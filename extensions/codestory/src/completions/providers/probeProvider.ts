/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as http from 'http';
import * as net from 'net';
import * as os from 'os';
import * as uuid from 'uuid';
import * as vscode from 'vscode';

import { readJsonFile, reportAgentEventsToChat } from '../../chatState/convertStreamToMessage';
import postHogClient from '../../posthog/client';
import { applyEdits } from '../../server/applyEdits';
import { handleRequest } from '../../server/requestHandler';
import { SidecarApplyEditsRequest } from '../../server/types';
import { SideCarClient } from '../../sidecar/client';
import { getInviteCode } from '../../utilities/getInviteCode';
import { getUniqueId } from '../../utilities/uniqueId';

export class AideProbeProvider implements vscode.Disposable {
	private _sideCarClient: SideCarClient;
	private _editorUrl: string | undefined;
	private active: boolean = false;

	private _requestHandler: http.Server | null = null;
	private _currentRequest = new Map<string, vscode.ProbeResponseStream>();

	private async isPortOpen(port: number): Promise<boolean> {
		return new Promise((resolve, _) => {
			const s = net.createServer();
			s.once('error', (err) => {
				s.close();
				// @ts-ignore
				if (err['code'] === 'EADDRINUSE') {
					resolve(false);
				} else {
					resolve(false); // or throw error!!
					// reject(err);
				}
			});
			s.once('listening', () => {
				resolve(true);
				s.close();
			});
			s.listen(port);
		});
	}

	private async getNextOpenPort(startFrom: number = 42423) {
		let openPort: number | null = null;
		while (startFrom < 65535 || !!openPort) {
			if (await this.isPortOpen(startFrom)) {
				openPort = startFrom;
				break;
			}
			startFrom++;
		}
		return openPort;
	}

	constructor(
		sideCarClient: SideCarClient,
	) {
		this._sideCarClient = sideCarClient;

		// Server for the sidecar to talk to the editor
		this._requestHandler = http.createServer(
			handleRequest(this.provideEdit.bind(this))
		);
		this.getNextOpenPort().then((port) => {
			if (port === null) {
				throw new Error('Could not find an open port');
			}

			// can still grab it by listenting to port 0
			this._requestHandler?.listen(port);
			const editorUrl = `http://localhost:${port}`;
			this._editorUrl = editorUrl;
			console.log(this._editorUrl);
		});

		vscode.aideProbe.registerProbeResponseProvider(
			'aideProbeProvider',
			{
				provideProbeResponse: this.provideProbeResponse.bind(this),
				onDidUserAction(action) {
					postHogClient?.capture({
						distinctId: getUniqueId(),
						event: action.action.type,
						properties: {
							platform: os.platform(),
							requestId: action.sessionId,
						},
					});
				}
			}
		);

		this.checkActivation();

		vscode.workspace.onDidChangeConfiguration((event) => {
			if (event.affectsConfiguration('aide')) {
				this.checkActivation();
			}
		});
	}

	private checkActivation() {
		this.active = Boolean(getInviteCode());
	}

	async provideEdit(request: SidecarApplyEditsRequest) {
		applyEdits(request);
	}

	private async provideProbeResponse(request: vscode.ProbeRequest, response: vscode.ProbeResponseStream, _token: vscode.CancellationToken) {
		this._currentRequest.set(request.requestId, response);
		let { query } = request;
		query = query.trim();

		const startTime = process.hrtime();

		postHogClient?.capture({
			distinctId: getUniqueId(),
			event: 'probe_requested',
			properties: {
				platform: os.platform(),
				query,
				requestId: request.requestId,
			},
		});

		if (!this.active) {
			response.markdown('Please add your invite under `"aide.probeInviteCode"` in your settings.');
			return {};
		}

		const variables: vscode.ChatPromptReference[] = [];
		const activeEditor = vscode.window.activeTextEditor;
		if (activeEditor) {
			const fileName = activeEditor.document.fileName.split('/').pop();
			const firstLine = activeEditor.document.lineAt(0);
			const lastLine = activeEditor.document.lineAt(activeEditor.document.lineCount - 1);
			const codeSelection = {
				uri: activeEditor.document.uri,
				range: {
					startLineNumber: firstLine.lineNumber,
					startColumn: firstLine.range.start.character,
					endLineNumber: lastLine.lineNumber,
					endColumn: lastLine.range.end.character
				}
			};
			variables.push({
				id: 'vscode.file',
				name: `file:${fileName}`,
				value: JSON.stringify(codeSelection)
			});
		}

		const threadId = uuid.v4();

		// let probeResponse: AsyncIterableIterator<SideCarAgentEvent>;
		// if (false) {
		// const probeResponse = this._sideCarClient.startAgentCodeEdit(query, variables, this._editorUrl, threadId);
		// } else {
		// 	probeResponse = this._sideCarClient.startAgentProbe(query, variables, this._editorUrl, threadId);
		// }

		// Use dummy data: Start
		const extensionRoot = vscode.extensions.getExtension('codestory-ghost.codestoryai')?.extensionPath;
		const workspaceRoot = vscode.workspace.workspaceFolders?.[0].uri.fsPath;
		if (!extensionRoot || !workspaceRoot) {
			return {};
		}

		const jsonArr = readJsonFile(`${extensionRoot}/src/completions/providers/dummydata.json`);
		const probeResponse = (async function* (arr) {
			for (const original of arr) {
				const itemString = JSON.stringify(original).replace(/\/Users\/nareshr\/github\/codestory\/sidecar/g, workspaceRoot);
				const item = JSON.parse(itemString);
				yield item;
			}
		})(jsonArr);
		// Use dummy data: End

		await reportAgentEventsToChat(probeResponse, response, threadId, _token, this._sideCarClient);

		const endTime = process.hrtime(startTime);
		postHogClient?.capture({
			distinctId: getUniqueId(),
			event: 'probe_completed',
			properties: {
				platform: os.platform(),
				query,
				timeElapsed: `${endTime[0]}s ${endTime[1] / 1000000}ms`,
				requestId: request.requestId,
			},
		});

		return {};
	}

	dispose() {
		this._requestHandler?.close();
	}
}
