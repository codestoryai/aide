/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { Position } from 'vscode';

import type { DocumentDependentContext, LinesContext } from './get-current-doc-context';
import {
	getLastLine,
	indentation,
	lines,
	OPENING_BRACKET_REGEX,
} from './text-processing';
import { getLanguageConfig } from './language_config';
import { LoggingService } from './logger';

interface DetectMultilineParams {
	docContext: LinesContext & DocumentDependentContext;
	languageId: string;
	dynamicMultilineCompletions: boolean;
	position: Position;
}

/**
 * We return the trigger point for multine, which in this case is the start of a new block
 * generally denoted by { or [ or : etc
 * The position of the multiline trigger is the position of the above element in the current line
 */
interface DetectMultilineResult {
	multilineTrigger: string | null;
	multilineTriggerPosition: Position | null;
}

export function endsWithBlockStart(text: string, languageId: string): string | null {
	const blockStart = getLanguageConfig(languageId)?.blockStart;
	return blockStart && text.trimEnd().endsWith(blockStart) ? blockStart : null;
}

export function detectMultiline(params: DetectMultilineParams, logger: LoggingService, _spanId: string): DetectMultilineResult {
	// dynamicMultilineCompletions is a flag that determines whether we should trigger multiline
	// its always set to true
	const { docContext, languageId, dynamicMultilineCompletions, position } = params;
	const { prefix, prevNonEmptyLine, nextNonEmptyLine, currentLinePrefix, currentLineSuffix } =
		docContext;

	const blockStart = endsWithBlockStart(prefix, languageId);
	const isBlockStartActive = Boolean(blockStart);

	// why do we here change it to current like prefix + suffix or just the prefix
	// const currentLineText =
	// 	currentLineSuffix.trim().length > 0 ? currentLinePrefix + currentLineSuffix : currentLinePrefix;

	// const isMethodOrFunctionInvocation =
	// 	!currentLinePrefix.trim().match(FUNCTION_KEYWORDS) &&
	// 	currentLineText.match(FUNCTION_OR_METHOD_INVOCATION_REGEX);

	// Don't fire multiline completion for method or function invocations
	// TODO(skcd): We want to fire for method and function invocations as well
	// if (!dynamicMultilineCompletions && isMethodOrFunctionInvocation) {

	// 	return {
	// 		multilineTrigger: null,
	// 		multilineTriggerPosition: null,
	// 	};
	// }

	const openingBracketMatch = getLastLine(prefix.trimEnd()).match(OPENING_BRACKET_REGEX);

	// TODO(skcd): I do not understand this condition properly
	// we are restricting the condition based on the fact that we might not have a match over
	// here based on indentation but I think that's not exactly correct.
	// one example of this case is:
	// if (something) {[cursor here]}
	const isSameLineOpeningBracketMatch =
		currentLinePrefix.trim() !== '' &&
		openingBracketMatch &&
		// Only trigger multiline suggestions when the next non-empty line is indented less
		// than the block start line (the newly created block is empty).
		indentation(currentLinePrefix) >= indentation(nextNonEmptyLine);
	// we handle cases like this
	// ```typescript
	// class A {
	// 		function a() {
	// 			if a() {
	// 				[cursor here]
	// 			}
	// 		}
	// 	}
	// ```
	// in this case we still want it to trigger and show some value
	// the point is inner indentation is not the same as the indentation of the block

	// if
	const isNewLineOpeningBracketMatch =
		currentLinePrefix.trim() === '' &&
		currentLineSuffix.trim() === '' &&
		openingBracketMatch &&
		// Only trigger multiline suggestions when the next non-empty line is indented the same or less
		// examples like this
		// ```typescript
		// if a() {
		// 		[cursor_here]
		// } <- next non empty line
		// what about cases like this
		// if a() {[cursor_here]}
		// we still want to trigger it in this case
		indentation(prevNonEmptyLine) < indentation(currentLinePrefix) &&
		// Only trigger multiline suggestions when the next non-empty line is indented less
		// than the block start line (the newly created block is empty).
		indentation(prevNonEmptyLine) >= indentation(nextNonEmptyLine);

	// basically we detect blocks of code which are contained or in a scoope here from the bracket
	// start position, const a = {[cursor]} <- an example
	if ((dynamicMultilineCompletions && isNewLineOpeningBracketMatch) || isSameLineOpeningBracketMatch) {

		logger.logInfo('sidecar.multiline.trigger', {
			event_name: 'sidecar.multiline.trigger',
			current_line_prefix: currentLinePrefix,
			current_line_suffix: currentLineSuffix,
		});
		return {
			multilineTrigger: openingBracketMatch[0],
			multilineTriggerPosition: getPrefixLastNonEmptyCharPosition(prefix, position),
		};
	}

	const nonEmptyLineEndsWithBlockStart =
		currentLinePrefix.length > 0 &&
		isBlockStartActive &&
		indentation(currentLinePrefix) >= indentation(nextNonEmptyLine);

	const isEmptyLineAfterBlockStart =
		currentLinePrefix.trim() === '' &&
		currentLineSuffix.trim() === '' &&
		// Only trigger multiline suggestions for the beginning of blocks
		isBlockStartActive &&
		// Only trigger multiline suggestions when the next non-empty line is indented the same or less
		indentation(prevNonEmptyLine) < indentation(currentLinePrefix) &&
		// Only trigger multiline suggestions when the next non-empty line is indented less
		// than the block start line (the newly created block is empty).
		indentation(prevNonEmptyLine) >= indentation(nextNonEmptyLine);

	if ((dynamicMultilineCompletions && nonEmptyLineEndsWithBlockStart) || isEmptyLineAfterBlockStart) {

		return {
			multilineTrigger: blockStart,
			multilineTriggerPosition: getPrefixLastNonEmptyCharPosition(prefix, position),
		};
	}

	return {
		multilineTrigger: null,
		multilineTriggerPosition: null,
	};
}

/**
 * Precalculate the multiline trigger position based on `prefix` and `cursorPosition` to be
 * able to change it during streaming to the end of the first line of the completion.
 * So whats happening here is that say we have the prefix like this `if (something) {\n`
 * and we are at the cursor position where the `\n` is, we want to move the cursor to the end of the line
 * and not to the beginning of the line.
 * This function will return the position of the last non-empty character in the prefix.
 */
function getPrefixLastNonEmptyCharPosition(prefix: string, cursorPosition: Position): Position {
	const trimmedPrefix = prefix.trimEnd();
	const diffLength = prefix.length - trimmedPrefix.length;
	if (diffLength === 0) {
		return cursorPosition.translate(0, -1);
	}

	const prefixDiff = prefix.slice(-diffLength);
	return new Position(
		cursorPosition.line - (lines(prefixDiff).length - 1),
		getLastLine(trimmedPrefix).length - 1
	);
}
