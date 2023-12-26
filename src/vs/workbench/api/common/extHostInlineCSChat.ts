/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from 'vs/base/common/cancellation';
import { toDisposable } from 'vs/base/common/lifecycle';
import { URI, UriComponents } from 'vs/base/common/uri';
import { ISelection } from 'vs/editor/common/core/selection';
import { IInlineCSChatSession, IInlineCSChatRequest, InlineCSChatResponseFeedbackKind, InlineChatResponseType } from 'vs/workbench/contrib/inlineCSChat/common/inlineCSChat';
import { IRelaxedExtensionDescription } from 'vs/platform/extensions/common/extensions';
import { ILogService } from 'vs/platform/log/common/log';
import { ExtHostInlineCSChatShape, IInlineCSChatResponseDto, IMainContext, MainContext, MainThreadInlineCSChatShape } from 'vs/workbench/api/common/extHost.protocol';
import { ExtHostDocuments } from 'vs/workbench/api/common/extHostDocuments';
import * as typeConvert from 'vs/workbench/api/common/extHostTypeConverters';
import * as extHostTypes from 'vs/workbench/api/common/extHostTypes';
import type * as vscode from 'vscode';
import { ApiCommand, ApiCommandArgument, ApiCommandResult, ExtHostCommands } from 'vs/workbench/api/common/extHostCommands';
import { IRange } from 'vs/editor/common/core/range';
import { IPosition } from 'vs/editor/common/core/position';
import { raceCancellation } from 'vs/base/common/async';
import { ICSChatReplyFollowup } from 'vs/workbench/contrib/csChat/common/csChatService';

class ProviderWrapper {

	private static _pool = 0;

	readonly handle: number = ProviderWrapper._pool++;

	constructor(
		readonly extension: Readonly<IRelaxedExtensionDescription>,
		readonly provider: vscode.CSChatEditorSessionProvider
	) { }
}

class SessionWrapper {

	readonly responses: (vscode.CSChatEditorResponse | vscode.CSChatEditorMessageResponse)[] = [];

	constructor(
		readonly session: vscode.CSChatEditorSession
	) { }
}

export class ExtHostCSChatEditor implements ExtHostInlineCSChatShape {

	private static _nextId = 0;

	private readonly _inputProvider = new Map<number, ProviderWrapper>();
	private readonly _inputSessions = new Map<number, SessionWrapper>();
	private readonly _proxy: MainThreadInlineCSChatShape;

	constructor(
		mainContext: IMainContext,
		extHostCommands: ExtHostCommands,
		private readonly _documents: ExtHostDocuments,
		private readonly _logService: ILogService,
	) {
		this._proxy = mainContext.getProxy(MainContext.MainThreadInlineCSChat);

		type EditorChatApiArg = {
			initialRange?: vscode.Range;
			initialSelection?: vscode.Selection;
			message?: string;
			autoSend?: boolean;
			position?: vscode.Position;
		};

		type CSChatEditorRunOptions = {
			initialRange?: IRange;
			initialSelection?: ISelection;
			message?: string;
			autoSend?: boolean;
			position?: IPosition;
		};

		extHostCommands.registerApiCommand(new ApiCommand(
			'vscode.editorCSChat.start', 'inlineCSChat.start', 'Invoke a new editor chat session',
			[new ApiCommandArgument<EditorChatApiArg | undefined, CSChatEditorRunOptions | undefined>('Run arguments', '', _v => true, v => {

				if (!v) {
					return undefined;
				}

				return {
					initialRange: v.initialRange ? typeConvert.Range.from(v.initialRange) : undefined,
					initialSelection: v.initialSelection ? typeConvert.Selection.from(v.initialSelection) : undefined,
					message: v.message,
					autoSend: v.autoSend,
					position: v.position ? typeConvert.Position.from(v.position) : undefined,
				};
			})],
			ApiCommandResult.Void
		));
	}

	registerProvider(extension: Readonly<IRelaxedExtensionDescription>, provider: vscode.CSChatEditorSessionProvider, metadata?: vscode.CSChatEditorSessionProviderMetadata): vscode.Disposable {
		const wrapper = new ProviderWrapper(extension, provider);
		this._inputProvider.set(wrapper.handle, wrapper);
		this._proxy.$registerCSChatEditorProvider(wrapper.handle, metadata?.label ?? extension.displayName ?? extension.name, extension.identifier.value, typeof provider.handleCSChatEditorResponseFeedback === 'function', typeof provider.provideFollowups === 'function', metadata?.supportReportIssue ?? false);
		return toDisposable(() => {
			this._proxy.$unregisterCSChatEditorProvider(wrapper.handle);
			this._inputProvider.delete(wrapper.handle);
		});
	}

