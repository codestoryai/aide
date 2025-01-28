/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

export function getPreviousWordRange(document: vscode.TextDocument, position: vscode.Position): vscode.Range | undefined {
	let line = position.line;
	let character = position.character - 1; // Start from the previous character

	while (line >= 0) {
		while (character >= 0) {
			const pos = new vscode.Position(line, character);
			const wordRange = document.getWordRangeAtPosition(pos);
			if (wordRange && wordRange.end.isBefore(position)) {
				return wordRange;
			}
			character--;
		}
		line--;
		if (line >= 0) {
			character = document.lineAt(line).text.length - 1;
		}
	}
	return undefined;
}
