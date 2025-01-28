/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { LRUCache } from 'lru-cache';
import * as vscode from 'vscode';

import type { DocumentContext } from './get-current-doc-context';
import * as CompletionLogger from './logger';
import {
	InlineCompletionsResultSource,
} from './get-inline-completions';
import {
	type InlineCompletionItemWithAnalytics,
} from './text-processing/process-inline-completions';
import { getPositionAfterTextInsertionSameLine, lines, removeIndentation } from './text-processing';
import { Provider } from './providers/provider';
import { TypeDefinitionProviderWithNode } from './helpers/vscodeApi';

export const isDefined = <T>(value: T): value is NonNullable<T> => value !== undefined && value !== null;

export interface RequestParams {
	/** The request's document */
	document: vscode.TextDocument;

	/** The request's document context */
	docContext: DocumentContext;

	/** The state of the completion info box */
	selectedCompletionInfo: vscode.SelectedCompletionInfo | undefined;

	/** The cursor position in the source file where the completion request was triggered. */
	position: vscode.Position;

	/** The abort signal for the request. */
	abortSignal?: AbortSignal;

	/** Pass the clipboard content */
	clipBoardContent: string | null;

	identifierNodes: TypeDefinitionProviderWithNode[];
}

export interface RequestManagerResult {
	completions: InlineCompletionItemWithAnalytics[];
	source: InlineCompletionsResultSource;
}

interface RequestsManagerParams {
	requestParams: RequestParams;
	isCacheEnabled: boolean;
	provider: Provider;
	logger: CompletionLogger.LoggingService;
	spanId: string;
	startTime: number;
	identifierNodes: TypeDefinitionProviderWithNode[];
}

/**
 * This class can handle concurrent requests for code completions. The idea is
 * that requests are not cancelled even when the user continues typing in the
 * document. This allows us to cache the results of expensive completions and
 * return them when the user triggers a completion again.
 *
 * It also retests the request against the completion result of an inflight
 * request that just resolved and uses the last candidate logic to synthesize
 * completions if possible.
 */
export class RequestManager {
	private cache = new RequestCache();
	private completionCache: string | undefined = undefined;
	private previousRequest: AbortController | undefined = undefined;
	private readonly inflightRequests: Set<InflightRequest> = new Set();
	// Tracks the last request that the request manager is called with. We use this to evaluate
	// the relevance of existing requests (i.e to find out if the generations are still relevant)
	// private latestRequestParams: null | RequestsManagerParams = null;

	public checkCache(
		params: Pick<RequestsManagerParams, 'requestParams' | 'isCacheEnabled' | 'logger' | 'spanId'>
	): RequestManagerResult | null {
		const { requestParams, isCacheEnabled, logger, spanId } = params;
		const cachedCompletions = this.cache.get(requestParams);

		if (isCacheEnabled && cachedCompletions) {
			logger.logInfo('sidecar.request_manager.cache_hit', {
				'event_name': 'sidecar.request_manager.cache_hit',
				'id': spanId,
			});
			// addAutocompleteDebugEvent('RequestManager.checkCache', { cachedCompletions })
			return cachedCompletions;
		}
		return null;
	}

	public async requestPlain(params: RequestsManagerParams): Promise<RequestManagerResult> {
		// logic here is the following:
		// we want to resolve the promise for the user properly and keep stremaing it back
		// but since we are yielding it line by line, it could happen that the user has
		// typed a bit forward or something, so we can lookup our cache here and check
		// if what the user has typed matches with the cache
		// the other thing to keep in mind is that the user always wants to accept one
		// line and then move to the next, partial one liners make no sense, at the very
		// least the user will get the experience that its streaming back properly
		const { requestParams, provider, logger, spanId, startTime } = params;
		// now we need to check if we have prefix overlap with the other completion which are running around
		const prefix = requestParams.docContext.prefix;
		const completionCacheString = this.completionCache;
		const currentPosition = requestParams.position;
		if (completionCacheString) {
			const equalStart = completionCacheString.startsWith(prefix);
			if (equalStart) {
				// we have a prefix overlap, find the index of this and then return it
				const remainingCompletion = completionCacheString.substring(prefix.length);
				const completionToShow = remainingCompletion.trimRight();
				logger.logInfo('sidecar.request.plain.cached', {
					'event_name': 'sidecar.request.plain.cached.hit',
					'completion': completionToShow,
					'completion_cache': completionCacheString,
					'prefix': prefix,
					'time_taken': performance.now() - startTime,
					'id': spanId,
				});
				return {
					completions: [{
						insertText: completionToShow,
						range: new vscode.Range(currentPosition, getPositionAfterTextInsertionSameLine(currentPosition, completionToShow)),
					}],
					source: InlineCompletionsResultSource.Cache,
				};
			} else {
				// we should terminate the running request in the background as its not useful anymore
				// and set our cache to empty right here and then start a new request
				if (this.previousRequest) {
					// we are aborting the previous running request here
					this.previousRequest.abort();
					this.completionCache = undefined;
				}
			}
		}
		const abortController = new AbortController();
		this.previousRequest = abortController;
		this.completionCache = '';
		const request = new InflightRequest(requestParams, abortController);
		// lets assume that there is no cache for now, we will add it back later
		const generateCompletions = async (): Promise<void> => {
			try {
				for await (const fetchCompletionResults of provider.generateCompletionsPlain(
					request.abortController.signal,
					startTime,
					requestParams.clipBoardContent,
					requestParams.identifierNodes,
				)) {
					// we are going to get the generations back, here we will keep adding them to the cache
					// one per line
					// const stopReason = fetchCompletionResults.stopReason;
					const currentCompletion = fetchCompletionResults.completion;
					const completionToShow = currentCompletion.trimRight();
					// First add it to the cache so we can look it up later
					this.completionCache = prefix + currentCompletion;
					logger.logInfo('sidecar.request.plain.generate_completions', {
						'event_name': 'sidecar.request.plain.generate_completions',
						'completion': completionToShow,
						'id': spanId,
					});
					request.resolve({
						completions: [{
							insertText: completionToShow,
							range: new vscode.Range(currentPosition, getPositionAfterTextInsertionSameLine(currentPosition, completionToShow))
						}],
						source: InlineCompletionsResultSource.Network,
					});
				}
			} catch (error) {
				request.reject(error as Error);
			} finally {
				this.inflightRequests.delete(request);
			}
		};
		generateCompletions();
		return request.promise;
	}

