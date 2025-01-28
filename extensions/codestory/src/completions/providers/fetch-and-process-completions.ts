/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CompletionStopReason } from '../../sidecar/client';
import { canUsePartialCompletion } from '../can-use-partial-completion';
import type { DocumentContext } from '../get-current-doc-context';
import { getFirstLine } from '../text-processing';
import * as CompletionLogger from '../logger';
import { parseAndTruncateCompletion } from '../text-processing/parse-and-truncate-completion';
import {
	processCompletion,
	type InlineCompletionItemWithAnalytics,
} from '../text-processing/process-inline-completions';

import { getDynamicMultilineDocContext } from './dynamic-multiline';
import { createHotStreakExtractor, type HotStreakExtractor } from './hot-streak';
import type { ProviderOptions } from './provider';

export interface StreamCompletionResponse {
	completion: string;
	stopReason: string;
}

export interface StreamCompletionResponseUpdates {
	completion: string;
	stopReason: string;
	delta: string | null;
}

export interface FetchAndProcessCompletionsParams {
	// the abort controller that should be used to cancel the request
	abortController: AbortController;
	// the generator that will yield the completions
	completionResponseGenerator: AsyncIterable<StreamCompletionResponse>;
	providerSpecificPostProcess: (insertText: string) => string;
	providerOptions: Readonly<ProviderOptions>;
	// the logger to use
	logger: CompletionLogger.LoggingService;
	// the span id to use for logging
	spanId: string;
}

/**
 * Uses the first line of the completion to figure out if it start the new multiline syntax node.
 * If it does, continues streaming until the completion is truncated or we reach the token sample limit.
 */
