/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { DeferredPromise } from '../../../../base/common/async.js';
import { CancellationToken, CancellationTokenSource } from '../../../../base/common/cancellation.js';
import { toErrorMessage } from '../../../../base/common/errorMessage.js';
import { ErrorNoTelemetry } from '../../../../base/common/errors.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { MarkdownString } from '../../../../base/common/htmlContent.js';
import { Iterable } from '../../../../base/common/iterator.js';
import { Disposable, DisposableMap, IDisposable } from '../../../../base/common/lifecycle.js';
import { revive } from '../../../../base/common/marshalling.js';
import { URI, UriComponents } from '../../../../base/common/uri.js';
import { localize } from '../../../../nls.js';
import { AgentMode } from '../../../../platform/aideAgent/common/model.js';
import { ICSAccountService } from '../../../../platform/codestoryAccount/common/csAccount.js';
import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { IWorkbenchAssignmentService } from '../../../services/assignment/common/assignmentService.js';
import { IExtensionService } from '../../../services/extensions/common/extensions.js';
import { IRageShakeService } from '../../../services/rageShake/common/rageShake.js';
import { ChatAgentLocation, IAideAgentAgentService, IChatAgent, IChatAgentCommand, IChatAgentData, IChatAgentRequest, IChatAgentResult } from './aideAgentAgents.js';
import { CONTEXT_VOTE_UP_ENABLED } from './aideAgentContextKeys.js';
import { AgentScope, ChatModel, ChatRequestModel, ChatResponseModel, IChatModel, IChatRequestVariableData, IChatResponseModel, IExportableChatData, ISerializableChatData, ISerializableChatDataIn, ISerializableChatsData, updateRanges } from './aideAgentModel.js';
import { ChatRequestAgentPart, ChatRequestAgentSubcommandPart, ChatRequestSlashCommandPart, IParsedChatRequest, chatAgentLeader, chatSubcommandLeader, getPromptText } from './aideAgentParserTypes.js';
import { ChatRequestParser } from './aideAgentRequestParser.js';
import { IAideAgentService, IChatCompleteResponse, IChatDetail, IChatFollowup, IChatProgress, IChatSendRequestData, IChatSendRequestOptions, IChatSendRequestResponseState, IChatTransferredSessionData, IChatUserActionEvent } from './aideAgentService.js';
import { ChatServiceTelemetry } from './aideAgentServiceTelemetry.js';
import { IAideAgentSlashCommandService } from './aideAgentSlashCommands.js';
import { IAideAgentVariablesService } from './aideAgentVariables.js';

const serializedChatKey = 'aide.sessions';

const globalChatKey = 'chat.workspaceTransfer';
interface IChatTransfer {
	toWorkspace: UriComponents;
	timestampInMilliseconds: number;
	chat: ISerializableChatData;
	inputValue: string;
}
const SESSION_TRANSFER_EXPIRATION_IN_MILLISECONDS = 1000 * 60;


const maxPersistedSessions = 25;

class CancellableExchange implements IDisposable {
	constructor(
		public readonly cancellationTokenSource: CancellationTokenSource,
		public exchangeId?: string | undefined
	) { }

	dispose() {
		this.cancellationTokenSource.dispose();
	}

	cancel() {
		this.cancellationTokenSource.cancel();
	}
}

const allowedProgressWhenCanceling = new Set<IChatProgress['kind']>(['endResponse', 'stage']);

export class ChatService extends Disposable implements IAideAgentService {
	declare _serviceBrand: undefined;

	private readonly _sessionModels = this._register(new DisposableMap<string, ChatModel>());
	// TODO(@ghostwriternr): Does this continue to make sense? How do we interpret 'pending requests' when we're no longer using a request-response model?
	private readonly _pendingExchanges = this._register(new DisposableMap<string, CancellableExchange>());
	private _persistedSessions: ISerializableChatsData;

	private _lastExchangeId: string | undefined;
	get lastExchangeId(): string | undefined {
		return this._lastExchangeId;
	}

	/** Just for empty windows, need to enforce that a chat was deleted, even though other windows still have it */
	private _deletedChatIds = new Set<string>();

	private _transferredSessionData: IChatTransferredSessionData | undefined;
	public get transferredSessionData(): IChatTransferredSessionData | undefined {
		return this._transferredSessionData;
	}

