/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { coalesce } from '../../../../base/common/arrays.js';
import { DeferredPromise } from '../../../../base/common/async.js';
import { CancellationToken, CancellationTokenSource } from '../../../../base/common/cancellation.js';
import { toErrorMessage } from '../../../../base/common/errorMessage.js';
import { ErrorNoTelemetry } from '../../../../base/common/errors.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { MarkdownString } from '../../../../base/common/htmlContent.js';
import { Iterable } from '../../../../base/common/iterator.js';
import { Disposable, DisposableMap } from '../../../../base/common/lifecycle.js';
import { revive } from '../../../../base/common/marshalling.js';
import { StopWatch } from '../../../../base/common/stopwatch.js';
import { URI, UriComponents } from '../../../../base/common/uri.js';
import { localize } from '../../../../nls.js';
import { CommandsRegistry } from '../../../../platform/commands/common/commands.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { Progress } from '../../../../platform/progress/common/progress.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { ITelemetryService } from '../../../../platform/telemetry/common/telemetry.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { AideChatAgentLocation, IChatAgent, IAideChatAgentRequest, IAideChatAgentResult, IAideChatAgentService } from '../../../../workbench/contrib/aideChat/common/aideChatAgents.js';
import { ChatModel, ChatRequestModel, ChatRequestRemovalReason, ChatWelcomeMessageModel, IChatModel, IChatRequestModel, IChatRequestVariableData, IAideChatRequestVariableEntry, IChatResponseModel, IExportableChatData, ISerializableChatData, ISerializableChatsData, getHistoryEntriesFromModel, updateRanges } from '../../../../workbench/contrib/aideChat/common/aideChatModel.js';
import { ChatRequestAgentPart, ChatRequestAgentSubcommandPart, ChatRequestSlashCommandPart, IParsedChatRequest, chatAgentLeader, chatSubcommandLeader, getPromptText } from '../../../../workbench/contrib/aideChat/common/aideChatParserTypes.js';
import { ChatRequestParser } from '../../../../workbench/contrib/aideChat/common/aideChatRequestParser.js';
import { ChatCopyKind, IChatCompleteResponse, IChatDetail, IAideChatFollowup, IAideChatProgress, IChatSendRequestData, IChatSendRequestOptions, IChatSendRequestResponseState, IAideChatService, IChatTransferredSessionData, IAideChatUserActionEvent, AideChatAgentVoteDirection } from '../../../../workbench/contrib/aideChat/common/aideChatService.js';
import { IAideChatSlashCommandService } from '../../../../workbench/contrib/aideChat/common/aideChatSlashCommands.js';
import { IAideChatVariablesService } from '../../../../workbench/contrib/aideChat/common/aideChatVariables.js';
import { AideChatMessageRole, IAideChatMessage } from '../../../../workbench/contrib/aideChat/common/languageModels.js';
import { IExtensionService } from '../../../../workbench/services/extensions/common/extensions.js';

const serializedChatKey = 'aideChat.sessions';

const globalChatKey = 'aideChat.workspaceTransfer';
interface IChatTransfer {
	toWorkspace: UriComponents;
	timestampInMilliseconds: number;
	chat: ISerializableChatData;
	inputValue: string;
}
const SESSION_TRANSFER_EXPIRATION_IN_MILLISECONDS = 1000 * 60;

type ChatProviderInvokedEvent = {
	timeToFirstProgress: number | undefined;
	totalTime: number | undefined;
	result: 'success' | 'error' | 'errorWithOutput' | 'cancelled' | 'filtered';
	requestType: 'string' | 'followup' | 'slashCommand';
	chatSessionId: string;
	agent: string;
	slashCommand: string | undefined;
	location: AideChatAgentLocation;
};

type ChatProviderInvokedClassification = {
	timeToFirstProgress: { classification: 'SystemMetaData'; purpose: 'PerformanceAndHealth'; comment: 'The time in milliseconds from invoking the provider to getting the first data.' };
	totalTime: { classification: 'SystemMetaData'; purpose: 'PerformanceAndHealth'; comment: 'The total time it took to run the provider\'s `provideResponseWithProgress`.' };
	result: { classification: 'SystemMetaData'; purpose: 'FeatureInsight'; comment: 'Whether invoking the ChatProvider resulted in an error.' };
	requestType: { classification: 'SystemMetaData'; purpose: 'FeatureInsight'; comment: 'The type of request that the user made.' };
	chatSessionId: { classification: 'SystemMetaData'; purpose: 'FeatureInsight'; comment: 'A random ID for the session.' };
	agent: { classification: 'SystemMetaData'; purpose: 'FeatureInsight'; comment: 'The type of agent used.' };
	slashCommand?: { classification: 'SystemMetaData'; purpose: 'FeatureInsight'; comment: 'The type of slashCommand used.' };
	location?: { classification: 'SystemMetaData'; purpose: 'FeatureInsight'; comment: 'The location at which chat request was made.' };
	owner: 'roblourens';
	comment: 'Provides insight into the performance of Chat agents.';
};

