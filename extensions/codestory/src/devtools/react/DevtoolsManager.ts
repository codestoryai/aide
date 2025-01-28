/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
// @ts-expect-error external
import createDevtools from './dist/standalone.js';
import { proxy, ProxyResult } from './proxy';
import { DevtoolsStatus, DevtoolsType, InfoOrigin, InspectedElementPayload, InspectElementParsedFullData, InspectionResult } from './types';
import { findTsxNodeAtLine } from '../../languages/tsxCodeSymbols.js';
import { join } from 'node:path';

export class DevtoolsSession extends vscode.Disposable {

	private _devtools: DevtoolsType;
	private _port: number;
	private _proxyResult: ProxyResult | undefined;

	get port() {
		return this._port;
	}

	get proxyPort() {
		return this._proxyResult?.listenPort;
	}

	get devtoolsPort() {
		return this._devtools.currentPort;
	}

	constructor(port: number, suggestedDevtoolsPort = 8097) {
		super(() => {
			this._cleanupProxy();
			this._devtools.stopServer();
		});

		this._port = port;

		this._devtools = createDevtools()
			.setStatusListener(this.updateStatus.bind(this))
			.setDataCallback(this.updateInspectedElement.bind(this))
			.setDisconnectedCallback(this.onDidDisconnect.bind(this))
			.setInspectionCallback(this.updateInspectHost.bind(this))
			.startServer(suggestedDevtoolsPort, 'localhost');
	}

	private _onStatusChange = new vscode.EventEmitter<DevtoolsStatus>();
	onStatusChange = this._onStatusChange.event;

	private _onInspectedElementChange = new vscode.EventEmitter<InspectionResult | null>();
	onInspectedElementChange = this._onInspectedElementChange.event;

	private _onInspectHostChange = new vscode.EventEmitter<boolean>();
	onInspectHostChange = this._onInspectHostChange.event;

	private _waitForDisconnection: DeferredPromise | null = null;
	// get waitForDisconnection() {
	// 	return this._waitForDisconnection;
	// }

	private _cleanupProxy() {
		if (this._waitForDisconnection) {
			this._waitForDisconnection.resolve();
		}
		this._proxyResult?.cleanup();
	}

	private _status: DevtoolsStatus = DevtoolsStatus.Idle;
	get status() {
		return this._status;
	}

	// undefined is the default, null is for invalid paths
	private _inspectedElement: InspectedElementPayload | undefined | null;
	get inspectedElement() {
		return this._inspectedElement;
	}

	private async updateStatus(_message: string, status: DevtoolsStatus) {
		this._status = status;
		if (status === DevtoolsStatus.ServerConnected) {
			this._waitForDisconnection = new DeferredPromise();
			await this._startProxy();
		}
		this._onStatusChange.fire(status);
	}


	private updateInspectHost(isInspecting: boolean) {
		this._onInspectHostChange.fire(isInspecting);
	}

	private onDidDisconnect() {
		if (this._status === DevtoolsStatus.DevtoolsConnected) {
			this._cleanupProxy();
			// @g-danna take a look at this again
			this.updateStatus('Devtools disconnected', DevtoolsStatus.ServerConnected);
		}
	}

	private async updateInspectedElement(payload: InspectedElementPayload) {
		this._inspectedElement = payload;
		if (payload.type === 'full-data') {
			const reference = await this.getValidReference(payload);
			this._onInspectedElementChange.fire(reference);
		}
	}

	private async getValidReference(payload: InspectElementParsedFullData): Promise<InspectionResult | null> {
		try {
			const { parsedSource } = payload.value;
			if (parsedSource) {
				const { origin, source, column, line, componentName } = parsedSource;
				let reference: vscode.Uri | null = null;
				if (source.type === 'URL') {
					reference = await this.resolveRelativeReference(source.relativePath);
				} else if (source.type === 'relative') {
					reference = await this.resolveRelativeReference(source.path);
				} else if (source.type === 'absolute') {
					reference = vscode.Uri.parse(source.path);
				}

				if (!reference) {
					console.error(`Cannot find file on system: ${JSON.stringify(payload)}`);
					return null;
				}

				const doc = await vscode.workspace.openTextDocument(reference);

				const fullRange = doc.validateRange(
					new vscode.Range(0, 0, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER)
				);

				console.log(parsedSource);

				let range = fullRange;
				if (origin === InfoOrigin.Tag || origin === InfoOrigin.DevtoolsSymbolicated) {
					const fileArrayBuffer = await vscode.workspace.fs.readFile(reference);
					const fileString = fileArrayBuffer.toString().replace(/\\n/g, '\n');
					const foundRange = await findTsxNodeAtLine(fileString, line - 1);
					const endLine = foundRange ? foundRange.endLine : line - 1;

					range = new vscode.Range(
						new vscode.Position(line - 1, column),
						new vscode.Position(endLine, 9999999),
					);
				}
				const location = new vscode.Location(
					reference,
					range
				);

				return { location, componentName };
			} else {
				return null;
			}
		} catch (err) {
			return null;
		}
	}

