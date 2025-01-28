/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

function pad(num: number): string {
	return num.toString().padStart(2, '0');
}

export class AidePlanTimer {
	private _startTime: number;
	private _statusBar: vscode.StatusBarItem;
	private _timer: NodeJS.Timer;

	constructor() {
		this._startTime = Date.now();
		const myStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
		myStatusBarItem.show();

		// start an interval timer here to keep updating
		const timer = setInterval(() => {
			const elapsedTime = Date.now() - this._startTime;

			const seconds = Math.floor((elapsedTime / 1000) % 60);
			const minutes = Math.floor((elapsedTime / (1000 * 60)) % 60);
			const hours = Math.floor((elapsedTime / (1000 * 60 * 60)));

			const timeString = `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
			myStatusBarItem.text = `$(clock) ${timeString}`;
		}, 1000);
		this._statusBar = myStatusBarItem;
		this._timer = timer;
	}

	/**
	 * Starts the plan timer which keeps running with start of the plan
	 */
	startPlanTimer() {
		this._startTime = Date.now();
		this._timer.refresh();
	}

	/**
	 * Returns back the status bar so we can register it
	 */
	statusBar(): vscode.StatusBarItem {
		return this._statusBar;
	}
}
