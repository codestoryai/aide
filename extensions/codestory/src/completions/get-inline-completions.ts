/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import type * as vscode from 'vscode';
import type { URI } from 'vscode-uri';
import { type DocumentContext } from './get-current-doc-context';
import * as CompletionLogger from './logger';
import type { RequestManager, RequestParams } from './request-manager';
import type { AutocompleteItem } from './suggested-autocomplete-items-cache';
import type { InlineCompletionItemWithAnalytics } from './text-processing/process-inline-completions';
import { CompletionIntent } from './artificial-delay';
import { SideCarClient } from '../sidecar/client';
import { SidecarProvider } from './providers/sidecarProvider';
import { TypeDefinitionProviderWithNode } from './helpers/vscodeApi';

/**
 * Checks if the given file uri has a valid test file name.
 * @param uri - The file uri to check
 *
 * Removes file extension and checks if file name starts with 'test' or
 * ends with 'test', excluding files starting with 'test-'.
 * Also returns false for any files in node_modules directory.
 */
export function isValidTestFile(_uri: URI): boolean {
	return false;
}
export interface InlineCompletionsParams {
	// Context
	document: vscode.TextDocument;
	position: vscode.Position;
	triggerKind: TriggerKind;
	selectedCompletionInfo: vscode.SelectedCompletionInfo | undefined;
	docContext: DocumentContext;
	completionIntent?: CompletionIntent;
	lastAcceptedCompletionItem?: Pick<AutocompleteItem, 'requestParams' | 'analyticsItem'>;
	// Shared
	requestManager: RequestManager;
	// UI state
	lastCandidate?: LastInlineCompletionCandidate;
	debounceInterval?: { singleLine: number; multiLine: number };
	setIsLoading?: (isLoading: boolean) => void;
	// Execution
	abortSignal?: AbortSignal;
	artificialDelay?: number;
	// Feature flags
	completeSuggestWidgetSelection?: boolean;
	// Callbacks to accept completions
	handleDidAcceptCompletionItem?: (
		completion: Pick<AutocompleteItem, 'requestParams' | 'logId' | 'analyticsItem' | 'trackedRange'>
	) => void;
	handleDidPartiallyAcceptCompletionItem?: (
		completion: Pick<AutocompleteItem, 'logId' | 'analyticsItem'>,
		acceptedLength: number
	) => void;
	// sidecar client
	sidecarClient: SideCarClient;
	// Loggers
	logger: CompletionLogger.LoggingService;
	spanId: string;
	startTime: number;

	// clipboard content
	clipBoardContent: string | null;

	// go-to-definition provider
	identifierNodes: TypeDefinitionProviderWithNode[];
}

/**
 * The last-suggested ghost text result, which can be reused if it is still valid.
 */
export interface LastInlineCompletionCandidate {
	/** The document URI for which this candidate was generated. */
	uri: URI;
	/** The doc context item */
	lastTriggerDocContext: DocumentContext;
	/** The position at which this candidate was generated. */
	lastTriggerPosition: vscode.Position;
	/** The selected info item. */
	lastTriggerSelectedCompletionInfo: vscode.SelectedCompletionInfo | undefined;
	/** The previously suggested result. */
	result: InlineCompletionsResult;
}
/**
 * The result of a call to {@link getInlineCompletions}.
 */
export interface InlineCompletionsResult {
	/** The unique identifier for logging this result. */
	logId: string;
	/** Where this result was generated from. */
	source: InlineCompletionsResultSource;
	/** The completions. */
	items: InlineCompletionItemWithAnalytics[];
}
/**
 * The source of the inline completions result.
 */
export enum InlineCompletionsResultSource {
	Network = 'Network',
	Cache = 'Cache',
	HotStreak = 'HotStreak',
	CacheAfterRequestStart = 'CacheAfterRequestStart',
	/**
	 * The user is typing as suggested by the currently visible ghost text. For example, if the
	 * user's editor shows ghost text `abc` ahead of the cursor, and the user types `ab`, the
	 * original completion should be reused because it is still relevant.
	 *
	 * The last suggestion is passed in {@link InlineCompletionsParams.lastCandidate}.
	 */
	LastCandidate = 'LastCandidate',
}
/**
 * Extends the default VS Code trigger kind to distinguish between manually invoking a completion
 * via the keyboard shortcut and invoking a completion via hovering over ghost text.
 */
