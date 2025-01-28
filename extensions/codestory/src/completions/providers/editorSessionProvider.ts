/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { RepoRef, SideCarClient } from '../../sidecar/client';
import { InEditorRequest, InLineAgentContextSelection } from '../../sidecar/types';
import { parseDiagnosticsInformation, reportFromStreamToEditorSessionProgress } from './reportEditorSessionAnswerStream';

export enum IndentStyle {
	Tabs = 'tabs',
	Spaces = 'spaces'
}

export interface IndentStyleSpaces {
	kind: IndentStyle;
	indentSize: number | null;
}

export class IndentationUtils {
	private spacePatterns: Map<number, RegExp>;
	private readonly tabPattern: RegExp;

	constructor() {
		this.spacePatterns = new Map();
		this.tabPattern = /^(\t+)/;
	}

	/**
	 * Determines the indentation of a given line.
	 *
	 * @param line The line to inspect.
	 * @param useSpaces Whether to look for spaces (true) or tabs (false).
	 * @param spaceCount If using spaces, the number of spaces per indent.
	 * @returns A tuple where the first element is the whitespace string and the second is the indent count.
	 */
	guessIndent(line: string, useSpaces: boolean, spaceCount?: number): [string, number] {
		const pattern = useSpaces ? this.getSpacePattern(spaceCount!) : this.tabPattern;
		const match = line.match(pattern);
		return match ? [match[0], match[0].length / (useSpaces ? spaceCount! : 1)] : ['', 0];
	}

	/**
	 * Retrieves (or generates) the regex pattern for a given space count.
	 *
	 * @param count The number of spaces per indent.
	 * @returns The corresponding regex pattern.
	 */
	private getSpacePattern(count: number): RegExp {
		if (!this.spacePatterns.has(count)) {
			this.spacePatterns.set(count, new RegExp(`^(( {${count}})+)`));
		}
		return this.spacePatterns.get(count)!;
	}
}

export class IndentationHelper {
	static getLeadingWhitespace(line: string) {
		for (let i = 0; i < line.length; i++) {
			const charCode = line.charCodeAt(i);
			if (charCode !== 32 && charCode !== 9) {
				return line.substring(0, i);
			}
		}
		return line;
	}

	static guessIndentStyleFromLeadingWhitespace(whitespace: string): IndentStyleSpaces | null {
		if (!whitespace || whitespace === ' ') {
			return null;
		}
		if (/\t/.test(whitespace)) {
			return { kind: IndentStyle.Tabs, indentSize: null };
		}
		const spaceMatch = whitespace.match(/( +)/);
		if (spaceMatch) {
			const spaceCount = spaceMatch[1].length;
			return {
				kind: IndentStyle.Spaces,
				indentSize: spaceCount === 2 ? spaceCount : 4
			};
		}
		return null;
	}

	static guessIndentStyleFromLine(line: string) {
		const leadingWhitespace = this.getLeadingWhitespace(line);
		const result = this.guessIndentStyleFromLeadingWhitespace(leadingWhitespace);
		return result;
	}

	// we get the whitespace string and the indent level this way for the string we want to add
	static guessIndentLevel(line: string, indentStyle: IndentStyleSpaces): [string, number] {
		const indentationUtils = new IndentationUtils();
		if (indentStyle === null) {
			return ['', 0];
		}
		const [whiteSpaceString, indentationLevel] = indentationUtils.guessIndent(line, indentStyle.kind === IndentStyle.Spaces, indentStyle.indentSize ?? 1);
		return [whiteSpaceString, indentationLevel];
	}

	static getDocumentIndentStyle(lines: string[], defaultStyle: IndentStyleSpaces | undefined) {
		for (const line of lines) {
			const style = this.guessIndentStyleFromLine(line);
			if (style) {
				return style;
			}
		}
		return defaultStyle || { kind: IndentStyle.Tabs, indentSize: null };
	}

	static getDocumentIndentStyleUsingSelection(selectionContext: InLineAgentContextSelection): IndentStyleSpaces {
		const activeTextEditor = vscode.window.activeTextEditor;
		if (activeTextEditor) {
			if (activeTextEditor.options.insertSpaces) {
				// @ts-ignore
				return { kind: IndentStyle.Spaces, indentSize: activeTextEditor.options.tabSize ?? null };
			} else {
				return { kind: IndentStyle.Tabs, indentSize: null };
			}
		}
		const content = [...selectionContext.above.lines, ...selectionContext.range.lines, ...selectionContext.below.lines];
		for (const line of content) {
			const style = this.guessIndentStyleFromLine(line);
			if (style) {
				return style;
			}
		}
		return { kind: IndentStyle.Tabs, indentSize: null };
	}

