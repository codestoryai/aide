/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { coalesce } from 'vs/base/common/arrays';
import { raceCancellation } from 'vs/base/common/async';
import { CancellationToken } from 'vs/base/common/cancellation';
import { toErrorMessage } from 'vs/base/common/errorMessage';
import { Emitter } from 'vs/base/common/event';
import { IMarkdownString } from 'vs/base/common/htmlContent';
import { Iterable } from 'vs/base/common/iterator';
import { Disposable, DisposableMap, DisposableStore } from 'vs/base/common/lifecycle';
import { StopWatch } from 'vs/base/common/stopwatch';
import { assertType } from 'vs/base/common/types';
import { URI } from 'vs/base/common/uri';
import { Location } from 'vs/editor/common/languages';
import { ExtensionIdentifier, IExtensionDescription } from 'vs/platform/extensions/common/extensions';
import { ILogService } from 'vs/platform/log/common/log';
import { ExtHostAideChatAgentsShape2, IAideChatAgentCompletionItem, IAideChatAgentHistoryEntryDto, IAideChatProgressDto, IExtensionAideChatAgentMetadata, IMainContext, MainContext, MainThreadAideChatAgentsShape2 } from 'vs/workbench/api/common/extHost.protocol';
import { CommandsConverter, ExtHostCommands } from 'vs/workbench/api/common/extHostCommands';
import * as typeConvert from 'vs/workbench/api/common/extHostTypeConverters';
import * as extHostTypes from 'vs/workbench/api/common/extHostTypes';
import { AideChatAgentLocation, IAideChatAgentRequest, IAideChatAgentResult } from 'vs/workbench/contrib/aideChat/common/aideChatAgents';
import { IAideChatContentReference, IAideChatFollowup, IAideChatUserActionEvent, AideChatAgentVoteDirection, IAideChatResponseErrorDetails } from 'vs/workbench/contrib/aideChat/common/aideChatService';
import { checkProposedApiEnabled, isProposedApiEnabled } from 'vs/workbench/services/extensions/common/extensions';
import { Dto } from 'vs/workbench/services/extensions/common/proxyIdentifier';
import type * as vscode from 'vscode';

class ChatAgentResponseStream {

	private _stopWatch = StopWatch.create(false);
	private _isClosed: boolean = false;
	private _firstProgress: number | undefined;
	private _apiObject: vscode.AideChatResponseStream | undefined;

	constructor(
		private readonly _extension: IExtensionDescription,
		private readonly _request: IAideChatAgentRequest,
		private readonly _proxy: MainThreadAideChatAgentsShape2,
		private readonly _commandsConverter: CommandsConverter,
		private readonly _sessionDisposables: DisposableStore
	) { }

	close() {
		this._isClosed = true;
	}

	get timings() {
		return {
			firstProgress: this._firstProgress,
			totalElapsed: this._stopWatch.elapsed()
		};
	}