	public removeFromCache(params: RequestParams): void {
		// clear the cache here completely, and also stop the previous request
		// and clear the previous request as well
		// this will be called when we are done with the current request
		// and we want to clear the cache and the previous request
		this.cache.delete(params);
		// this.previousRequest?.abort();
		// this.completionCache = undefined;
	}

	public removeCompletionCache(): void {
		// abort the previous request and clear the completion cache
		this.previousRequest?.abort();
		this.completionCache = undefined;
	}
}

class InflightRequest {
	public promise: Promise<RequestManagerResult>;
	public resolve: (result: RequestManagerResult) => void;
	public reject: (error: Error) => void;

	// Remember the latest completion candidates emitted by an inflight request. This is necessary
	// since we want to detect when a completion generation is diverging from the current document
	// context in order to effectively abort it.
	public lastCompletions: InlineCompletionItemWithAnalytics[] | null = null;
	public lastRequestParams: RequestParams;

	constructor(
		public params: RequestParams,
		public abortController: AbortController
	) {
		// The promise constructor is called synchronously, so this is just to
		// make TS happy
		this.resolve = () => { };
		this.reject = () => { };

		this.lastRequestParams = params;

		this.promise = new Promise<RequestManagerResult>((res, rej) => {
			this.resolve = res;
			this.reject = rej;
		});
	}
}

interface RequestCacheItem {
	completions: InlineCompletionItemWithAnalytics[];
	source: InlineCompletionsResultSource;
}
class RequestCache {
	private cache = new LRUCache<string, RequestCacheItem>({
		max: 50,
	});

	private toCacheKey(key: Pick<RequestParams, 'docContext'>): string {
		// allow-any-unicode-next-line
		return `${key.docContext.prefix}█${key.docContext.nextNonEmptyLine}`;
	}

	public get(key: RequestParams): RequestCacheItem | undefined {
		return this.cache.get(this.toCacheKey(key));
	}

	public set(key: Pick<RequestParams, 'docContext'>, item: RequestCacheItem): void {
		this.cache.set(this.toCacheKey(key), item);
	}

	public delete(key: RequestParams): void {
		this.cache.delete(this.toCacheKey(key));
	}
}

// Given the current document and a previous request with it's recommended completions, compute if
// the completion is still relevant for the current document.
//
// We define a completion suggestion as still relevant if the prefix still overlap with the new new
// completion while allowing for some slight changes to account for prefixes.
export function computeIfRequestStillRelevant(
	currentRequest: Pick<RequestParams, 'docContext'> & { document: { uri: vscode.Uri } },
	previousRequest: Pick<RequestParams, 'docContext'> & { document: { uri: vscode.Uri } },
	completions: InlineCompletionItemWithAnalytics[] | null
): boolean {
	if (currentRequest.document.uri.toString() !== previousRequest.document.uri.toString()) {
		return false;
	}

	const currentPrefixStartLine =
		currentRequest.docContext.position.line - (lines(currentRequest.docContext.prefix).length - 1);
	const previousPrefixStartLine =
		previousRequest.docContext.position.line - (lines(previousRequest.docContext.prefix).length - 1);

	const sharedStartLine = Math.max(currentPrefixStartLine, previousPrefixStartLine);

	// Truncate both prefixes to ensure they start at the same line
	const currentPrefixDiff = sharedStartLine - currentPrefixStartLine;
	const previousPrefixDiff = sharedStartLine - previousPrefixStartLine;
	if (currentPrefixDiff < 0 || previousPrefixDiff < 0) {
		// There is no overlap in prefixes, the completions are not relevant
		return false;
	}
	const currentPrefix = currentRequest.docContext.prefix
		.split('\n')
		.slice(currentPrefixDiff)
		.join('\n');

	const previousPrefix = previousRequest.docContext.prefix
		.split('\n')
		.slice(previousPrefixDiff)
		.join('\n');

	// Require some overlap in the prefixes
	if (currentPrefix === '' || previousPrefix === '') {
		return false;
	}

	const current = removeIndentation(currentPrefix);
	for (const completion of completions ?? [{ insertText: '' }]) {
		const inserted = removeIndentation(previousPrefix + completion.insertText);

		const isFullContinuation = inserted.startsWith(current) || current.startsWith(inserted);
		// We consider a completion still relevant if the prefixes and the continuation diverge up
		// to three characters. For this, we only consider typos in the last line (= the line at the
		// cursor position)
		const [insertedLines, insertedLastLine] = splitLastLine(inserted);
		const [currentLines, currentLastLine] = splitLastLine(current);
		const isTypo =
			insertedLines === currentLines && insertedLastLine.startsWith(currentLastLine.slice(0, -3));

		if (isFullContinuation || isTypo) {
			return true;
		}
	}

	return false;
}

function splitLastLine(text: string): [string, string] {
	const lines = text.split('\n');
	const lastLine = lines.pop()!;
	return [lines.join('\n'), lastLine];
}