type ChatVoteEvent = {
	direction: 'up' | 'down';
	agentId: string;
};

type ChatVoteClassification = {
	direction: { classification: 'SystemMetaData'; purpose: 'FeatureInsight'; comment: 'Whether the user voted up or down.' };
	agentId: { classification: 'SystemMetaData'; purpose: 'FeatureInsight'; comment: 'The ID of the chat agent that this vote is for.' };
	owner: 'roblourens';
	comment: 'Provides insight into the performance of Chat agents.';
};

type ChatCopyEvent = {
	copyKind: 'action' | 'toolbar';
	agentId: string;
};

type ChatCopyClassification = {
	copyKind: { classification: 'SystemMetaData'; purpose: 'FeatureInsight'; comment: 'How the copy was initiated.' };
	agentId: { classification: 'SystemMetaData'; purpose: 'FeatureInsight'; comment: 'The ID of the chat agent that the copy acted on.' };
	owner: 'roblourens';
	comment: 'Provides insight into the usage of Chat features.';
};

type ChatInsertEvent = {
	newFile: boolean;
	agentId: string;
};

type ChatInsertClassification = {
	newFile: { classification: 'SystemMetaData'; purpose: 'FeatureInsight'; comment: 'Whether the code was inserted into a new untitled file.' };
	agentId: { classification: 'SystemMetaData'; purpose: 'FeatureInsight'; comment: 'The ID of the chat agent that this insertion is for.' };
	owner: 'roblourens';
	comment: 'Provides insight into the usage of Chat features.';
};

type ChatCommandEvent = {
	commandId: string;
	agentId: string;
};

type ChatCommandClassification = {
	commandId: { classification: 'SystemMetaData'; purpose: 'FeatureInsight'; comment: 'The id of the command that was executed.' };
	agentId: { classification: 'SystemMetaData'; purpose: 'FeatureInsight'; comment: 'The ID of the related chat agent.' };
	owner: 'roblourens';
	comment: 'Provides insight into the usage of Chat features.';
};

type ChatTerminalEvent = {
	languageId: string;
};

type ChatTerminalClassification = {
	languageId: { classification: 'SystemMetaData'; purpose: 'FeatureInsight'; comment: 'The language of the code that was run in the terminal.' };
	owner: 'roblourens';
	comment: 'Provides insight into the usage of Chat features.';
};

const maxPersistedSessions = 25;

export class ChatService extends Disposable implements IAideChatService {
	declare _serviceBrand: undefined;

	private readonly _sessionModels = this._register(new DisposableMap<string, ChatModel>());
	private readonly _pendingRequests = this._register(new DisposableMap<string, CancellationTokenSource>());
	private _persistedSessions: ISerializableChatsData;


	private _transferredSessionData: IChatTransferredSessionData | undefined;
	public get transferredSessionData(): IChatTransferredSessionData | undefined {
		return this._transferredSessionData;
	}

	private readonly _onDidPerformUserAction = this._register(new Emitter<IAideChatUserActionEvent>());
	public readonly onDidPerformUserAction: Event<IAideChatUserActionEvent> = this._onDidPerformUserAction.event;

	private readonly _onDidDisposeSession = this._register(new Emitter<{ sessionId: string; reason: 'initializationFailed' | 'cleared' }>());
	public readonly onDidDisposeSession = this._onDidDisposeSession.event;

	private readonly _sessionFollowupCancelTokens = this._register(new DisposableMap<string, CancellationTokenSource>());

