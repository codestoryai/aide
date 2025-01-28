/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import type { TextDocument } from 'vscode';

import { canUsePartialCompletion } from '../can-use-partial-completion';
import { endsWithBlockStart } from '../detect-multiline';
import { insertIntoDocContext, type DocumentContext } from '../get-current-doc-context';
import { getLastLine } from '../text-processing';
import { parseAndTruncateCompletion } from '../text-processing/parse-and-truncate-completion';
import {
	processCompletion,
	type InlineCompletionItemWithAnalytics,
} from '../text-processing/process-inline-completions';

import { getDynamicMultilineDocContext } from './dynamic-multiline';
import type {
	FetchAndProcessCompletionsParams,
	FetchCompletionResult,
} from './fetch-and-process-completions';
import { getEditorIndentString } from '../format-completion';
import detectIndent from '../detectIndent';
import { LoggingService } from '../logger';

interface HotStreakExtractorParams extends FetchAndProcessCompletionsParams {
	completedCompletion: InlineCompletionItemWithAnalytics;
}

export const STOP_REASON_HOT_STREAK = 'aide-hot-streak';

export interface HotStreakExtractor {
	extract(rawCompletion: string, isRequestEnd: boolean): Generator<FetchCompletionResult>;
}

export function pressEnterAndGetIndentString(
	insertText: string,
	currentLine: string,
	document: TextDocument
): string {
	const { languageId, uri } = document;

	const startsNewBlock = Boolean(endsWithBlockStart(insertText, languageId));
	const newBlockIndent = startsNewBlock ? getEditorIndentString(uri) : '';
	const currentIndentReference = insertText.includes('\n') ? getLastLine(insertText) : currentLine;

	return '\n' + detectIndent(currentIndentReference).indent + newBlockIndent;
}

/**
 * For a hot streak, we require the completion to be inserted followed by an enter key
 * We do not want to insert a enter over here, can we control it instead and figure out
 * when we want to send it.. that should help with the current issue of having to figure
 * out how we can make the stream of requests work properly, cause it feels very bad today
 */
// function insertCompletionAndWait(
// 	docContext: DocumentContext,
// 	completion: InlineCompletionItemWithAnalytics,
// 	document: TextDocument,
// 	dynamicMultilineCompletions: boolean,
// ): DocumentContext {
// 	const { insertText } = completion;

// 	// do we have a new line in the insert text?

// }

/**
 * For a hot streak, we require the completion to be inserted followed by an enter key
 * Enter will usually insert a line break followed by the same indentation that the
 * current line has.
 */
function insertCompletionAndPressEnter(
	docContext: DocumentContext,
	completion: InlineCompletionItemWithAnalytics,
	document: TextDocument,
	dynamicMultilineCompletions: boolean,
	logger: LoggingService,
	spanId: string,
): DocumentContext {
	const { insertText } = completion;

	const indentString = pressEnterAndGetIndentString(insertText, docContext.currentLinePrefix, document);
	// console.log('insertCompletionAndPressEnter.indentString', indentString);
	// console.log('insertCompletionAndPressEnter.insertText', insertText);
	const insertTextWithPressedEnter = insertText + indentString;

	const updatedDocContext = insertIntoDocContext({
		docContext,
		languageId: document.languageId,
		insertText: insertTextWithPressedEnter,
		dynamicMultilineCompletions,
	}, logger, spanId);

	return updatedDocContext;
}

