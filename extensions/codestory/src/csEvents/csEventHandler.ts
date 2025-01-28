/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { getSymbolNavigationActionTypeLabel } from '../utilities/stringifyEvent';
import { SidecarContextEvent, SidecarRequestRange } from '../server/types';

type AideChatRequestType = 'ChatRequest' | 'AgenticRequest';
type UsageRequest = {
	type: AideChatRequestType | 'AgenticCodeEdit';
	units: number;
	timestamp: Date;
};

const USAGE_EVENTS_KEY = 'codestory.usageEvents';
const MAX_RETRIES = 5;
const RETRY_DELAY_MS = 1000; // 1 second

export class CSEventHandler implements vscode.CSEventHandler, vscode.Disposable {
	private _disposable: vscode.Disposable;
	private _subscriptionsAPIBase: string | null = null;
	// The current recording session which the user is going through over here
	private _currentSession: SidecarContextEvent[];

	constructor(private readonly _context: vscode.ExtensionContext) {
		this._disposable = vscode.csevents.registerCSEventHandler(this);
		this._currentSession = [];

		if (vscode.env.uriScheme === 'aide') {
			this._subscriptionsAPIBase = 'https://api.codestory.ai';
		} else {
			this._subscriptionsAPIBase = 'https://staging-api.codestory.ai';
		}
	}

	async handleSymbolNavigation(event: vscode.SymbolNavigationEvent): Promise<void> {
		const textDocument = await vscode.workspace.openTextDocument(vscode.Uri.file(event.uri.fsPath));
		const wordRange = textDocument.getWordRangeAtPosition(event.position);
		const lineContent = textDocument.lineAt(event.position.line).text;
		let textAtRange = undefined;
		if (wordRange !== undefined) {
			textAtRange = textDocument.getText(wordRange);
		}
		this._currentSession.push({
			LSPContextEvent: {
				fs_file_path: event.uri.fsPath,
				position: {
					line: event.position.line,
					character: event.position.character,
					byteOffset: 0,
				},
				source_word: textAtRange,
				source_line: lineContent,
				destination: null,
				event_type: getSymbolNavigationActionTypeLabel(event.action),
			}
		});
	}

	async handleAgentCodeEdit(event: { accepted: boolean; added: number; removed: number }): Promise<void> {
		if (!event.accepted) {
			return;
		}

		const usageRequest: UsageRequest = {
			type: 'AgenticCodeEdit',
			units: event.added + event.removed,
			timestamp: new Date(),
		};

		const persistedEvents = this._context.globalState.get<UsageRequest[]>(USAGE_EVENTS_KEY, []);
		persistedEvents.push(usageRequest);
		this._context.globalState.update(USAGE_EVENTS_KEY, persistedEvents);

		this.sendUsageEvents(persistedEvents);
	}

	async handleNewRequest(type: AideChatRequestType): Promise<void> {
		const usageRequest: UsageRequest = { type, units: 1, timestamp: new Date() };

		const persistedEvents = this._context.globalState.get<UsageRequest[]>(USAGE_EVENTS_KEY, []);
		persistedEvents.push(usageRequest);
		this._context.globalState.update(USAGE_EVENTS_KEY, persistedEvents);

		this.sendUsageEvents(persistedEvents);
	}

	private async sendUsageEvents(events: UsageRequest[]): Promise<void> {
		await this.sendUsageEventsWithRetry(events, 0);
	}

	private async sendUsageEventsWithRetry(events: UsageRequest[], retryCount: number): Promise<void> {
		if (retryCount >= MAX_RETRIES) {
			console.error('Maximum retries exceeded for sending usage events.');
			return;
		}

		const session = await vscode.csAuthentication.getSession();
		if (!session) {
			console.error('Failed to get authentication session.');
			return;
		}

		const success = await this.sendUsageEvent(events, session);
		if (success) {
			this._context.globalState.update(USAGE_EVENTS_KEY, []);
		} else {
			const delay = RETRY_DELAY_MS * Math.pow(2, retryCount);
			console.log(`Failed to send usage events. Retrying in ${delay} ms...`);
			setTimeout(() => this.sendUsageEventsWithRetry(events, retryCount + 1), delay);
		}
	}