	constructor(
		@IStorageService private readonly storageService: IStorageService,
		@ILogService private readonly logService: ILogService,
		@IExtensionService private readonly extensionService: IExtensionService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@ITelemetryService private readonly telemetryService: ITelemetryService,
		@IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService,
		@IAideChatSlashCommandService private readonly chatSlashCommandService: IAideChatSlashCommandService,
		@IAideChatVariablesService private readonly chatVariablesService: IAideChatVariablesService,
		@IAideChatAgentService private readonly chatAgentService: IAideChatAgentService,
	) {
		super();

		const sessionData = storageService.get(serializedChatKey, StorageScope.WORKSPACE, '');
		if (sessionData) {
			this._persistedSessions = this.deserializeChats(sessionData);
			const countsForLog = Object.keys(this._persistedSessions).length;
			if (countsForLog > 0) {
				this.trace('constructor', `Restored ${countsForLog} persisted sessions`);
			}
		} else {
			this._persistedSessions = {};
		}

		const transferredData = this.getTransferredSessionData();
		const transferredChat = transferredData?.chat;
		if (transferredChat) {
			this.trace('constructor', `Transferred session ${transferredChat.sessionId}`);
			this._persistedSessions[transferredChat.sessionId] = transferredChat;
			this._transferredSessionData = { sessionId: transferredChat.sessionId, inputValue: transferredData.inputValue };
		}

		this._register(storageService.onWillSaveState(() => this.saveState()));
	}

	isEnabled(location: AideChatAgentLocation): boolean {
		return this.chatAgentService.getContributedDefaultAgent(location) !== undefined;
	}

	private saveState(): void {
		let allSessions: (ChatModel | ISerializableChatData)[] = Array.from(this._sessionModels.values())
			.filter(session => session.initialLocation === AideChatAgentLocation.Panel)
			.filter(session => session.getRequests().length > 0);
		allSessions = allSessions.concat(
			Object.values(this._persistedSessions)
				.filter(session => !this._sessionModels.has(session.sessionId))
				.filter(session => session.requests.length));
		allSessions.sort((a, b) => (b.creationDate ?? 0) - (a.creationDate ?? 0));
		allSessions = allSessions.slice(0, maxPersistedSessions);
		if (allSessions.length) {
			this.trace('onWillSaveState', `Persisting ${allSessions.length} sessions`);
		}

		const serialized = JSON.stringify(allSessions);

		if (allSessions.length) {
			this.trace('onWillSaveState', `Persisting ${serialized.length} chars`);
		}

		this.storageService.store(serializedChatKey, serialized, StorageScope.WORKSPACE, StorageTarget.MACHINE);
	}

	notifyUserAction(action: IAideChatUserActionEvent): void {
		if (action.action.kind === 'vote') {
			this.telemetryService.publicLog2<ChatVoteEvent, ChatVoteClassification>('aideChatVote', {
				direction: action.action.direction === AideChatAgentVoteDirection.Up ? 'up' : 'down',
				agentId: action.agentId ?? ''
			});
		} else if (action.action.kind === 'copy') {
			this.telemetryService.publicLog2<ChatCopyEvent, ChatCopyClassification>('aideChatCopy', {
				copyKind: action.action.copyKind === ChatCopyKind.Action ? 'action' : 'toolbar',
				agentId: action.agentId ?? ''
			});
		} else if (action.action.kind === 'insert') {
			this.telemetryService.publicLog2<ChatInsertEvent, ChatInsertClassification>('aideChatInsert', {
				newFile: !!action.action.newFile,
				agentId: action.agentId ?? ''
			});
		} else if (action.action.kind === 'command') {
			// TODO not currently called
			const command = CommandsRegistry.getCommand(action.action.commandButton.command.id);
			const commandId = command ? action.action.commandButton.command.id : 'INVALID';
			this.telemetryService.publicLog2<ChatCommandEvent, ChatCommandClassification>('aideChatCommand', {
				commandId,
				agentId: action.agentId ?? ''
			});
		} else if (action.action.kind === 'runInTerminal') {
			this.telemetryService.publicLog2<ChatTerminalEvent, ChatTerminalClassification>('aideChatRunInTerminal', {
				languageId: action.action.languageId ?? ''
			});
		}

		this._onDidPerformUserAction.fire(action);
	}

	private trace(method: string, message?: string): void {
		if (message) {
			this.logService.trace(`ChatService#${method}: ${message}`);
		} else {
			this.logService.trace(`ChatService#${method}`);
		}
	}

	private error(method: string, message: string): void {
		this.logService.error(`ChatService#${method} ${message}`);
	}

	private deserializeChats(sessionData: string): ISerializableChatsData {
		try {
			const arrayOfSessions: ISerializableChatData[] = revive(JSON.parse(sessionData)); // Revive serialized URIs in session data
			if (!Array.isArray(arrayOfSessions)) {
				throw new Error('Expected array');
			}

			const sessions = arrayOfSessions.reduce<ISerializableChatsData>((acc, session) => {
				// Revive serialized markdown strings in response data
				for (const request of session.requests) {
					if (Array.isArray(request.response)) {
						request.response = request.response.map((response) => {
							if (typeof response === 'string') {
								return new MarkdownString(response);
							}
							return response;
						});
					} else if (typeof request.response === 'string') {
						request.response = [new MarkdownString(request.response)];
					}
				}

				acc[session.sessionId] = session;
				return acc;
			}, {});
			return sessions;
		} catch (err) {
			this.error('deserializeChats', `Malformed session data: ${err}. [${sessionData.substring(0, 20)}${sessionData.length > 20 ? '...' : ''}]`);
			return {};
		}
	}