export function createHotStreakExtractor(params: HotStreakExtractorParams): HotStreakExtractor {
	const { completedCompletion, providerOptions, logger, spanId } = params;
	const {
		docContext,
		document,
		document: { languageId },
		dynamicMultilineCompletions = false,
	} = providerOptions;

	logger.logInfo('sidecar.hotstreak.create', {
		'event_name': 'hotstreak.create',
		'raw_completion_insert_text': completedCompletion.insertText,
		'raw_completion_parse_error_count': completedCompletion.parseErrorCount,
		'raw_completion_len': completedCompletion.insertText.length,
	});

	// This is the global statae of the document context which we are using
	// we need to keep this in mind how we are updating the document context when we are creating the extractor
	// for the hot streak
	let updatedDocContext = insertCompletionAndPressEnter(
		docContext,
		completedCompletion,
		document,
		dynamicMultilineCompletions,
		logger,
		spanId,
	);

	function* extract(rawCompletion: string, isRequestEnd: boolean): Generator<FetchCompletionResult> {
		// log the hot streak raw completion
		logger.logInfo('sidecar.hotstreak.completion', {
			'event_name': 'hotstreak_extract',
			'raw_completion': rawCompletion,
			'raw_completion_len': rawCompletion.length,
			'is_request_ended': isRequestEnd,
			'updated_document_context': updatedDocContext.injectedCompletionText,
			id: spanId,
		});
		while (true) {
			const unprocessedCompletion = rawCompletion.slice(
				updatedDocContext.injectedCompletionText?.length || 0
			);

			if (unprocessedCompletion.length === 0) {
				logger.logInfo('sidecar.hotstreak.unprocessedCompletion', {
					event_name: 'sidecar.hotstreak.unprocessedCompletion.empty',
					id: spanId,
				});
				return undefined;
			}

			// we extract the completion using either the parsing or the partial completion logic
			// one of the things to note here is that the logic for them is similar
			// in canUserPart logic we truncate the completion if it is a partial completion
			// in parseAndTruncateCompletion
			const extractCompletion = isRequestEnd ? parseAndTruncateCompletion : canUsePartialCompletion;

			const maybeDynamicMultilineDocContext: DocumentContext = {
				...updatedDocContext,
				...(dynamicMultilineCompletions && !updatedDocContext.multilineTrigger
					? getDynamicMultilineDocContext({
						languageId,
						docContext: updatedDocContext,
						insertText: unprocessedCompletion,
					}, logger, spanId)
					: {}),
			};

			const completion = extractCompletion(unprocessedCompletion, {
				document,
				docContext: maybeDynamicMultilineDocContext,
				isDynamicMultilineCompletion: Boolean(dynamicMultilineCompletions),
				logger: logger,
				spanId: spanId,
			});

			logger.logInfo('sidecar.hotstreak.completionExtract', {
				'event_name': 'sidecar.hotstreak.extractCompletion',
				'completion': completion?.insertText,
				'completion_range': completion?.range,
				'id': spanId,
				'is_request_ended': isRequestEnd,
				'unprocessedCompletion': unprocessedCompletion,
			});

			if (completion && completion.insertText.trim().length > 0) {
				// If the partial completion logic finds a match, extract this as the next hot
				// streak...
				// ... if not and we are processing the last payload, we use the whole remainder for the
				// completion (this means we will parse the last line even when a \n is missing at
				// the end) ...
				const processedCompletion = processCompletion(completion, {
					document,
					position: maybeDynamicMultilineDocContext.position,
					docContext: maybeDynamicMultilineDocContext,
				});

				yield {
					docContext: updatedDocContext,
					completion: {
						...processedCompletion,
						stopReason: STOP_REASON_HOT_STREAK,
					},
				};

				updatedDocContext = insertCompletionAndPressEnter(
					updatedDocContext,
					processedCompletion,
					document,
					dynamicMultilineCompletions,
					logger,
					spanId,
				);
			} else {
				// ... otherwise we don't have enough in the remaining completion text to generate a full
				// hot-streak completion and yield to wait for the next chunk (or abort).
				logger.logInfo("sidecar.hotstreak.no_completion", {
					"event_name": "sidecar.hotstreak.no_completion",
					"id": spanId,
					"raw_completion": rawCompletion,
					"unprocessed_completion": unprocessedCompletion,
				});
				return undefined;
			}
		}
	}

	return {
		extract,
	};
}
