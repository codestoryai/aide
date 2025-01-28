/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

/*
const statusBarItemText = (enabled: boolean | undefined) =>
	enabled ? '$(check) Aide' : '$(circle-slash) Aide';

const statusBarItemTooltip = (enabled: boolean | undefined) =>
	enabled ? 'Tab autocomplete is enabled' : 'Click to enable tab autocomplete';

let lastStatusBar: vscode.StatusBarItem | undefined = undefined;
*/

export function setupStatusBar(
	_enabled: boolean | undefined,
	_loading?: boolean
) {
	/*
	const statusBarItem = vscode.window.createStatusBarItem(
		vscode.StatusBarAlignment.Right,
	);
	statusBarItem.text = loading
		? '$(loading~spin) Aide'
		: statusBarItemText(enabled);
	statusBarItem.tooltip = statusBarItemTooltip(enabled);
	statusBarItem.command = 'aide.inlineCompletion.toggle';

	// Swap out with old status bar
	if (lastStatusBar) {
		lastStatusBar.dispose();
	}
	statusBarItem.show();
	lastStatusBar = statusBarItem;

	vscode.workspace.onDidChangeConfiguration((event) => {
		if (event.affectsConfiguration('aide')) {
			const config = vscode.workspace.getConfiguration('aide');
			const enabled = config.get<boolean>('inlineCompletion.enableTabAutocomplete');
			statusBarItem.dispose();
			setupStatusBar(enabled);
		}
	});
	*/
}

export function startupStatusBar() {
	const config = vscode.workspace.getConfiguration('aide');
	const enabled = config.get<boolean>('inlineCompletion.enableTabAutocomplete');
	if (enabled) {
		setupStatusBar(enabled);
	}
}

function checkInlineCompletionsEnabled(): boolean {
	const config = vscode.workspace.getConfiguration('aide');
	return config.get<boolean>('inlineCompletion.enableTabAutocomplete') ?? false;
}

export function setLoadingStatus() {
	if (checkInlineCompletionsEnabled()) {
		setupStatusBar(true, true);
	}
}

export function disableLoadingStatus() {
	if (checkInlineCompletionsEnabled()) {
		setupStatusBar(true, false);
	}
}
