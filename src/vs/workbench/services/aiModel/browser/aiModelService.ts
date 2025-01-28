/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { RunOnceScheduler } from '../../../../base/common/async.js';
import { CancellationToken, CancellationTokenSource } from '../../../../base/common/cancellation.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { parse } from '../../../../base/common/json.js';
import { IJSONSchema } from '../../../../base/common/jsonSchema.js';
import { Disposable, DisposableStore, IDisposable, toDisposable } from '../../../../base/common/lifecycle.js';
import * as objects from '../../../../base/common/objects.js';
import { dirname } from '../../../../base/common/resources.js';
import * as nls from '../../../../nls.js';
import { ApiKeyOnlyProviderConfig, apiKeyOnlyProviders, defaultModelSelectionSettings, IAIModelSelectionService, ILanguageModelItem, IModelSelectionSettings, IModelSelectionValidationResponse, isModelSelectionSettings, ModelConfigValidator, noConfigurationProviders, openAICompatibleProvider, OpenAICompatibleProviderConfig, ProviderConfig } from '../../../../platform/aiModel/common/aiModels.js';
import { FileOperation, IFileService } from '../../../../platform/files/common/files.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { Extensions, IJSONContributionRegistry } from '../../../../platform/jsonschemas/common/jsonContributionRegistry.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { IUriIdentityService } from '../../../../platform/uriIdentity/common/uriIdentity.js';
import { AgentMode } from '../../../../platform/aideAgent/common/model.js';
import { IUserDataProfileService } from '../../userDataProfile/common/userDataProfile.js';

export const allowedProviders = new Set([
	'codestory',
	'openai-default',
	'togetherai',
	'openai-compatible',
	'ollama',
	'anthropic',
	'fireworkai',
	'geminipro',
	'open-router'
]);

export class AIModelsService extends Disposable implements IAIModelSelectionService {
	_serviceBrand: undefined;

	private modelSelection: ModelSelection;
	private modelConfigValidator: ModelConfigValidator | undefined;
	private didValidateCurrentModelSelection = false;
	private _isCurrentModelSelectionValid: IModelSelectionValidationResponse = { valid: false };

	get isCurrentModelSelectionValid() {
		return this._isCurrentModelSelectionValid;
	}

	private readonly _onDidChangeModelSelection: Emitter<IModelSelectionSettings> = this._register(new Emitter<IModelSelectionSettings>());
	public readonly onDidChangeModelSelection: Event<IModelSelectionSettings> = this._onDidChangeModelSelection.event;

	constructor(
		@IUserDataProfileService userDataProfileService: IUserDataProfileService,
		@IUriIdentityService uriIdentityService: IUriIdentityService,
		@IFileService fileService: IFileService,
		@ILogService logService: ILogService,
		@IInstantiationService private readonly instantiationService: IInstantiationService
	) {
		super();

		new ModelSelectionJsonSchema();
		this.modelSelection = this._register(new ModelSelection(userDataProfileService, uriIdentityService, fileService, logService));
		this._register(this.modelSelection.onDidChange((modelSelection) => {
			this.didValidateCurrentModelSelection = false;
			this._onDidChangeModelSelection.fire(modelSelection);
		}));
		this.modelSelection.initialize();
	}

	public async validateCurrentModelSelection() {
		if (this.didValidateCurrentModelSelection) {
			return this._isCurrentModelSelectionValid;
		} else {
			const modelSelectionSettings = await this.getValidatedModelSelectionSettings();
			const cancellationTokenSource = this._register(this.instantiationService.createInstance(CancellationTokenSource));
			const configValidation = await this.validateModelConfiguration(modelSelectionSettings, cancellationTokenSource.token);
			this.didValidateCurrentModelSelection = true;
			return this._isCurrentModelSelectionValid = configValidation;
		}
	}

	public getDefaultModelSelectionContent(): string {
		return JSON.stringify(defaultModelSelectionSettings, null, '\t');
	}

	async getModelSelectionSettings(): Promise<IModelSelectionSettings> {
		const modelSelection = this.modelSelection.modelSelection;
		if (!modelSelection) {
			await this.modelSelection.initialize();
		}
		return this.modelSelection.modelSelection!;
	}

