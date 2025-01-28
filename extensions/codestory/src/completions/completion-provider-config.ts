/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
class CompletionProviderConfig {
	/**
	 * Should be called before `InlineCompletionItemProvider` instance is created, so that the singleton
	 * with resolved values is ready for downstream use.
	 */
	public async init(): Promise<void> {
	}

	public get dynamicMultilineCompletions(): boolean {
		return true;
	}

	public get hotStreak(): boolean {
		return true;
	}

	public get fastPath(): boolean {
		return true;
	}

	public get contextStrategy(): ContextStrategy {
		return 'sidecar';
	}
}

export type ContextStrategy =
	| 'sidecar';

/**
 * A singleton store for completion provider configuration values which allows us to
 * avoid propagating every feature flag and config value through completion provider
 * internal calls. It guarantees that `flagsToResolve` are resolved on `CompletionProvider`
 * creation and along with `Configuration`.
 *
 * A subset of relevant config values and feature flags is moved here from the existing
 * params waterfall. Ideally, we rely on this singleton as a source of truth for config values
 * and collapse function calls nested in `InlineCompletionItemProvider.generateCompletions()`.
 */
export const completionProviderConfig = new CompletionProviderConfig();
