/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { raceCancellation } from 'vs/base/common/async';
import { CancellationToken } from 'vs/base/common/cancellation';
import { Disposable, IDisposable, toDisposable } from 'vs/base/common/lifecycle';
import { IExtensionDescription } from 'vs/platform/extensions/common/extensions';
import { ExtHostAideAgentProviderShape, IAideAgentProgressDto, IMainContext, MainContext, MainThreadAideAgentProviderShape } from 'vs/workbench/api/common/extHost.protocol';
import * as typeConvert from 'vs/workbench/api/common/extHostTypeConverters';
import * as extHostTypes from 'vs/workbench/api/common/extHostTypes';
import { IAgentTriggerComplete } from 'vs/workbench/contrib/aideAgent/common/aideAgent';
import { IAgentTriggerPayload } from 'vs/workbench/contrib/aideAgent/common/aideAgentModel';
import * as vscode from 'vscode';

class AideAgentResponseStream {
	private _isClosed: boolean = false;
	private _apiObject: vscode.AgentResponseStream | undefined;

	constructor(
		private readonly _request: IAgentTriggerPayload,
		private readonly _proxy: MainThreadAideAgentProviderShape,
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

			const _report = (progress: IAideAgentProgressDto, task?: (progress: vscode.Progress<vscode.ChatResponseWarningPart>) => Thenable<string | void>) => {
				if (task) {
					const progressReporterPromise = this._proxy.$handleProgress(this._request.id, progress);
					const progressReporter = {
						report: (p: vscode.ChatResponseWarningPart) => {
							progressReporterPromise?.then((handle) => {
								if (handle) {
									if (extHostTypes.MarkdownString.isMarkdownString(p.value)) {
										this._proxy.$handleProgress(this._request.id, typeConvert.ChatResponseWarningPart.from(<vscode.ChatResponseWarningPart>p), handle);
									}
								}
							});
						}
					};

					Promise.all([progressReporterPromise, task?.(progressReporter)]).then(([handle, res]) => {
						if (handle !== undefined && res !== undefined) {
							this._proxy.$handleProgress(this._request.id, typeConvert.ChatTaskResult.from(res), handle);
						}
					});
				} else {
					this._proxy.$handleProgress(this._request.id, progress);
				}
			};

			this._apiObject = {
				markdown(value) {
					throwIfDone(this.markdown);
					const part = new extHostTypes.AideChatResponseMarkdownPart(value);
					const dto = typeConvert.ChatResponseMarkdownPart.from(part);
					_report(dto);
					return this;
				},
			};
		}

		return this._apiObject;
	}
}

export class ExtHostAideAgentProvider extends Disposable implements ExtHostAideAgentProviderShape {
	private static _idPool = 0;

	private readonly _providers = new Map<number, { extension: IExtensionDescription; provider: vscode.AideAgentProvider }>();
	private readonly _proxy: MainThreadAideAgentProviderShape;

	constructor(
		mainContext: IMainContext
	) {
		super();
		this._proxy = mainContext.getProxy(MainContext.MainThreadAideAgentProvider);
	}

	async $trigger(handle: number, request: IAgentTriggerPayload, token: CancellationToken): Promise<IAgentTriggerComplete | undefined> {
		const provider = this._providers.get(handle);
		if (!provider) {
			return;
		}

		const stream = new AideAgentResponseStream(request, this._proxy);
		try {
			const task = provider.provider.provideTriggerResponse(request, stream.apiObject, token);

			return await raceCancellation(Promise.resolve(task).then((result) => {
				return {
					errorDetails: result?.errorDetails
				} satisfies IAgentTriggerComplete;
			}), token);
		} catch (err) {
			return { errorDetails: err.message } satisfies IAgentTriggerComplete;
		} finally {
			stream.close();
		}
	}

	registerAgentprovider(extension: IExtensionDescription, id: string, provider: vscode.AideAgentProvider): IDisposable {
		const handle = ExtHostAideAgentProvider._idPool++;
		this._providers.set(handle, { extension, provider });
		this._proxy.$registerAideAgentProvider(handle);

		return toDisposable(() => {
			this._proxy.$unregisterAideAgentProvider(handle);
			this._providers.delete(handle);
		});
	}
}
