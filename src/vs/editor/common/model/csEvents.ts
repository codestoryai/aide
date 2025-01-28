/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../base/common/uri.js';
import { Position } from '../core/position.js';

export type SymbolNavigationEvent = {
	position: Position;
	action: string;
	uri: URI;
};

export type AgentCodeEditEvent = {
	accepted: boolean;
	added: number;
	removed: number;
};
