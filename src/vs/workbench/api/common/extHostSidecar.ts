/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as vscode from 'vscode';
import { ExtHostSidecarShape, IMainContext, MainContext, MainThreadSidecarShape } from './extHost.protocol.js';
import { SidecarRunningState } from './extHostTypeConverters.js';
import { Emitter } from '../../../base/common/event.js';

export class ExtHostSidecar implements ExtHostSidecarShape {
	private _proxy: MainThreadSidecarShape;

	private _onDidTriggerSidecarRestart = new Emitter<void>();
	onDidTriggerSidecarRestart = this._onDidTriggerSidecarRestart.event;

	constructor(
		mainContext: IMainContext
	) {
		this._proxy = mainContext.getProxy(MainContext.MainThreadSidecar);
	}

	setVersion(version: string): void {
		this._proxy.$setSidecarVersion(version);
	}

	setDownloadStatus(status: vscode.SidecarDownloadStatus): void {
		this._proxy.$setDownloadStatus(status);
	}

	setRunningStatus(status: vscode.SidecarRunningStatus): void {
		const state = SidecarRunningState.from(status);
		this._proxy.$setRunningStatus(state);
	}

	$attemptRestart(): void {
		this._onDidTriggerSidecarRestart.fire();
	}
}
