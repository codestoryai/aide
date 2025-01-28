/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../base/common/lifecycle.js';
import { ISidecarService, SidecarDownloadStatus, SidecarRunningStatus } from '../../contrib/aideAgent/common/sidecarService.js';
import { extHostNamedCustomer, IExtHostContext } from '../../services/extensions/common/extHostCustomers.js';
import { ExtHostContext, ExtHostSidecarShape, MainContext, MainThreadSidecarShape } from '../common/extHost.protocol.js';

@extHostNamedCustomer(MainContext.MainThreadSidecar)
export class MainThreadSidecar extends Disposable implements MainThreadSidecarShape {
	private readonly _proxy: ExtHostSidecarShape;

	constructor(
		extHostContext: IExtHostContext,
		@ISidecarService private readonly _sidecarService: ISidecarService
	) {
		super();
		this._proxy = extHostContext.getProxy(ExtHostContext.ExtHostSidecar);

		this._register(this._sidecarService.onDidRestart(() => {
			this._proxy.$attemptRestart();
		}));
	}

	$setSidecarVersion(version: string): void {
		this._sidecarService.version = version;
	}

	$setRunningStatus(status: SidecarRunningStatus): void {
		this._sidecarService.runningStatus = status;
	}

	$setDownloadStatus(status: SidecarDownloadStatus): void {
		this._sidecarService.downloadStatus = status;
	}
}
