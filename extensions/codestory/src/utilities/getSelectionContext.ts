/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'path';
import * as vscode from 'vscode';
import { RepoRef } from '../sidecar/client';

export interface SelectionData {
	documentFilePath: string;
	selection: vscode.Selection;
	selectedText: string;
	extraSurroundingText: string;
	labelInformation: {
		label: string;
		hyperlink: string;
	};
}


export interface SelectionDataForExplain {
	lineStart: number;
	lineEnd: number;
	relativeFilePath: string;
	repoRef: string;
}


const getLabelForSelectedContext = (_workingDirectory: string, filePath: string, selection: vscode.Selection): {
	label: string;
	hyperlink: string;
} => {
	const relativePath = vscode.workspace.asRelativePath(filePath);
	const lineStart = selection.start.line + 1;
	const lineEnd = selection.end.line + 1;
	const columnStart = selection.start.character + 1;
	const columnEnd = selection.end.character + 1;
	return {
		label: `${relativePath} ${lineStart}:${columnStart} - ${lineEnd}:${columnEnd}`,
		hyperlink: `vscode://${filePath}:${lineStart}:${columnStart}?end=${lineEnd}:${columnEnd}`,
	};
};

export const getSelectedCodeContext = (workingDirectory: string): SelectionData | null => {
	const editor = vscode.window.activeTextEditor;

	if (editor) {
		const document = editor.document;
		const selection = editor.selection;

		if (selection.start.line === selection.end.line && selection.start.character === selection.end.character) {
			return null;
		}

		// Get the selected text
		const selectedText = document.getText(selection);
		// Now we will expand the context a bit more, ideally we should use tree-sitter
		// here to expand to the last open and close branch point, but for now this will do
		// we will expand to 50 lines above and 50 lines below
		const startLine = Math.max(0, selection.start.line - 50);
		const endLine = Math.min(document.lineCount - 1, selection.end.line + 50);
		const extraSurroundingSelection = new vscode.Selection(
			new vscode.Position(startLine, 0),
			new vscode.Position(endLine, document.lineAt(endLine).text.length)
		);
		const extraSurroundingText = document.getText(extraSurroundingSelection);

		return {
			documentFilePath: document.fileName,
			selection: selection,
			selectedText: selectedText,
			extraSurroundingText,
			labelInformation: getLabelForSelectedContext(workingDirectory, document.fileName, selection),
		};
	}
	return null;
};

export const getSelectedCodeContextForExplain = (workingDirectory: string, reporef: RepoRef): SelectionDataForExplain | null => {
	const editor = vscode.window.activeTextEditor;

	if (editor) {
		const document = editor.document;
		const selection = editor.selection;

		if (selection.start.line === selection.end.line && selection.start.character === selection.end.character) {
			return null;
		}
		const relativePath = path.relative(workingDirectory, document.fileName);
		return {
			lineStart: selection.start.line,
			lineEnd: selection.end.line,
			relativeFilePath: relativePath,
			repoRef: reporef.getRepresentation(),
		};
	} else {
		return null;
	}
};
