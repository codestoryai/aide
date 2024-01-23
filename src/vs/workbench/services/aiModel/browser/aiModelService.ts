/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as nls from 'vs/nls';

// base
import { RunOnceScheduler } from 'vs/base/common/async';
import { Emitter, Event } from 'vs/base/common/event';
import { parse } from 'vs/base/common/json';
import { IJSONSchema } from 'vs/base/common/jsonSchema';
import { Disposable, DisposableStore } from 'vs/base/common/lifecycle';
import * as objects from 'vs/base/common/objects';
import { dirname } from 'vs/base/common/resources';
import { Mutable } from 'vs/base/common/types';

// platform
import { IAIModelSelectionService, ILanguageModelItem, IModelProviders, IModelSelectionSettings, ProviderConfig, ProviderType, defaultModelSelectionSettings, isDefaultProviderConfig, isModelSelectionSettings } from 'vs/platform/aiModel/common/aiModels';
import { FileOperation, IFileService } from 'vs/platform/files/common/files';
import { InstantiationType, registerSingleton } from 'vs/platform/instantiation/common/extensions';
import { Extensions, IJSONContributionRegistry } from 'vs/platform/jsonschemas/common/jsonContributionRegistry';
import { ILogService } from 'vs/platform/log/common/log';
import { Registry } from 'vs/platform/registry/common/platform';
import { IUriIdentityService } from 'vs/platform/uriIdentity/common/uriIdentity';

// workbench
import { IUserDataProfileService } from 'vs/workbench/services/userDataProfile/common/userDataProfile';

export class AIModelsService extends Disposable implements IAIModelSelectionService {
	_serviceBrand: undefined;

	private modelSelection: ModelSelection;

	private readonly _onDidChangeModelSelection: Emitter<IModelSelectionSettings> = this._register(new Emitter<IModelSelectionSettings>());
	public readonly onDidChangeModelSelection: Event<IModelSelectionSettings> = this._onDidChangeModelSelection.event;

	constructor(
		@IUserDataProfileService userDataProfileService: IUserDataProfileService,
		@IUriIdentityService uriIdentityService: IUriIdentityService,
		@IFileService fileService: IFileService,
		@ILogService logService: ILogService,
	) {
		super();

		new ModelSelectionJsonSchema();
		this.modelSelection = this._register(new ModelSelection(userDataProfileService, uriIdentityService, fileService, logService));
		this._register(this.modelSelection.onDidChange((modelSelection) => {
			this._onDidChangeModelSelection.fire(modelSelection);
		}));
		this.modelSelection.initialize();
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

	async getValidatedModelSelectionSettings(): Promise<IModelSelectionSettings> {
		const modelSelection = await this.getModelSelectionSettings();
		const validatedProviders = Object.keys(modelSelection.providers).reduce((untypedAcc, untypedKey) => {
			const key = untypedKey as ProviderType;
			const acc = untypedAcc as { [key: string]: ProviderConfig };
			const provider = modelSelection.providers[key as keyof typeof modelSelection.providers] as ProviderConfig;
			if (provider.name === 'Azure OpenAI' && (isDefaultProviderConfig(key, provider) || (provider.apiBase.length > 0 && provider.apiKey.length > 0))) {
				acc[key] = provider;
			} else if ((provider.name === 'OpenAI' || provider.name === 'Together AI') && (provider.apiKey?.length ?? 0) > 0) {
				acc[key] = provider;
			} else if (provider.name === 'CodeStory' || provider.name === 'Ollama') {
				acc[key] = provider;
			}
			return acc as IModelProviders;
		}, {} as IModelProviders);
		const validatedModels = Object.keys(modelSelection.models).reduce((untypedAcc, key) => {
			const untypedValidatedProviders = validatedProviders as { [key: string]: ProviderConfig };
			const model = modelSelection.models[key];
			const acc = untypedAcc as { [key: string]: ILanguageModelItem };
			if (model.name.length > 0
				&& model.contextLength > 0
				&& model.temperature >= 0 && model.temperature <= 2
				&& model.provider
				&& untypedValidatedProviders[model.provider.type]) {
				if (model.provider.type === 'azure-openai' && model.provider.deploymentID.length > 0) {
					acc[key] = model;
				} else if (model.provider.type === 'codestory'
					|| model.provider.type === 'openai-default'
					|| model.provider.type === 'togetherai'
					|| model.provider.type === 'ollama') {
					acc[key] = model;
				}
			}
			return acc;
		}, {} as Record<string, ILanguageModelItem>);
		// TODO(ghostwriternr): Handle this better once we start charging our users.
		let modelSelectionSettings = {
			slowModel: modelSelection.slowModel,
			fastModel: modelSelection.fastModel,
			models: validatedModels,
			providers: validatedProviders
		} as IModelSelectionSettings;
		['slowModel', 'fastModel'].forEach(untypedModelType => {
			const untypedModelSelectionSettings = modelSelectionSettings as Mutable<Omit<IModelSelectionSettings, 'providers'>> & { ['providers']: { [key: string]: ProviderConfig } };
			const modelType = untypedModelType as 'slowModel' | 'fastModel';
			if (!validatedModels[modelSelection[modelType]]) {
				untypedModelSelectionSettings[modelType] = defaultModelSelectionSettings[modelType];
				const matchingDefaultModel = defaultModelSelectionSettings.models[defaultModelSelectionSettings[modelType] as keyof typeof defaultModelSelectionSettings.models] as ILanguageModelItem;
				const matchingDefaultProvider = defaultModelSelectionSettings.providers[defaultModelSelectionSettings[modelType] as keyof typeof defaultModelSelectionSettings.providers] as ProviderConfig;
				untypedModelSelectionSettings.models[modelSelectionSettings[modelType] as keyof typeof modelSelectionSettings.models] = matchingDefaultModel;
				untypedModelSelectionSettings.providers[modelSelectionSettings[modelType]] = matchingDefaultProvider;
			}
			modelSelectionSettings = untypedModelSelectionSettings as IModelSelectionSettings;
		});
		return modelSelectionSettings;
	}
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
			'providers': {
				'oneOf': [
					{ '$ref': '#/definitions/codestoryProvider' },
					{ '$ref': '#/definitions/openaiProvider' },
					{ '$ref': '#/definitions/azureOpenAIProvider' },
					{ '$ref': '#/definitions/togetherAIProvider' },
					{ '$ref': '#/definitions/ollamaProvider' }
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
						'enum': ['codestory', 'openai-default', 'togetherai', 'ollama'],
						'description': nls.localize('modelSelection.json.genericModelProviderConfig.type', 'Type of the provider')
					}
				},
				'required': ['type']
			},
			'modelProviderConfig': {
				'oneOf': [
					{ '$ref': '#/definitions/azureOpenAIModelProviderConfig' },
					{ '$ref': '#/definitions/genericModelProviderConfig' }
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