	private getTransferredSessionData(): IChatTransfer | undefined {
		const data: IChatTransfer[] = this.storageService.getObject(globalChatKey, StorageScope.PROFILE, []);
		const workspaceUri = this.workspaceContextService.getWorkspace().folders[0]?.uri;
		if (!workspaceUri) {
			return;
		}

		const thisWorkspace = workspaceUri.toString();
		const currentTime = Date.now();
		// Only use transferred data if it was created recently
		const transferred = data.find(item => URI.revive(item.toWorkspace).toString() === thisWorkspace && (currentTime - item.timestampInMilliseconds < SESSION_TRANSFER_EXPIRATION_IN_MILLISECONDS));
		// Keep data that isn't for the current workspace and that hasn't expired yet
		const filtered = data.filter(item => URI.revive(item.toWorkspace).toString() !== thisWorkspace && (currentTime - item.timestampInMilliseconds < SESSION_TRANSFER_EXPIRATION_IN_MILLISECONDS));
		this.storageService.store(globalChatKey, JSON.stringify(filtered), StorageScope.PROFILE, StorageTarget.MACHINE);
		return transferred;
	}

	/**
	 * Returns an array of chat details for all persisted chat sessions that have at least one request.
	 * The array is sorted by creation date in descending order.
	 * Chat sessions that have already been loaded into the chat view are excluded from the result.
	 * Imported chat sessions are also excluded from the result.
	 */
	getHistory(): IChatDetail[] {
		const sessions = Object.values(this._persistedSessions)
			.filter(session => session.requests.length > 0);
		sessions.sort((a, b) => (b.creationDate ?? 0) - (a.creationDate ?? 0));

		return sessions
			.filter(session => !this._sessionModels.has(session.sessionId))
			.filter(session => !session.isImported)
			.map(item => {
				const title = ChatModel.getDefaultTitle(item.requests);
				return {
					sessionId: item.sessionId,
					title
				};
			});
	}

	removeHistoryEntry(sessionId: string): void {
		delete this._persistedSessions[sessionId];
		this.saveState();
	}

	clearAllHistoryEntries(): void {
		this._persistedSessions = {};
		this.saveState();
	}

	startSession(location: AideChatAgentLocation, token: CancellationToken): ChatModel {
		this.trace('startSession');
		return this._startSession(undefined, location, token);
	}

	private _startSession(someSessionHistory: IExportableChatData | ISerializableChatData | undefined, location: AideChatAgentLocation, token: CancellationToken): ChatModel {
		const model = this.instantiationService.createInstance(ChatModel, someSessionHistory, location);
		this._sessionModels.set(model.sessionId, model);
		this.initializeSession(model, token);
		return model;
	}

	private async initializeSession(model: ChatModel, token: CancellationToken): Promise<void> {
		try {
			this.trace('initializeSession', `Initialize session ${model.sessionId}`);
			model.startInitialize();

			await this.extensionService.whenInstalledExtensionsRegistered();
			const defaultAgentData = this.chatAgentService.getContributedDefaultAgent(model.initialLocation) ?? this.chatAgentService.getContributedDefaultAgent(AideChatAgentLocation.Panel);
			if (!defaultAgentData) {
				throw new ErrorNoTelemetry('No default agent contributed');
			}

			await this.extensionService.activateByEvent(`onChatParticipant:${defaultAgentData.id}`);

			const defaultAgent = this.chatAgentService.getActivatedAgents().find(agent => agent.id === defaultAgentData.id);
			if (!defaultAgent) {
				throw new ErrorNoTelemetry('No default agent registered');
			}
			const welcomeMessage = model.welcomeMessage ? undefined : await defaultAgent.provideWelcomeMessage?.(model.initialLocation, token) ?? undefined;
			const welcomeModel = welcomeMessage && this.instantiationService.createInstance(
				ChatWelcomeMessageModel,
				welcomeMessage.map(item => typeof item === 'string' ? new MarkdownString(item) : item),
				await defaultAgent.provideSampleQuestions?.(model.initialLocation, token) ?? []
			);

			model.initialize(welcomeModel);
		} catch (err) {
			this.trace('startSession', `initializeSession failed: ${err}`);
			model.setInitializationError(err);
			this._sessionModels.deleteAndDispose(model.sessionId);
			this._onDidDisposeSession.fire({ sessionId: model.sessionId, reason: 'initializationFailed' });
		}
	}

