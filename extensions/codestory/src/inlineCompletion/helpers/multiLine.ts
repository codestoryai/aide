/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';

export async function isMultiline(
	document: vscode.TextDocument,
	_position: vscode.Position,
	isMiddleOfLine: boolean,
): Promise<boolean> {
	// TODO(skcd): Implement this properly later on, there are certain conditions
	// based on tree sitter that we can use to determine if a completion is multiline
	if (document.lineCount > 800) {
		return false;
	}
	if (!isMiddleOfLine) {

	}
	if (isMiddleOfLine) {

	}
	return true;
}