	async checkIfCurrentModelSelectionSupportsAgenticFeatures(mode: AgentMode) {
		const modelSelection = await this.getModelSelectionSettings();
		const currentModelId = modelSelection.slowModel;
		const currentModel = modelSelection.models[currentModelId];
		// Temporary, half-assed check
		const supportsAgenticFeatures = mode === AgentMode.Chat || currentModelId.toLocaleLowerCase().includes('sonnet');
		return {
			currentModel,
			supportsAgenticFeatures
		};
	}

	async checkIfModelIdIsTaken(modelId: string): Promise<[boolean, takenModel: ILanguageModelItem]> {
		const modelSelection = await this.getModelSelectionSettings();
		const takenModel = modelSelection.models[modelId];
		return [takenModel !== undefined, takenModel];
	}

	async getValidatedModelSelectionSettings(): Promise<IModelSelectionSettings> {
		const modelSelection = await this.getModelSelectionSettings();

		// Validate providers
		const validatedProviders = this.validateProviders(modelSelection.providers);

		// Validate models and check for duplicates
		const validatedModels = this.validateModels(modelSelection.models, validatedProviders);

		// Create a mutable copy of the selection settings,
		// since we need to adjust them if defaults are required.
		const mutableSettings: {
			slowModel: string;
			fastModel: string;
			models: Record<string, ILanguageModelItem>;
			providers: Record<string, ProviderConfig>;
		} = {
			slowModel: modelSelection.slowModel,
			fastModel: modelSelection.fastModel,
			models: { ...validatedModels },
			providers: { ...validatedProviders }
		};

		// Ensure slowModel and fastModel are valid or fallback to defaults
		(['slowModel', 'fastModel'] as const).forEach(modelType => {
			const chosenModelKey = modelSelection[modelType];
			if (!mutableSettings.models[chosenModelKey]) {
				console.warn(`Invalid model selection setting for ${modelType}: ${chosenModelKey}. Falling back to default.`);
				// Fallback to default
				const defaultKey = defaultModelSelectionSettings[modelType];
				const defaultModel = defaultModelSelectionSettings.models[defaultKey] as ILanguageModelItem;
				const defaultProvider = defaultModelSelectionSettings.providers[defaultModel.provider.type] as ProviderConfig;

				mutableSettings[modelType] = defaultKey;
				mutableSettings.models[defaultKey] = defaultModel;
				mutableSettings.providers[defaultKey] = defaultProvider;
			}
		});

		// Now cast back to the desired return type (assuming it's compatible)
		return {
			slowModel: mutableSettings.slowModel,
			fastModel: mutableSettings.fastModel,
			models: mutableSettings.models,
			providers: mutableSettings.providers
		} as IModelSelectionSettings;
	}

	/** Validate and filter providers based on their required configurations. */
	private validateProviders(providers: Record<string, ProviderConfig>): Record<string, ProviderConfig> {
		const validated: Record<string, ProviderConfig> = {};
		for (const [key, provider] of Object.entries(providers)) {
			if (this.isValidOpenAICompatibleProvider(key, provider)) {
				validated[key] = provider;
			} else if (this.isValidApiKeyOnlyProvider(key, provider)) {
				validated[key] = provider;
			} else if (this.isNoConfigurationProvider(key)) {
				validated[key] = provider;
			}
		}
		return validated;
	}

	/** Validate and filter models. Check duplicates and ensure each model references a valid provider. */
	private validateModels(
		models: Record<string, ILanguageModelItem>,
		validatedProviders: Record<string, ProviderConfig>
	): Record<string, ILanguageModelItem> {
		const result: Record<string, ILanguageModelItem> = {};
		for (const [key, model] of Object.entries(models)) {
			if (result[key]) {
				// Duplicate detected; log a warning and keep the first one.
				console.warn(`Duplicate model key detected: "${key}". Ignoring subsequent entries.`);
				continue;
			}
			if (this.isValidModel(model, validatedProviders)) {
				result[key] = model;
			}
		}
		return result;
	}