	get apiObject() {

		if (!this._apiObject) {

			const that = this;
			this._stopWatch.reset();

			function throwIfDone(source: Function | undefined) {
				if (that._isClosed) {
					const err = new Error('Response stream has been closed');
					Error.captureStackTrace(err, source);
					throw err;
				}
			}

			const _report = (progress: IAideChatProgressDto, task?: (progress: vscode.Progress<vscode.ChatResponseWarningPart | vscode.ChatResponseReferencePart>) => Thenable<string | void>) => {
				// Measure the time to the first progress update with real markdown content
				if (typeof this._firstProgress === 'undefined' && 'content' in progress) {
					this._firstProgress = this._stopWatch.elapsed();
				}

				if (task) {
					const progressReporterPromise = this._proxy.$handleProgressChunk(this._request.requestId, progress);
					const progressReporter = {
						report: (p: vscode.ChatResponseWarningPart | vscode.ChatResponseReferencePart) => {
							progressReporterPromise?.then((handle) => {
								if (handle) {
									if (extHostTypes.MarkdownString.isMarkdownString(p.value)) {
										this._proxy.$handleProgressChunk(this._request.requestId, typeConvert.AideChatResponseWarningPart.from(<vscode.ChatResponseWarningPart>p), handle);
									} else {
										this._proxy.$handleProgressChunk(this._request.requestId, typeConvert.AideChatResponseReferencePart.from(<vscode.ChatResponseReferencePart>p), handle);
									}
								}
							});
						}
					};

					Promise.all([progressReporterPromise, task?.(progressReporter)]).then(([handle, res]) => {
						if (handle !== undefined && res !== undefined) {
							this._proxy.$handleProgressChunk(this._request.requestId, typeConvert.AideChatTaskResult.from(res), handle);
						}
					});
				} else {
					this._proxy.$handleProgressChunk(this._request.requestId, progress);
				}
			};

			this._apiObject = {
				markdown(value) {
					throwIfDone(this.markdown);
					const part = new extHostTypes.AideChatResponseMarkdownPart(value);
					const dto = typeConvert.AideChatResponseMarkdownPart.from(part);
					_report(dto);
					return this;
				},
				markdownWithVulnerabilities(value, vulnerabilities) {
					throwIfDone(this.markdown);
					if (vulnerabilities) {
						checkProposedApiEnabled(that._extension, 'aideChatParticipant');
					}

					const part = new extHostTypes.AideChatResponseMarkdownWithVulnerabilitiesPart(value, vulnerabilities);
					const dto = typeConvert.AideChatResponseMarkdownWithVulnerabilitiesPart.from(part);
					_report(dto);
					return this;
				},
				filetree(value, baseUri) {
					throwIfDone(this.filetree);
					const part = new extHostTypes.AideChatResponseFileTreePart(value, baseUri);
					const dto = typeConvert.AideChatResponseFilesPart.from(part);
					_report(dto);
					return this;
				},
				anchor(value, title?: string) {
					throwIfDone(this.anchor);
					const part = new extHostTypes.AideChatResponseAnchorPart(value, title);
					const dto = typeConvert.AideChatResponseAnchorPart.from(part);
					_report(dto);
					return this;
				},
				button(value) {
					throwIfDone(this.anchor);
					const part = new extHostTypes.AideChatResponseCommandButtonPart(value);
					const dto = typeConvert.AideChatResponseCommandButtonPart.from(part, that._commandsConverter, that._sessionDisposables);
					_report(dto);
					return this;
				},
				progress(value, task?: ((progress: vscode.Progress<vscode.ChatResponseWarningPart>) => Thenable<string | void>)) {
					throwIfDone(this.progress);
					const part = new extHostTypes.AideChatResponseProgressPart2(value, task);
					const dto = task ? typeConvert.AideChatTask.from(part) : typeConvert.AideChatResponseProgressPart.from(part);
					_report(dto, task);
					return this;
				},
				warning(value) {
					throwIfDone(this.progress);
					checkProposedApiEnabled(that._extension, 'aideChatParticipant');
					const part = new extHostTypes.ChatResponseWarningPart(value);
					const dto = typeConvert.AideChatResponseWarningPart.from(part);
					_report(dto);
					return this;
				},
				reference(value, iconPath) {
					throwIfDone(this.reference);

					if ('variableName' in value) {
						checkProposedApiEnabled(that._extension, 'aideChatParticipant');
					}

					if ('variableName' in value && !value.value) {
						// The participant used this variable. Does that variable have any references to pull in?
						const matchingVarData = that._request.variables.variables.find(v => v.name === value.variableName);
						if (matchingVarData) {
							let references: Dto<IAideChatContentReference>[] | undefined;
							if (matchingVarData.references?.length) {
								references = matchingVarData.references.map(r => ({
									kind: 'reference',
									reference: { variableName: value.variableName, value: r.reference as URI | Location }
								} satisfies IAideChatContentReference));
							} else {
								// Participant sent a variableName reference but the variable produced no references. Show variable reference with no value
								const part = new extHostTypes.AideChatResponseReferencePart(value, iconPath);
								const dto = typeConvert.AideChatResponseReferencePart.from(part);
								references = [dto];
							}

							references.forEach(r => _report(r));
							return this;
						} else {
							// Something went wrong- that variable doesn't actually exist
						}
					} else {
						const part = new extHostTypes.AideChatResponseReferencePart(value, iconPath);
						const dto = typeConvert.AideChatResponseReferencePart.from(part);
						_report(dto);
					}

					return this;
				},
				textEdit(target, edits) {
					throwIfDone(this.textEdit);
					checkProposedApiEnabled(that._extension, 'aideChatParticipant');

					const part = new extHostTypes.AideChatResponseTextEditPart(target, edits);
					const dto = typeConvert.AideChatResponseTextEditPart.from(part);
					_report(dto);
					return this;
				},
				detectedParticipant(participant, command) {
					throwIfDone(this.detectedParticipant);
					checkProposedApiEnabled(that._extension, 'aideChatParticipant');

					const part = new extHostTypes.AideChatResponseDetectedParticipantPart(participant, command);
					const dto = typeConvert.AideChatResponseDetectedParticipantPart.from(part);
					_report(dto);
					return this;
				},
				confirmation(title, message, data) {
					throwIfDone(this.confirmation);
					checkProposedApiEnabled(that._extension, 'aideChatParticipant');

					const part = new extHostTypes.AideChatResponseConfirmationPart(title, message, data);
					const dto = typeConvert.AideChatResponseConfirmationPart.from(part);
					_report(dto);
					return this;
				},
				push(part) {
					throwIfDone(this.push);

					if (
						part instanceof extHostTypes.ChatResponseTextEditPart ||
						part instanceof extHostTypes.ChatResponseMarkdownWithVulnerabilitiesPart ||
						part instanceof extHostTypes.ChatResponseDetectedParticipantPart ||
						part instanceof extHostTypes.ChatResponseWarningPart ||
						part instanceof extHostTypes.ChatResponseConfirmationPart
					) {
						checkProposedApiEnabled(that._extension, 'aideChatParticipant');
					}

					if (part instanceof extHostTypes.ChatResponseReferencePart) {
						// Ensure variable reference values get fixed up
						this.reference(part.value, part.iconPath);
					} else {
						const dto = typeConvert.AideChatResponsePart.from(part, that._commandsConverter, that._sessionDisposables);
						_report(dto);
					}

					return this;
				},
			};
		}

		return this._apiObject;
	}
}

