/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ExtHostAideAgentTerminalsShape, IMainContext, MainContext, MainThreadAideAgentTerminalsShape } from './extHost.protocol.js';

export class ExtHostAideAgentTerminals implements ExtHostAideAgentTerminalsShape {
	private _proxy: MainThreadAideAgentTerminalsShape;

	constructor(
		mainContext: IMainContext
	) {
		this._proxy = mainContext.getProxy(MainContext.MainThreadAideAgentTerminals);
	}

	showTerminal(id: string): void {
		this._proxy.$showTerminal(id);
	}

}
