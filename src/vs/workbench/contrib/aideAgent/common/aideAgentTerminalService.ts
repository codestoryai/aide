/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../../base/common/event.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';

export const IAideAgentTerminalService = createDecorator<IAideAgentTerminalService>('IAideAgentTerminalService');
export interface IAideAgentTerminalService {
	_serviceBrand: undefined;
	// we could pass the terminal to show output and name
	onDidAgentAddTerminal: Event<void>;
	showTerminal(id: string): void;
}
