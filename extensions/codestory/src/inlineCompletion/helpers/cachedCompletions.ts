/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { PromptCompletionsLRUCache, keyForPrompt } from './promptCache';
import { PromptData } from './promptWrapper';

export class CompletionsContext {
	static documentPrefix: string | null;
	static cacheKey: string | null;

	public setDocumentPrefix(prefix: string) {
		CompletionsContext.documentPrefix = prefix;
	}

	public setCacheKey(key: string) {
		CompletionsContext.cacheKey = key;
	}

	public updateContext(documentPrefix: string, cacheKey: string) {
		CompletionsContext.documentPrefix = documentPrefix;
		CompletionsContext.cacheKey = cacheKey;
	}
}

function getCachedChoices(promptCacheKey: string, multiline: boolean): string[] | null {
	const cachedVal = PromptCompletionsLRUCache.get(promptCacheKey);
	if (cachedVal && (!multiline || cachedVal.multiLine)) {
		return cachedVal.completions;
	}
	return null;
}


function trimCompletion(choice: string, forceSingleLine: boolean): string {
	let trimmedCompletion = choice.trimEnd();
	if (forceSingleLine) {
		trimmedCompletion = trimmedCompletion.split('\n')[0];
	}
	return trimmedCompletion;
}

export interface CachedCompletionResponse {
	completions: string[];
	cacheHitType: string;
}

export async function getCachedCompletions(
	prompt: PromptData,
	docTillCursor: string,
	requestMultiLine: boolean,
): Promise<[string[], string] | undefined> {
	const cachedChoicesMatchingTypedText = (function (docTillCursor, requestMultiline) {
		// I stores the doc till cursor from last "snapshot"
		if (!CompletionsContext.documentPrefix || !CompletionsContext.cacheKey || !docTillCursor.startsWith(CompletionsContext.documentPrefix)) {
			return;
		}
		const cachedChoices = getCachedChoices(CompletionsContext.cacheKey, requestMultiline);
		if (!cachedChoices) {
			return;
		}
		const i = docTillCursor.substring(CompletionsContext.documentPrefix.length);
		// exports.ghostTextLogger.debug(
		// 	ctx,
		// 	`Getting completions for user-typing flow - remaining prefix: ${i}`
		// );
		const updatedChoices: string[] = [];
		cachedChoices.forEach((choice) => {
			let trimmedChoice = trimCompletion(choice, false);
			if (trimmedChoice.startsWith(i)) {
				trimmedChoice = trimmedChoice.substring(i.length);
				updatedChoices.push(trimmedChoice);
			}
		});
		return updatedChoices;
	})(docTillCursor, requestMultiLine);

	if (cachedChoicesMatchingTypedText && cachedChoicesMatchingTypedText.length > 0) {
		return [cachedChoicesMatchingTypedText, 'TypingAsSuggested'];
	}

	const cachedChoices = (function (docTillCursor, prompt, requestMultiline) {
		const promptCacheKey = keyForPrompt(prompt.prompt.prefix, prompt.prompt.suffix);
		const cachedChoices = getCachedChoices(promptCacheKey, requestMultiline);
		if (cachedChoices) {
			const trimmedChoices: string[] = [];
			cachedChoices.forEach((e) => {
				const t = trimCompletion(e, !requestMultiline);
				trimmedChoices.push(t);
			});
			// dk why this is there -- all choices would be non-empty ones, right?
			// i think i'm missing something in this code.
			// const i = trimmedChoices.filter((e) => e.completionText);
			if (trimmedChoices.length > 0) {
				CompletionsContext.documentPrefix = docTillCursor;
				CompletionsContext.cacheKey = promptCacheKey;
			}
			return trimmedChoices;
		}
		return [];
	})(docTillCursor, prompt, requestMultiLine);
	return cachedChoices && cachedChoices.length > 0 ? [cachedChoices, 'Cache'] : undefined;
}
