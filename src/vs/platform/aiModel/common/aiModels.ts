/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../base/common/cancellation.js';
import { Event } from '../../../base/common/event.js';
import { IDisposable } from '../../../base/common/lifecycle.js';
import { AgentMode } from '../../aideAgent/common/model.js';
import { createDecorator } from '../../instantiation/common/instantiation.js';

export const humanReadableModelConfigKey: Record<string, string> = {
	'contextLength': 'Context Length',
	'temperature': 'Temperature',
	'deploymentID': 'Deployment ID',
	'modelId': 'Model ID'
};

export const modelConfigKeyDescription: Record<string, string> = {
	'provider': 'The provider you wish to use for this model',
	'contextLength': 'Maximum context length supported by the model',
	'temperature': 'The temperature setting for the model',
	'deploymentID': 'Deployment ID specified by the provider',
	'modelId': 'Unique identifier for the model as per provider\'s API'
};

export const humanReadableProviderConfigKey: Record<string, string> = {
	'apiKey': 'API Key',
	'apiBase': 'Base URL'
};

export const noConfigurationProviders = ['codestory', 'ollama'] as const;
export const apiKeyOnlyProviders = ['openai-default', 'togetherai', 'anthropic', 'fireworkai', 'geminipro', 'open-router', 'azure-openai'] as const;
export const openAICompatibleProvider = ['openai-compatible'] as const;
export const providerTypeValues = [...noConfigurationProviders, ...apiKeyOnlyProviders, ...openAICompatibleProvider] as const;
export type ProviderType = typeof providerTypeValues[number];

export interface AzureOpenAIModelProviderConfig {
	readonly type: 'azure-openai';
	readonly deploymentID: string;
}

export interface GenericModelProviderConfig {
	readonly type: Exclude<ProviderType, 'azure-openai'>;
}

export type ModelProviderConfig = AzureOpenAIModelProviderConfig | GenericModelProviderConfig;

export function isModelProviderConfig(obj: any): obj is ModelProviderConfig {
	return obj && typeof obj === 'object'
		&& 'type' in obj && typeof obj['type'] === 'string'
		&& ('deploymentID' in obj ? typeof obj['deploymentID'] === 'string' : true);
}

export interface ILanguageModelItem {
	readonly name: string;
	readonly contextLength: number;
	readonly temperature: number;
	readonly provider: ModelProviderConfig;
}

export function isLanguageModelItem(obj: any): obj is ILanguageModelItem {
	return obj && typeof obj === 'object'
		&& 'name' in obj && typeof obj['name'] === 'string'
		&& ('contextLength' in obj ? typeof obj['contextLength'] === 'number' : true)
		&& ('temperature' in obj ? typeof obj['temperature'] === 'number' : true)
		&& ('provider' in obj ? isModelProviderConfig(obj['provider']) : true);
}

export interface NoConfigurationProviderConfig {
	readonly name: string;
}

export interface ApiKeyOnlyProviderConfig extends NoConfigurationProviderConfig {
	readonly apiKey: string;
}

export interface OpenAICompatibleProviderConfig extends ApiKeyOnlyProviderConfig {
	readonly apiBase: string;
}

export type ProviderConfig = NoConfigurationProviderConfig | ApiKeyOnlyProviderConfig | OpenAICompatibleProviderConfig;

export type IModelProviders = {
	'codestory': NoConfigurationProviderConfig;
	'ollama': NoConfigurationProviderConfig;
	'openai-default': ApiKeyOnlyProviderConfig;
	'azure-openai': ApiKeyOnlyProviderConfig;
	'togetherai': ApiKeyOnlyProviderConfig;
	'anthropic': ApiKeyOnlyProviderConfig;
	'fireworkai': ApiKeyOnlyProviderConfig;
	'geminipro': ApiKeyOnlyProviderConfig;
	'open-router': ApiKeyOnlyProviderConfig;
	'openai-compatible': OpenAICompatibleProviderConfig;
};

export function isModelProviderItem(obj: any): obj is IModelProviders {
	return obj && typeof obj === 'object'
		&& 'name' in obj && typeof obj['name'] === 'string'
		&& ('apiKey' in obj ? typeof obj['apiKey'] === 'string' : true)
		&& ('apiBase' in obj ? typeof obj['apiBase'] === 'string' : true);
}

export interface IModelSelectionSettings {
	readonly slowModel: string;
	readonly fastModel: string;
	readonly models: Record<string, ILanguageModelItem>;
	readonly providers: IModelProviders;
}

export function isModelSelectionSettings(obj: any): obj is IModelSelectionSettings {
	return obj && typeof obj === 'object'
		&& ('slowModel' in obj ? typeof obj['slowModel'] === 'string' : true)
		&& ('fastModel' in obj ? typeof obj['fastModel'] === 'string' : true)
		&& ('models' in obj ? Object.keys(obj['models']).every(key => isLanguageModelItem(obj['models'][key])) : true)
		&& ('providers' in obj ? Object.keys(obj['providers']).every(key => isModelProviderItem(obj['providers'][key])) : true);
}

