/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { CancellationToken } from '../../../base/common/cancellation.js';
import { Disposable, DisposableMap, IDisposable } from '../../../base/common/lifecycle.js';
import { URI } from '../../../base/common/uri.js';
import { ICodeMapperProvider, ICodeMapperRequest, ICodeMapperResponse, IAideAgentCodeMapperService } from '../../contrib/aideAgent/common/aideAgentCodeMapperService.js';
import { extHostNamedCustomer, IExtHostContext } from '../../services/extensions/common/extHostCustomers.js';
import { ExtHostCodeMapperShape, ExtHostContext, ICodeMapperProgressDto, ICodeMapperRequestDto, MainContext, MainThreadCodeMapperShape } from '../common/extHost.protocol.js';

@extHostNamedCustomer(MainContext.MainThreadAideAgentCodeMapper)
export class MainThreadChatCodemapper extends Disposable implements MainThreadCodeMapperShape {

	private providers = this._register(new DisposableMap<number, IDisposable>());
	private readonly _proxy: ExtHostCodeMapperShape;
	private static _requestHandlePool: number = 0;
	private _responseMap = new Map<string, ICodeMapperResponse>();

	constructor(
		extHostContext: IExtHostContext,
		@IAideAgentCodeMapperService private readonly codeMapperService: IAideAgentCodeMapperService
	) {
		super();
		this._proxy = extHostContext.getProxy(ExtHostContext.ExtHostAideAgentCodeMapper);
	}

	$registerCodeMapperProvider(handle: number, displayName: string): void {
		const impl: ICodeMapperProvider = {
			displayName,
			mapCode: async (uiRequest: ICodeMapperRequest, response: ICodeMapperResponse, token: CancellationToken) => {
				const requestId = String(MainThreadChatCodemapper._requestHandlePool++);
				this._responseMap.set(requestId, response);
				const extHostRequest: ICodeMapperRequestDto = {
					requestId,
					codeBlocks: uiRequest.codeBlocks,
					chatRequestId: uiRequest.chatRequestId,
					location: uiRequest.location
				};
				try {
					return await this._proxy.$mapCode(handle, extHostRequest, token).then((result) => result ?? undefined);
				} finally {
					this._responseMap.delete(requestId);
				}
			}
		};

		const disposable = this.codeMapperService.registerCodeMapperProvider(handle, impl);
		this.providers.set(handle, disposable);
	}

	$unregisterCodeMapperProvider(handle: number): void {
		this.providers.deleteAndDispose(handle);
	}

	$handleProgress(requestId: string, data: ICodeMapperProgressDto): Promise<void> {
		const response = this._responseMap.get(requestId);
		if (response) {
			const resource = URI.revive(data.uri);
			response.textEdit(resource, data.edits);
		}
		return Promise.resolve();
	}
}