	/** Check if a provider key and config is valid for openAI-compatible providers. */
	private isValidOpenAICompatibleProvider(key: string, provider: ProviderConfig): provider is OpenAICompatibleProviderConfig {
		return openAICompatibleProvider.includes(key as typeof openAICompatibleProvider[number])
			&& typeof (provider as OpenAICompatibleProviderConfig).apiBase === 'string'
			&& (provider as OpenAICompatibleProviderConfig).apiBase.length > 0
			&& typeof (provider as OpenAICompatibleProviderConfig).apiKey === 'string'
			&& (provider as OpenAICompatibleProviderConfig).apiKey.length > 0;
	}

	/** Check if a provider key and config is valid for apiKey-only providers. */
	private isValidApiKeyOnlyProvider(key: string, provider: ProviderConfig): provider is ApiKeyOnlyProviderConfig {
		return apiKeyOnlyProviders.includes(key as typeof apiKeyOnlyProviders[number])
			&& typeof (provider as ApiKeyOnlyProviderConfig).apiKey === 'string'
			&& (provider as ApiKeyOnlyProviderConfig).apiKey.length > 0;
	}

	/** Check if a provider requires no configuration. */
	private isNoConfigurationProvider(key: string): boolean {
		return noConfigurationProviders.includes(key as typeof noConfigurationProviders[number]);
	}

	/** Validate a single model against required constraints and ensure its provider is validated. */
	private isValidModel(model: ILanguageModelItem, validatedProviders: Record<string, ProviderConfig>): boolean {
		// Basic checks
		const baseChecks = model.name.length > 0
			&& model.contextLength > 0
			&& model.temperature >= 0 && model.temperature <= 2
			&& model.provider
			&& validatedProviders[model.provider.type];

		if (!baseChecks) { return false; }

		// Additional check for azure-openai
		if (model.provider.type === 'azure-openai') {
			return typeof model.provider.deploymentID === 'string' && model.provider.deploymentID.length > 0;
		}
		// For other supported provider types, no extra conditions:
		return allowedProviders.has(model.provider.type);
	}


	registerModelConfigValidator(validator: ModelConfigValidator): IDisposable {
		this.modelConfigValidator = validator;
		return toDisposable(() => {
			this.modelConfigValidator = undefined;
		});
	}

	async alwaysValidConfiguration(): Promise<IModelSelectionValidationResponse> {
		return {
			valid: true,
			error: undefined,
		};
	}

	validateModelConfiguration(data: IModelSelectionSettings, token: CancellationToken): Promise<IModelSelectionValidationResponse> {
		if (!this.modelConfigValidator) {
			console.error('Unable to validate model configuration. Please let us know if you see this!');
		}
		// if (!this.modelConfigValidator) {
		// 	return Promise.resolve({ valid: false, error: 'Unable to validate model configuration. This is likely an issue at our end. Please let us know!' });
		// }
		// return this.modelConfigValidator(data, token);
		// TODO(codestory): How did we ever feel comfortable throwing error at people's face
		// thats really bad... and this is part of the login initialisation
		// reverting this, please never let system failures block users from using the product
		return this.alwaysValidConfiguration();
	}
}

export function checkIfDefaultModel(modelKey: string): boolean {
	return new Set(Object.keys(defaultModelSelectionSettings.models)).has(modelKey);
}

class ModelSelection extends Disposable {
	private _rawModelSelection: Object = {};

	private _modelSelection: IModelSelectionSettings | undefined;
	get modelSelection() { return this._modelSelection; }

	private readonly reloadConfigurationScheduler: RunOnceScheduler;

	private readonly watchDisposables = this._register(new DisposableStore());

	private readonly _onDidChange: Emitter<IModelSelectionSettings> = this._register(new Emitter<IModelSelectionSettings>());
	readonly onDidChange: Event<IModelSelectionSettings> = this._onDidChange.event;