	private async sendUsageEvent(events: UsageRequest[], session: vscode.CSAuthenticationSession): Promise<boolean> {
		try {
			const response = await fetch(
				`${this._subscriptionsAPIBase}/v1/usage`,
				{
					headers: {
						'Content-Type': 'application/json',
						Authorization: `Bearer ${session.accessToken}`,
					},
					method: 'POST',
					body: JSON.stringify({ events }),
				}
			);

			if (response.ok) {
				const data = await response.json();
				if (data['status'] !== session.subscription.status) {
					vscode.csAuthentication.refreshSession();
				}

				return true;
			} else if (response.status === 401) {
				await vscode.commands.executeCommand('codestory.refreshTokens');
				return false; // Retry after refreshing token
			} else {
				console.error(`Failed to send usage events. Status code: ${response.status}`);
				return true; // Don't retry for other errors
			}
		} catch (error) {
			console.error('Failed to send usage events:', error);
			return true; // Don't retry on error
		}
	}

	/**
	 * Starts recording the user activity over here and keeps track of the set of events the user is doing
	 */
	async startRecording() {
		this._currentSession = [];
	}

	/**
	 * Stops recording the user activity and returns an object which can be used for inferencing
	 */
	async stopRecording(): Promise<SidecarContextEvent[]> {
		const currentSession = this._currentSession;
		this._currentSession = [];
		return currentSession;
	}

	/**
	 * We are going to record the fact that the selection was changed in the editor
	 * This allows the the user to give context to the LLM by literally just doing what
	 * they would normally do in the editor
	 */
	async onDidChangeTextDocumentSelection(filePath: string, selections: readonly vscode.Selection[]) {
		// we are getting multiple selections for the same file, so figure out what to do
		// over here
		const currentSelectionRange = this.selectionToSidecarRange(selections[0]);
		if (this._currentSession.length === 0) {
			// we should not track any events which are just movements, a movement
			// in the editor shows up as a 0 length selection
			if (currentSelectionRange.startPosition.line === currentSelectionRange.endPosition.line && currentSelectionRange.startPosition.character === currentSelectionRange.endPosition.character) {
				return;
			}
			this._currentSession.push({
				Selection: {
					fs_file_path: filePath,
					range: this.selectionToSidecarRange(selections[0]),
				}
			});
			return;
		}
		const lastEvent = this._currentSession.at(-1);
		const textDocument = await vscode.workspace.openTextDocument(filePath);
		// If we have a lsp context event then we most likely here have the destination
		// location over here
		if (lastEvent !== undefined && lastEvent.LSPContextEvent !== undefined) {
			lastEvent.LSPContextEvent.destination = {
				position: currentSelectionRange.startPosition,
				fs_file_path: filePath,
				line_content: textDocument.lineAt(currentSelectionRange.startPosition.line).text,
			};
			return;
		}
		// we should not track any events which are just movements, a movement
		// in the editor shows up as a 0 length selection
		if (currentSelectionRange.startPosition.line === currentSelectionRange.endPosition.line && currentSelectionRange.startPosition.character === currentSelectionRange.endPosition.character) {
			return;
		}
		if (lastEvent !== undefined && lastEvent.Selection !== null && lastEvent.Selection !== undefined) {
			// we compare both the start and the end position line numbers here
			// because the selection can be from the top dragging or the bottom
			// dragging
			if (lastEvent.Selection.range.startPosition.line === currentSelectionRange.startPosition.line || lastEvent.Selection.range.endPosition.line === currentSelectionRange.endPosition.line) {
				this._currentSession[this._currentSession.length - 1] = {
					Selection: {
						fs_file_path: filePath,
						range: currentSelectionRange,
					}
				};
				return;
			}
		}
		this._currentSession.push({
			Selection: {
				fs_file_path: filePath,
				range: currentSelectionRange,
			}
		});
		console.log('selectionLenght', selections.length);
	}

	selectionToSidecarRange(selection: vscode.Selection): SidecarRequestRange {
		if (selection.isReversed) {
			return {
				startPosition: {
					line: selection.active.line,
					character: selection.active.character,
					byteOffset: 0,
				},
				endPosition: {
					line: selection.anchor.line,
					character: selection.anchor.character,
					byteOffset: 0,
				}
			};
		} else {
			return {
				startPosition: {
					line: selection.anchor.line,
					character: selection.anchor.character,
					byteOffset: 0,
				},
				endPosition: {
					line: selection.active.line,
					character: selection.active.character,
					byteOffset: 0,
				}
			};
		}
	}

	dispose(): void {
		this._disposable.dispose();
	}
}
