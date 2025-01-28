/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../../base/common/event.js';
import { URI } from '../../../../base/common/uri.js';
import { Range } from '../../../../editor/common/core/range.js';
import { IWorkspaceTextEdit } from '../../../../editor/common/languages.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';

export const enum AideAgentCodeEditingSessionState {
	Initial = 0,
	StreamingEdits = 1,
	Idle = 2,
	Disposed = 3
}

export interface IAideAgentCodeEditingSession {
	readonly onDidChange: Event<void>;
	readonly onDidDispose: Event<void>;

	readonly sessionId: string;
	readonly codeEdits: Map<URI, Range[]>;

	apply(edits: IWorkspaceTextEdit): Promise<void>;
	complete(): void;
	accept(): void;
	reject(): void;
	/**
	 * Will lead to this object getting disposed
	 */
	stop(): Promise<void>;
	dispose(): void;
}

export const IAideAgentCodeEditingService = createDecorator<IAideAgentCodeEditingService>('aideAgentCodeEditingService');
export interface IAideAgentCodeEditingService {
	_serviceBrand: undefined;

	onDidComplete: Event<void>;
	getOrStartCodeEditingSession(sessionId: string): IAideAgentCodeEditingSession;
	getExistingCodeEditingSession(sessionId: string): IAideAgentCodeEditingSession | undefined;
}
