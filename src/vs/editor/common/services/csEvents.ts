/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IDisposable } from '../../../base/common/lifecycle.js';
import { createDecorator } from '../../../platform/instantiation/common/instantiation.js';
import { SymbolNavigationEvent } from '../model/csEvents.js';

export interface ICSEventHandler {
	reportSymbolNavigation(event: SymbolNavigationEvent): void;
	reportAgentCodeEdit(event: { accepted: boolean; added: number; removed: number }): void;
}

export const ICSEventsService = createDecorator<ICSEventsService>('csEventsService');

export interface ICSEventsService {
	readonly _serviceBrand: undefined;
	reportSymbolNavigation(event: SymbolNavigationEvent): void;
	reportAgentCodeEdit(event: { accepted: boolean; added: number; removed: number }): void;
	registerCSEventsHandler(extensionId: string, handler: ICSEventHandler): IDisposable;
}
