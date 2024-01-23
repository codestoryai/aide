/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

declare module 'vscode' {
	export interface ModelSelection {
		slowModel: string;
		fastModel: string;
		models: LanguageModels;
		providers: ModelProviders;
	}

	export interface ProviderSpecificConfiguration {
		type: string;
		deploymentID?: string;
	}

	export interface LanguageModelConfiguration {
		name: string;
		contextLength: number;
		temperature: number;
		provider: ProviderSpecificConfiguration;
	}

	export interface ModelProviderConfiguration {
		name: string;
		apiBase?: string | null;
		apiKey?: string | null;
	}

	export type LanguageModels = Record<string, LanguageModelConfiguration>;
	export type ModelProviders = Record<string, ModelProviderConfiguration>;

	export namespace modelSelection {
		export function getConfiguration(): Thenable<ModelSelection>;
		export const onDidChangeConfiguration: Event<ModelSelection>;
	}
}
