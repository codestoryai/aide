/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as vscode from 'vscode';
import { createDecorator } from '../../../platform/instantiation/common/instantiation.js';
import { ExtHostCSAuthenticationShape, MainContext, MainThreadCSAuthenticationShape } from './extHost.protocol.js';
import { IExtHostRpcService } from './extHostRpcService.js';

export interface IExtHostCSAuthentication extends ExtHostCSAuthentication { }
export const IExtHostCSAuthentication = createDecorator<IExtHostCSAuthentication>('IExtHostCSAuthentication');

export class ExtHostCSAuthentication implements ExtHostCSAuthenticationShape {
	declare _serviceBrand: undefined;

	private _proxy: MainThreadCSAuthenticationShape;

	constructor(
		@IExtHostRpcService extHostRpc: IExtHostRpcService
	) {
		this._proxy = extHostRpc.getProxy(MainContext.MainThreadCSAuthentication);
	}

	async getSession(): Promise<vscode.CSAuthenticationSession | undefined> {
		return this._proxy.$getSession();
	}

	async refreshSession(): Promise<vscode.CSAuthenticationSession | undefined> {
		return this._proxy.$refreshSession();
	}
}
