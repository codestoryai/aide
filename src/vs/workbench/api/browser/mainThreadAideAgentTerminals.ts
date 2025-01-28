/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../base/common/lifecycle.js';
import { IAideAgentTerminalService } from '../../contrib/aideAgent/common/aideAgentTerminalService.js';
import { extHostNamedCustomer, IExtHostContext } from '../../services/extensions/common/extHostCustomers.js';
import { MainContext, MainThreadAideAgentTerminalsShape } from '../common/extHost.protocol.js';


@extHostNamedCustomer(MainContext.MainThreadAideAgentTerminals)
export class MainThreadAideAgentTerminals extends Disposable implements MainThreadAideAgentTerminalsShape {
	//private readonly _proxy: ExtHostAideAgentTerminalsShape;
	constructor(
		extHostContext: IExtHostContext,
		@IAideAgentTerminalService private readonly _aideAgentTerminalService: IAideAgentTerminalService
	) {
		super();
		//this._proxy = extHostContext.getProxy(ExtHostContext.ExtHostAideAgentTerminals);
	}

	$showTerminal(id: string) {
		this._aideAgentTerminalService.showTerminal(id);
	}
}
