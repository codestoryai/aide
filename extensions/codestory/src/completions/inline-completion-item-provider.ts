/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import { getArtificialDelay, resetArtificialDelay, type LatencyFeatureFlags } from './artificial-delay';
import { getCurrentDocContext } from './get-current-doc-context';
import {
	getInlineCompletions,
	InlineCompletionsResultSource,
	TriggerKind,
	type LastInlineCompletionCandidate,
} from './get-inline-completions';
import { isCompletionVisible } from './is-completion-visible';
import * as CompletionLogger from './logger';
import { RequestManager, type RequestParams } from './request-manager';
import { getRequestParamsFromLastCandidate } from './reuse-last-candidate';
import {
	analyticsItemToAutocompleteItem,
	suggestedAutocompleteItemsCache,
	updateInsertRangeForVSCode,
	type AutocompleteInlineAcceptedCommandArgs,
	type AutocompleteItem,
} from './suggested-autocomplete-items-cache';
import { completionProviderConfig } from './completion-provider-config';
import { disableLoadingStatus, setLoadingStatus } from '../inlineCompletion/statusBar';
import { SideCarClient } from '../sidecar/client';
import { uniqueId } from 'lodash';
import { TypeDefinitionProviderWithNode, typeDefinitionForIdentifierNodes } from './helpers/vscodeApi';

