/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { Range, type Position, type TextDocument } from 'vscode';
import type { default as Parser, Point, SyntaxNode, Tree } from 'web-tree-sitter';

import type { DocumentContext } from '../get-current-doc-context';
import type { ItemPostProcessingInfo } from '../logger';
import type { InlineCompletionItem } from '../types';
import { dropParserFields, type ParsedCompletion } from './parse-completion';
import { getCachedParseTreeForDocument } from './treeSitter/parseTree';
import { findLastAncestorOnTheSameRow } from './truncate-parsed-completion';
import { collapseDuplicativeWhitespace, removeTrailingWhitespace, trimUntilSuffix } from './utils';

interface ProcessInlineCompletionsParams {
	document: TextDocument;
	position: Position;
	docContext: DocumentContext;
}

export interface InlineCompletionItemWithAnalytics extends ItemPostProcessingInfo, InlineCompletionItem {
	stopReason?: string;
}

/**
 * Return a filtered version of the given array, de-duplicating items based on the given key function.
 * The order of the filtered array is not guaranteed to be related to the input ordering.
 */
export const dedupeWith = <T>(items: T[], key: keyof T | ((item: T) => string)): T[] => [
	...new Map(items.map(item => [typeof key === 'function' ? key(item) : item[key], item])).values(),
];

/**
 * This function implements post-processing logic that is applied regardless of
 * which provider is chosen.
 */
export function processInlineCompletions(
	items: ParsedCompletion[],
	_params: ProcessInlineCompletionsParams
): InlineCompletionItemWithAnalytics[] {

	// Remove low quality results
	const visibleResults = removeLowQualityCompletions(items);

	// Remove duplicate results
	const uniqueResults = dedupeWith(visibleResults, 'insertText');

	// Rank results
	const rankedResults = rankCompletions(uniqueResults);

	return rankedResults.map(dropParserFields);
}

interface ProcessItemParams {
	document: TextDocument;
	position: Position;
	docContext: DocumentContext;
}

export function processCompletion(
	completion: ParsedCompletion,
	params: ProcessItemParams
): ParsedCompletion {
	const { document, position, docContext } = params;
	const { prefix, suffix, currentLineSuffix, multilineTrigger, multilineTriggerPosition } = docContext;
	let { insertText } = completion;

	if (completion.insertText.length === 0) {
		return completion;
	}

	if (docContext.injectedPrefix) {
		insertText = docContext.injectedPrefix + completion.insertText;
	}

	if (insertText.length === 0) {
		return completion;
	}

	completion.range = getRangeAdjustedForOverlappingCharacters(completion, {
		position,
		currentLineSuffix,
	});

	// Use the parse tree WITHOUT the pasted completion to get surrounding node types.
	// Helpful to optimize the completion AST triggers for higher CAR.
	completion.nodeTypes = getNodeTypesInfo({
		position,
		parseTree: getCachedParseTreeForDocument(document)?.tree,
		multilineTriggerPosition,
	});

	// Use the parse tree WITH the pasted completion to get surrounding node types.
	// Helpful to understand CAR for incomplete code snippets.
	// E.g., `const value = ` does not produce a valid AST, but `const value = 'someValue'` does
	completion.nodeTypesWithCompletion = getNodeTypesInfo({
		position,
		parseTree: completion.tree,
		multilineTriggerPosition,
	});

	if (multilineTrigger) {
		insertText = removeTrailingWhitespace(insertText);
	} else {
		// TODO: move to parse-and-truncate to have one place where truncation happens
		// Only keep a single line in single-line completions mode
		const newLineIndex = insertText.indexOf('\n');
		if (newLineIndex !== -1) {
			insertText = insertText.slice(0, newLineIndex + 1);
		}
	}

	insertText = trimUntilSuffix(insertText, prefix, suffix, document.languageId);
	insertText = collapseDuplicativeWhitespace(prefix, insertText);

	// Trim start and end of the completion to remove all trailing whitespace.
	insertText = insertText.trimEnd();

	return { ...completion, insertText };
}

interface GetNodeTypesInfoParams {
	position: Position;
	parseTree?: Tree;
	multilineTriggerPosition: Position | null;
}

export function asPoint(position: Pick<Position, 'line' | 'character'>): Parser.Point {
	return { row: position.line, column: position.character };
}

