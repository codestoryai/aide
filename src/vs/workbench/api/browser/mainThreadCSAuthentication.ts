/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../base/common/lifecycle.js';
import { CSAuthenticationSession, ICSAuthenticationService } from '../../../platform/codestoryAccount/common/csAccount.js';
import { extHostNamedCustomer, IExtHostContext } from '../../services/extensions/common/extHostCustomers.js';
import { MainContext, MainThreadCSAuthenticationShape } from '../common/extHost.protocol.js';

@extHostNamedCustomer(MainContext.MainThreadCSAuthentication)
export class MainThreadCSAuthentication extends Disposable implements MainThreadCSAuthenticationShape {
	constructor(
		extHostContext: IExtHostContext,
		@ICSAuthenticationService private readonly _csAccountService: ICSAuthenticationService
	) {
		super();
	}

	$getSession(): Promise<CSAuthenticationSession | undefined> {
		return this._csAccountService.getSession();
	}

	async $refreshSession(): Promise<CSAuthenticationSession | undefined> {
		await this._csAccountService.refreshTokens();
		return this._csAccountService.getSession();
	}
}