export async function* fetchAndProcessDynamicMultilineCompletions(
	params: FetchAndProcessCompletionsParams
): FetchCompletionsGenerator {
	const {
		completionResponseGenerator,
		abortController,
		providerOptions,
		providerSpecificPostProcess,
		logger,
		spanId,
	} = params;
	const { hotStreak, docContext, multiline, firstCompletionTimeout } = providerOptions;

	let hotStreakExtractor: undefined | HotStreakExtractor;

	interface StopParams {
		completedCompletion: InlineCompletionItemWithAnalytics;
		rawCompletion: string;
		isFullResponse: boolean;
	}

	function* stopStreamingAndUsePartialResponse(
		stopParams: StopParams
	): Generator<FetchCompletionResult> {
		const { completedCompletion, rawCompletion, isFullResponse } = stopParams;
		logger.logInfo('sidecar.stop_streaming_and_use_partial_response', {
			'event_name': 'sidecar.stop_streaming_and_use_partial_response_first',
			'completion': completedCompletion.insertText,
			'id': spanId,
		});
		yield {
			docContext,
			completion: {
				...completedCompletion,
				stopReason: isFullResponse ? completedCompletion.stopReason : 'streaming-truncation',
			},
		};

		if (hotStreak) {
			hotStreakExtractor = createHotStreakExtractor({
				completedCompletion,
				...params,
			});

			yield* hotStreakExtractor.extract(rawCompletion, isFullResponse);
		} else {
			abortController.abort();
		}
	}

	const generatorStartTime = performance.now();

	logger.logInfo('sidecar.completion_request.generator', {
		event_name: 'sidecar.completion_request.generator',
		id: spanId,
	});
	for await (const { completion, stopReason } of completionResponseGenerator) {
		const isFirstCompletionTimeoutElapsed =
			performance.now() - generatorStartTime >= firstCompletionTimeout;
		const isFullResponse = stopReason !== CompletionStopReason.StreamingChunk;
		const shouldYieldFirstCompletion = isFullResponse || isFirstCompletionTimeoutElapsed;
		logger.logInfo('sidecar.shouldYieldFirstCompletion', {
			'event_name': 'should_yield_first_completion',
			'should_yield_first_completion': shouldYieldFirstCompletion,
			'multiline': multiline,
			'completion': completion,
			'completion_len': completion.length,
			'hotStreakExtractor': hotStreakExtractor !== undefined ? 'present' : 'not_present',
		});

		const extractCompletion = shouldYieldFirstCompletion
			? parseAndTruncateCompletion
			: canUsePartialCompletion;
		// TODO(skcd): We always want to have a single complete line as completion
		// const extractCompletion = canUsePartialCompletion;
		const rawCompletion = providerSpecificPostProcess(completion);
		// console.log('sidecar.rawCompletion', rawCompletion);

		if (!getFirstLine(rawCompletion) && !shouldYieldFirstCompletion) {
			// console.log('sidecar.getFirstLine', 'empty-string');
			logger.logDebug('sidecar.stream_response.get_first_line', {
				'event_name': 'sidecar.stream_response.get_first_line',
				'first_line': getFirstLine(rawCompletion),
				'completion': rawCompletion,
				'id': spanId,
			});
			continue;
		}

		if (hotStreakExtractor) {
			yield* hotStreakExtractor.extract(rawCompletion, isFullResponse);
			continue;
		}

		/**
		 * This completion was triggered with the multiline trigger at the end of current line.
		 * Process it as the usual multiline completion: continue streaming until it's truncated.
		 */
		if (multiline) {
			const completion = extractCompletion(rawCompletion, {
				document: providerOptions.document,
				docContext,
				isDynamicMultilineCompletion: false,
				logger,
				spanId,
			});
			logger.logInfo('sidecar.multiline.completion_extract', {
				event_name: 'sidecar.multiline.completion_extract',
				completion: completion?.insertText,
				raw_completion: rawCompletion,
			});


			if (completion) {
				const completedCompletion = processCompletion(completion, providerOptions);
				yield* stopStreamingAndUsePartialResponse({
					completedCompletion,
					isFullResponse,
					rawCompletion,
				});
			}

			continue;
		}

		logger.logInfo('sidecar.DO_NOT_LOG', {
			event_name: 'DO_NOT_LOG_EVER',
			id: spanId,
		});

		/**
		 * This completion was started without the multiline trigger at the end of current line.
		 * Check if the the first completion line ends with the multiline trigger. If that's the case
		 * continue streaming and pretend like this completion was multiline in the first place:
		 *
		 * 1. Update `docContext` with the `multilineTrigger` value.
		 * 2. Set the cursor position to the multiline trigger.
		 */
		const dynamicMultilineDocContext = {
			...docContext,
			...getDynamicMultilineDocContext({
				docContext,
				languageId: providerOptions.document.languageId,
				insertText: rawCompletion,
			}, logger, spanId),
		};

		if (dynamicMultilineDocContext.multilineTrigger && !isFirstCompletionTimeoutElapsed) {
			const completion = extractCompletion(rawCompletion, {
				document: providerOptions.document,
				docContext: dynamicMultilineDocContext,
				isDynamicMultilineCompletion: true,
				logger,
				spanId,
			});

			if (completion) {
				const completedCompletion = processCompletion(completion, {
					document: providerOptions.document,
					position: dynamicMultilineDocContext.position,
					docContext: dynamicMultilineDocContext,
				});

				// console.log('sidecarCompletion.completion', 'dynamic-multiline-completion');
				yield* stopStreamingAndUsePartialResponse({
					completedCompletion,
					isFullResponse,
					rawCompletion,
				});
			}
		} else {
			/**
			 * This completion was started without the multiline trigger at the end of current line
			 * and the first generated line does not end with a multiline trigger.
			 *
			 * Process this completion as a singleline completion: cut-off after the first new line char.
			 */
			const completion = extractCompletion(rawCompletion, {
				document: providerOptions.document,
				docContext,
				isDynamicMultilineCompletion: false,
				logger,
				spanId,
			});

			if (completion) {
				const firstLine = getFirstLine(completion.insertText);

				const completedCompletion = processCompletion(
					{
						...completion,
						insertText: firstLine,
					},
					providerOptions
				);

				// console.log('sidecarCompletion.compltion', 'else-dynamic-multline-completion');
				yield* stopStreamingAndUsePartialResponse({
					isFullResponse,
					completedCompletion,
					rawCompletion,
				});
			}
		}
	}
}

export type FetchCompletionResult =
	| {
		docContext: DocumentContext;
		completion: InlineCompletionItemWithAnalytics;
	}
	| undefined;

type FetchCompletionsGenerator = AsyncGenerator<FetchCompletionResult>;
