/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { SidecarRequestRange, } from '../../server/types';


/**
 * Add a decoration on the editor
 */
export async function addDecoration(fsFilePath: string, range: SidecarRequestRange) {
	const uri = vscode.Uri.file(fsFilePath);
	const editor = vscode.window.visibleTextEditors.find(editor => editor.document.uri.toString() === uri.toString());
	if (editor) {
		const decorations: vscode.DecorationOptions[] = [
			{
				range: new vscode.Range(range.startPosition.line, range.startPosition.character, range.endPosition.line, range.endPosition.character),
				hoverMessage: new vscode.MarkdownString(`aide is following the symbol`),
			}
		];
		const goToDefinitionDecoration = vscode.window.createTextEditorDecorationType({
			backgroundColor: 'rgba(0, 0, 255, 0.05)', // Reduce opacity for a more translucent background
			borderWidth: '0px', // Remove the border
			overviewRulerColor: 'rgba(0, 0, 255, 0.2)', // Reduce opacity for the overview ruler color
			overviewRulerLane: vscode.OverviewRulerLane.Right,
			cursor: 'pointer',
			textDecoration: 'underline',
			color: 'inherit' // Inherit the text color from the editor theme
		});
		editor.setDecorations(goToDefinitionDecoration, decorations);
	}
}
