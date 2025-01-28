/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import type { TextDocument } from 'vscode';

import type { DocumentContext } from './get-current-doc-context';
import { hasCompleteFirstLine } from './text-processing';
import { parseAndTruncateCompletion } from './text-processing/parse-and-truncate-completion';
import type { InlineCompletionItemWithAnalytics } from './text-processing/process-inline-completions';
import { LoggingService } from './logger';

interface CanUsePartialCompletionParams {
	document: TextDocument;
	docContext: DocumentContext;
	isDynamicMultilineCompletion: boolean;
	logger: LoggingService;
	spanId: string;
}

/**
 * Evaluates a partial completion response and returns it when we can already use it. This is used
 * to terminate any streaming responses where we can get a token-by-token access to the result and
 * want to terminate as soon as stop conditions are triggered.
 *
 * Right now this handles two cases:
 *  1. When a single line completion is requested, it terminates after the first full line was
 *     received.
 *  2. For a multi-line completion, it terminates when the completion will be truncated based on the
 *     multi-line indentation logic.
 */
export function canUsePartialCompletion(
	partialResponse: string,
	params: CanUsePartialCompletionParams
): InlineCompletionItemWithAnalytics | null {
	const { docContext } = params;
	// console.log('sidecar.docContext.multilineTrigger', params.docContext.multilineTrigger);

	if (!hasCompleteFirstLine(partialResponse)) {
		params.logger.logInfo('sidecar.canUsePartialCompletion', {
			event_name: 'sidecar.canUsePartialCompletion.has_complete_first_line',
			event_value: 'false',
			id: params.spanId,
			partial_response: partialResponse,
		});
		// console.log('sidecar.hasCompleteFirstLine', false);
		return null;
	}

	const item = parseAndTruncateCompletion(partialResponse, params);
	params.logger.logInfo('sidecar.canUsePartialCompletion.parse', {
		event_name: 'sidecar.can_use_partial_completion.parse_truncate_completion',
		id: params.spanId,
		partial_response: partialResponse,
	});
	// console.log('sidecar.canUsePartialCompletion', item.insertText);
	// console.log('sidecar.item.lineTruncatedCount', item.lineTruncatedCount);

	// TODO(skcd): This condition is weird, what if we are getting the whole string back
	// then we do not have any line truncated count, so do we always end up returning null?
	// always???
	// SKETCHY AF condition
	if (docContext.multilineTrigger) {
		return (item.lineTruncatedCount || 0) > 0 ? item : null;
	}

	return item.insertText.trim() === '' ? null : item;
}
