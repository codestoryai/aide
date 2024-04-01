/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';

export const TERMINAL_SELECTION = 'terminalSelection';

export function registerTerminalSelection() {
	// TODO(skcd): This isnot working, we are parsing the value as a JSON which makes sense maybe?
	vscode.chat.registerChatVariableResolver(TERMINAL_SELECTION, 'User selection in the terminal', {
		resolve: (_name: string, _context: vscode.ChatVariableContext, _token: vscode.CancellationToken) => {
			let selection = '';
			try {
				const possibleSelection = vscode.window.activeTerminal?.selection;
				if (possibleSelection) {
					selection = possibleSelection;
				} else {
					selection = 'unable to read selection, is the terminal active?';
				}
			} catch (err) {
				selection = 'unable to read selection, please let the developers at codestoryai know';
				return [
					{
						level: vscode.ChatVariableLevel.Full,
						value: selection,
					}
				];
			}
			return [
				{
					level: vscode.ChatVariableLevel.Full,
					value: selection,
				},
			];
		}
	});
}