	constructor(
		private readonly userDataProfileService: IUserDataProfileService,
		private readonly uriIdentityService: IUriIdentityService,
		private readonly fileService: IFileService,
		logService: ILogService,
	) {
		super();

		this.watch();

		this.reloadConfigurationScheduler = this._register(new RunOnceScheduler(() => this.reload().then(changed => {
			if (changed) {
				this._onDidChange.fire(this._modelSelection!);
			}
		}), 50));

		this._register(Event.filter(this.fileService.onDidFilesChange, e => e.contains(this.userDataProfileService.currentProfile.modelSelectionResource))(() => {
			logService.debug('Model selection file changed');
			this.reloadConfigurationScheduler.schedule();
		}));

		this._register(this.fileService.onDidRunOperation((e) => {
			if (e.operation === FileOperation.WRITE && e.resource.toString() === this.userDataProfileService.currentProfile.modelSelectionResource.toString()) {
				logService.debug('Model selection file written');
				this.reloadConfigurationScheduler.schedule();
			}
		}));

		this._register(userDataProfileService.onDidChangeCurrentProfile(e => {
			if (!this.uriIdentityService.extUri.isEqual(e.previous.modelSelectionResource, e.profile.modelSelectionResource)) {
				e.join(this.whenCurrentProfileChanged());
			}
		}));
	}

	private async whenCurrentProfileChanged(): Promise<void> {
		this.watch();
		this.reloadConfigurationScheduler.schedule();
	}

	private watch(): void {
		this.watchDisposables.clear();
		this.watchDisposables.add(this.fileService.watch(dirname(this.userDataProfileService.currentProfile.modelSelectionResource)));
		// Also listen to the resource incase the resource is a symlink - https://github.com/microsoft/vscode/issues/118134
		this.watchDisposables.add(this.fileService.watch(this.userDataProfileService.currentProfile.modelSelectionResource));
	}

	async initialize(): Promise<void> {
		const newModelSelection = await this.readModelSelectionSettings();
		this._rawModelSelection = newModelSelection;
		this._modelSelection = this.mergeModelSelectionSettings(newModelSelection);
	}

	private async reload(): Promise<boolean> {
		const newModelSelection = await this.readModelSelectionSettings();
		if (objects.equals(this._rawModelSelection, newModelSelection)) {
			// no change
			return false;
		}

		this._rawModelSelection = newModelSelection;
		this._modelSelection = this.mergeModelSelectionSettings(newModelSelection);
		return true;
	}

	private async readModelSelectionSettings(): Promise<Object> {
		try {
			const content = await this.fileService.readFile(this.userDataProfileService.currentProfile.modelSelectionResource);
			const value = parse(content.value.toString());
			return isModelSelectionSettings(value) ? value : {};
		} catch (e) {
			return {};
		}
	}

	private mergeModelSelectionSettings(modelSelectionSettings: Object): IModelSelectionSettings {
		const mergedSettings = { ...defaultModelSelectionSettings };
		if (modelSelectionSettings && isModelSelectionSettings(modelSelectionSettings)) {
			if (modelSelectionSettings.models) {
				mergedSettings.models = { ...defaultModelSelectionSettings.models, ...modelSelectionSettings.models };
			}
			if (modelSelectionSettings.providers) {
				mergedSettings.providers = { ...defaultModelSelectionSettings.providers, ...modelSelectionSettings.providers };
			}

			if (modelSelectionSettings.slowModel && mergedSettings.models[modelSelectionSettings.slowModel]) {
				mergedSettings.slowModel = modelSelectionSettings.slowModel;
			}
			if (modelSelectionSettings.fastModel && mergedSettings.models[modelSelectionSettings.fastModel]) {
				mergedSettings.fastModel = modelSelectionSettings.fastModel;
			}
		}
		return mergedSettings;
	}
}

class ModelSelectionJsonSchema {
	private static readonly schemaId = 'vscode://schemas/modelSelection';

