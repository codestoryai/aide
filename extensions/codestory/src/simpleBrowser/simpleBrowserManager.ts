/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { ShowOptions, SimpleBrowserView, UrlChangePayload } from './simpleBrowserView';

type WebViewState = {
	url: string;
	sessions: Record<number, number>;
};

export class SimpleBrowserManager extends vscode.Disposable {

	private _activeView?: SimpleBrowserView;

	constructor(
		private readonly extensionUri: vscode.Uri,
		private readonly onDidClearOverlays: () => void,
	) {
		super(() => {
			if (this._activeView) {
				this.disposeViews();
			}
		});
	}

	private _onUrlChange = new vscode.EventEmitter<UrlChangePayload>();
	onUrlChange = this._onUrlChange.event;


	disposeViews() {
		this._activeView?.dispose();
		this._activeView = undefined;
	}

	public show(inputUri: string | vscode.Uri, options?: ShowOptions): void {
		const url = typeof inputUri === 'string' ? inputUri : inputUri.toString(true);
		if (this._activeView) {
			this._activeView.show(url, options);
		} else {
			const view = SimpleBrowserView.create(this.extensionUri, url, this.onDidClearOverlays, options);
			this.registerWebviewListeners(view);
			this._activeView = view;
		}
		this._activeView.onUrlChange((payload) => {
			this._onUrlChange.fire(payload);
		});
	}

	public restore(panel: vscode.WebviewPanel, state: WebViewState): void {
		const view = SimpleBrowserView.restore(this.extensionUri, state.url, panel, this.onDidClearOverlays, state.sessions);
		this.registerWebviewListeners(view);
		this._activeView ??= view;
	}

	private registerWebviewListeners(view: SimpleBrowserView) {
		view.onDispose(() => {
			if (this._activeView === view) {
				this._activeView = undefined;
			}
		});
	}

	override dispose() {
		super.dispose();
		this.disposeViews();
	}

}