export class ExtHostAideChatAgents2 extends Disposable implements ExtHostAideChatAgentsShape2 {

	private static _idPool = 0;

	private readonly _agents = new Map<number, ExtHostChatAgent>();
	private readonly _proxy: MainThreadAideChatAgentsShape2;

	private readonly _sessionDisposables: DisposableMap<string, DisposableStore> = this._register(new DisposableMap());
	private readonly _completionDisposables: DisposableMap<number, DisposableStore> = this._register(new DisposableMap());

	constructor(
		mainContext: IMainContext,
		private readonly _logService: ILogService,
		private readonly commands: ExtHostCommands,
		private readonly quality: string | undefined
	) {
		super();
		this._proxy = mainContext.getProxy(MainContext.MainThreadAideChatAgents2);
	}

	transferActiveChat(newWorkspace: vscode.Uri): void {
		this._proxy.$transferActiveChatSession(newWorkspace);
	}

	createChatAgent(extension: IExtensionDescription, id: string, handler: vscode.AideChatExtendedRequestHandler): vscode.AideChatParticipant {
		const handle = ExtHostAideChatAgents2._idPool++;
		const agent = new ExtHostChatAgent(extension, this.quality, id, this._proxy, handle, handler);
		this._agents.set(handle, agent);

		if (agent.isAgentEnabled()) {
			this._proxy.$registerAgent(handle, extension.identifier, id, {}, undefined);
		}

		return agent.apiAgent;
	}

	createDynamicChatAgent(extension: IExtensionDescription, id: string, dynamicProps: vscode.DynamicChatParticipantProps, handler: vscode.AideChatExtendedRequestHandler): vscode.AideChatParticipant {
		const handle = ExtHostAideChatAgents2._idPool++;
		const agent = new ExtHostChatAgent(extension, this.quality, id, this._proxy, handle, handler);
		this._agents.set(handle, agent);

		this._proxy.$registerAgent(handle, extension.identifier, id, { isSticky: true } satisfies IExtensionAideChatAgentMetadata, dynamicProps);
		return agent.apiAgent;
	}

