/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';

import { logCompletionFormatEvent, logError } from './logger';
import type { AutocompleteItem } from './suggested-autocomplete-items-cache';
import { lines } from './text-processing';

export function getEditorInsertSpaces(uri: vscode.Uri): boolean {
	const editor = vscode.window.visibleTextEditors.find(editor => editor.document.uri === uri);
	if (!editor) {
		// Default to the same as VS Code default
		return true;
	}

	const { languageId } = editor.document;
	const languageConfig = vscode.workspace.getConfiguration(`[${languageId}]`, uri);
	const languageSetting = languageConfig.get('editor.insertSpaces') as boolean | undefined;
	// Prefer language specific setting.
	const insertSpaces = languageSetting || editor.options.insertSpaces;

	// This should never happen: "When getting a text editor's options, this property will always be a boolean (resolved)."
	if (typeof insertSpaces === 'string' || insertSpaces === undefined) {
		console.error('Unexpected value when getting "insertSpaces" for the current editor.');
		return true;
	}

	return insertSpaces;
}

export function getEditorTabSize(uri: vscode.Uri): number {
	const editor = vscode.window.visibleTextEditors.find(editor => editor.document.uri === uri);
	if (!editor) {
		// Default to the same as VS Code default
		return 4;
	}

	const { languageId } = editor.document;
	const languageConfig = vscode.workspace.getConfiguration(`[${languageId}]`, uri);
	const languageSetting = languageConfig.get<number>('editor.tabSize');
	// Prefer language specific setting.
	const tabSize = languageSetting || editor.options.tabSize;

	// This should never happen: "When getting a text editor's options, this property will always be a number (resolved)."
	if (typeof tabSize === 'string' || tabSize === undefined) {
		console.error('Unexpected value when getting "tabSize" for the current editor.');
		return 4;
	}

	return tabSize;
}

export async function formatCompletion(autocompleteItem: AutocompleteItem): Promise<void> {
	try {
		const startedAt = performance.now();
		const {
			document,
			position,
			docContext: { currentLinePrefix },
		} = autocompleteItem.requestParams;

		const insertedLines = lines(autocompleteItem.analyticsItem.insertText);
		const endPosition =
			insertedLines.length <= 1
				? new vscode.Position(position.line, currentLinePrefix.length + insertedLines[0].length)
				: new vscode.Position(
					position.line + insertedLines.length - 1,
					insertedLines.at(-1)!.length
				);
		// Start at the beginning of the line to format the whole line if needed.
		const rangeToFormat = new vscode.Range(new vscode.Position(position.line, 0), endPosition);

		const formattingChanges = await vscode.commands.executeCommand<vscode.TextEdit[] | undefined>(
			'vscode.executeFormatRangeProvider',
			document.uri,
			rangeToFormat,
			{
				tabSize: getEditorTabSize(document.uri),
				insertSpaces: getEditorInsertSpaces(document.uri),
			}
		);

		const formattingChangesInRange = (formattingChanges || []).filter(change =>
			rangeToFormat.contains(change.range)
		);

		if (formattingChangesInRange.length !== 0) {
			await vscode.window.activeTextEditor?.edit(
				edit => {
					for (const change of formattingChangesInRange) {
						edit.replace(change.range, change.newText);
					}
				},
				{ undoStopBefore: false, undoStopAfter: true }
			);
		}

		logCompletionFormatEvent({
			duration: performance.now() - startedAt,
			languageId: document.languageId,
			formatter: getFormatter(document.languageId),
		});
	} catch (unknownError) {
		logError(unknownError instanceof Error ? unknownError : new Error(unknownError as string));
	}
}

function getFormatter(languageId: string): string | undefined {
	// Access the configuration for the specific languageId
	const config = vscode.workspace.getConfiguration(`[${languageId}]`);

	// Get the default formatter setting
	const defaultFormatter = config.get('editor.defaultFormatter');

	if (defaultFormatter) {
		return defaultFormatter as string;
	}

	// Fallback: Check the global default formatter if specific language formatter is not set
	const globalConfig = vscode.workspace.getConfiguration();
	return globalConfig.get('editor.defaultFormatter');
}

export function getEditorIndentString(uri: vscode.Uri): string {
	const insertSpaces = getEditorInsertSpaces(uri);
	const tabSize = getEditorTabSize(uri);

	return insertSpaces ? ' '.repeat(tabSize) : '\t';
}