	getSession(sessionId: string): IChatModel | undefined {
		return this._sessionModels.get(sessionId);
	}

	getOrRestoreSession(sessionId: string): ChatModel | undefined {
		this.trace('getOrRestoreSession', `sessionId: ${sessionId}`);
		const model = this._sessionModels.get(sessionId);
		if (model) {
			return model;
		}

		const sessionData = revive<ISerializableChatData>(this._persistedSessions[sessionId]);
		if (!sessionData) {
			return undefined;
		}

		if (sessionId === this.transferredSessionData?.sessionId) {
			this._transferredSessionData = undefined;
		}

		return this._startSession(sessionData, sessionData.initialLocation ?? AideChatAgentLocation.Panel, CancellationToken.None);
	}

	loadSessionFromContent(data: IExportableChatData | ISerializableChatData): IChatModel | undefined {
		return this._startSession(data, data.initialLocation ?? AideChatAgentLocation.Panel, CancellationToken.None);
	}

	async resendRequest(request: IChatRequestModel, options?: IChatSendRequestOptions): Promise<void> {
		const model = this._sessionModels.get(request.session.sessionId);
		if (!model && model !== request.session) {
			throw new Error(`Unknown session: ${request.session.sessionId}`);
		}

		await model.waitForInitialization();

		const cts = this._pendingRequests.get(request.session.sessionId);
		if (cts) {
			this.trace('resendRequest', `Session ${request.session.sessionId} already has a pending request, cancelling...`);
			cts.cancel();
		}

		const location = options?.location ?? model.initialLocation;
		const attempt = options?.attempt ?? 0;
		const enableCommandDetection = !options?.noCommandDetection;
		const defaultAgent = this.chatAgentService.getDefaultAgent(location)!;

		model.removeRequest(request.id, ChatRequestRemovalReason.Resend);

		await this._sendRequestAsync(model, model.sessionId, request.message, attempt, enableCommandDetection, defaultAgent, location, options).responseCompletePromise;
	}

	async sendRequest(sessionId: string, request: string, options?: IChatSendRequestOptions): Promise<IChatSendRequestData | undefined> {

		this.trace('sendRequest', `sessionId: ${sessionId}, message: ${request.substring(0, 20)}${request.length > 20 ? '[...]' : ''}}`);
		if (!request.trim()) {
			this.trace('sendRequest', 'Rejected empty message');
			return;
		}

		const model = this._sessionModels.get(sessionId);
		if (!model) {
			throw new Error(`Unknown session: ${sessionId}`);
		}

		await model.waitForInitialization();

		if (this._pendingRequests.has(sessionId)) {
			this.trace('sendRequest', `Session ${sessionId} already has a pending request`);
			return;
		}

		const location = options?.location ?? model.initialLocation;
		const attempt = options?.attempt ?? 0;
		const defaultAgent = this.chatAgentService.getDefaultAgent(location)!;

		const parsedRequest = this.parseChatRequest(sessionId, request, location, options);
		const agent = parsedRequest.parts.find((r): r is ChatRequestAgentPart => r instanceof ChatRequestAgentPart)?.agent ?? defaultAgent;
		const agentSlashCommandPart = parsedRequest.parts.find((r): r is ChatRequestAgentSubcommandPart => r instanceof ChatRequestAgentSubcommandPart);

		// This method is only returning whether the request was accepted - don't block on the actual request
		return {
			...this._sendRequestAsync(model, sessionId, parsedRequest, attempt, !options?.noCommandDetection, defaultAgent, location, options),
			agent,
			slashCommand: agentSlashCommandPart?.command,
		};
	}

	private parseChatRequest(sessionId: string, request: string, location: AideChatAgentLocation, options: IChatSendRequestOptions | undefined): IParsedChatRequest {
		let parserContext = options?.parserContext;
		if (options?.agentId) {
			const agent = this.chatAgentService.getAgent(options.agentId);
			if (!agent) {
				throw new Error(`Unknown agent: ${options.agentId}`);
			}
			parserContext = { selectedAgent: agent };
			const commandPart = options.slashCommand ? ` ${chatSubcommandLeader}${options.slashCommand}` : '';
			request = `${chatAgentLeader}${agent.name}${commandPart} ${request}`;
		}

		const parsedRequest = this.instantiationService.createInstance(ChatRequestParser).parseChatRequest(sessionId, request, location, parserContext);
		return parsedRequest;
	}

