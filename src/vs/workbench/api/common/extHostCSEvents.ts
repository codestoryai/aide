/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { CSEventHandler, SymbolNavigationEvent as ExtSymbolNavigationEvent } from 'vscode';
import { SymbolNavigationEvent } from '../../../editor/common/model/csEvents.js';
import { IExtensionDescription } from '../../../platform/extensions/common/extensions.js';
import { ExtHostCSEventsShape, IMainContext, MainContext, MainThreadCSEventsShape } from './extHost.protocol.js';
import * as TypeConverters from './extHostTypeConverters.js';
import { Disposable } from './extHostTypes.js';

export class ExtHostCSEvents implements ExtHostCSEventsShape {
	private readonly _proxy: MainThreadCSEventsShape;
	private _CSEventHandlers: Map<string, CSEventHandler> = new Map();

	constructor(
		mainContext: IMainContext
	) {
		this._proxy = mainContext.getProxy(MainContext.MainThreadCSEvents);
	}

	$reportSymbolNavigation(extensionId: string, event: SymbolNavigationEvent): void {
		if (this._CSEventHandlers.size === 0) {
			throw new Error('No CS event handler registered');
		}

		const provider = this._CSEventHandlers.get(extensionId);
		if (!provider) {
			throw new Error('CS event handler not found');
		}

		const position = TypeConverters.Position.to(event.position);
		const action = TypeConverters.SymbolNavigationActionType.to(event.action);
		const uri = event.uri;
		const extEvent: ExtSymbolNavigationEvent = { position, action, uri };

		provider.handleSymbolNavigation(extEvent);
	}

	$reportAgentCodeEdit(extensionId: string, event: { accepted: boolean; added: number; removed: number }): void {
		if (this._CSEventHandlers.size === 0) {
			throw new Error('No CS event handler registered');
		}

		const provider = this._CSEventHandlers.get(extensionId);
		if (!provider) {
			throw new Error('CS event handler not found');
		}

		provider.handleAgentCodeEdit(event);
	}

	registerCSEventsHandler(extension: IExtensionDescription, handler: CSEventHandler): Disposable {
		const extensionId = extension.identifier.value;
		this._CSEventHandlers.set(extensionId, handler);
		this._proxy.$registerCSEventHandler(extensionId);
		return new Disposable(() => {
			this._proxy.$unregisterCSEventHandler(extensionId);
			this._CSEventHandlers.delete(extensionId);
		});
	}
}
