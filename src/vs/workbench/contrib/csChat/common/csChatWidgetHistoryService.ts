/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from 'vs/base/common/event';
import { createDecorator } from 'vs/platform/instantiation/common/instantiation';
import { IStorageService, StorageScope, StorageTarget } from 'vs/platform/storage/common/storage';
import { Memento } from 'vs/workbench/common/memento';

export interface IChatHistoryEntry {
	text: string;
	state?: any;
}

export const ICSChatWidgetHistoryService = createDecorator<ICSChatWidgetHistoryService>('ICSChatWidgetHistoryService');
export interface ICSChatWidgetHistoryService {
	_serviceBrand: undefined;

	readonly onDidClearHistory: Event<void>;

	clearHistory(): void;
	getHistory(providerId: string): IChatHistoryEntry[];
	saveHistory(providerId: string, history: IChatHistoryEntry[]): void;
}

interface IChatHistory {
	history: { [providerId: string]: IChatHistoryEntry[] };
}

export class ChatWidgetHistoryService implements ICSChatWidgetHistoryService {
	_serviceBrand: undefined;

	private memento: Memento;
	private viewState: IChatHistory;

	private readonly _onDidClearHistory = new Emitter<void>();
	readonly onDidClearHistory: Event<void> = this._onDidClearHistory.event;

	constructor(
		@IStorageService storageService: IStorageService
	) {
		this.memento = new Memento('csChat-session', storageService);
		const loadedState = this.memento.getMemento(StorageScope.WORKSPACE, StorageTarget.MACHINE) as IChatHistory;
		for (const provider in loadedState.history) {
			// Migration from old format
			loadedState.history[provider] = loadedState.history[provider].map(entry => typeof entry === 'string' ? { text: entry } : entry);
		}

		this.viewState = loadedState;
	}

	getHistory(providerId: string): IChatHistoryEntry[] {
		return this.viewState.history?.[providerId] ?? [];
	}

	saveHistory(providerId: string, history: IChatHistoryEntry[]): void {
		if (!this.viewState.history) {
			this.viewState.history = {};
		}
		this.viewState.history[providerId] = history;
		this.memento.saveMemento();
	}

	clearHistory(): void {
		this.viewState.history = {};
		this.memento.saveMemento();
		this._onDidClearHistory.fire();
	}
}