	async $invokeAgent(handle: number, request: IAideChatAgentRequest, context: { history: IAideChatAgentHistoryEntryDto[] }, token: CancellationToken): Promise<IAideChatAgentResult | undefined> {
		const agent = this._agents.get(handle);
		if (!agent) {
			throw new Error(`[CHAT](${handle}) CANNOT invoke agent because the agent is not registered`);
		}

		// Init session disposables
		let sessionDisposables = this._sessionDisposables.get(request.sessionId);
		if (!sessionDisposables) {
			sessionDisposables = new DisposableStore();
			this._sessionDisposables.set(request.sessionId, sessionDisposables);
		}

		const stream = new ChatAgentResponseStream(agent.extension, request, this._proxy, this.commands.converter, sessionDisposables);
		try {
			const convertedHistory = await this.prepareHistoryTurns(request.agentId, context);
			const task = agent.invoke(
				typeConvert.AideChatAgentRequest.to(request),
				{ history: convertedHistory },
				stream.apiObject,
				token
			);

			return await raceCancellation(Promise.resolve(task).then((result) => {
				if (result?.metadata) {
					try {
						JSON.stringify(result.metadata);
					} catch (err) {
						const msg = `result.metadata MUST be JSON.stringify-able. Got error: ${err.message}`;
						this._logService.error(`[${agent.extension.identifier.value}] [@${agent.id}] ${msg}`, agent.extension);
						return { errorDetails: { message: msg }, timings: stream.timings };
					}
				}
				let errorDetails: IAideChatResponseErrorDetails | undefined;
				if (result?.errorDetails) {
					errorDetails = {
						...result.errorDetails,
						responseIsIncomplete: true
					};
				}
				if (errorDetails?.responseIsRedacted) {
					checkProposedApiEnabled(agent.extension, 'aideChatParticipant');
				}

				return { errorDetails, timings: stream.timings, metadata: result?.metadata } satisfies IAideChatAgentResult;
			}), token);
		} catch (e) {
			this._logService.error(e, agent.extension);

			return { errorDetails: { message: toErrorMessage(e), responseIsIncomplete: true } };

		} finally {
			stream.close();
		}
	}

	private async prepareHistoryTurns(agentId: string, context: { history: IAideChatAgentHistoryEntryDto[] }): Promise<(vscode.ChatRequestTurn | vscode.ChatResponseTurn)[]> {

		const res: (vscode.ChatRequestTurn | vscode.ChatResponseTurn)[] = [];

		for (const h of context.history) {
			const ehResult = typeConvert.AideChatAgentResult.to(h.result);
			const result: vscode.ChatResult = agentId === h.request.agentId ?
				ehResult :
				{ ...ehResult, metadata: undefined };

			// REQUEST turn
			res.push(new extHostTypes.AideChatRequestTurn(h.request.message, h.request.command, h.request.variables.variables.map(typeConvert.AideChatAgentValueReference.to), h.request.agentId));

			// RESPONSE turn
			const parts = coalesce(h.response.map(r => typeConvert.AideChatResponsePart.toContent(r, this.commands.converter)));
			res.push(new extHostTypes.AideChatResponseTurn(parts, result, h.request.agentId, h.request.command));
		}

		return res;
	}

	$releaseSession(sessionId: string): void {
		this._sessionDisposables.deleteAndDispose(sessionId);
	}

	async $provideFollowups(request: IAideChatAgentRequest, handle: number, result: IAideChatAgentResult, context: { history: IAideChatAgentHistoryEntryDto[] }, token: CancellationToken): Promise<IAideChatFollowup[]> {
		const agent = this._agents.get(handle);
		if (!agent) {
			return Promise.resolve([]);
		}

		const convertedHistory = await this.prepareHistoryTurns(agent.id, context);

		const ehResult = typeConvert.AideChatAgentResult.to(result);
		return (await agent.provideFollowups(ehResult, { history: convertedHistory }, token))
			.filter(f => {
				// The followup must refer to a participant that exists from the same extension
				const isValid = !f.participant || Iterable.some(
					this._agents.values(),
					a => a.id === f.participant && ExtensionIdentifier.equals(a.extension.identifier, agent.extension.identifier));
				if (!isValid) {
					this._logService.warn(`[@${agent.id}] ChatFollowup refers to an unknown participant: ${f.participant}`);
				}
				return isValid;
			})
			.map(f => typeConvert.AideChatFollowup.from(f, request));
	}