	private refreshFollowupsCancellationToken(sessionId: string): CancellationToken {
		this._sessionFollowupCancelTokens.get(sessionId)?.cancel();
		const newTokenSource = new CancellationTokenSource();
		this._sessionFollowupCancelTokens.set(sessionId, newTokenSource);

		return newTokenSource.token;
	}

	private _sendRequestAsync(model: ChatModel, sessionId: string, parsedRequest: IParsedChatRequest, attempt: number, enableCommandDetection: boolean, defaultAgent: IChatAgent, location: AideChatAgentLocation, options?: IChatSendRequestOptions): IChatSendRequestResponseState {
		const followupsCancelToken = this.refreshFollowupsCancellationToken(sessionId);
		let request: ChatRequestModel;
		const agentPart = 'kind' in parsedRequest ? undefined : parsedRequest.parts.find((r): r is ChatRequestAgentPart => r instanceof ChatRequestAgentPart);
		const agentSlashCommandPart = 'kind' in parsedRequest ? undefined : parsedRequest.parts.find((r): r is ChatRequestAgentSubcommandPart => r instanceof ChatRequestAgentSubcommandPart);
		const commandPart = 'kind' in parsedRequest ? undefined : parsedRequest.parts.find((r): r is ChatRequestSlashCommandPart => r instanceof ChatRequestSlashCommandPart);

		let gotProgress = false;
		const requestType = commandPart ? 'slashCommand' : 'string';

		const responseCreated = new DeferredPromise<IChatResponseModel>();
		let responseCreatedComplete = false;
		function completeResponseCreated(): void {
			if (!responseCreatedComplete && request?.response) {
				responseCreated.complete(request.response);
				responseCreatedComplete = true;
			}
		}

		const source = new CancellationTokenSource();
		const token = source.token;
		const sendRequestInternal = async () => {
			const progressCallback = (progress: IAideChatProgress) => {
				if (token.isCancellationRequested) {
					return;
				}

				gotProgress = true;

				if (progress.kind === 'markdownContent') {
					this.trace('sendRequest', `Provider returned progress for session ${model.sessionId}, ${progress.content.value.length} chars`);
				} else {
					this.trace('sendRequest', `Provider returned progress: ${JSON.stringify(progress)}`);
				}

				model.acceptResponseProgress(request, progress);
				completeResponseCreated();
			};

			const stopWatch = new StopWatch(false);
			const listener = token.onCancellationRequested(() => {
				this.trace('sendRequest', `Request for session ${model.sessionId} was cancelled`);
				this.telemetryService.publicLog2<ChatProviderInvokedEvent, ChatProviderInvokedClassification>('aideChatProviderInvoked', {
					timeToFirstProgress: undefined,
					// Normally timings happen inside the EH around the actual provider. For cancellation we can measure how long the user waited before cancelling
					totalTime: stopWatch.elapsed(),
					result: 'cancelled',
					requestType,
					agent: agentPart?.agent.id ?? '',
					slashCommand: agentSlashCommandPart ? agentSlashCommandPart.command.name : commandPart?.slashCommand.command,
					chatSessionId: model.sessionId,
					location,
				});

				model.cancelRequest(request);
			});

			try {
				let rawResult: IAideChatAgentResult | null | undefined;
				let agentOrCommandFollowups: Promise<IAideChatFollowup[] | undefined> | undefined = undefined;

				if (agentPart || (defaultAgent && !commandPart)) {
					const agent = (agentPart?.agent ?? defaultAgent)!;
					await this.extensionService.activateByEvent(`onChatParticipant:${agent.id}`);
					const history = getHistoryEntriesFromModel(model, agentPart?.agent.id);

					const initVariableData: IChatRequestVariableData = { variables: [] };
					request = model.addRequest(parsedRequest, initVariableData, attempt, agent, agentSlashCommandPart?.command);
					completeResponseCreated();
					const variableData = await this.chatVariablesService.resolveVariables(parsedRequest, options?.attachedContext, model, progressCallback, token);
					request.variableData = variableData;

					const promptTextResult = getPromptText(request.message);
					const updatedVariableData = updateRanges(variableData, promptTextResult.diff); // TODO bit of a hack

					// TODO- should figure out how to get rid of implicit variables for inline chat
					const implicitVariablesEnabled = (location === AideChatAgentLocation.Editor || location === AideChatAgentLocation.Notebook);
					if (implicitVariablesEnabled) {
						const implicitVariables = agent.defaultImplicitVariables;
						if (implicitVariables) {
							const resolvedImplicitVariables = await Promise.all(implicitVariables.map(async v => {
								const id = this.chatVariablesService.getVariable(v)?.id ?? '';
								const value = await this.chatVariablesService.resolveVariable(v, parsedRequest.text, model, progressCallback, token);
								return value ? { id, name: v, value } satisfies IAideChatRequestVariableEntry :
									undefined;
							}));
							updatedVariableData.variables.push(...coalesce(resolvedImplicitVariables));
						}
					}

					const requestProps: IAideChatAgentRequest = {
						sessionId,
						requestId: request.id,
						agentId: agent.id,
						message: promptTextResult.message,
						command: agentSlashCommandPart?.command.name,
						variables: updatedVariableData,
						enableCommandDetection,
						attempt,
						location,
						acceptedConfirmationData: options?.acceptedConfirmationData,
						rejectedConfirmationData: options?.rejectedConfirmationData,
					};

					const agentResult = await this.chatAgentService.invokeAgent(agent.id, requestProps, progressCallback, history, token);
					rawResult = agentResult;
					agentOrCommandFollowups = this.chatAgentService.getFollowups(agent.id, requestProps, agentResult, history, followupsCancelToken);
				} else if (commandPart && this.chatSlashCommandService.hasCommand(commandPart.slashCommand.command)) {
					request = model.addRequest(parsedRequest, { variables: [] }, attempt);
					completeResponseCreated();
					// contributed slash commands
					// TODO: spell this out in the UI
					const history: IAideChatMessage[] = [];
					for (const request of model.getRequests()) {
						if (!request.response) {
							continue;
						}
						history.push({ role: AideChatMessageRole.User, content: { type: 'text', value: request.message.text } });
						history.push({ role: AideChatMessageRole.Assistant, content: { type: 'text', value: request.response.response.asString() } });
					}
					const message = parsedRequest.text;
					const commandResult = await this.chatSlashCommandService.executeCommand(commandPart.slashCommand.command, message.substring(commandPart.slashCommand.command.length + 1).trimStart(), new Progress<IAideChatProgress>(p => {
						progressCallback(p);
					}), history, token);
					agentOrCommandFollowups = Promise.resolve(commandResult?.followUp);
					rawResult = {};

				} else {
					throw new Error(`Cannot handle request`);
				}

				if (token.isCancellationRequested) {
					return;
				} else {
					if (!rawResult) {
						this.trace('sendRequest', `Provider returned no response for session ${model.sessionId}`);
						rawResult = { errorDetails: { message: localize('emptyResponse', "Provider returned null response") } };
					}

					const result = rawResult.errorDetails?.responseIsFiltered ? 'filtered' :
						rawResult.errorDetails && gotProgress ? 'errorWithOutput' :
							rawResult.errorDetails ? 'error' :
								'success';
					this.telemetryService.publicLog2<ChatProviderInvokedEvent, ChatProviderInvokedClassification>('aideChatProviderInvoked', {
						timeToFirstProgress: rawResult.timings?.firstProgress,
						totalTime: rawResult.timings?.totalElapsed,
						result,
						requestType,
						agent: agentPart?.agent.id ?? '',
						slashCommand: agentSlashCommandPart ? agentSlashCommandPart.command.name : commandPart?.slashCommand.command,
						chatSessionId: model.sessionId,
						location
					});
					model.setResponse(request, rawResult);
					completeResponseCreated();
					this.trace('sendRequest', `Provider returned response for session ${model.sessionId}`);

					model.completeResponse(request);
					if (agentOrCommandFollowups) {
						agentOrCommandFollowups.then(followups => {
							model.setFollowups(request, followups);
						});
					}
				}
			} catch (err) {
				const result = 'error';
				this.telemetryService.publicLog2<ChatProviderInvokedEvent, ChatProviderInvokedClassification>('aideChatProviderInvoked', {
					timeToFirstProgress: undefined,
					totalTime: undefined,
					result,
					requestType,
					agent: agentPart?.agent.id ?? '',
					slashCommand: agentSlashCommandPart ? agentSlashCommandPart.command.name : commandPart?.slashCommand.command,
					chatSessionId: model.sessionId,
					location
				});
				this.logService.error(`Error while handling chat request: ${toErrorMessage(err, true)}`);
				if (request) {
					const rawResult: IAideChatAgentResult = { errorDetails: { message: err.message } };
					model.setResponse(request, rawResult);
					completeResponseCreated();
					model.completeResponse(request);
				}
			} finally {
				listener.dispose();
			}
		};
		const rawResponsePromise = sendRequestInternal();
		this._pendingRequests.set(model.sessionId, source);
		rawResponsePromise.finally(() => {
			this._pendingRequests.deleteAndDispose(model.sessionId);
		});
		return {
			responseCreatedPromise: responseCreated.p,
			responseCompletePromise: rawResponsePromise,
		};
	}