	private readonly schema: IJSONSchema = {
		id: ModelSelectionJsonSchema.schemaId,
		type: 'object',
		title: nls.localize('modelSelection.json.title', "Model Selection Settings"),
		allowTrailingCommas: true,
		allowComments: true,
		definitions: {
			'codestoryProvider': {
				'type': 'object',
				'properties': {
					'codestory': {
						'type': 'object',
						'properties': {
							'name': {
								'enum': ['CodeStory'],
								'description': nls.localize('modelSelection.json.codestoryProvider.name', 'Name of the provider')
							}
						},
						'required': ['name']
					}
				}
			},
			'openaiProvider': {
				'type': 'object',
				'properties': {
					'openai-default': {
						'type': 'object',
						'properties': {
							'name': {
								'enum': ['OpenAI'],
								'description': nls.localize('modelSelection.json.openaiProvider.name', 'Name of the provider'),
								'$vocabulary': 'openaiProviderName'
							},
							'apiKey': {
								'type': 'string',
								'description': nls.localize('modelSelection.json.openaiProvider.apiKey', 'API key for the provider')
							}
						},
						'required': ['name']
					}
				}
			},
			'azureOpenAIProvider': {
				'type': 'object',
				'properties': {
					'azure-openai': {
						'type': 'object',
						'properties': {
							'name': {
								'enum': ['Azure OpenAI'],
								'description': nls.localize('modelSelection.json.azureOpenAIProvider.name', 'Name of the provider'),
								'$vocabulary': 'azureOpenAIProviderName'
							},
							'apiBase': {
								'type': 'string',
								'description': nls.localize('modelSelection.json.azureOpenAIProvider.apiBase', 'Base URL of the provider\'s API')
							},
							'apiKey': {
								'type': 'string',
								'description': nls.localize('modelSelection.json.azureOpenAIProvider.apiKey', 'API key for the provider')
							}
						},
						'required': ['name', 'apiBase', 'apiKey']
					}
				},
			},
			'togetherAIProvider': {
				'type': 'object',
				'properties': {
					'togetherai': {
						'type': 'object',
						'properties': {
							'name': {
								'enum': ['Together AI'],
								'description': nls.localize('modelSelection.json.togetherAIProvider.name', 'Name of the provider')
							},
							'apiKey': {
								'type': 'string',
								'description': nls.localize('modelSelection.json.togetherAIProvider.apiKey', 'API key for the provider')
							}
						},
						'required': ['name', 'apiKey']
					}
				}
			},
			'ollamaProvider': {
				'type': 'object',
				'properties': {
					'ollama': {
						'type': 'object',
						'properties': {
							'name': {
								'enum': ['Ollama'],
								'description': nls.localize('modelSelection.json.ollamaProvider.name', 'Name of the provider')
							}
						},
						'required': ['name']
					}
				}
			},
			'openAICompatibleProvider': {
				'type': 'object',
				'properties': {
					'openai-compatible': {
						'type': 'object',
						'properties': {
							'name': {
								'enum': ['OpenAI Compatible'],
								'description': nls.localize('modelSelection.json.openAICompatibleProvider.name', 'Name of the provider')
							},
							'apiKey': {
								'type': 'string',
								'description': nls.localize('modelSelection.json.openAICompatibleProvider.apiKey', 'API key for the provider')
							},
							'apiBase': {
								'type': 'string',
								'description': nls.localize('modelSelection.json.openAICompatibleProvider.apiBase', 'Base URL of the provider\'s API')
							}
						},
						'required': ['name', 'apiKey', 'apiBase']
					}
				}
			},
			'anthropicProvider': {
				'type': 'object',
				'properties': {
					'anthropic': {
						'type': 'object',
						'properties': {
							'name': {
								'enum': ['Anthropic'],
								'description': nls.localize('modelSelection.json.anthropicProvider.name', 'Name of the provider')
							},
							'apiKey': {
								'type': 'string',
								'description': nls.localize('modelSelection.json.anthropicProvider.apiKey', 'API key for the provider')
							}
						},
						'required': ['name', 'apiKey']
					}
				}
			},
			'fireworksaiProvider': {
				'type': 'object',
				'properties': {
					'fireworksai': {
						'type': 'object',
						'properties': {
							'name': {
								'enum': ['Fireworks AI'],
								'description': nls.localize('modelSelection.json.fireworkaiProvider.name', 'Name of the provider')
							},
							'apiKey': {
								'type': 'string',
								'description': nls.localize('modelSelection.json.fireworkaiProvider.apiKey', 'API key for the provider')
							}
						},
						'required': ['name', 'apiKey']
					}
				}
			},
			'geminiProProvider': {
				'type': 'object',
				'properties': {
					'geminipro': {
						'type': 'object',
						'properties': {
							'name': {
								'enum': ['Gemini Pro 1.5'],
								'description': nls.localize('modelSelection.json.geminiProProvider.name', 'Name of the provider')
							},
							'apiKey': {
								'type': 'string',
								'description': nls.localize('modelSelection.json.geminiProProvider.apiKey', 'API key for the provider')
							},
							'apiBase': {
								'type': 'string',
								'description': nls.localize('modelSelection.json.geminiProProvider.apiBase', 'Base URL of the provider\'s API')
							}
						},
						'required': ['name', 'apiKey']
					}
				}
			},
			'openRouterProvider': {
				'type': 'object',
				'properties': {
					'open-router': {
						'type': 'object',
						'properties': {
							'name': {
								'enum': ['Open Router'],
								'description': nls.localize('modelSelection.json.openRouterProvider.name', 'Name of the provider')
							},
							'apiKey': {
								'type': 'string',
								'description': nls.localize('modelSelection.json.openRouterProvider.apiKey', 'API key for the provider')
							},
						},
						'required': ['name', 'apiKey']
					}
				}
			},
			'providers': {
				'oneOf': [
					{ '$ref': '#/definitions/codestoryProvider' },
					{ '$ref': '#/definitions/openaiProvider' },
					{ '$ref': '#/definitions/azureOpenAIProvider' },
					{ '$ref': '#/definitions/togetherAIProvider' },
					{ '$ref': '#/definitions/openAICompatibleProvider' },
					{ '$ref': '#/definitions/ollamaProvider' },
					{ '$ref': '#/definitions/anthropicProvider' },
					{ '$ref': '#/definitions/fireworksaiProvider' },
					{ '$ref': '#/definitions/geminiProProvider' },
					{ '$ref': '#/definitions/openRouterProvider' }
				]
			},
			'azureOpenAIModelProviderConfig': {
				'type': 'object',
				'properties': {
					'type': {
						'enum': ['azure-openai'],
						'description': nls.localize('modelSelection.json.azureOpenAIModelProviderConfig.type', 'Type of the provider')
					},
					'deploymentID': {
						'type': 'string',
						'description': nls.localize('modelSelection.json.azureOpenAIModelProviderConfig.deploymentID', 'Deployment ID configured on the provider')
					}
				},
				'required': ['type', 'deploymentID']
			},
			'genericModelProviderConfig': {
				'type': 'object',
				'properties': {
					'type': {
						'enum': ['codestory', 'openai-default', 'togetherai', 'openai-compatible', 'ollama', 'anthropic', 'fireworkai', 'geminipro', 'open-router'],
						'description': nls.localize('modelSelection.json.genericModelProviderConfig.type', 'Type of the provider')
					}
				},
				'required': ['type']
			},
			'modelProviderConfig': {
				'oneOf': [
					{ '$ref': '#/definitions/genericModelProviderConfig' },
					{ '$ref': '#/definitions/azureOpenAIModelProviderConfig' }
				]
			},
			'model': {
				'type': 'object',
				'properties': {
					'name': {
						'type': 'string',
						'description': nls.localize('modelSelection.json.model.name', 'Name of the model')
					},
					'contextLength': {
						'type': 'number',
						'description': nls.localize('modelSelection.json.model.contextLength', 'Context length of the model')
					},
					'temperature': {
						'type': 'number',
						'description': nls.localize('modelSelection.json.model.temperature', 'Temperature to use in requests')
					},
					'provider': {
						'$ref': '#/definitions/modelProviderConfig',
						'description': nls.localize('modelSelection.json.model.provider', 'Provider for the model')
					}
				},
				'required': ['name', 'contextLength', 'temperature', 'provider']
			}
		},
		properties: {
			'slowModel': {
				'type': 'string',
				'description': nls.localize('modelSelection.json.slowModel', 'Model to use for sidebar chat')
			},
			'fastModel': {
				'type': 'string',
				'description': nls.localize('modelSelection.json.fastModel', 'Model to use for inline chat')
			},
			'models': {
				'type': 'object',
				'description': nls.localize('modelSelection.json.models', 'Configuration for supported models'),
				'additionalProperties': {
					'$ref': '#/definitions/model'
				}
			},
			'providers': {
				'$ref': '#/definitions/providers',
				'description': nls.localize('modelSelection.json.providers', 'Configuration for supported providers'),
			}
		}
	};

	private readonly schemaRegistry = Registry.as<IJSONContributionRegistry>(Extensions.JSONContribution);

	constructor() {
		this.schemaRegistry.registerSchema(ModelSelectionJsonSchema.schemaId, this.schema);
	}
}

registerSingleton(IAIModelSelectionService, AIModelsService, InstantiationType.Eager);