	$acceptFeedback(handle: number, result: IAideChatAgentResult, vote: AideChatAgentVoteDirection, reportIssue?: boolean): void {
		const agent = this._agents.get(handle);
		if (!agent) {
			return;
		}

		const ehResult = typeConvert.AideChatAgentResult.to(result);
		let kind: extHostTypes.AideChatResultFeedbackKind;
		switch (vote) {
			case AideChatAgentVoteDirection.Down:
				kind = extHostTypes.AideChatResultFeedbackKind.Unhelpful;
				break;
			case AideChatAgentVoteDirection.Up:
				kind = extHostTypes.AideChatResultFeedbackKind.Helpful;
				break;
		}
		agent.acceptFeedback(reportIssue ?
			Object.freeze({ result: ehResult, kind, reportIssue }) :
			Object.freeze({ result: ehResult, kind }));
	}

	$acceptAction(handle: number, result: IAideChatAgentResult, event: IAideChatUserActionEvent): void {
		const agent = this._agents.get(handle);
		if (!agent) {
			return;
		}
		if (event.action.kind === 'vote') {
			// handled by $acceptFeedback
			return;
		}

		const ehAction = typeConvert.AideChatAgentUserActionEvent.to(result, event, this.commands.converter);
		if (ehAction) {
			agent.acceptAction(Object.freeze(ehAction));
		}
	}

	async $invokeCompletionProvider(handle: number, query: string, token: CancellationToken): Promise<IAideChatAgentCompletionItem[]> {
		const agent = this._agents.get(handle);
		if (!agent) {
			return [];
		}

		let disposables = this._completionDisposables.get(handle);
		if (disposables) {
			// Clear any disposables from the last invocation of this completion provider
			disposables.clear();
		} else {
			disposables = new DisposableStore();
			this._completionDisposables.set(handle, disposables);
		}

		const items = await agent.invokeCompletionProvider(query, token);

		return items.map((i) => typeConvert.AideChatAgentCompletionItem.from(i, this.commands.converter, disposables));
	}

	async $provideWelcomeMessage(handle: number, location: AideChatAgentLocation, token: CancellationToken): Promise<(string | IMarkdownString)[] | undefined> {
		const agent = this._agents.get(handle);
		if (!agent) {
			return;
		}

		return await agent.provideWelcomeMessage(typeConvert.AideChatLocation.to(location), token);
	}

	async $provideSampleQuestions(handle: number, location: AideChatAgentLocation, token: CancellationToken): Promise<IAideChatFollowup[] | undefined> {
		const agent = this._agents.get(handle);
		if (!agent) {
			return;
		}

		return (await agent.provideSampleQuestions(typeConvert.AideChatLocation.to(location), token))
			.map(f => typeConvert.AideChatFollowup.from(f, undefined));
	}
}

class ExtHostChatAgent {

	private _followupProvider: vscode.ChatFollowupProvider | undefined;
	private _iconPath: vscode.Uri | { light: vscode.Uri; dark: vscode.Uri } | vscode.ThemeIcon | undefined;
	private _isDefault: boolean | undefined;
	private _helpTextPrefix: string | vscode.MarkdownString | undefined;
	private _helpTextVariablesPrefix: string | vscode.MarkdownString | undefined;
	private _helpTextPostfix: string | vscode.MarkdownString | undefined;
	private _isSecondary: boolean | undefined;
	private _onDidReceiveFeedback = new Emitter<vscode.AideChatResultFeedback>();
	private _onDidPerformAction = new Emitter<vscode.ChatUserActionEvent>();
	private _supportIssueReporting: boolean | undefined;
	private _agentVariableProvider?: { provider: vscode.ChatParticipantCompletionItemProvider; triggerCharacters: string[] };
	private _welcomeMessageProvider?: vscode.AideChatWelcomeMessageProvider | undefined;
	private _requester: vscode.ChatRequesterInformation | undefined;
	private _supportsSlowReferences: boolean | undefined;

	constructor(
		public readonly extension: IExtensionDescription,
		private readonly quality: string | undefined,
		public readonly id: string,
		private readonly _proxy: MainThreadAideChatAgentsShape2,
		private readonly _handle: number,
		private _requestHandler: vscode.AideChatExtendedRequestHandler,
	) { }

	acceptFeedback(feedback: vscode.AideChatResultFeedback) {
		this._onDidReceiveFeedback.fire(feedback);
	}

	acceptAction(event: vscode.ChatUserActionEvent) {
		this._onDidPerformAction.fire(event);
	}