	async $prepareSession(handle: number, uri: UriComponents, range: ISelection, token: CancellationToken): Promise<IInlineCSChatSession | undefined> {
		const entry = this._inputProvider.get(handle);
		if (!entry) {
			this._logService.warn('CANNOT prepare session because the PROVIDER IS GONE');
			return undefined;
		}

		const document = this._documents.getDocument(URI.revive(uri));
		const selection = typeConvert.Selection.to(range);
		console.log('[prepareSession] whats the selection');
		console.log(selection);
		const session = await entry.provider.prepareCSChatEditorSession({ document, selection }, token);
		if (!session) {
			return undefined;
		}

		if (session.wholeRange && !session.wholeRange.contains(selection)) {
			throw new Error(`CSChatEditorSessionProvider returned a wholeRange that does not contain the selection.`);
		}

		const id = ExtHostCSChatEditor._nextId++;
		this._inputSessions.set(id, new SessionWrapper(session));

		return {
			id,
			placeholder: session.placeholder,
			input: session.input,
			slashCommands: session.slashCommands?.map(c => ({ command: c.command, detail: c.detail, refer: c.refer, executeImmediately: c.executeImmediately })),
			wholeRange: typeConvert.Range.from(session.wholeRange),
			message: session.message
		};
	}

	async $provideResponse(handle: number, item: IInlineCSChatSession, request: IInlineCSChatRequest, token: CancellationToken): Promise<IInlineCSChatResponseDto | undefined> {
		const entry = this._inputProvider.get(handle);
		if (!entry) {
			return undefined;
		}
		const sessionData = this._inputSessions.get(item.id);
		if (!sessionData) {
			return;
		}

		const apiRequest: vscode.CSChatEditorRequest = {
			prompt: request.prompt,
			selection: typeConvert.Selection.to(request.selection),
			wholeRange: typeConvert.Range.to(request.wholeRange),
			attempt: request.attempt,
			live: request.live,
			variables: {}
		};

		if (request.variables) {
			for (const key of Object.keys(request.variables)) {
				apiRequest.variables[key] = request.variables[key].map(typeConvert.CSChatVariable.to);
			}
		}

		let done = false;
		const progress: vscode.Progress<vscode.CSChatEditorProgressItem> = {
			report: async value => {
				if (!request.live && value.edits?.length) {
					throw new Error('Progress reporting is only supported for live sessions');
				}
				if (done || token.isCancellationRequested) {
					return;
				}
				await this._proxy.$handleProgressChunk(request.requestId, {
					message: value.message,
					edits: value.edits?.map(typeConvert.TextEdit.from),
					editsShouldBeInstant: value.editsShouldBeInstant,
					slashCommand: value.slashCommand?.command,
					markdownFragment: extHostTypes.MarkdownString.isMarkdownString(value.content) ? value.content.value : value.content
				});
			}
		};

		const task = Promise.resolve(entry.provider.provideCSChatEditorResponse(sessionData.session, apiRequest, progress, token));

		let res: vscode.CSChatEditorResponse | vscode.CSChatEditorMessageResponse | null | undefined;
		try {
			res = await raceCancellation(task, token);
		} finally {
			done = true;
		}

		if (!res) {
			return undefined;
		}


		const id = sessionData.responses.push(res) - 1;

		const stub: Partial<IInlineCSChatResponseDto> = {
			wholeRange: typeConvert.Range.from(res.wholeRange),
			placeholder: res.placeholder,
		};

		if (!ExtHostCSChatEditor._isEditResponse(res)) {
			return {
				...stub,
				id,
				type: InlineChatResponseType.EditorEdit,
				message: typeConvert.MarkdownString.from(res.contents),
				edits: []
			};
		}

		const { edits, contents } = res;
		const message = contents !== undefined ? typeConvert.MarkdownString.from(contents) : undefined;
		if (edits instanceof extHostTypes.WorkspaceEdit) {
			return {
				...stub,
				id,
				type: InlineChatResponseType.BulkEdit,
				edits: typeConvert.WorkspaceEdit.from(edits),
				message
			};
		} else {
			return {
				...stub,
				id,
				type: InlineChatResponseType.EditorEdit,
				edits: (<vscode.TextEdit[]>edits).map(typeConvert.TextEdit.from),
				message
			};
		}
	}

	async $provideFollowups(handle: number, sessionId: number, responseId: number, token: CancellationToken): Promise<ICSChatReplyFollowup[] | undefined> {
		const entry = this._inputProvider.get(handle);
		const sessionData = this._inputSessions.get(sessionId);
		const response = sessionData?.responses[responseId];
		if (entry && response && entry.provider.provideFollowups) {
			const task = Promise.resolve(entry.provider.provideFollowups(sessionData.session, response, token));
			const followups = await raceCancellation(task, token);
			return followups?.map(typeConvert.ChatReplyFollowup.from);
		}
		return undefined;
	}


	$handleFeedback(handle: number, sessionId: number, responseId: number, kind: InlineCSChatResponseFeedbackKind): void {
		const entry = this._inputProvider.get(handle);
		const sessionData = this._inputSessions.get(sessionId);
		const response = sessionData?.responses[responseId];
		if (entry && response) {
			const apiKind = typeConvert.CSChatEditorResponseFeedbackKind.to(kind);
			entry.provider.handleCSChatEditorResponseFeedback?.(sessionData.session, response, apiKind);
		}
	}

	$releaseSession(handle: number, sessionId: number) {
		// TODO@jrieken remove this
	}

	private static _isEditResponse(thing: any): thing is vscode.CSChatEditorResponse {
		return typeof thing === 'object' && typeof (<vscode.CSChatEditorResponse>thing).edits === 'object';
	}
}
