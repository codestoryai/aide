/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IDisposable, toDisposable } from '../../../base/common/lifecycle.js';
import { InstantiationType, registerSingleton } from '../../../platform/instantiation/common/extensions.js';
import { SymbolNavigationEvent } from '../model/csEvents.js';
import { ICSEventHandler, ICSEventsService } from './csEvents.js';

export class CSEventsService implements ICSEventsService {
	declare readonly _serviceBrand: undefined;

	private readonly _handlers = new Map<string, ICSEventHandler>();

	registerCSEventsHandler(extensionId: string, handler: ICSEventHandler): IDisposable {
		this._handlers.set(extensionId, handler);
		return toDisposable(() => this._handlers.delete(extensionId));
	}

	reportSymbolNavigation(event: SymbolNavigationEvent): void {
		for (const [_, handler] of this._handlers) {
			handler.reportSymbolNavigation(event);
		}
	}

	reportAgentCodeEdit(event: { accepted: boolean; added: number; removed: number }): void {
		for (const [_, handler] of this._handlers) {
			handler.reportAgentCodeEdit(event);
		}
	}
}

registerSingleton(ICSEventsService, CSEventsService, InstantiationType.Delayed);