	async invokeCompletionProvider(query: string, token: CancellationToken): Promise<vscode.ChatCompletionItem[]> {
		if (!this._agentVariableProvider) {
			return [];
		}

		return await this._agentVariableProvider.provider.provideCompletionItems(query, token) ?? [];
	}

	public isAgentEnabled() {
		// If in stable and this extension doesn't have the right proposed API, then don't register the agent
		return !(this.quality === 'stable' && !isProposedApiEnabled(this.extension, 'aideChatParticipant'));
	}

	async provideFollowups(result: vscode.ChatResult, context: vscode.ChatContext, token: CancellationToken): Promise<vscode.ChatFollowup[]> {
		if (!this._followupProvider) {
			return [];
		}

		const followups = await this._followupProvider.provideFollowups(result, context, token);
		if (!followups) {
			return [];
		}
		return followups
			// Filter out "command followups" from older providers
			.filter(f => !(f && 'commandId' in f))
			// Filter out followups from older providers before 'message' changed to 'prompt'
			.filter(f => !(f && 'message' in f));
	}

	async provideWelcomeMessage(location: vscode.AideChatLocation, token: CancellationToken): Promise<(string | IMarkdownString)[] | undefined> {
		if (!this._welcomeMessageProvider) {
			return [];
		}
		const content = await this._welcomeMessageProvider.provideWelcomeMessage(location, token);
		if (!content) {
			return [];
		}
		return content.map(item => {
			if (typeof item === 'string') {
				return item;
			} else {
				return typeConvert.MarkdownString.from(item);
			}
		});
	}

	async provideSampleQuestions(location: vscode.AideChatLocation, token: CancellationToken): Promise<vscode.ChatFollowup[]> {
		if (!this._welcomeMessageProvider || !this._welcomeMessageProvider.provideSampleQuestions) {
			return [];
		}
		const content = await this._welcomeMessageProvider.provideSampleQuestions(location, token);
		if (!content) {
			return [];
		}

		return content;
	}