	static changeIndentLevel(lines: string[], currentLevel: number, newLevel: number, style: IndentStyleSpaces): string[] {
		if (currentLevel === newLevel) {
			return lines;
		}
		if (currentLevel > newLevel) {
			// we have to shift things back by a few levels
			const indentationStringToRemoveFromPrefix = style.kind === IndentStyle.Tabs ? '\t' : ' '.repeat(style.indentSize ?? 4);
			// we have to remove this string from every string
			const newLines = lines.map((line) => {
				if (line.startsWith(indentationStringToRemoveFromPrefix)) {
					return line.slice(indentationStringToRemoveFromPrefix.length);
				} else {
					return line;
				}
			});
			return newLines;
		}
		if (currentLevel < newLevel) {
			// we have to shift things forward by a few levels
			const indentationStringToAddToPrefix = style.kind === IndentStyle.Tabs ? '\t' : ' '.repeat(style.indentSize ?? 4);
			// we have to add this string to every string
			const newLines = lines.map((line) => {
				return indentationStringToAddToPrefix + line;
			});
			return newLines;
		}
		return lines;
	}

	static changeIndentStyle(lines: string[], oldStyle: IndentStyleSpaces, newStyle: IndentStyleSpaces): string[] {
		const indentationStringToRemoveFromPrefix = oldStyle.kind === IndentStyle.Tabs ? '\t' : ' '.repeat(oldStyle.indentSize ?? 4);
		const indentationStringToAddToPrefix = newStyle.kind === IndentStyle.Tabs ? '\t' : ' '.repeat(newStyle.indentSize ?? 4);
		const newLines = lines.map((line) => {
			// we have to remove the old indentation and add the new one
			const indentationLevel = IndentationHelper.guessIndentLevel(line, oldStyle);
			// now we can remove the string
			const strippedLine = line.slice(indentationStringToRemoveFromPrefix.repeat(indentationLevel[1]).length);
			// now add back the new indentation string
			return indentationStringToAddToPrefix.repeat(indentationLevel[1]) + strippedLine;
		});
		return newLines;
	}
}

export async function provideInteractiveEditorResponse(
	repoRef: RepoRef,
	sidecarClient: SideCarClient,
	workingDirectory: string,
	request: vscode.AideAgentRequest,
	progress: vscode.AideAgentResponseStream,
	token: vscode.CancellationToken,
): Promise<vscode.ChatResult> {
	const variables = request.references;
	if (!variables || variables.length === 0) {
		return {};
	}

	// Find variable entry with name `_inlineChatContext`
	const contextVariable = variables.find(variable => variable.id === '_inlineChatContext');
	if (!contextVariable) {
		return {};
	}

	const sessionString = contextVariable.value as string;
	const session = JSON.parse(sessionString) as { uri: vscode.Uri; selection: vscode.Selection; wholeRange: vscode.Range };
	const textDocumentUri = session.uri;
	const textDocument = await vscode.workspace.openTextDocument(textDocumentUri);
	// First get the more correct range for this selection
	const text = textDocument.getText();
	const lineCount = textDocument.lineCount;
	const startOffset = textDocument.offsetAt(session.wholeRange.start);
	const endOffset = textDocument.offsetAt(session.wholeRange.end);
	const textEncoder = new TextEncoder();
	const utf8Array = [...textEncoder.encode(text)];
	// Now we want to prepare the data we have to send over the wire
	const context: InEditorRequest = {
		repoRef: repoRef.getRepresentation(),
		query: request.prompt,
		threadId: request.exchangeId,
		language: textDocument.languageId,
		snippetInformation: {
			startPosition: {
				line: session.wholeRange.start.line,
				character: session.wholeRange.start.character,
				byteOffset: startOffset,
			},
			endPosition: {
				line: session.wholeRange.end.line,
				character: session.wholeRange.end.character,
				byteOffset: endOffset,
			},
			shouldUseExactMatching: true,
		},
		textDocumentWeb: {
			text,
			utf8Array,
			language: textDocument.languageId,
			fsFilePath: textDocument.fileName,
			relativePath: vscode.workspace.asRelativePath(textDocument.fileName),
			lineCount,
		},
		diagnosticsInformation: await parseDiagnosticsInformation(
			vscode.languages.getDiagnostics(textDocument.uri),
			textDocument,
			session.wholeRange,
		),
		userContext: {
			variables: [],
			file_content_map: [],
			images: [],
			terminal_selection: undefined,
			folder_paths: [],
			is_plan_generation: false,
			is_plan_execution_until: null,
			is_plan_append: false,
			with_lsp_enrichment: false,
			is_plan_drop_from: null,
		}
	};
	const messages = await sidecarClient.getInLineEditorResponse(context);
	await reportFromStreamToEditorSessionProgress(
		messages,
		progress,
		token,
		repoRef,
		workingDirectory,
		sidecarClient,
		textDocument.languageId,
		textDocument,
	);

	return {};
}