export enum TriggerKind {
	/** Completion was triggered explicitly by a user hovering over ghost text. */
	Hover = 'Hover',
	/** Completion was triggered automatically while editing. */
	Automatic = 'Automatic',
	/** Completion was triggered manually by the user invoking the keyboard shortcut. */
	Manual = 'Manual',
	/** When the user uses the suggest widget to cycle through different completions. */
	SuggestWidget = 'SuggestWidget',
}
export async function getInlineCompletions(
	params: InlineCompletionsParams
): Promise<InlineCompletionsResult | null> {
	try {
		params.logger.logInfo('sidecar.get_inline_completions.request', {
			event_name: 'sidecar.get_inline_completions.request',
			id: params.spanId,
			doc_context_multiline: params.docContext.multilineTrigger ?? 'not_present',
			prefix: params.docContext.currentLinePrefix,
			suffix: params.docContext.currentLineSuffix,
			prev_non_empty_line: params.docContext.prevNonEmptyLine,
			next_non_empty_line: params.docContext.nextNonEmptyLine,
			'time_taken': performance.now() - params.startTime,
			previous_accepted_completion: params.lastAcceptedCompletionItem?.analyticsItem.insertText,
		});
		const result = await doGetInlineCompletions(params);
		params.setIsLoading?.(false);
		params.logger.logInfo('sidecar.get_inline_completion_results', {
			event_name: 'sidecar.get_inline_completion_results',
			id: params.spanId,
			prefix: params.docContext.currentLinePrefix,
			suffix: params.docContext.currentLineSuffix,
			prev_non_empty_line: params.docContext.prevNonEmptyLine,
			next_non_empty_line: params.docContext.nextNonEmptyLine,
			result: result?.items[0].insertText,
			'time_taken': performance.now() - params.startTime,
			previous_accepted_completion: params.lastAcceptedCompletionItem?.analyticsItem.insertText,
		});
		return result;
	} catch (unknownError: unknown) {
		const error = unknownError instanceof Error ? unknownError : new Error(unknownError as any);
		if (process.env.NODE_ENV === 'development') {
			// Log errors to the console in the development mode to see the stack traces with source maps
			// in Chrome dev tools.
			console.error(error);
		}
		console.error('getInlineCompletions:error', error.message, error.stack, { verbose: { error } });
		throw error;
	} finally {
		params.setIsLoading?.(false);
	}
}
async function doGetInlineCompletions(
	params: InlineCompletionsParams
): Promise<InlineCompletionsResult | null> {
	const {
		document,
		position,
		triggerKind,
		selectedCompletionInfo,
		docContext,
		docContext: { multilineTrigger },
		requestManager,
		debounceInterval,
		setIsLoading,
		abortSignal,
		artificialDelay,
		sidecarClient,
		logger,
		spanId,
		startTime,
		clipBoardContent,
		identifierNodes,
	} = params;
	const multiline = Boolean(multilineTrigger);

	const requestParams: RequestParams = {
		document,
		docContext,
		position,
		selectedCompletionInfo,
		abortSignal,
		clipBoardContent,
		identifierNodes,
	};

	const cachedResult = requestManager.checkCache({
		requestParams,
		isCacheEnabled: triggerKind !== TriggerKind.Manual,
		logger,
		spanId,
	});
	if (cachedResult) {
		const { completions, source } = cachedResult

		return {
			logId: spanId,
			items: completions,
			source,
		};
	}

	// TODO(skcd): How do we handle the case where the user has backspaced, cause then we
	// do not want to show the completion suggestions., one easy way to do it is to check
	// the current prefix and the previous prefix, if both of them are matching then we can
	// understand that this is a generation which was backspaced, so we need to clean up
	// the previous requests, lets just check the positions of the current prefix and the
	// previous prefix, if both of them are close by (character difference but same line)
	// we should start a new request.
	// Debounce to avoid firing off too many network requests as the user is still typing.
	const interval =
		((multiline ? debounceInterval?.multiLine : debounceInterval?.singleLine) ?? 0) +
		(artificialDelay ?? 0);
	if (triggerKind === TriggerKind.Automatic && interval !== undefined && interval > 0) {
		await new Promise<void>(resolve => setTimeout(resolve, interval));
	}
	// We don't need to make a request at all if the signal is already aborted after the debounce.
	if (abortSignal?.aborted) {
		return null;
	}
	setIsLoading?.(true);
	if (abortSignal?.aborted) {
		setIsLoading?.(false);
		return null;
	}
	const provider = new SidecarProvider(
		{
			id: spanId,
			spanId: spanId,
			position: requestParams.position,
			document: requestParams.document,
			docContext: requestParams.docContext,
			// only do multline completions if the trigger is set
			multiline: docContext.multilineTrigger ? true : false,
			n: 1,
			// we are setting it to 1200ms here so its lower
			firstCompletionTimeout: 1200,
			// we want to enable the hot streak
			hotStreak: true,
			// we want to generate multiline completions
			dynamicMultilineCompletions: true,
		},
		sidecarClient,
		logger,
	);
	// Get the processed completions from providers
	const { completions, source } = await requestManager.requestPlain({
		requestParams,
		isCacheEnabled: triggerKind !== TriggerKind.Manual,
		provider,
		logger,
		spanId,
		startTime,
		identifierNodes,
	});

	setIsLoading?.(false);
	// log the final completions which are coming from the request manager
	// for (const completion of completions) {
	// 	console.log('sidecar.request.manager.completion', completion.insertText);
	// }
	// console.log('sidecar.request.manager.length', logId, completions.length);
	// CompletionLogger.loaded(logId, requestParams, completions, source);
	return {
		logId: spanId,
		items: completions,
		source,
	};
}
