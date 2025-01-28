/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import type { TextDocument } from 'vscode';
import type { SyntaxNode } from 'web-tree-sitter';

import type { DocumentContext } from '../get-current-doc-context';

import { parseCompletion, type ParsedCompletion } from './parse-completion';
import type { InlineCompletionItemWithAnalytics } from './process-inline-completions';
import { normalizeStartLine, truncateMultilineCompletion } from './truncate-multiline-completion';
import { truncateParsedCompletion } from './truncate-parsed-completion';
import { getFirstLine } from './utils';
import { LoggingService } from '../logger';

interface ParseAndTruncateParams {
	document: TextDocument;
	docContext: DocumentContext;
	isDynamicMultilineCompletion: boolean;
	logger: LoggingService;
	spanId: string;
}

export function parseAndTruncateCompletion(
	completion: string,
	params: ParseAndTruncateParams
): InlineCompletionItemWithAnalytics {
	const {
		document,
		docContext,
		docContext: { multilineTrigger, prefix },
		isDynamicMultilineCompletion,
		logger,
		spanId,
	} = params;

	const multiline = Boolean(multilineTrigger);
	const insertTextBeforeTruncation = (
		multiline ? normalizeStartLine(completion, prefix) : completion
	).trimEnd();

	const parsed = parseCompletion({
		completion: { insertText: insertTextBeforeTruncation },
		document,
		docContext,
		logger: params.logger,
		spanId: params.spanId,
	});

	if (parsed.insertText === '') {
		return parsed;
	}

	if (multiline) {
		const truncationResult = truncateMultilineBlock({
			parsed,
			document,
			docContext,
			logger: params.logger,
			spanId: params.spanId,
		});

		if (
			isDynamicMultilineCompletion &&
			isDynamicMultilineCompletionToStopStreaming(truncationResult.nodeToInsert)
		) {
			truncationResult.insertText = getFirstLine(truncationResult.insertText);
		}

		const initialLineCount = insertTextBeforeTruncation.split('\n').length;
		const truncatedLineCount = truncationResult.insertText.split('\n').length;

		parsed.lineTruncatedCount = initialLineCount - truncatedLineCount;
		parsed.insertText = truncationResult.insertText;
		parsed.truncatedWith = truncationResult.truncatedWith;
	}

	// console.log('sidecar.parseAndTruncateCompletion.parsed', parsed.insertText);
	logger.logInfo('sidecar.parseAndTruncateCompletion.parsed', {
		'event_name': 'sidecar.parseAndTruncateCompletion.parsed',
		'id': spanId,
		'insert_text': parsed.insertText,
		'completion': completion,
	});
	return parsed;
}

interface TruncateMultilineBlockParams {
	parsed: ParsedCompletion;
	docContext: DocumentContext;
	document: TextDocument;
	logger: LoggingService;
	spanId: string;
}

interface TruncateMultilineBlockResult {
	truncatedWith: 'tree-sitter' | 'indentation';
	insertText: string;
	nodeToInsert?: SyntaxNode;
}

function truncateMultilineBlock(params: TruncateMultilineBlockParams): TruncateMultilineBlockResult {
	const { parsed, docContext, document } = params;

	if (parsed.tree) {
		return {
			truncatedWith: 'tree-sitter',
			...truncateParsedCompletion({
				completion: parsed,
				docContext,
				document,
				logger: params.logger,
				spanId: params.spanId,
			}),
		};
	}

	const { prefix, suffix } = docContext;

	const truncatedString = truncateMultilineCompletion(
		parsed.insertText,
		prefix,
		suffix,
		document.languageId
	);
	return {
		truncatedWith: 'indentation',
		insertText: truncatedString,
	};
}

const NODE_TYPES_TO_STOP_STREAMING_AT_ROOT_NODE = new Set(['class_declaration']);

/**
 * Stop streaming dynamic multiline completions which leads to genereting a lot of lines
 * and are unhelpful most of the time. Currently applicable to a number of node types
 * at the root of the document.
 */
function isDynamicMultilineCompletionToStopStreaming(node?: SyntaxNode): boolean {
	return Boolean(
		node && isRootNode(node.parent) && NODE_TYPES_TO_STOP_STREAMING_AT_ROOT_NODE.has(node.type)
	);
}

function isRootNode(node: SyntaxNode | null): boolean {
	return node?.parent === null;
}