	private readonly _onDidPerformUserAction = this._register(new Emitter<IChatUserActionEvent>());
	public readonly onDidPerformUserAction: Event<IChatUserActionEvent> = this._onDidPerformUserAction.event;

	private readonly _onDidDisposeSession = this._register(new Emitter<{ sessionId: string; reason: 'initializationFailed' | 'cleared' }>());
	public readonly onDidDisposeSession = this._onDidDisposeSession.event;

	private readonly _sessionFollowupCancelTokens = this._register(new DisposableMap<string, CancellationTokenSource>());
	private readonly _chatServiceTelemetry: ChatServiceTelemetry;

	constructor(
		@IStorageService private readonly storageService: IStorageService,
		@ILogService private readonly logService: ILogService,
		@IExtensionService private readonly extensionService: IExtensionService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService,
		@IAideAgentSlashCommandService private readonly chatSlashCommandService: IAideAgentSlashCommandService,
		@IAideAgentVariablesService private readonly chatVariablesService: IAideAgentVariablesService,
		@IAideAgentAgentService private readonly chatAgentService: IAideAgentAgentService,
		@ICSAccountService private readonly csAccountService: ICSAccountService,
		@IRageShakeService private readonly rageShakeService: IRageShakeService,
		@IWorkbenchAssignmentService workbenchAssignmentService: IWorkbenchAssignmentService,
		@IContextKeyService contextKeyService: IContextKeyService,
	) {
		super();

		this._chatServiceTelemetry = this.instantiationService.createInstance(ChatServiceTelemetry);
		const isEmptyWindow = !workspaceContextService.getWorkspace().folders.length;
		const sessionData = storageService.get(serializedChatKey, isEmptyWindow ? StorageScope.APPLICATION : StorageScope.WORKSPACE, '');
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

		const voteUpEnabled = CONTEXT_VOTE_UP_ENABLED.bindTo(contextKeyService);
		workbenchAssignmentService.getTreatment('chatVoteUpEnabled')
			.then(value => voteUpEnabled.set(!!value));
	}

	isEnabled(location: ChatAgentLocation): boolean {
		return this.chatAgentService.getContributedDefaultAgent(location) !== undefined;
	}