	async removeRequest(sessionId: string, requestId: string): Promise<void> {
		const model = this._sessionModels.get(sessionId);
		if (!model) {
			throw new Error(`Unknown session: ${sessionId}`);
		}

		await model.waitForInitialization();

		model.removeRequest(requestId);
	}

	async adoptRequest(sessionId: string, request: IChatRequestModel) {
		if (!(request instanceof ChatRequestModel)) {
			throw new TypeError('Can only adopt requests of type ChatRequestModel');
		}
		const target = this._sessionModels.get(sessionId);
		if (!target) {
			throw new Error(`Unknown session: ${sessionId}`);
		}

		await target.waitForInitialization();

		const oldOwner = request.session;
		target.adoptRequest(request);

		if (request.response && !request.response.isComplete) {
			const cts = this._pendingRequests.deleteAndLeak(oldOwner.sessionId);
			if (cts) {
				this._pendingRequests.set(target.sessionId, cts);
			}
		}
	}

	async addCompleteRequest(sessionId: string, message: IParsedChatRequest | string, variableData: IChatRequestVariableData | undefined, attempt: number | undefined, response: IChatCompleteResponse): Promise<void> {
		this.trace('addCompleteRequest', `message: ${message}`);

		const model = this._sessionModels.get(sessionId);
		if (!model) {
			throw new Error(`Unknown session: ${sessionId}`);
		}

		await model.waitForInitialization();
		const parsedRequest = typeof message === 'string' ?
			this.instantiationService.createInstance(ChatRequestParser).parseChatRequest(sessionId, message) :
			message;
		const request = model.addRequest(parsedRequest, variableData || { variables: [] }, attempt ?? 0);
		if (typeof response.message === 'string') {
			// TODO is this possible?
			model.acceptResponseProgress(request, { content: new MarkdownString(response.message), kind: 'markdownContent' });
		} else {
			for (const part of response.message) {
				model.acceptResponseProgress(request, part, true);
			}
		}
		model.setResponse(request, response.result || {});
		if (response.followups !== undefined) {
			model.setFollowups(request, response.followups);
		}
		model.completeResponse(request);
	}