export const IAIModelSelectionService = createDecorator<IAIModelSelectionService>('aiModelSelectionService');
export interface IAIModelSelectionService {
	readonly _serviceBrand: undefined;
	onDidChangeModelSelection: Event<IModelSelectionSettings>;
	registerModelConfigValidator(validator: (data: IModelSelectionSettings, token: CancellationToken) => Promise<IModelSelectionValidationResponse>): IDisposable;
	/**
	 * Sends a request to sidecar using the model configuration's `slowModel`. Pings the provider of the indicated `slowModel` to see if it's valid.
	 * @param data IModelSelectionSettings
	 * @param token CancellationToken
	 */
	validateModelConfiguration(data: IModelSelectionSettings, token: CancellationToken): Promise<IModelSelectionValidationResponse>;
	validateCurrentModelSelection(): Promise<IModelSelectionValidationResponse>;
	checkIfModelIdIsTaken(modelId: string): Promise<[boolean, takenModel: ILanguageModelItem]>;
	checkIfCurrentModelSelectionSupportsAgenticFeatures(mode: AgentMode): Promise<{ supportsAgenticFeatures: boolean; currentModel: ILanguageModelItem }>;
	getDefaultModelSelectionContent(): string;
	getModelSelectionSettings(): Promise<IModelSelectionSettings>;
	getValidatedModelSelectionSettings(): Promise<IModelSelectionSettings>;
}

// default settings
export const defaultModelSelectionSettings: IModelSelectionSettings = {
	slowModel: 'ClaudeSonnet',
	fastModel: 'ClaudeHaiku',
	models: {
		'ClaudeSonnet': {
			name: 'Claude Sonnet',
			contextLength: 200000,
			temperature: 0.2,
			provider: {
				type: 'codestory'
			}
		},
		'ClaudeHaiku': {
			name: 'Claude Haiku',
			contextLength: 200000,
			temperature: 0.2,
			provider: {
				type: 'codestory'
			}
		},
		'gpt-4o': {
			name: 'GPT-4o',
			contextLength: 128000,
			temperature: 0.2,
			provider: {
				type: 'codestory'
			}
		},
		'o1-mini': {
			name: 'o1-mini',
			contextLength: 128000,
			temperature: 0.2,
			provider: {
				type: 'codestory'
			}
		},
		'o1-preview': {
			name: 'o1-preview',
			contextLength: 128000,
			temperature: 0.2,
			provider: {
				type: 'openai-default'
			}
		},
		'gemini-1.5-pro': {
			name: 'Gemini 1.5 Pro',
			contextLength: 1000000,
			temperature: 0.2,
			provider: {
				type: 'codestory',
			}
		},
		'qwen/qwen-2.5-coder-32b-instruct': {
			name: 'Qwen2.5 Coder 32B Instruct',
			contextLength: 32768,
			temperature: 0.2,
			provider: {
				type: 'open-router',
			}
		},
		'deepseek/deepseek-chat': {
			name: 'DeepSeek V3',
			contextLength: 65536,
			temperature: 0.2,
			provider: {
				type: 'codestory',
			}
		},
		'gemini-2.0-flash-exp': {
			name: 'Gemini 2.0 Flash Exp',
			contextLength: 1000000,
			temperature: 0.2,
			provider: {
				type: 'geminipro',
			}
		},
		'gemini-2.0-flash-thinking-exp-1219': {
			name: 'Gemini 2.0 Flash Thinking Experimental',
			contextLength: 32000,
			temperature: 0.2,
			provider: {
				type: 'geminipro',
			}
		},
		'deepseek/deepseek-r1': {
			name: "DeepSeek r1",
			contextLength: 64000,
			temperature: 0.2,
			provider: {
				'type': 'codestory',
			}
		},
	},
	providers: {
		'codestory': {
			name: 'CodeStory'
		},
		'anthropic': {
			name: 'Anthropic',
			apiKey: '',
		},
		'openai-default': {
			name: 'OpenAI',
			apiKey: '',
		},
		'geminipro': {
			name: 'Gemini',
			apiKey: '',
		},
		'open-router': {
			name: 'Open Router',
			apiKey: '',
		},
		'openai-compatible': {
			name: 'OpenAI Compatible',
			apiBase: '',
			apiKey: '',
		},
		'ollama': {
			name: 'Ollama'
		},
		'azure-openai': {
			name: 'Azure OpenAI',
			apiKey: '',
		},
		'togetherai': {
			name: 'Together AI',
			apiKey: '',
		},
		'fireworkai': {
			name: 'Fireworks AI',
			apiKey: '',
		},
	}
} as const;


export interface IModelSelectionValidationResponse {
	readonly valid: boolean;
	readonly error?: string;
}

export type ModelConfigValidator = (data: IModelSelectionSettings, token: CancellationToken) => Promise<IModelSelectionValidationResponse>;
