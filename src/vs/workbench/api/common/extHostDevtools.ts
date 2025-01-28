/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as vscode from 'vscode';
import { ExtHostDevtoolsShape, IMainContext, MainContext, MainThreadDevtoolsShape } from './extHost.protocol.js';
import { DevtoolsState } from './extHostTypeConverters.js';
import { Emitter } from '../../../base/common/event.js';
import * as typeConvert from './extHostTypeConverters.js';

export class ExtHostDevtools implements ExtHostDevtoolsShape {
	private _proxy: MainThreadDevtoolsShape;

	private _onDidTriggerInspectingHostStart = new Emitter<void>();
	onDidTriggerInspectingHostStart = this._onDidTriggerInspectingHostStart.event;

	private _onDidTriggerInspectingHostStop = new Emitter<void>();
	onDidTriggerInspectingHostStop = this._onDidTriggerInspectingHostStop.event;

	private _onDidInspectingClearOverlays = new Emitter<void>();
	onDidInspectingClearOverlays = this._onDidInspectingClearOverlays.event;

	constructor(
		mainContext: IMainContext
	) {
		this._proxy = mainContext.getProxy(MainContext.MainThreadDevtools);
	}

	setStatus(status: vscode.DevtoolsStatus): void {
		const state = DevtoolsState.from(status);
		this._proxy.$setStatus(state);
	}

	setIsInspecting(isInspecting: boolean): void {
		this._proxy.$setIsInspecting(isInspecting);
	}

	setLatestPayload(payload: vscode.InspectionResult | null) {
		if (payload) {
			const dto = typeConvert.DevtoolsInspectionResult.from(payload);
			this._proxy.$setLatestPayload(dto);
		} else {
			this._proxy.$setLatestPayload(null);
		}
	}

	$startInspectingHost(): void {
		this._onDidTriggerInspectingHostStart.fire();
	}

	$stopInspectingHost(): void {
		this._onDidTriggerInspectingHostStop.fire();
	}

	$inspectingClearOverlays(): void {
		this._onDidInspectingClearOverlays.fire();
	}
}