	cancelCurrentRequestForSession(sessionId: string): void {
		this.trace('cancelCurrentRequestForSession', `sessionId: ${sessionId}`);
		this._pendingRequests.get(sessionId)?.cancel();
		this._pendingRequests.deleteAndDispose(sessionId);
	}

	clearSession(sessionId: string): void {
		this.trace('clearSession', `sessionId: ${sessionId}`);
		const model = this._sessionModels.get(sessionId);
		if (!model) {
			throw new Error(`Unknown session: ${sessionId}`);
		}

		if (model.initialLocation === AideChatAgentLocation.Panel) {
			// Turn all the real objects into actual JSON, otherwise, calling 'revive' may fail when it tries to
			// assign values to properties that are getters- microsoft/vscode-copilot-release#1233
			this._persistedSessions[sessionId] = JSON.parse(JSON.stringify(model));
		}

		this._sessionModels.deleteAndDispose(sessionId);
		this._pendingRequests.get(sessionId)?.cancel();
		this._pendingRequests.deleteAndDispose(sessionId);
		this._onDidDisposeSession.fire({ sessionId, reason: 'cleared' });
	}

	public hasSessions(): boolean {
		return !!Object.values(this._persistedSessions);
	}

	transferChatSession(transferredSessionData: IChatTransferredSessionData, toWorkspace: URI): void {
		const model = Iterable.find(this._sessionModels.values(), model => model.sessionId === transferredSessionData.sessionId);
		if (!model) {
			throw new Error(`Failed to transfer session. Unknown session ID: ${transferredSessionData.sessionId}`);
		}

		const existingRaw: IChatTransfer[] = this.storageService.getObject(globalChatKey, StorageScope.PROFILE, []);
		existingRaw.push({
			chat: model.toJSON(),
			timestampInMilliseconds: Date.now(),
			toWorkspace: toWorkspace,
			inputValue: transferredSessionData.inputValue,
		});

		this.storageService.store(globalChatKey, JSON.stringify(existingRaw), StorageScope.PROFILE, StorageTarget.MACHINE);
		this.trace('transferChatSession', `Transferred session ${model.sessionId} to workspace ${toWorkspace.toString()}`);
	}
}