	private async resolveRelativeReference(relativePath: string): Promise<vscode.Uri | null> {
		if (!vscode.workspace.workspaceFolders) {
			throw Error('A workspace needs to be open in order to parse relative references.');
		}
		for (const workspaceFolder of vscode.workspace.workspaceFolders) {
			const absolutePath = join(workspaceFolder.uri.fsPath, relativePath);
			const uri = vscode.Uri.file(absolutePath);
			const doesFileExist = await vscode.workspace.fs.stat(uri);
			if (doesFileExist) {
				return uri;
			}
		}
		return null;
	}


	async _startProxy() {
		if (!this._devtools.currentPort) {
			throw new Error('Devtools server is not connected, cannot start proxy');
		}
		this._proxyResult = await proxy(this._port, this._devtools.currentPort);
		return;
	}

	startInspectingHost() {
		// Have to call this manually because React devtools don't call this
		this._onInspectHostChange.fire(true);
		this._devtools.startInspectingHost();
	}

	stopInspectingHost() {
		this._devtools.stopInspectingHost();
	}

	inspectingClearOverlays() {
		this._devtools.inspectingClearOverlays();
	}

	override dispose() {
		super.dispose();
		this._cleanupProxy();
		this._devtools.stopServer();
	}

}


export class ReactDevtoolsManager extends vscode.Disposable {

	constructor() {
		super(() => this._disposeSessions());
	}

	private _sessions = new Map<number, DevtoolsSession>;

	get sessions(): ReadonlyMap<number, DevtoolsSession> {
		return this._sessions;
	}

	private activeSession: DevtoolsSession | undefined;
	private activeSessionDisposables: vscode.Disposable[] = [];

	private _onActiveSessionStatusChange = new vscode.EventEmitter<DevtoolsStatus>();
	onActiveSessionStatusChange = this._onActiveSessionStatusChange.event;

	private _onActiveSessionInspectedElementChange = new vscode.EventEmitter<InspectionResult | null>();
	onActiveSessionInspectedElementChange = this._onActiveSessionInspectedElementChange.event;

	private _onActiveSessionInspectHostChange = new vscode.EventEmitter<boolean>();
	onActiveSessionInspectHostChange = this._onActiveSessionInspectHostChange.event;

	async startOrGetSession(port: number): Promise<number> {
		return new Promise((resolve, reject) => {
			let session: DevtoolsSession;

			if (this._sessions.has(port)) {
				session = this._sessions.get(port)!;
			} else {
				let suggestedDevtoolsPort: number | undefined;
				const activeSessionPorts = new Set<number>();
				for (const session of this._sessions.values()) {
					if (session.devtoolsPort) {
						activeSessionPorts.add(session.devtoolsPort);
					}
				}
				if (activeSessionPorts.size > 0) {
					suggestedDevtoolsPort = Math.max(...activeSessionPorts) + 1;
				}
				session = new DevtoolsSession(port, suggestedDevtoolsPort);
				this._sessions.set(port, session);
			}

			if (this.activeSession !== session) {
				this._activeInspectedElement = undefined;
				this.clearSessionDisposables();

				this.activeSessionDisposables.push(
					session.onStatusChange(status => {
						this._onActiveSessionStatusChange.fire(status);
					}),
					session.onInspectedElementChange(location => {
						this._onActiveSessionInspectedElementChange.fire(location);
					}),
					session.onInspectHostChange(isInspecting => {
						this._onActiveSessionInspectHostChange.fire(isInspecting);
					})
				);

				this.activeSession = session;
			}

			if (session.status === DevtoolsStatus.ServerConnected && session.proxyPort) {
				return resolve(session.proxyPort);
			}

			const statusListener = session.onStatusChange(status => {
				if (status === DevtoolsStatus.ServerConnected && session.proxyPort) {
					statusListener.dispose();
					resolve(session.proxyPort);
				} else if (status === DevtoolsStatus.Error) {
					reject('Error while starting a new session');
				}
			});
		});
	}

	private _activeInspectedElement: InspectedElementPayload | undefined | null;
	get activeInspectedElement() {
		return this._activeInspectedElement;
	}

	startInspectingHost() {
		if (!this.activeSession) {
			console.error('Cannot start inspecting host: no active session');
			return;
		}
		this.activeSession.startInspectingHost();
	}

	stopInspectingHost() {
		if (!this.activeSession) {
			console.error('Cannot stop inspecting host: no active session');
			return;
		}
		this.activeSession.stopInspectingHost();
	}

	inspectingClearOverlays() {
		if (!this.activeSession) {
			console.error('Cannot clear inspecting overlays: no active session');
			return;
		}
		this.activeSession.inspectingClearOverlays();
	}

	private clearSessionDisposables() {
		// Clean up old listeners
		this.activeSessionDisposables.forEach(d => d.dispose());
		this.activeSessionDisposables = [];
	}

	private _disposeSessions() {
		for (const session of this._sessions.values()) {
			session.dispose();
		}
		this.clearSessionDisposables();
	}

}


class DeferredPromise {
	promise: Promise<any>;
	resolve!: (...args: any) => void;
	reject!: (reason: any) => void;

	constructor() {
		this.promise = new Promise((resolve, reject) => {
			this.resolve = resolve;
			this.reject = reject;
		});
	}
}