interface AutocompleteResult extends vscode.InlineCompletionList {
	logId: string;
	items: AutocompleteItem[];
	/** @deprecated */
	completionEvent?: CompletionLogger.CompletionBookkeepingEvent;
}
export interface CodeStoryCompletionItemProviderConfig {
	triggerNotice: ((notice: { key: string }) => void) | null;
	// Settings
	formatOnAccept?: boolean;
	// Feature flags
	completeSuggestWidgetSelection?: boolean;
	// Sidecar client
	sidecarClient: SideCarClient;
}
interface CompletionRequest {
	document: vscode.TextDocument;
	position: vscode.Position;
	context: vscode.InlineCompletionContext;
}
export class InlineCompletionItemProvider
	implements vscode.InlineCompletionItemProvider, vscode.Disposable {
	private lastCompletionRequest: CompletionRequest | null = null;
	// This field is going to be set if you use the keyboard shortcut to manually trigger a
	// completion. Since VS Code does not provide a way to distinguish manual vs automatic
	// completions, we use consult this field inside the completion callback instead.
	private lastManualCompletionTimestamp: number | null = null;
	// private reportedErrorMessages: Map<string, number> = new Map()
	private readonly config: Required<CodeStoryCompletionItemProviderConfig>;
	private requestManager: RequestManager;
	/** Mockable (for testing only). */
	protected getInlineCompletions = getInlineCompletions;
	/** Accessible for testing only. */
	protected lastCandidate: LastInlineCompletionCandidate | undefined;
	private lastAcceptedCompletionItem:
		| Pick<AutocompleteItem, 'requestParams' | 'analyticsItem'>
		| undefined;
	private disposables: vscode.Disposable[] = [];
	private sidecarClient: SideCarClient;
	private logger: CompletionLogger.LoggingService;
	constructor({
		completeSuggestWidgetSelection = true,
		formatOnAccept = true,
		sidecarClient,
		...config
	}: CodeStoryCompletionItemProviderConfig) {
		this.logger = new CompletionLogger.LoggingService();
		this.config = {
			...config,
			sidecarClient,
			completeSuggestWidgetSelection,
			formatOnAccept,
		};
		this.sidecarClient = sidecarClient;
		/*
		if (this.config.completeSuggestWidgetSelection) {
			// This must be set to true, or else the suggest widget showing will suppress inline
			// completions. Note that the VS Code proposed API inlineCompletionsAdditions contains
			// an InlineCompletionList#suppressSuggestions field that lets an inline completion
			// provider override this on a per-completion basis. Because that API is proposed, we
			// can't use it and must instead resort to writing to the user's VS Code settings.
			void vscode.workspace
				.getConfiguration()
				.update(
					'editor.inlineSuggest.suppressSuggestions',
					true,
					vscode.ConfigurationTarget.Global
				);
		}
		*/
		this.requestManager = new RequestManager();
		this.disposables.push(
			vscode.commands.registerCommand(
				'codestory.autocomplete.inline.accepted',
				({ aideCompletion }: AutocompleteInlineAcceptedCommandArgs) => {
					void this.handleDidAcceptCompletionItem(aideCompletion);
				}
			)
		);
	}
	private lastCompletionRequestTimestamp = 0;
	public async provideInlineCompletionItems(
		document: vscode.TextDocument,
		position: vscode.Position,
		context: vscode.InlineCompletionContext,
		token?: vscode.CancellationToken
	): Promise<AutocompleteResult | null> {
		const id = uniqueId('completions-');
		const startTime = performance.now();
		this.logger.logInfo('sidecar.providerInlineCompletionItems', {
			'event_name': 'start',
			'id': id,
			'start_time': startTime,
		});
		const configuration = vscode.workspace.getConfiguration('aide');
		const shouldCopy = configuration.get<boolean>('inlineCompletion.copyClipBoardContent') || false;
		let clipBoardContent: string | null = null;
		if (shouldCopy) {
			clipBoardContent = await vscode.env.clipboard.readText();
		}
		const isEnabled = configuration.get<boolean>('inlineCompletion.enableTabAutocomplete') || false;
		if (!isEnabled) {
			return null;
		}
		// console.log('sidecar.providerInlineCompletionItems', 'start');
		// Update the last request
		const lastCompletionRequest = this.lastCompletionRequest;
		const completionRequest: CompletionRequest = {
			document,
			position,
			context,
		};
		// We are going to check if the user has backspaced at all, if that's the case then we should
		// clear the cache and the already running requests
		if (lastCompletionRequest?.document.uri === document.uri) {
			if (lastCompletionRequest.position.isAfter(position)) {
				this.requestManager.removeCompletionCache();
			}
		}
		this.lastCompletionRequest = completionRequest;
		if (!this.lastCompletionRequestTimestamp) {
			this.lastCompletionRequestTimestamp = startTime;
		}
		const setIsLoading = (isLoading: boolean): void => {
			if (isLoading) {
				// We do not want to show a loading spinner when the user is rate limited to
				// avoid visual churn.
				//
				// We still make the request to find out if the user is still rate limited.
				setLoadingStatus();
			} else {
				disableLoadingStatus();
			}
		};
		const abortController = new AbortController();
		if (token) {
			if (token.isCancellationRequested) {
				abortController.abort();
			}
			token.onCancellationRequested(() => {
				this.logger.logInfo('sidecar.providerOnCancellationRequested', {
					'event_name': 'aborting',
					'id': id,
				});
				// send this in the background
				this.sidecarClient.cancelInlineCompletion(id);
				abortController.abort();
			});
		}
		// const now = performance.now();
		const response = await this.sidecarClient.getIdentifierNodes(
			document.uri.fsPath,
			document.getText(),
			document.languageId,
			position.line,
			position.character,
		);
		// console.log('Time taken for identifier nodes: ', performance.now() - now);
		// console.log('Identifier nodes interested', response);
		let responses: TypeDefinitionProviderWithNode[] | unknown = [];
		try {
			responses = await Promise.race([typeDefinitionForIdentifierNodes(response, document.uri, this.sidecarClient), new Promise((_, reject) => {
				const { signal } = abortController;
				signal.addEventListener('abort', () => {
					reject(new Error('Aborted'));
				});
				// resolve([]);
			})]);
		} catch (exception) {
			responses = [];
		}
		// @ts-ignore
		const identifierNodes: TypeDefinitionProviderWithNode[] = responses;


		// When the user has the completions popup open and an item is selected that does not match
		// the text that is already in the editor, VS Code will never render the completion.
		if (!currentEditorContentMatchesPopupItem(document, context)) {
			return null;
		}
		let takeSuggestWidgetSelectionIntoAccount = false;
		// Only take the completion widget selection into account if the selection was actively changed
		// by the user
		if (
			this.config.completeSuggestWidgetSelection &&
			lastCompletionRequest &&
			onlyCompletionWidgetSelectionChanged(lastCompletionRequest, completionRequest)
		) {
			takeSuggestWidgetSelectionIntoAccount = true;
		}
		// check if we should reset our current request
		const triggerKind =
			this.lastManualCompletionTimestamp &&
				this.lastManualCompletionTimestamp > Date.now() - 500
				? TriggerKind.Manual
				: context.triggerKind === vscode.InlineCompletionTriggerKind.Automatic
					? TriggerKind.Automatic
					: takeSuggestWidgetSelectionIntoAccount
						? TriggerKind.SuggestWidget
						: TriggerKind.Hover;
		this.lastManualCompletionTimestamp = null;
		// my question: how is multiline defined here? that's one of the questions we want to figure out
		const docContext = getCurrentDocContext({
			document,
			position,
			maxPrefixLength: 100000,
			maxSuffixLength: 100000,
			// We ignore the current context selection if completeSuggestWidgetSelection is not enabled
			context: takeSuggestWidgetSelectionIntoAccount ? context : undefined,
			dynamicMultilineCompletions: completionProviderConfig.dynamicMultilineCompletions,
		}, this.logger, id);
		this.logger.logInfo('sidecar.initialRequest.docContext', {
			event_name: 'sidecar.initialRequest.docContext',
			now: performance.now(),
			time_taken: performance.now() - startTime,
			id: id,
			multiline_trigger: docContext.multilineTrigger ?? 'no_multiline_trigger'
		});
		const latencyFeatureFlags: LatencyFeatureFlags = {
			user: false,
		};
		const artificialDelay = getArtificialDelay(
			latencyFeatureFlags,
			document.uri.toString(),
			document.languageId,
			undefined,
		);
		const isLocalProvider = false;
		// TODO(skcd): Enable this again later on when we have better detection model
		// const isLocalProvider = isLocalCompletionsProvider(this.config.providerConfig.identifier)
		try {
			// we get the results from making a call first, do we even hit the cache here?
			// The important trick here is not that we can send back just a single result
			// we also check the cache etc all here, so this is the entry point
			const result = await this.getInlineCompletions({
				document,
				position,
				triggerKind,
				selectedCompletionInfo: context.selectedCompletionInfo,
				docContext,
				requestManager: this.requestManager,
				sidecarClient: this.sidecarClient,
				lastCandidate: this.lastCandidate,
				debounceInterval: {
					singleLine: isLocalProvider ? 75 : 125,
					multiLine: 125,
				},
				setIsLoading,
				abortSignal: abortController.signal,
				handleDidAcceptCompletionItem: this.handleDidAcceptCompletionItem.bind(this),
				handleDidPartiallyAcceptCompletionItem:
					this.unstable_handleDidPartiallyAcceptCompletionItem.bind(this),
				completeSuggestWidgetSelection: takeSuggestWidgetSelectionIntoAccount,
				artificialDelay,
				completionIntent: undefined,
				lastAcceptedCompletionItem: this.lastAcceptedCompletionItem,
				logger: this.logger,
				spanId: id,
				startTime,
				clipBoardContent,
				identifierNodes,
			});

			// Avoid any further work if the completion is invalidated already.
			if (abortController.signal.aborted) {
				return null;
			}
			if (!result) {
				// Returning null will clear any existing suggestions, thus we need to reset the
				// last candidate.
				this.lastCandidate = undefined;
				return null;
			}
			// we need to check the results here to make sure they are not all whitespaces (which are just annoying)
			let isNonWhitespaceCompletion = false;
			let multilineCompletion = false;
			result.items.forEach((item) => {
				if (item.insertText.trim() !== '') {
					isNonWhitespaceCompletion = true;
				}
			});
			result.items.forEach((item) => {
				if (item.insertText.split('\n').length >= 1) {
					multilineCompletion = true;
				}
			});
			// we only block when we have whitespace and its multiline
			if (!isNonWhitespaceCompletion && multilineCompletion) {
				this.logger.logInfo('sidecar.providerInlineCompletionItems.WHITESPACE', {
					'event_name': 'sidecar.providerInlineCompletionItems.WHITESPACE',
					'id': id,
				});
				return null;
			}
			this.logger.logInfo('sidecar.providerInlineCompletionItems.COMPLETE', {
				'event_name': 'sidecar.provide_inline_completions.COMPLETE',
				'inline_completions': result.items.map((item) => item.insertText),
				'inline_completions_ranges': result.items.map((item) => item.range),
				'current_position': position,
				'now': performance.now(),
				'time_taken': performance.now() - startTime,
				'id': id,
			});

			// Checks if the current line prefix length is less than or equal to the last triggered prefix length
			// If true, that means user has backspaced/deleted characters to trigger a new completion request,
			// meaning the previous result is unwanted/rejected.
			// In that case, we mark the last candidate as "unwanted", remove it from cache, and clear the last candidate
			const currentPrefix = docContext.currentLinePrefix;
			const lastTriggeredPrefix = this.lastCandidate?.lastTriggerDocContext.currentLinePrefix;
			if (
				this.lastCandidate &&
				lastTriggeredPrefix !== undefined &&
				currentPrefix.length < lastTriggeredPrefix.length
			) {
				this.handleUnwantedCompletionItem(
					getRequestParamsFromLastCandidate(document, this.lastCandidate)
				);
			}

			const visibleItems = result.items.filter(item =>
				isCompletionVisible(
					item,
					document,
					position,
					docContext,
					context,
					takeSuggestWidgetSelectionIntoAccount,
					abortController.signal
				)
			);

			// A completion that won't be visible in VS Code will not be returned and not be logged.
			if (visibleItems.length === 0) {
				// Returning null will clear any existing suggestions, thus we need to reset the
				// last candidate.
				this.lastCandidate = undefined;
				// CompletionLogger.noResponse(result.logId);
				this.logger.logInfo('sidecar.visible.items.not_present', {
					'event_name': 'sidecar.visible.items.not_present',
					'id': id,
				});
				return null;
			}

			// log if the visible items are present
			// CompletionLogger.response(result.logId);
			this.logger.logInfo('sidecar.visible.items.present', {
				'event_name': 'sidecar.visible.items.present',
				'id': id,
				'inline_completions': visibleItems.map((item) => item.insertText),
				'inline_completions_ranges': visibleItems.map((item) => item.range),
				'current_position': position,
				'inline_completions_length': visibleItems.length,
				'inline_completions_ranges_length': visibleItems.map((item) => item.range).length,
			});

			// Since we now know that the completion is going to be visible in the UI, we save the
			// completion as the last candidate (that is shown as ghost text in the editor) so that
			// we can reuse it if the user types in such a way that it is still valid (such as by
			// typing `ab` if the ghost text suggests `abcd`).
			if (result.source !== InlineCompletionsResultSource.LastCandidate) {
				this.lastCandidate = {
					uri: document.uri,
					lastTriggerPosition: position,
					lastTriggerDocContext: docContext,
					lastTriggerSelectedCompletionInfo: context?.selectedCompletionInfo,
					result,
				};
			}

			const autocompleteItems = analyticsItemToAutocompleteItem(
				result.logId,
				document,
				docContext,
				position,
				visibleItems,
				context
			);

			// Store the log ID for each completion item so that we can later map to the selected
			// item from the ID alone
			for (const item of autocompleteItems) {
				suggestedAutocompleteItemsCache.add(item);
			}

			// return `CompletionEvent` telemetry data to the agent command `autocomplete/execute`.
			const autocompleteResult: AutocompleteResult = {
				logId: id,
				items: updateInsertRangeForVSCode(autocompleteItems),
			};

			this.logger.logInfo('sidecar.autocomplet.result', {
				'event_name': 'sidecar.autocomplet.result',
				'id': id,
				'autocomplete_items': autocompleteItems.map((item) => item.insertText),
				'inline_completions_ranges': autocompleteItems.map((item) => item.range),
				'current_position': position,
				'inline_completions_length': autocompleteItems.length,
			});

			return autocompleteResult;
		} catch (error) {
			this.onError(error as Error);
			throw error;
		}
	}

	/**
	 * Callback to be called when the user accepts a completion. For VS Code, this is part of the
	 * action inside the `AutocompleteItem`. Agent needs to call this callback manually.
	 */
	public async handleDidAcceptCompletionItem(
		completionOrItemId:
			| Pick<
				AutocompleteItem,
				'range' | 'requestParams' | 'logId' | 'analyticsItem' | 'trackedRange'
			>
			| CompletionLogger.CompletionItemID
	): Promise<void> {
		const completion = suggestedAutocompleteItemsCache.get(completionOrItemId);

		if (!completion) {
			return;
		}

		resetArtificialDelay();

		this.logger.logInfo('sidecar.inlinecompletion.accepted', {
			'event_name': 'sidecar.inlinecompletion.accepted',
		});

		// When a completion is accepted, the lastCandidate should be cleared. This makes sure the
		// log id is never reused if the completion is accepted.
		this.clearLastCandidate();

		// Remove the completion from the network cache
		this.requestManager.removeFromCache(completion.requestParams);

		this.lastAcceptedCompletionItem = completion;

	}

	/**
	 * Called when a suggestion is shown. This API is inspired by the proposed VS Code API of the
	 * same name, it's prefixed with `unstable_` to avoid a clash when the new API goes GA.
	 */
	public unstable_handleDidShowCompletionItem(
		completionOrItemId: Pick<AutocompleteItem, 'logId' | 'analyticsItem'> | CompletionLogger.CompletionItemID
	): void {
		const completion = suggestedAutocompleteItemsCache.get(completionOrItemId);
		if (!completion) {
			return;
		}
	}

	/**
	 * Called when the user partially accepts a completion. This API is inspired by the proposed VS
	 * Code API of the same name, it's prefixed with `unstable_` to avoid a clash when the new API
	 * goes GA.
	 */
	private unstable_handleDidPartiallyAcceptCompletionItem(
		_completion: Pick<AutocompleteItem, 'logId' | 'analyticsItem'>,
		_acceptedLength: number
	): void {
		// CompletionLogger.partiallyAccept(
		// 	completion.logId,
		// 	completion.analyticsItem,
		// 	acceptedLength,
		// );
	}

	public async manuallyTriggerCompletion(): Promise<void> {
		await vscode.commands.executeCommand('editor.action.inlineSuggest.hide');
		this.lastManualCompletionTimestamp = Date.now();
		await vscode.commands.executeCommand('editor.action.inlineSuggest.trigger');
	}

	/**
	 * Handles when a completion item was rejected by the user.
	 *
	 * A completion item is marked as rejected/unwanted when:
	 * - pressing backspace on a visible suggestion
	 */
	private handleUnwantedCompletionItem(reqContext: RequestParams): void {
		const completionItem = this.lastCandidate?.result.items[0];
		if (!completionItem) {
			return;
		}

		this.clearLastCandidate();

		this.requestManager.removeFromCache(reqContext);
	}

	/**
	 * The user no longer wishes to see the last candidate and requests a new completion. Note this
	 * is reset by heuristics when new completion requests are triggered and completions are
	 * rejected as a result of that.
	 */
	public clearLastCandidate(): void {
		this.lastCandidate = undefined;
	}

	/**
	 * A callback that is called whenever an error happens. We do not want to flood a users UI with
	 * error messages so every unexpected error is deduplicated by its message and rate limit errors
	 * are only shown once during the rate limit period.
	 */
	private onError(_error: Error): void {
	}

	public dispose(): void {
		for (const disposable of this.disposables) {
			disposable.dispose();
		}
	}
}

