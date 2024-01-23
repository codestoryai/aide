/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from 'vs/base/common/event';
import { createDecorator } from 'vs/platform/instantiation/common/instantiation';

export const humanReadableModelConfigKey: Record<string, string> = {
	'contextLength': 'Context Length',
	'temperature': 'Temperature',
	'deploymentID': 'Deployment ID'
};

export const humanReadableProviderConfigKey: Record<string, string> = {
	'apiKey': 'API Key',
	'apiBase': 'Base URL'
};

export type ProviderType = 'codestory' | 'openai-default' | 'azure-openai' | 'togetherai' | 'ollama';
export const providerTypeValues: ProviderType[] = ['codestory', 'openai-default', 'azure-openai', 'togetherai', 'ollama'];

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

export interface CodeStoryProviderConfig {
	readonly name: 'CodeStory';
}

export interface OpenAIProviderConfig {
	readonly name: 'OpenAI';
	readonly apiKey?: string;
}

export interface AzureOpenAIProviderConfig {
	readonly name: 'Azure OpenAI';
	readonly apiBase: string;
	readonly apiKey: string;
}

export interface TogetherAIProviderConfig {
	readonly name: 'Together AI';
	readonly apiKey: string;
}

export interface OllamaProviderConfig {
	readonly name: 'Ollama';
}

export type ProviderConfig = CodeStoryProviderConfig | OpenAIProviderConfig | AzureOpenAIProviderConfig | TogetherAIProviderConfig | OllamaProviderConfig;
export type ProviderConfigsWithAPIKey = Exclude<ProviderConfig, CodeStoryProviderConfig | OllamaProviderConfig>;

export type IModelProviders =
	{ 'codestory': CodeStoryProviderConfig }
	| { 'openai-default': OpenAIProviderConfig }
	| { 'azure-openai': AzureOpenAIProviderConfig }
	| { 'togetherai': TogetherAIProviderConfig }
	| { 'ollama': OllamaProviderConfig };

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

	getDefaultModelSelectionContent(): string;
	getModelSelectionSettings(): Promise<IModelSelectionSettings>;
	getValidatedModelSelectionSettings(): Promise<IModelSelectionSettings>;
}

export const defaultModelSelectionSettings: IModelSelectionSettings = {
	slowModel: 'Gpt4',
	fastModel: 'GPT3_5_16k',
	models: {
		'Gpt4': {
			name: 'GPT-4',
			contextLength: 8192,
			temperature: 0.2,
			provider: {
				type: 'codestory'
			}
		},
		'GPT3_5_16k': {
			name: 'GPT-3.5 Turbo 16k',
			contextLength: 16385,
			temperature: 0.2,
			provider: {
				type: 'codestory'
			}
		},
		'Gpt4Turbo': {
			name: 'GPT-4 Turbo',
			contextLength: 128000,
			temperature: 0.2,
			provider: {
				type: 'openai-default'
			}
		},
		'Gpt4_32k': {
			name: 'GPT-4 32k',
			contextLength: 32768,
			temperature: 0.2,
			provider: {
				type: 'openai-default'
			}
		},
		'GPT3_5': {
			name: 'GPT-3.5 Turbo',
			contextLength: 4096,
			temperature: 0.2,
			provider: {
				type: 'openai-default'
			}
		},
		'Mixtral': {
			name: 'Mixtral',
			contextLength: 32000,
			temperature: 0.2,
			provider: {
				type: 'togetherai'
			}
		},
		'MistralInstruct': {
			name: 'Mistral 7B Instruct',
			contextLength: 8000,
			temperature: 0.2,
			provider: {
				type: 'togetherai'
			}
		},
	},
	providers: {
		'codestory': {
			name: 'CodeStory'
		},
		'openai-default': {
			name: 'OpenAI',
			apiKey: '',
		},
		'azure-openai': {
			name: 'Azure OpenAI',
			apiBase: '',
			apiKey: '',
		},
		'togetherai': {
			name: 'Together AI',
			apiKey: '',
		},
		'ollama': {
			name: 'Ollama'
		}
	}
};

export const supportedModels: Record<ProviderType, string[]> = {
	'codestory': ['Gpt4', 'GPT3_5_16k'],
	'openai-default': ['Gpt4Turbo', 'Gpt4_32k', 'Gpt4', 'GPT3_5_16k', 'GPT3_5'],
	'azure-openai': ['Gpt4Turbo', 'Gpt4_32k', 'Gpt4', 'GPT3_5_16k', 'GPT3_5'],
	'togetherai': ['Mixtral', 'MistralInstruct'],
	'ollama': ['Mixtral', 'MistralInstruct']
};

export const providersSupportingModel = (model: string): ProviderType[] => {
	return Object.keys(supportedModels)
		.filter(provider => supportedModels[provider as ProviderType].includes(model)) as ProviderType[];
};

export const isDefaultLanguageModelItem = (item: ILanguageModelItem) => {
	const defaultItem = defaultModelSelectionSettings.models[item.name];
	return defaultItem
		&& defaultItem.contextLength === item.contextLength
		&& defaultItem.temperature === item.temperature
		&& defaultItem.provider.type === item.provider.type
		&& (defaultItem.provider.type === 'azure-openai'
			? defaultItem.provider.deploymentID === (item.provider as AzureOpenAIModelProviderConfig).deploymentID
			: true
		);
};

export const areLanguageModelItemsEqual = (a: ILanguageModelItem, b: ILanguageModelItem) => {
	return a.name === b.name
		&& a.contextLength === b.contextLength
		&& a.temperature === b.temperature
		&& a.provider.type === b.provider.type
		&& (a.provider.type === 'azure-openai'
			? (a.provider as AzureOpenAIModelProviderConfig).deploymentID === (b.provider as AzureOpenAIModelProviderConfig).deploymentID
			: true
		);
};


export const isDefaultProviderConfig = (key: ProviderType, config: ProviderConfig) => {
	const defaultConfig = defaultModelSelectionSettings.providers[key as keyof IModelProviders] as ProviderConfig;
	return defaultConfig
		&& defaultConfig.name === config.name
		&& (defaultConfig.name === 'OpenAI' || defaultConfig.name === 'Together AI' || defaultConfig.name === 'Azure OpenAI'
			? (defaultConfig).apiKey === (config as ProviderConfigsWithAPIKey).apiKey
			: true
		)
		&& (defaultConfig.name === 'Azure OpenAI'
			? defaultConfig.apiBase === (config as AzureOpenAIProviderConfig).apiBase
			: true
		);
};

export const areProviderConfigsEqual = (a: ProviderConfig, b: ProviderConfig) => {
	return a.name === b.name
		&& (a.name === 'OpenAI' || a.name === 'Together AI' || a.name === 'Azure OpenAI'
			? (a as ProviderConfigsWithAPIKey).apiKey === (b as ProviderConfigsWithAPIKey).apiKey
			: true
		)
		&& (a.name === 'Azure OpenAI'
			? (a as AzureOpenAIProviderConfig).apiBase === (b as AzureOpenAIProviderConfig).apiBase
			: true
		);
};
