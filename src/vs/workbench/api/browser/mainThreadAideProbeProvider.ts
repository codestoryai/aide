/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from 'vs/base/common/lifecycle';
import { revive } from 'vs/base/common/marshalling';
import { ICSAccountService } from 'vs/platform/codestoryAccount/common/csAccount';
import { ExtHostAideProbeProviderShape, ExtHostContext, IAideProbeProgressDto, MainContext, MainThreadAideProbeProviderShape } from 'vs/workbench/api/common/extHost.protocol';
import { IAideProbeResolver, IAideProbeService } from 'vs/workbench/contrib/aideProbe/browser/aideProbeService';
import { IAideProbeData, IAideProbeProgress, IAideProbeRequestModel, IAideProbeSessionAction, IAideProbeUserAction } from 'vs/workbench/contrib/aideProbe/common/aideProbe';
import { extHostNamedCustomer, IExtHostContext } from 'vs/workbench/services/extensions/common/extHostCustomers';

@extHostNamedCustomer(MainContext.MainThreadProbeProvider)
export class MainThreadAideProbeProvider extends Disposable implements MainThreadAideProbeProviderShape {
	private readonly _proxy: ExtHostAideProbeProviderShape;
	private readonly _pendingProgress = new Map<string, (part: IAideProbeProgress) => Promise<void>>();

	constructor(
		extHostContext: IExtHostContext,
		@IAideProbeService private readonly _aideProbeService: IAideProbeService,
		@ICSAccountService private readonly _csAccountService: ICSAccountService
	) {
		super();
		this._proxy = extHostContext.getProxy(ExtHostContext.ExtHostAideProbeProvider);
	}

	$registerProbingProvider(handle: number, data: IAideProbeData): void {
		const impl: IAideProbeResolver = {
			initiate: async (request, progress, token) => {
				const authenticated = await this._csAccountService.ensureAuthenticated();
				if (!authenticated) {
					return {};
				}

				this._pendingProgress.set(request.sessionId, progress);
				try {
					return await this._proxy.$initiateProbe(handle, request, token) ?? {};
				} finally {
					this._pendingProgress.delete(request.sessionId);
				}
			},
			onSessionAction: async (action: IAideProbeSessionAction) => {
				await this._proxy.$onSessionAction(handle, action);
			},
			onUserAction: async (action: IAideProbeUserAction) => {
				await this._proxy.$onUserAction(handle, action);
			}
		};

		this._aideProbeService.registerProbeProvider(data, impl);
	}

	async $handleProbingProgressChunk(request: IAideProbeRequestModel, progress: IAideProbeProgressDto): Promise<void> {
		if (progress.kind === 'textEdit') {
			const revivedProgress = revive(progress) as IAideProbeProgress;
			await this._pendingProgress.get(request.sessionId)?.(revivedProgress);
		} else {
			const revivedProgress = revive(progress) as IAideProbeProgress;
			await this._pendingProgress.get(request.sessionId)?.(revivedProgress);
		}
	}

	$unregisterProbingProvider(handle: number): void {
		throw new Error('Method not implemented.');
	}
}