// const globalInvocationSequenceForTracer = 0;


// Check if the current text in the editor overlaps with the currently selected
// item in the completion widget.
//
// If it won't VS Code will never show an inline completions.
//
// Here's an example of how to trigger this case:
//
//  1. Type the text `console.l` in a TypeScript file.
//  2. Use the arrow keys to navigate to a suggested method that start with a
//     different letter like `console.dir`.
//  3. Since it is impossible to render a suggestion with `.dir` when the
//     editor already has `.l` in the text, VS Code won't ever render it.
function currentEditorContentMatchesPopupItem(
	document: vscode.TextDocument,
	context: vscode.InlineCompletionContext
): boolean {
	if (context.selectedCompletionInfo) {
		const currentText = document.getText(context.selectedCompletionInfo.range);
		const selectedText = context.selectedCompletionInfo.text;

		if (!selectedText.startsWith(currentText)) {
			return false;
		}
	}
	return true;
}

/**
 * Returns true if the only difference between the two requests is the selected completions info
 * item from the completions widget.
 */
function onlyCompletionWidgetSelectionChanged(
	prev: CompletionRequest,
	next: CompletionRequest
): boolean {
	if (prev.document.uri.toString() !== next.document.uri.toString()) {
		return false;
	}

	if (!prev.position.isEqual(next.position)) {
		return false;
	}

	if (prev.context.triggerKind !== next.context.triggerKind) {
		return false;
	}

	const prevSelectedCompletionInfo = prev.context.selectedCompletionInfo;
	const nextSelectedCompletionInfo = next.context.selectedCompletionInfo;

	if (!prevSelectedCompletionInfo || !nextSelectedCompletionInfo) {
		return false;
	}

	if (!prevSelectedCompletionInfo.range.isEqual(nextSelectedCompletionInfo.range)) {
		return false;
	}

	return prevSelectedCompletionInfo.text !== nextSelectedCompletionInfo.text;
}