	get apiAgent(): vscode.AideChatParticipant {
		let disposed = false;
		let updateScheduled = false;
		const updateMetadataSoon = () => {
			if (disposed) {
				return;
			}
			if (updateScheduled) {
				return;
			}
			updateScheduled = true;
			queueMicrotask(() => {
				if (!that.isAgentEnabled()) {
					return;
				}

				this._proxy.$updateAgent(this._handle, {
					icon: !this._iconPath ? undefined :
						this._iconPath instanceof URI ? this._iconPath :
							'light' in this._iconPath ? this._iconPath.light :
								undefined,
					iconDark: !this._iconPath ? undefined :
						'dark' in this._iconPath ? this._iconPath.dark :
							undefined,
					themeIcon: this._iconPath instanceof extHostTypes.ThemeIcon || this._iconPath instanceof URI ? this._iconPath : undefined,
					hasFollowups: this._followupProvider !== undefined,
					isSecondary: this._isSecondary,
					helpTextPrefix: (!this._helpTextPrefix || typeof this._helpTextPrefix === 'string') ? this._helpTextPrefix : typeConvert.MarkdownString.from(this._helpTextPrefix),
					helpTextVariablesPrefix: (!this._helpTextVariablesPrefix || typeof this._helpTextVariablesPrefix === 'string') ? this._helpTextVariablesPrefix : typeConvert.MarkdownString.from(this._helpTextVariablesPrefix),
					helpTextPostfix: (!this._helpTextPostfix || typeof this._helpTextPostfix === 'string') ? this._helpTextPostfix : typeConvert.MarkdownString.from(this._helpTextPostfix),
					supportIssueReporting: this._supportIssueReporting,
					requester: this._requester,
					supportsSlowVariables: this._supportsSlowReferences,
				});
				updateScheduled = false;
			});
		};

		const that = this;
		return {
			get id() {
				return that.id;
			},
			get iconPath() {
				return that._iconPath;
			},
			set iconPath(v) {
				that._iconPath = v;
				updateMetadataSoon();
			},
			get requestHandler() {
				return that._requestHandler;
			},
			set requestHandler(v) {
				assertType(typeof v === 'function', 'Invalid request handler');
				that._requestHandler = v;
			},
			get followupProvider() {
				return that._followupProvider;
			},
			set followupProvider(v) {
				that._followupProvider = v;
				updateMetadataSoon();
			},
			get isDefault() {
				checkProposedApiEnabled(that.extension, 'aideChatParticipant');
				return that._isDefault;
			},
			set isDefault(v) {
				checkProposedApiEnabled(that.extension, 'aideChatParticipant');
				that._isDefault = v;
				updateMetadataSoon();
			},
			get helpTextPrefix() {
				checkProposedApiEnabled(that.extension, 'aideChatParticipant');
				return that._helpTextPrefix;
			},
			set helpTextPrefix(v) {
				checkProposedApiEnabled(that.extension, 'aideChatParticipant');
				that._helpTextPrefix = v;
				updateMetadataSoon();
			},
			get helpTextVariablesPrefix() {
				checkProposedApiEnabled(that.extension, 'aideChatParticipant');
				return that._helpTextVariablesPrefix;
			},
			set helpTextVariablesPrefix(v) {
				checkProposedApiEnabled(that.extension, 'aideChatParticipant');
				that._helpTextVariablesPrefix = v;
				updateMetadataSoon();
			},
			get helpTextPostfix() {
				checkProposedApiEnabled(that.extension, 'aideChatParticipant');
				return that._helpTextPostfix;
			},
			set helpTextPostfix(v) {
				checkProposedApiEnabled(that.extension, 'aideChatParticipant');
				that._helpTextPostfix = v;
				updateMetadataSoon();
			},
			get isSecondary() {
				checkProposedApiEnabled(that.extension, 'aideChatParticipant');
				return that._isSecondary;
			},
			set isSecondary(v) {
				checkProposedApiEnabled(that.extension, 'aideChatParticipant');
				that._isSecondary = v;
				updateMetadataSoon();
			},
			get supportIssueReporting() {
				checkProposedApiEnabled(that.extension, 'aideChatParticipant');
				return that._supportIssueReporting;
			},
			set supportIssueReporting(v) {
				checkProposedApiEnabled(that.extension, 'aideChatParticipant');
				that._supportIssueReporting = v;
				updateMetadataSoon();
			},
			get onDidReceiveFeedback() {
				return that._onDidReceiveFeedback.event;
			},
			set participantVariableProvider(v) {
				checkProposedApiEnabled(that.extension, 'aideChatParticipant');
				that._agentVariableProvider = v;
				if (v) {
					if (!v.triggerCharacters.length) {
						throw new Error('triggerCharacters are required');
					}

					that._proxy.$registerAgentCompletionsProvider(that._handle, that.id, v.triggerCharacters);
				} else {
					that._proxy.$unregisterAgentCompletionsProvider(that._handle, that.id);
				}
			},
			get participantVariableProvider() {
				checkProposedApiEnabled(that.extension, 'aideChatParticipant');
				return that._agentVariableProvider;
			},
			set welcomeMessageProvider(v) {
				checkProposedApiEnabled(that.extension, 'aideChatParticipant');
				that._welcomeMessageProvider = v;
				updateMetadataSoon();
			},
			get welcomeMessageProvider() {
				checkProposedApiEnabled(that.extension, 'aideChatParticipant');
				return that._welcomeMessageProvider;
			},
			onDidPerformAction: !isProposedApiEnabled(this.extension, 'aideChatParticipant')
				? undefined!
				: this._onDidPerformAction.event
			,
			set requester(v) {
				that._requester = v;
				updateMetadataSoon();
			},
			get requester() {
				return that._requester;
			},
			set supportsSlowReferences(v) {
				checkProposedApiEnabled(that.extension, 'aideChatParticipant');
				that._supportsSlowReferences = v;
				updateMetadataSoon();
			},
			get supportsSlowReferences() {
				checkProposedApiEnabled(that.extension, 'aideChatParticipant');
				return that._supportsSlowReferences;
			},
			dispose() {
				disposed = true;
				that._followupProvider = undefined;
				that._onDidReceiveFeedback.dispose();
				that._proxy.$unregisterAgent(that._handle);
			},
		} satisfies vscode.AideChatParticipant;
	}

	invoke(request: vscode.AideChatRequest, context: vscode.ChatContext, response: vscode.AideChatResponseStream, token: CancellationToken): vscode.ProviderResult<vscode.ChatResult | void> {
		return this._requestHandler(request, context, response, token);
	}
}