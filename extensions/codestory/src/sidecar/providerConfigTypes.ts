/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export interface OpenAIProviderConfig {
	readonly api_key: string;
}

export interface TogetherAIProviderConfig {
	readonly api_key: string;
}

export interface OllamaProviderConfig { }

export interface AzureOpenAIProviderConfig {
	readonly deployment_id: string;
	readonly api_base: string;
	readonly api_key: string;
	readonly api_version: string;
}

export interface LMStudioProviderConfig {
	readonly api_base: string;
}

export interface OpenAICompatibleProviderConfig {
	readonly api_key: string;
	readonly api_base: string;
}

export interface CodeStoryProviderConfig { }

export interface AnthropicProviderConfig {
	readonly api_key: string;
}

export interface FireworkAIProviderConfig {
	readonly api_key: string;
}

export interface GeminiProProviderConfig {
	readonly api_key: string;
	readonly api_base: string;
}

export interface OpenRouterProviderConfig {
	readonly api_key: string;
}

export interface LLMProviderAPIKeys {
	OpenAI?: OpenAIProviderConfig;
	TogetherAI?: TogetherAIProviderConfig;
	Ollama?: OllamaProviderConfig;
	OpenAIAzureConfig?: AzureOpenAIProviderConfig;
	LMStudio?: LMStudioProviderConfig;
	OpenAICompatible?: OpenAICompatibleProviderConfig;
	CodeStory?: CodeStoryProviderConfig;
	Anthropic?: AnthropicProviderConfig;
	FireworksAI?: FireworkAIProviderConfig;
	GeminiPro?: GeminiProProviderConfig;
	OpenRouter?: OpenRouterProviderConfig;
}
