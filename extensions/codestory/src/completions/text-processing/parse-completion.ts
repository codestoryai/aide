/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { Position, Range, type TextDocument } from 'vscode';
import type { default as Parser, Point, Tree } from 'web-tree-sitter';

import type { DocumentContext } from '../get-current-doc-context';
import type { InlineCompletionItem } from '../types';

import {
	asPoint,
	getMatchingSuffixLength,
	type InlineCompletionItemWithAnalytics,
} from './process-inline-completions';
import { getLastLine, lines } from './utils';
import { getCachedParseTreeForDocument } from './treeSitter/parseTree';
import { LoggingService } from '../logger';

interface CompletionContext {
	completion: InlineCompletionItem;
	document: TextDocument;
	docContext: DocumentContext;
	logger: LoggingService;
	spanId: string;
}

export interface ParsedCompletion extends InlineCompletionItemWithAnalytics {
	tree?: Tree;
	parseErrorCount?: number;
	// Points for parse-tree queries.
	points?: {
		// Start of completion.insertText in the parse-tree.
		start: Point;
		// End of completion.insertText in the parse-tree
		end: Point;
		// Start of the multi-line completion trigger if applicable
		trigger?: Point;
	};
}

interface PasteCompletionParams {
	completion: InlineCompletionItem;
	document: TextDocument;
	docContext: DocumentContext;
	tree: Tree;
	parser: Parser;
	completionEndPosition: Position;
	logger: LoggingService;
	spanId: string;
}

function pasteCompletion(params: PasteCompletionParams): Tree {
	const {
		completion: { insertText },
		document,
		parser,
		docContext: {
			position,
			currentLineSuffix,
			// biome-ignore lint/nursery/noInvalidUseBeforeDeclaration: it's actually correct
			positionWithoutInjectedCompletionText = position,
			injectedCompletionText = '',
		},
		completionEndPosition,
		logger,
		spanId,
	} = params;

	const matchingSuffixLength = getMatchingSuffixLength(insertText, currentLineSuffix);

	// Adjust suffix and prefix based on completion insert range.
	const prefix =
		document.getText(new Range(new Position(0, 0), positionWithoutInjectedCompletionText)) +
		injectedCompletionText;
	const suffix = document.getText(
		new Range(positionWithoutInjectedCompletionText, document.positionAt(document.getText().length))
	);

	// const offset = document.offsetAt(positionWithoutInjectedCompletionText);

	// Remove the characters that are being replaced by the completion to avoid having
	// them in the parse tree. It breaks the multiline truncation logic which looks for
	// the increased number of children in the tree.
	const textWithCompletion = prefix + insertText + suffix.slice(matchingSuffixLength);

	logger.logInfo('sidecar.paseCompletion', {
		event_name: 'sidecar.parse_completion',
		'id': spanId,
		'completion': insertText,
		// 'prefix': prefix,
		// 'suffix': suffix,
		'text_with_completion': textWithCompletion,
		'start_position': positionWithoutInjectedCompletionText,
		'end_position': completionEndPosition,
	});

	// const treeCopy = tree.copy()

	// treeCopy.edit({
	// 	startIndex: offset,
	// 	oldEndIndex: offset,
	// 	newEndIndex: offset + injectedCompletionText.length + insertText.length,
	// 	startPosition: asPoint(positionWithoutInjectedCompletionText),
	// 	oldEndPosition: asPoint(positionWithoutInjectedCompletionText),
	// 	newEndPosition: asPoint(completionEndPosition),
	// })

	// TODO(tree-sitter): consider parsing only the changed part of the document to improve performance.
	// parser.parse(textWithCompletion, tree, { includedRanges: [...]})
	return parser.parse(textWithCompletion);
	// return parser.parse(textWithCompletion, treeCopy)
}

/**
 * Parses an inline code completion item using Tree-sitter and determines if the completion
 * would introduce any syntactic errors.
 */
export function parseCompletion(context: CompletionContext): ParsedCompletion {
	const {
		completion,
		document,
		docContext,
		docContext: { position, multilineTriggerPosition },
		logger,
		spanId,
	} = context;
	const parseTreeCache = getCachedParseTreeForDocument(document);

	// // Do nothing if the syntactic post-processing is not enabled.
	if (!parseTreeCache) {
		return completion;
	}

	const { parser, tree } = parseTreeCache;

	const completionEndPosition = position.translate(
		// TODO(skcd): We are subtracting 1 from the line count because the translate
		// happens on the delta, so we want to keep it as such
		lines(completion.insertText).length - 1,
		getLastLine(completion.insertText).length
	);

	logger.logInfo('sidecar.parse_completion', {
		'event_name': 'sidecar.parse_completion',
		'position': position,
		'completion_end_position': completionEndPosition,
		completion: completion.insertText,
	});

	const treeWithCompletion = pasteCompletion({
		completion,
		document,
		docContext,
		tree,
		parser,
		completionEndPosition,
		logger,
		spanId,
	});

	const points: ParsedCompletion['points'] = {
		start: {
			row: position.line,
			column: position.character,
		},
		end: {
			row: completionEndPosition.line,
			column: completionEndPosition.character,
		},
	};

	if (multilineTriggerPosition) {
		points.trigger = asPoint(multilineTriggerPosition);
	}

	// Search for ERROR nodes in the completion range.
	// This is not really complete because we can have missing } or other parameters
	// which we need to fill in
	const query = parser.getLanguage().query('(ERROR) @error');
	// TODO(tree-sitter): query bigger range to catch higher scope syntactic errors caused by the completion.
	const captures = query.captures(
		treeWithCompletion.rootNode,
		points?.trigger || points.start,
		points.end
	);
	const completeCaptures = query.captures(treeWithCompletion.rootNode);

	logger.logInfo('sidecar.tree_sitter.errors', {
		'event_name': 'sidecar.tree_sitter.errors',
		'id': spanId,
		'parse_error_count': captures.length,
		'completion': completion.insertText,
		'parse_error_count_complete': completeCaptures.length,
	});

	return {
		...completion,
		points,
		tree: treeWithCompletion,
		parseErrorCount: captures.length,
	};
}

interface PasteCompletionParams {
	completion: InlineCompletionItem;
	document: TextDocument;
	docContext: DocumentContext;
	tree: Tree;
	parser: Parser;
	completionEndPosition: Position;
}

export function dropParserFields(completion: ParsedCompletion): InlineCompletionItemWithAnalytics {
	const { points, tree, ...rest } = completion;

	return rest;
}