	private saveState(): void {
		const liveChats = Array.from(this._sessionModels.values())
			.filter(session => session.initialLocation === ChatAgentLocation.Panel)
			.filter(session => session.getExchanges().length > 0);

		const isEmptyWindow = !this.workspaceContextService.getWorkspace().folders.length;
		if (isEmptyWindow) {
			this.syncEmptyWindowChats(liveChats);
		} else {
			let allSessions: (ChatModel | ISerializableChatData)[] = liveChats;
			allSessions = allSessions.concat(
				Object.values(this._persistedSessions)
					.filter(session => !this._sessionModels.has(session.sessionId))
					.filter(session => session.exchanges.length));
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

		this._deletedChatIds.clear();
	}

	private syncEmptyWindowChats(thisWindowChats: ChatModel[]): void {
		// Note- an unavoidable race condition exists here. If there are multiple empty windows open, and the user quits the application, then the focused
		// window may lose active chats, because all windows are reading and writing to storageService at the same time. This can't be fixed without some
		// kind of locking, but in reality, the focused window will likely have run `saveState` at some point, like on a window focus change, and it will
		// generally be fine.
		const sessionData = this.storageService.get(serializedChatKey, StorageScope.APPLICATION, '');

		const originalPersistedSessions = this._persistedSessions;
		let persistedSessions: ISerializableChatsData;
		if (sessionData) {
			persistedSessions = this.deserializeChats(sessionData);
			const countsForLog = Object.keys(persistedSessions).length;
			if (countsForLog > 0) {
				this.trace('constructor', `Restored ${countsForLog} persisted sessions`);
			}
		} else {
			persistedSessions = {};
		}

		this._deletedChatIds.forEach(id => delete persistedSessions[id]);

		// Has the chat in this window been updated, and then closed? Overwrite the old persisted chats.
		Object.values(originalPersistedSessions).forEach(session => {
			const persistedSession = persistedSessions[session.sessionId];
			if (persistedSession && session.exchanges.length > persistedSession.exchanges.length) {
				// We will add a 'modified date' at some point, but comparing the number of requests is good enough
				persistedSessions[session.sessionId] = session;
			} else if (!persistedSession && session.isNew) {
				// This session was created in this window, and hasn't been persisted yet
				session.isNew = false;
				persistedSessions[session.sessionId] = session;
			}
		});

		this._persistedSessions = persistedSessions;

		// Add this window's active chat models to the set to persist.
		// Having the same session open in two empty windows at the same time can lead to data loss, this is acceptable
		const allSessions: Record<string, ISerializableChatData | ChatModel> = { ...this._persistedSessions };
		for (const chat of thisWindowChats) {
			allSessions[chat.sessionId] = chat;
		}

		let sessionsList = Object.values(allSessions);
		sessionsList.sort((a, b) => (b.creationDate ?? 0) - (a.creationDate ?? 0));
		sessionsList = sessionsList.slice(0, maxPersistedSessions);
		const data = JSON.stringify(sessionsList);
		this.storageService.store(serializedChatKey, data, StorageScope.APPLICATION, StorageTarget.MACHINE);
	}

	notifyUserAction(action: IChatUserActionEvent): void {
		this._chatServiceTelemetry.notifyUserAction(action);
		this._onDidPerformUserAction.fire(action);
	}

	setChatSessionTitle(sessionId: string, title: string): void {
		const model = this._sessionModels.get(sessionId);
		if (model) {
			model.setCustomTitle(title);
			return;
		}

		const session = this._persistedSessions[sessionId];
		if (session) {
			session.customTitle = title;
		}
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
			const arrayOfSessions: ISerializableChatDataIn[] = revive(JSON.parse(sessionData)); // Revive serialized URIs in session data
			if (!Array.isArray(arrayOfSessions)) {
				throw new Error('Expected array');
			}

			const sessions = arrayOfSessions.reduce<ISerializableChatsData>((acc, session) => {
				// Revive serialized markdown strings in response data
				for (const exchange of session.exchanges) {

					if (exchange.type === 'response') {
						if (Array.isArray(exchange.response)) {
							exchange.response = exchange.response.map((response) => {
								if (typeof response === 'string') {
									return new MarkdownString(response);
								}
								return response;
							});
						} else if (typeof exchange.response === 'string') {
							exchange.response = [new MarkdownString(exchange.response)];
						}
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
		const persistedSessions = Object.values(this._persistedSessions)
			.filter(session => session.exchanges.length > 0)
			.filter(session => !this._sessionModels.has(session.sessionId));

		const persistedSessionItems = persistedSessions
			.filter(session => !session.isImported)
			.map(session => {
				const title = session.customTitle ?? ChatModel.getDefaultTitle(session.exchanges);
				return {
					sessionId: session.sessionId,
					title,
					lastMessageDate: session.lastMessageDate,
					isActive: false,
				} satisfies IChatDetail;
			});
		const liveSessionItems = Array.from(this._sessionModels.values())
			.filter(session => !session.isImported)
			.map(session => {
				const title = session.title || localize('newChat', "New Chat");
				return {
					sessionId: session.sessionId,
					title,
					lastMessageDate: session.lastMessageDate,
					isActive: true,
				} satisfies IChatDetail;
			});
		return [...liveSessionItems, ...persistedSessionItems];
	}

	removeHistoryEntry(sessionId: string): void {
		if (this._persistedSessions[sessionId]) {
			this._deletedChatIds.add(sessionId);
			delete this._persistedSessions[sessionId];
			this.saveState();
		}
	}

	clearAllHistoryEntries(): void {
		Object.values(this._persistedSessions).forEach(session => this._deletedChatIds.add(session.sessionId));
		this._persistedSessions = {};
		this.saveState();
	}

	startSession(location: ChatAgentLocation, token: CancellationToken, isPassthrough: boolean = false): ChatModel {
		this.trace('startSession');
		return this._startSession(undefined, location, isPassthrough, token);
	}

	private _startSession(someSessionHistory: IExportableChatData | ISerializableChatData | undefined, location: ChatAgentLocation, isPassthrough: boolean, token: CancellationToken): ChatModel {
		const model = this.instantiationService.createInstance(ChatModel, someSessionHistory, location, isPassthrough);
		this._sessionModels.set(model.sessionId, model);
		this.rageShakeService.setActiveSessionId(model.sessionId);
		this.initializeSession(model, token);
		return model;
	}

	private progressCallback(model: ChatModel, response: ChatResponseModel | undefined, progress: IChatProgress, token: CancellationToken): void {
		// @g-danna I added this to close the response visually even when a cancellation token has been requested
		if (!allowedProgressWhenCanceling.has(progress.kind) && token.isCancellationRequested) {
			return;
		}

		if (progress.kind === 'endResponse' && response) {
			model.completeResponse(response);
			return;
		}

		if (progress.kind === 'markdownContent') {
			this.trace('sendRequest', `Provider returned progress for session ${model.sessionId}, ${progress.content.value.length} chars`);
		} else {
			this.trace('sendRequest', `Provider returned progress: ${JSON.stringify(progress)}`);
		}

		model.acceptResponseProgress(response, progress);
	}

	private async initializeSession(model: ChatModel, token: CancellationToken): Promise<void> {
		try {
			this.trace('initializeSession', `Initialize session ${model.sessionId}`);
			model.startInitialize();

			await this.extensionService.whenInstalledExtensionsRegistered();
			const defaultAgentData = this.chatAgentService.getContributedDefaultAgent(model.initialLocation) ?? this.chatAgentService.getContributedDefaultAgent(ChatAgentLocation.Panel);
			if (!defaultAgentData) {
				throw new ErrorNoTelemetry('No default agent contributed');
			}

			await this.extensionService.activateByEvent(`onAideAgent:${defaultAgentData.id}`);

			const defaultAgent = this.chatAgentService.getActivatedAgents().find(agent => agent.id === defaultAgentData.id);
			if (!defaultAgent) {
				throw new ErrorNoTelemetry('No default agent registered');
			}

			if (!model.isPassthrough) {
				this.chatAgentService.initSession(defaultAgent.id, model.sessionId);
			}

			const welcomeMessage = await defaultAgent.provideWelcomeMessage?.(token) ?? undefined;
			model.initialize(welcomeMessage);
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
		// Sets the current active session for rage shake telemetry
		this.rageShakeService.setActiveSessionId(sessionId);
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

		return this._startSession(sessionData, sessionData.initialLocation ?? ChatAgentLocation.Panel, false, CancellationToken.None);
	}

	loadSessionFromContent(data: IExportableChatData | ISerializableChatData): IChatModel | undefined {
		return this._startSession(data, data.initialLocation ?? ChatAgentLocation.Panel, false, CancellationToken.None);
	}

	/* TODO(@ghostwriternr): This method already seems unused. Remove it?
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

		const resendOptions: IChatSendRequestOptions = {
			...options,
			locationData: request.locationData,
			attachedContext: request.attachedContext,
		};
		await this._sendRequestAsync(model, model.sessionId, request.message, attempt, enableCommandDetection, defaultAgent, location, resendOptions).responseCompletePromise;
	}
	*/

	async sendRequest(sessionId: string, request: string, options?: IChatSendRequestOptions): Promise<IChatSendRequestData | undefined> {
		this.trace('sendRequest', `sessionId: ${sessionId}, message: ${request.substring(0, 20)}${request.length > 20 ? '[...]' : ''}}`);
		if (!request.trim() && !options?.slashCommand && !options?.agentId) {
			this.trace('sendRequest', 'Rejected empty message');
			return;
		}

		const model = this._sessionModels.get(sessionId);
		if (!model) {
			throw new Error(`Unknown session: ${sessionId}`);
		}

		await model.waitForInitialization();

		/* TODO(@ghostwriternr): This is perhaps essential if we can't process requests in parallel. Think about this again when it becomes a problem.
		if (this._pendingRequests.has(sessionId)) {
			this.trace('sendRequest', `Session ${sessionId} already has a pending request`);
			return;
		}
		*/

		const location = options?.location ?? model.initialLocation;
		const attempt = options?.attempt ?? 0;
		const defaultAgent = this.chatAgentService.getDefaultAgent(location)!;

		const parsedRequest = this.parseChatRequest(sessionId, request, location, options);
		const agent = parsedRequest.parts.find((r): r is ChatRequestAgentPart => r instanceof ChatRequestAgentPart)?.agent ?? defaultAgent;
		const agentSlashCommandPart = parsedRequest.parts.find((r): r is ChatRequestAgentSubcommandPart => r instanceof ChatRequestAgentSubcommandPart);

		const authorized = await this.csAccountService.ensureAuthorized();
		if (!authorized) {
			return;
		}

		// This method is only returning whether the request was accepted - don't block on the actual request
		return {
			...this._sendRequestAsync(model, sessionId, parsedRequest, attempt, !options?.noCommandDetection, defaultAgent, location, options),
			agent,
			slashCommand: agentSlashCommandPart?.command,
		};
	}

	private parseChatRequest(sessionId: string, request: string, location: ChatAgentLocation, options: IChatSendRequestOptions | undefined): IParsedChatRequest {
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

	private _sendRequestAsync(model: ChatModel, sessionId: string, parsedRequest: IParsedChatRequest, attempt: number, enableCommandDetection: boolean, defaultAgent: IChatAgent, location: ChatAgentLocation, options?: IChatSendRequestOptions): IChatSendRequestResponseState {
		const followupsCancelToken = this.refreshFollowupsCancellationToken(sessionId);
		let request: ChatRequestModel;
		const agentPart = 'kind' in parsedRequest ? undefined : parsedRequest.parts.find((r): r is ChatRequestAgentPart => r instanceof ChatRequestAgentPart);
		const agentSlashCommandPart = 'kind' in parsedRequest ? undefined : parsedRequest.parts.find((r): r is ChatRequestAgentSubcommandPart => r instanceof ChatRequestAgentSubcommandPart);
		const commandPart = 'kind' in parsedRequest ? undefined : parsedRequest.parts.find((r): r is ChatRequestSlashCommandPart => r instanceof ChatRequestSlashCommandPart);

		const responseCreated = new DeferredPromise<IChatResponseModel>();
		// let responseCreatedComplete = false;
		function completeResponseCreated(): void {
			/* TODO(@ghostwriternr): Debug this when something breaks (this comment sounds useless because I don't yet know what will break, I just know something will)
			if (!responseCreatedComplete && request?.response) {
				responseCreated.complete(request.response);
				responseCreatedComplete = true;
			}
			*/
		}

		const source = new CancellationTokenSource();
		const token = source.token;
		const sendRequestInternal = async () => {
			let detectedAgent: IChatAgentData | undefined;
			let detectedCommand: IChatAgentCommand | undefined;

			const listener = token.onCancellationRequested(() => {
				this.trace('sendRequest', `Request for session ${model.sessionId} was cancelled`);
				// TODO(@ghostwriternr): How should a user cancel a request in the async response world? Revisit this.
				// model.cancelRequest(request);
			});

			try {
				let rawResult: IChatAgentResult | null | undefined;
				let agentOrCommandFollowups: Promise<IChatFollowup[] | undefined> | undefined = undefined;
				let chatTitlePromise: Promise<string | undefined> | undefined;

				if (agentPart || (defaultAgent && !commandPart)) {
					const prepareChatAgentRequest = async (agent: IChatAgentData, command?: IChatAgentCommand, enableCommandDetection?: boolean, chatRequest?: ChatRequestModel, isParticipantDetected?: boolean): Promise<IChatAgentRequest> => {
						const initVariableData: IChatRequestVariableData = { variables: [] };
						request = chatRequest ?? model.addRequest(parsedRequest, initVariableData, attempt, agent, command, options?.confirmation, options?.locationData, options?.attachedContext);
						this._lastExchangeId = request.id;

						// Variables may have changed if the agent and slash command changed, so resolve them again even if we already had a chatRequest
						const variableData = await this.chatVariablesService.resolveVariables(
							parsedRequest,
							request.attachedContext,
							model,
							// TODO(@ghostwriternr): Do we still need this? The lifecycle of the request object is unclear, and the cancellation token too.
							(part) => this.progressCallback(model, undefined, part, token),
							options,
							token
						);
						model.updateRequest(request, variableData);
						const promptTextResult = getPromptText(request.message);
						const updatedVariableData = updateRanges(variableData, promptTextResult.diff); // TODO bit of a hack

						return {
							mode: options?.agentMode ?? AgentMode.Chat,
							scope: options?.agentScope ?? AgentScope.Selection,
							sessionId,
							requestId: request.id,
							agentId: agent.id,
							message: promptTextResult.message,
							command: command?.name,
							variables: updatedVariableData,
							enableCommandDetection,
							isParticipantDetected,
							attempt,
							location,
							locationData: request.locationData,
							acceptedConfirmationData: options?.acceptedConfirmationData,
							rejectedConfirmationData: options?.rejectedConfirmationData,
							isDevtoolsContext: model.isDevtoolsContext,
						} satisfies IChatAgentRequest;
					};

					/* TODO(@ghostwriternr): Not really a TODO, just marking this code as stuff we don't want to do
					if (this.configurationService.getValue('chat.experimental.detectParticipant.enabled') !== false && this.chatAgentService.hasChatParticipantDetectionProviders() && !agentPart && !commandPart && enableCommandDetection) {
						// Prepare the request object that we will send to the participant detection provider
						const chatAgentRequest = await prepareChatAgentRequest(defaultAgent, agentSlashCommandPart?.command, enableCommandDetection, undefined, false);

						const result = await this.chatAgentService.detectAgentOrCommand(chatAgentRequest, [], { location }, token);
						if (result && this.chatAgentService.getAgent(result.agent.id)?.locations?.includes(location)) {
							// Update the response in the ChatModel to reflect the detected agent and command
							request.response?.setAgent(result.agent, result.command);
							detectedAgent = result.agent;
							detectedCommand = result.command;
						}
					}
					*/

					const agent = (detectedAgent ?? agentPart?.agent ?? defaultAgent)!;
					const command = detectedCommand ?? agentSlashCommandPart?.command;
					await this.extensionService.activateByEvent(`onAideAgent:${agent.id}`);

					const requestProps = await prepareChatAgentRequest(agent, command, enableCommandDetection, request /* Reuse the request object if we already created it for participant detection */, !!detectedAgent);
					requestProps.userSelectedModelId = options?.userSelectedModelId;
					/* TODO(@ghostwriternr): This is from the request-response world. Remove this when we no longer need to track pending requests.
					const pendingRequest = this._pendingExchanges.get(sessionId);
					if (pendingRequest && !pendingRequest.exchangeId) {
						pendingRequest.exchangeId = requestProps.requestId;
					}
					*/
					completeResponseCreated();
					const agentResult = await this.chatAgentService.invokeAgent(agent.id, requestProps, token);
					rawResult = agentResult;
					agentOrCommandFollowups = this.chatAgentService.getFollowups(agent.id, requestProps, agentResult, [], followupsCancelToken);
					chatTitlePromise = model.getExchanges().length === 1 && !model.customTitle ? this.chatAgentService.getChatTitle(defaultAgent.id, [], CancellationToken.None) : undefined;
				} else if (commandPart && this.chatSlashCommandService.hasCommand(commandPart.slashCommand.command)) {
					request = model.addRequest(parsedRequest, { variables: [] }, attempt);
					completeResponseCreated();
					// contributed slash commands
					// TODO: spell this out in the UI
					/* TODO(@ghostwriternr): Investigate if commenting this block out breaks slash commands (which we aren't currently using anyway)
					const history: IChatMessage[] = [];
					for (const request of model.getExchanges()) {
						if (!request.response) {
							continue;
						}
						history.push({ role: ChatMessageRole.User, content: [{ type: 'text', value: request.message.text }] });
						history.push({ role: ChatMessageRole.Assistant, content: [{ type: 'text', value: request.response.response.toString() }] });
					}
					const message = parsedRequest.text;
					const commandResult = await this.chatSlashCommandService.executeCommand(commandPart.slashCommand.command, message.substring(commandPart.slashCommand.command.length + 1).trimStart(), new Progress<IChatProgress>(p => {
						progressCallback(p);
					}), history, location, token);
					agentOrCommandFollowups = Promise.resolve(commandResult?.followUp);
					*/
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

					const commandForTelemetry = agentSlashCommandPart ? agentSlashCommandPart.command.name : commandPart?.slashCommand.command;
					// model.setResponse(request, rawResult);
					completeResponseCreated();
					this.trace('sendRequest', `Provider returned response for session ${model.sessionId}`);

					// model.completeResponse(request);
					if (agentOrCommandFollowups) {
						agentOrCommandFollowups.then(followups => {
							// model.setFollowups(request, followups);
							this._chatServiceTelemetry.retrievedFollowups(agentPart?.agent.id ?? '', commandForTelemetry, followups?.length ?? 0);
						});
					}
					chatTitlePromise?.then(title => {
						if (title) {
							model.setCustomTitle(title);
						}
					});
				}
			} catch (err) {
				this.logService.error(`Error while handling chat request: ${toErrorMessage(err, true)}`);
				if (request) {
					// const rawResult: IChatAgentResult = { errorDetails: { message: err.message } };
					// model.setResponse(request, rawResult);
					completeResponseCreated();
					// model.completeResponse(request);
				}
			} finally {
				listener.dispose();
			}
		};
		const rawResponsePromise = sendRequestInternal();
		/* TODO(@ghostwriternr): This is from the request-response world. Remove this when we no longer need to track pending requests.
		this._pendingExchanges.set(model.sessionId, new CancellableExchange(source));
		rawResponsePromise.finally(() => {
			this._pendingExchanges.deleteAndDispose(model.sessionId);
		});
		*/
		return {
			responseCreatedPromise: responseCreated.p,
			responseCompletePromise: rawResponsePromise,
		};
	}

	/* TODO(@ghostwriternr): Remove this if we no longer need to remove requests.
	async removeRequest(sessionId: string, requestId: string): Promise<void> {
		const model = this._sessionModels.get(sessionId);
		if (!model) {
			throw new Error(`Unknown session: ${sessionId}`);
		}

		await model.waitForInitialization();

		const pendingRequest = this._pendingRequests.get(sessionId);
		if (pendingRequest?.requestId === requestId) {
			pendingRequest.cancel();
			this._pendingRequests.deleteAndDispose(sessionId);
		}

		model.removeRequest(requestId);
	}
	*/

	async initiateResponse(sessionId: string): Promise<{ responseId: string; callback: (p: IChatProgress) => void; token: CancellationToken }> {
		const model = this._sessionModels.get(sessionId);
		if (!model) {
			throw new Error(`Unknown session: ${sessionId}`);
		}

		await model.waitForInitialization();

		const response = model.addResponse();
		this._lastExchangeId = response.id;
		const cts = new CancellationTokenSource();
		this._pendingExchanges.set(response.id, new CancellableExchange(cts));
		this._register(cts.token.onCancellationRequested(() => {
			this.trace('initiateResponse', `Response ${response.id} was cancelled`);
			model.cancelResponse(response);
		}));

		const progressCallback = (p: IChatProgress) => {
			// TODO(@ghostwriternr): Remove this comment once we get the cancellation to work
			this.progressCallback(model, response, p, cts.token);
		};
		return { responseId: response.id, callback: progressCallback, token: cts.token };
	}

	async addCompleteRequest(_sessionId: string, message: IParsedChatRequest | string, _variableData: IChatRequestVariableData | undefined, _attempt: number | undefined, _response: IChatCompleteResponse): Promise<void> {
		this.trace('addCompleteRequest', `message: ${message}`);

		/* TODO(@ghostwriternr): Come back to debug this when restoring a session inevitably fails
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
		*/
	}

	cancelExchange(exchangeId: string): void {
		const exchange = this._pendingExchanges.get(exchangeId);
		if (exchange) {
			exchange.cancel();
			this._pendingExchanges.deleteAndDispose(exchangeId);
		}
	}

	cancelAllExchangesForSession(): void {
		for (const [exchangeId] of this._pendingExchanges) {
			this.cancelExchange(exchangeId);
		}
	}

	clearSession(sessionId: string): void {
		this.trace('clearSession', `sessionId: ${sessionId}`);
		const model = this._sessionModels.get(sessionId);
		if (!model) {
			throw new Error(`Unknown session: ${sessionId}`);
		}

		if (model.initialLocation === ChatAgentLocation.Panel) {
			// Turn all the real objects into actual JSON, otherwise, calling 'revive' may fail when it tries to
			// assign values to properties that are getters- microsoft/vscode-copilot-release#1233
			const sessionData: ISerializableChatData = JSON.parse(JSON.stringify(model));
			sessionData.isNew = true;
			this._persistedSessions[sessionId] = sessionData;
		}

		this._sessionModels.deleteAndDispose(sessionId);
		this.cancelAllExchangesForSession();
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
