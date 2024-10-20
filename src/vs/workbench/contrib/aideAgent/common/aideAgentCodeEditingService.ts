/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../../base/common/event.js';
import { IWorkspaceTextEdit } from '../../../../editor/common/languages.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';

export const enum AideAgentCodeEditingSessionState {
	Initial = 0,
	StreamingEdits = 1,
	Idle = 2,
	Disposed = 3
}

export interface IAideAgentCodeEditingSession {
	readonly sessionId: string;
	readonly onDidChange: Event<void>;
	readonly onDidDispose: Event<void>;
	apply(edits: IWorkspaceTextEdit): Promise<void>;
	complete(): void;
	accept(): void;
	reject(): void;
	rejectForExchange(sessionId: string, exchangeId: string): Promise<void>;
	/**
	 * Will lead to this object getting disposed
	 */
	stop(): Promise<void>;
	dispose(): void;
}

export const IAideAgentCodeEditingService = createDecorator<IAideAgentCodeEditingService>('aideAgentCodeEditingService');
export interface IAideAgentCodeEditingService {
	_serviceBrand: undefined;

	getOrStartCodeEditingSession(sessionId: string): IAideAgentCodeEditingSession;
}
