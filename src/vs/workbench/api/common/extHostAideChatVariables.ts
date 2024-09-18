/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as vscode from 'vscode';
import { onUnexpectedExternalError } from '../../../base/common/errors.js';
import { IDisposable, toDisposable } from '../../../base/common/lifecycle.js';
import { ThemeIcon } from '../../../base/common/themables.js';
import { IExtensionDescription } from '../../../platform/extensions/common/extensions.js';
import { IAideChatRequestVariableValue, IAideChatVariableData } from '../../contrib/aideChat/common/aideChatVariables.js';
import { checkProposedApiEnabled } from '../../services/extensions/common/extensions.js';
import { ExtHostAideChatVariablesShape, IChatVariableResolverProgressDto, IMainContext, MainContext, MainThreadAideChatVariablesShape } from './extHost.protocol.js';
import * as typeConvert from './extHostTypeConverters.js';
import * as extHostTypes from './extHostTypes.js';

export class ExtHostAideChatVariables implements ExtHostAideChatVariablesShape {

	private static _idPool = 0;

	private readonly _resolver = new Map<number, { extension: IExtensionDescription; data: IAideChatVariableData; resolver: vscode.ChatVariableResolver }>();
	private readonly _proxy: MainThreadAideChatVariablesShape;

	constructor(mainContext: IMainContext) {
		this._proxy = mainContext.getProxy(MainContext.MainThreadAideChatVariables);
	}

	async $resolveVariable(handle: number, requestId: string, messageText: string, token: vscode.CancellationToken): Promise<IAideChatRequestVariableValue | undefined> {
		const item = this._resolver.get(handle);
		if (!item) {
			return undefined;
		}
		try {
			if (item.resolver.resolve2) {
				checkProposedApiEnabled(item.extension, 'aideChatParticipant');
				const stream = new ChatVariableResolverResponseStream(requestId, this._proxy);
				const value = await item.resolver.resolve2(item.data.name, { prompt: messageText }, stream.apiObject, token);

				// Temp, ignoring other returned values to convert the array into a single value
				if (value && value[0]) {
					return value[0].value;
				}
			} else {
				const value = await item.resolver.resolve(item.data.name, { prompt: messageText }, token);
				if (value && value[0]) {
					return value[0].value;
				}
			}
		} catch (err) {
			onUnexpectedExternalError(err);
		}
		return undefined;
	}

	registerVariableResolver(extension: IExtensionDescription, id: string, name: string, userDescription: string, modelDescription: string | undefined, isSlow: boolean | undefined, resolver: vscode.ChatVariableResolver, fullName?: string, themeIconId?: string): IDisposable {
		const handle = ExtHostAideChatVariables._idPool++;
		const icon = themeIconId ? ThemeIcon.fromId(themeIconId) : undefined;
		this._resolver.set(handle, { extension, data: { id, name, description: userDescription, modelDescription, icon }, resolver: resolver });
		this._proxy.$registerVariable(handle, { id, name, description: userDescription, modelDescription, isSlow, fullName, icon });

		return toDisposable(() => {
			this._resolver.delete(handle);
			this._proxy.$unregisterVariable(handle);
		});
	}
}

class ChatVariableResolverResponseStream {

	private _isClosed: boolean = false;
	private _apiObject: vscode.ChatVariableResolverResponseStream | undefined;

	constructor(
		private readonly _requestId: string,
		private readonly _proxy: MainThreadAideChatVariablesShape,
	) { }

	close() {
		this._isClosed = true;
	}

	get apiObject() {
		if (!this._apiObject) {
			const that = this;

			function throwIfDone(source: Function | undefined) {
				if (that._isClosed) {
					const err = new Error('Response stream has been closed');
					Error.captureStackTrace(err, source);
					throw err;
				}
			}

			const _report = (progress: IChatVariableResolverProgressDto) => {
				this._proxy.$handleProgressChunk(this._requestId, progress);
			};

			this._apiObject = {
				progress(value) {
					throwIfDone(this.progress);
					const part = new extHostTypes.ChatResponseProgressPart(value);
					const dto = typeConvert.ChatResponseProgressPart.from(part);
					_report(dto);
					return this;
				},
				reference(value) {
					throwIfDone(this.reference);
					const part = new extHostTypes.ChatResponseReferencePart(value);
					const dto = typeConvert.AideChatResponseReferencePart.from(part);
					_report(dto);
					return this;
				},
				push(part) {
					throwIfDone(this.push);

					if (part instanceof extHostTypes.ChatResponseReferencePart) {
						_report(typeConvert.AideChatResponseReferencePart.from(part));
					} else if (part instanceof extHostTypes.ChatResponseProgressPart) {
						_report(typeConvert.AideChatResponseProgressPart.from(part));
					}

					return this;
				}
			};
		}

		return this._apiObject;
	}
}
