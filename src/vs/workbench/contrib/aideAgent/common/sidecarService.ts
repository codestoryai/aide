/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';

export const ISidecarService = createDecorator<ISidecarService>('ISidecarService');
export interface ISidecarService {
	_serviceBrand: undefined;
	onDidChangeStatus: Event<SidecarStatusUpdateEvent>;
	onDidRestart: Event<void>;

	version: string;
	runningStatus: SidecarRunningStatus;
	downloadStatus: SidecarDownloadStatus;
	triggerRestart(): void;
}

export enum SidecarRunningStatus {
	Unavailable = 'Unavailable',
	Starting = 'Starting',
	Restarting = 'Restarting',
	Connecting = 'Connecting',
	Connected = 'Connected',
}

export type SidecarDownloadStatus = {
	downloading: boolean;
	update: boolean;
};

export type SidecarStatusUpdateEvent = {
	version: string;
	runningStatus: SidecarRunningStatus;
	downloadStatus: SidecarDownloadStatus;
};

export class SidecarService extends Disposable implements ISidecarService {
	declare _serviceBrand: undefined;

	private readonly _onDidChangeStatus = this._register(new Emitter<SidecarStatusUpdateEvent>());
	public readonly onDidChangeStatus = this._onDidChangeStatus.event;

	private readonly _onDidRestart = this._register(new Emitter<void>());
	public readonly onDidRestart = this._onDidRestart.event;

	private _version: string;
	get version(): string {
		return this._version;
	}

	set version(v: string) {
		this._version = v;
		this.notifyStatusChange();
	}

	private _runningStatus: SidecarRunningStatus;
	get runningStatus(): SidecarRunningStatus {
		return this._runningStatus;
	}

	set runningStatus(status: SidecarRunningStatus) {
		this._runningStatus = status;
		this.notifyStatusChange();
	}

	private _downloadStatus: SidecarDownloadStatus;
	get downloadStatus(): SidecarDownloadStatus {
		return this._downloadStatus;
	}

	set downloadStatus(status: SidecarDownloadStatus) {
		this._downloadStatus = status;
		this.notifyStatusChange();
	}

	private notifyStatusChange() {
		this._onDidChangeStatus.fire({ version: this._version, runningStatus: this._runningStatus, downloadStatus: this._downloadStatus });
	}

	constructor() {
		super();

		this._version = 'unknown';
		this._runningStatus = SidecarRunningStatus.Unavailable;
		this._downloadStatus = { downloading: false, update: false };
	}

	triggerRestart(): void {
		this._onDidRestart.fire();
	}
}