export const isDefined = <T>(value: T): value is NonNullable<T> => value !== undefined && value !== null;

/**
 * Returns a descendant node at the start position and three parent nodes.
 */
export function getNodeAtCursorAndParents(
	node: SyntaxNode,
	startPosition: Point
): readonly [
	{ readonly name: 'at_cursor'; readonly node: SyntaxNode },
	...{ name: string; node: SyntaxNode }[],
] {
	const atCursorNode = node.descendantForPosition(startPosition);

	const parent = atCursorNode.parent;
	const parents = [parent, parent?.parent, parent?.parent?.parent].filter(isDefined).map(node => ({
		name: 'parents',
		node,
	}));

	return [
		{
			name: 'at_cursor',
			node: atCursorNode,
		},
		...parents,
	] as const;
}

function getNodeTypesInfo(
	params: GetNodeTypesInfoParams
): InlineCompletionItemWithAnalytics['nodeTypes'] | undefined {
	const { position, parseTree, multilineTriggerPosition } = params;

	const positionBeforeCursor = asPoint({
		line: position.line,
		character: Math.max(0, position.character - 1),
	});

	if (parseTree) {
		const captures = getNodeAtCursorAndParents(parseTree.rootNode, positionBeforeCursor);

		if (captures.length > 0) {
			const [atCursor, ...parents] = captures;
			const lastAncestorOnTheSameLine = findLastAncestorOnTheSameRow(
				parseTree.rootNode,
				asPoint(multilineTriggerPosition || position)
			);

			return {
				atCursor: atCursor.node.type,
				parent: parents[0]?.node.type,
				grandparent: parents[1]?.node.type,
				greatGrandparent: parents[2]?.node.type,
				lastAncestorOnTheSameLine: lastAncestorOnTheSameLine?.type,
			};
		}
	}

	return undefined;
}

interface AdjustRangeToOverwriteOverlappingCharactersParams {
	position: Position;
	currentLineSuffix: string;
}

/**
 * Return a copy of item with an adjusted range to overwrite duplicative characters after the
 * completion on the first line.
 *
 * For example, with position `function sort()` and completion `array) {`, the range should be
 * adjusted to span the `)` so it is overwritten by the `insertText` (so that we don't end up with
 * the invalid `function sort(array) {)`).
 */
export function getRangeAdjustedForOverlappingCharacters(
	item: InlineCompletionItem,
	{ position, currentLineSuffix }: AdjustRangeToOverwriteOverlappingCharactersParams
): InlineCompletionItem['range'] {
	const matchingSuffixLength = getMatchingSuffixLength(item.insertText, currentLineSuffix);

	if (!item.range && currentLineSuffix !== '' && matchingSuffixLength !== 0) {
		return new Range(position, position.translate(undefined, matchingSuffixLength));
	}

	return undefined;
}

export function getMatchingSuffixLength(insertText: string, currentLineSuffix: string): number {
	let j = 0;
	for (let i = 0; i < insertText.length; i++) {
		if (insertText[i] === currentLineSuffix[j]) {
			j++;
		}
	}

	return j;
}

function rankCompletions(completions: ParsedCompletion[]): ParsedCompletion[] {
	return completions.sort((a, b) => {
		// Prioritize completions without parse errors
		if (a.parseErrorCount && !b.parseErrorCount) {
			return 1; // b comes first
		}
		if (!a.parseErrorCount && b.parseErrorCount) {
			return -1; // a comes first
		}

		// If both have or don't have parse errors, compare by insertText length
		return b.insertText.split('\n').length - a.insertText.split('\n').length;
	});
}

const PROMPT_CONTINUATIONS = [
	// Anthropic style prompt continuation
	/^(\n){0,2}Human:\ /,
	// StarCoder style code example
	/^(\/\/|\#) Path:\ /,
];
function removeLowQualityCompletions(completions: InlineCompletionItem[]): InlineCompletionItem[] {
	return completions.filter(c => {
		const isEmptyOrSingleCharacterCompletion = c.insertText.trim().length <= 1;
		const isPromptContinuation = PROMPT_CONTINUATIONS.some(regex => c.insertText.match(regex));

		return !isEmptyOrSingleCharacterCompletion && !isPromptContinuation;
	});
}
