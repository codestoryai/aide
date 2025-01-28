/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { asArray } from '../../../../base/common/arrays.js';
import { DeferredPromise } from '../../../../base/common/async.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { IMarkdownString, MarkdownString, isMarkdownString } from '../../../../base/common/htmlContent.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { revive } from '../../../../base/common/marshalling.js';
import { equals } from '../../../../base/common/objects.js';
import { basename, isEqual } from '../../../../base/common/resources.js';
import { ThemeIcon } from '../../../../base/common/themables.js';
import { isObject } from '../../../../base/common/types.js';
import { URI, UriComponents, UriDto, isUriComponents } from '../../../../base/common/uri.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { IOffsetRange, OffsetRange } from '../../../../editor/common/core/offsetRange.js';
import { IRange } from '../../../../editor/common/core/range.js';
import { IWorkspaceFileEdit, IWorkspaceTextEdit, TextEdit, WorkspaceEdit } from '../../../../editor/common/languages.js';
import { IModelDeltaDecoration, ITextModel } from '../../../../editor/common/model.js';
import { localize } from '../../../../nls.js';
import { IContextKey, IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { ChatAgentLocation, IAideAgentAgentService, IChatAgentCommand, IChatAgentData, IChatAgentResult, IChatWelcomeMessageContent, reviveSerializedAgent } from './aideAgentAgents.js';
import { IAideAgentCodeEditingService, IAideAgentCodeEditingSession } from './aideAgentCodeEditingService.js';
import { CONTEXT_CHAT_IS_PLAN_VISIBLE, CONTEXT_CHAT_LAST_EXCHANGE_COMPLETE } from './aideAgentContextKeys.js';
import { HunkData } from './aideAgentEditingSession.js';
import { ChatRequestTextPart, IParsedChatRequest, reviveParsedChatRequest } from './aideAgentParserTypes.js';
import { AideAgentPlanModel, IAideAgentPlanModel } from './aideAgentPlanModel.js';
import { ChatAgentVoteDirection, ChatAgentVoteDownReason, IAideAgentPlanProgressContent, IAideAgentPlanStep, IAideAgentToolTypeError, IChatAgentMarkdownContentWithVulnerability, IChatCodeCitation, IChatCodeEdit, IChatCommandButton, IChatConfirmation, IChatContentInlineReference, IChatContentReference, IChatFollowup, IChatLocationData, IChatMarkdownContent, IChatProgress, IChatProgressMessage, IChatResponseCodeblockUriPart, IChatResponseProgressFileTreeData, IChatTask, IChatTextEdit, IChatTreeData, IChatUsedContext, IChatWarningMessage, isIUsedContext } from './aideAgentService.js';
import { IAideAgentTerminalService } from './aideAgentTerminalService.js';
import { IChatRequestVariableValue } from './aideAgentVariables.js';

export function isRequestModel(item: unknown): item is IChatRequestModel {
	return !!item && typeof item === 'object' && 'message' in item;
}

export function isResponseModel(item: unknown): item is IChatResponseModel {
	return !!item && typeof (item as IChatResponseModel).setVote !== 'undefined';
}

export interface IChatRequestVariableEntry {
	id: string;
	fullName?: string;
	icon?: ThemeIcon;
	name: string;
	modelDescription?: string;
	range?: IOffsetRange;
	value: IChatRequestVariableValue;
	references?: IChatContentReference[];
	mimeType?: string;

	// TODO are these just a 'kind'?
	isDynamic?: boolean;
	isFile?: boolean;
	isDirectory?: boolean;
	isTool?: boolean;
	isImage?: boolean;
}

export interface IChatRequestVariableData {
	variables: IChatRequestVariableEntry[];
}

export interface IChatRequestModel {
	readonly id: string;
	readonly username: string;
	readonly avatarIconUri?: URI;
	readonly session: IChatModel;
	readonly message: IParsedChatRequest;
	readonly attempt: number;
	readonly variableData: IChatRequestVariableData;
	readonly confirmation?: string;
	readonly locationData?: IChatLocationData;
	readonly attachedContext?: IChatRequestVariableEntry[];
}

export type IChatExchangeModel = IChatRequestModel | IChatResponseModel;

export interface IChatTextEditGroupState {
	sha1: string;
	applied: number;
}

export interface IChatTextEditGroup {
	uri: URI;
	edits: TextEdit[][];
	state?: IChatTextEditGroupState;
	kind: 'textEditGroup';
}

export type IChatProgressResponseContent =
	| IChatMarkdownContent
	| IChatAgentMarkdownContentWithVulnerability
	| IChatResponseCodeblockUriPart
	| IChatTreeData
	| IChatContentInlineReference
	| IChatProgressMessage
	| IChatCommandButton
	| IChatWarningMessage
	| IChatTask
	| IChatTextEditGroup
	| IChatConfirmation
	| IAideAgentToolTypeError
	| IAideAgentPlanProgressContent;

export type IChatProgressRenderableResponseContent = Exclude<IChatProgressResponseContent, IChatContentInlineReference | IChatAgentMarkdownContentWithVulnerability | IChatResponseCodeblockUriPart>;

export interface IResponse {
	readonly value: ReadonlyArray<IChatProgressResponseContent>;
	getMarkdown(): string;
	toString(): string;
	responseRepr: string;
}

export interface IAideAgentEdits {
	readonly targetUri: string;
	readonly textModelN: ITextModel;
	textModel0: ITextModel;
	hunkData: HunkData;
	textModelNDecorations?: IModelDeltaDecoration[];
}

export interface IChatResponseModel {
	readonly onDidChange: Event<void>;
	readonly id: string;
	// readonly requestId: string;
	readonly username: string;
	readonly avatarIcon?: ThemeIcon | URI;
	readonly session: IChatModel;
	readonly agent?: IChatAgentData;
	readonly usedContext: IChatUsedContext | undefined;
	readonly contentReferences: ReadonlyArray<IChatContentReference>;
	readonly codeCitations: ReadonlyArray<IChatCodeCitation>;
	readonly progressMessages: ReadonlyArray<IChatProgressMessage>;
	readonly slashCommand?: IChatAgentCommand;
	readonly agentOrSlashCommandDetected: boolean;
	readonly response: IResponse;
	readonly isComplete: boolean;
	readonly isCanceled: boolean;
	/** A stale response is one that has been persisted and rehydrated, so e.g. Commands that have their arguments stored in the EH are gone. */
	readonly isStale: boolean;
	readonly vote: ChatAgentVoteDirection | undefined;
	readonly voteDownReason: ChatAgentVoteDownReason | undefined;
	readonly followups?: IChatFollowup[] | undefined;
	readonly result?: IChatAgentResult;
	setVote(vote: ChatAgentVoteDirection): void;
	setVoteDownReason(reason: ChatAgentVoteDownReason | undefined): void;
	setEditApplied(edit: IChatTextEditGroup, editCount: number): boolean;
}

export class ChatRequestModel implements IChatRequestModel {
	private static nextId = 0;

	public readonly id: string;

	public get session() {
		return this._session;
	}

	public get username(): string {
		return this.session.requesterUsername;
	}

	public get avatarIconUri(): URI | undefined {
		return this.session.requesterAvatarIconUri;
	}

	public get attempt(): number {
		return this._attempt;
	}

	public get variableData(): IChatRequestVariableData {
		return this._variableData;
	}

	public set variableData(v: IChatRequestVariableData) {
		this._variableData = v;
	}

	public get confirmation(): string | undefined {
		return this._confirmation;
	}

	public get locationData(): IChatLocationData | undefined {
		return this._locationData;
	}

	public get attachedContext(): IChatRequestVariableEntry[] | undefined {
		return this._attachedContext;
	}

	constructor(
		private _session: ChatModel,
		public readonly message: IParsedChatRequest,
		private _variableData: IChatRequestVariableData,
		private _attempt: number = 0,
		private _confirmation?: string,
		private _locationData?: IChatLocationData,
		private _attachedContext?: IChatRequestVariableEntry[]
	) {
		this.id = 'request_' + ChatRequestModel.nextId++;
	}
}

export class Response extends Disposable implements IResponse {
	private _onDidChangeValue = this._register(new Emitter<void>());
	public get onDidChangeValue() {
		return this._onDidChangeValue.event;
	}

	private _responseParts: IChatProgressResponseContent[];

	/**
	 * A stringified representation of response data which might be presented to a screenreader or used when copying a response.
	 */
	private _responseRepr = '';
	get responseRepr() {
		return this._responseRepr;
	}

	/**
	 * Just the markdown content of the response, used for determining the rendering rate of markdown
	 */
	private _markdownContent = '';

	private _citations: IChatCodeCitation[] = [];

	get value(): IChatProgressResponseContent[] {
		return this._responseParts;
	}

	constructor(value: IMarkdownString | ReadonlyArray<IMarkdownString | IChatResponseProgressFileTreeData | IChatContentInlineReference | IChatAgentMarkdownContentWithVulnerability | IChatResponseCodeblockUriPart>) {
		super();
		this._responseParts = asArray(value).map((v) => (isMarkdownString(v) ?
			{ content: v, kind: 'markdownContent' } satisfies IChatMarkdownContent :
			'kind' in v ? v : { kind: 'treeData', treeData: v }));

		this._updateRepr(true);
	}

	override toString(): string {
		return this._responseRepr;
	}

	getMarkdown(): string {
		return this._markdownContent;
	}

	clear(): void {
		this._responseParts = [];
		this._updateRepr(true);
	}

	updateContent(progress: IChatProgressResponseContent | IChatTextEdit | IChatTask, quiet?: boolean): void {
		if (progress.kind === 'markdownContent') {
			const responsePartLength = this._responseParts.length - 1;
			const lastResponsePart = this._responseParts[responsePartLength];

			if (!lastResponsePart || lastResponsePart.kind !== 'markdownContent' || !canMergeMarkdownStrings(lastResponsePart.content, progress.content)) {
				// The last part can't be merged with- not markdown, or markdown with different permissions
				this._responseParts.push(progress);
			} else {
				lastResponsePart.content = appendMarkdownString(lastResponsePart.content, progress.content);
			}
			this._updateRepr(quiet);
		} else if (progress.kind === 'textEdit') {
			if (progress.edits.length > 0) {
				// merge text edits for the same file no matter when they come in
				let found = false;
				for (let i = 0; !found && i < this._responseParts.length; i++) {
					const candidate = this._responseParts[i];
					if (candidate.kind === 'textEditGroup' && isEqual(candidate.uri, progress.uri)) {
						candidate.edits.push(progress.edits);
						found = true;
					}
				}
				if (!found) {
					this._responseParts.push({
						kind: 'textEditGroup',
						uri: progress.uri,
						edits: [progress.edits]
					});
				}
				this._updateRepr(quiet);
			}
		} else if (progress.kind === 'progressTask') {
			// Add a new resolving part
			const responsePosition = this._responseParts.push(progress) - 1;
			this._updateRepr(quiet);

			const disp = progress.onDidAddProgress(() => {
				this._updateRepr(false);
			});

			progress.task?.().then((content) => {
				// Stop listening for progress updates once the task settles
				disp.dispose();

				// Replace the resolving part's content with the resolved response
				if (typeof content === 'string') {
					(this._responseParts[responsePosition] as IChatTask).content = new MarkdownString(content);
				}
				this._updateRepr(false);
			});
		} else {
			this._responseParts.push(progress);
			this._updateRepr(quiet);
		}
	}

	public addCitation(citation: IChatCodeCitation) {
		this._citations.push(citation);
		this._updateRepr();
	}

	private _updateRepr(quiet?: boolean) {
		const inlineRefToRepr = (part: IChatContentInlineReference) =>
			'uri' in part.inlineReference ? basename(part.inlineReference.uri) : 'name' in part.inlineReference ? part.inlineReference.name : basename(part.inlineReference);

		this._responseRepr = this._responseParts.map(part => {
			if (part.kind === 'treeData') {
				return '';
			} else if (part.kind === 'inlineReference') {
				return inlineRefToRepr(part);
			} else if (part.kind === 'command') {
				return part.command.title;
			} else if (part.kind === 'textEditGroup') {
				return localize('editsSummary', "Made changes.");
			} else if (part.kind === 'progressMessage' || part.kind === 'codeblockUri') {
				return '';
			} else if (part.kind === 'confirmation') {
				return `${part.title}\n${part.message}`;
			} else if (part.kind === 'planStep') {
				return part.description.value;
			} else if (part.kind === 'stage') {
				return '';
			} else if (part.kind === 'toolTypeError') {
				return part.message;
			} else {
				return part.content.value;
			}
		})
			.filter(s => s.length > 0)
			.join('\n\n');

		this._responseRepr += this._citations.length ? '\n\n' + getCodeCitationsMessage(this._citations) : '';

		this._markdownContent = this._responseParts.map(part => {
			if (part.kind === 'inlineReference') {
				return inlineRefToRepr(part);
			} else if (part.kind === 'markdownContent' || part.kind === 'markdownVuln') {
				return part.content.value;
			} else {
				return '';
			}
		})
			.filter(s => s.length > 0)
			.join('\n\n');

		if (!quiet) {
			this._onDidChangeValue.fire();
		}
	}
}

export class ChatResponseModel extends Disposable implements IChatResponseModel {
	private readonly _onDidChange = this._register(new Emitter<void>());
	readonly onDidChange = this._onDidChange.event;

	private static nextId = 0;

	public readonly id: string;

	public get session() {
		return this._session;
	}

	public get isComplete(): boolean {
		return this._isComplete;
	}

	public get isCanceled(): boolean {
		return this._isCanceled;
	}

	public get vote(): ChatAgentVoteDirection | undefined {
		return this._vote;
	}

	public get voteDownReason(): ChatAgentVoteDownReason | undefined {
		return this._voteDownReason;
	}

	public get followups(): IChatFollowup[] | undefined {
		return this._followups;
	}

	private _response: Response;
	public get response(): IResponse {
		return this._response;
	}

	public get result(): IChatAgentResult | undefined {
		return this._result;
	}

	public get username(): string {
		return this.session.responderUsername;
	}

	public get avatarIcon(): ThemeIcon | URI | undefined {
		return this.session.responderAvatarIcon;
	}

	private _followups?: IChatFollowup[];

	public get agent(): IChatAgentData | undefined {
		return this._agent;
	}

	public get slashCommand(): IChatAgentCommand | undefined {
		return this._slashCommand;
	}

	private _agentOrSlashCommandDetected: boolean | undefined;
	public get agentOrSlashCommandDetected(): boolean {
		return this._agentOrSlashCommandDetected ?? false;
	}

	private _usedContext: IChatUsedContext | undefined;
	public get usedContext(): IChatUsedContext | undefined {
		return this._usedContext;
	}

	private readonly _contentReferences: IChatContentReference[] = [];
	public get contentReferences(): ReadonlyArray<IChatContentReference> {
		return this._contentReferences;
	}

	private _editingSession: IAideAgentCodeEditingSession | undefined;

	private readonly _codeCitations: IChatCodeCitation[] = [];
	public get codeCitations(): ReadonlyArray<IChatCodeCitation> {
		return this._codeCitations;
	}

	private readonly _progressMessages: IChatProgressMessage[] = [];
	public get progressMessages(): ReadonlyArray<IChatProgressMessage> {
		return this._progressMessages;
	}

	private _isStale: boolean = false;
	public get isStale(): boolean {
		return this._isStale;
	}

	constructor(
		@IAideAgentCodeEditingService private readonly _aideAgentCodeEditingService: IAideAgentCodeEditingService,
		_response: IMarkdownString | ReadonlyArray<IMarkdownString | IChatResponseProgressFileTreeData | IChatContentInlineReference | IChatAgentMarkdownContentWithVulnerability | IChatResponseCodeblockUriPart>,
		private _session: ChatModel,
		private _agent: IChatAgentData | undefined,
		private _slashCommand: IChatAgentCommand | undefined,
		// public readonly requestId: string,
		private _isComplete: boolean = false,
		private _isCanceled = false,
		private _vote?: ChatAgentVoteDirection,
		private _voteDownReason?: ChatAgentVoteDownReason,
		private _result?: IChatAgentResult,
		followups?: ReadonlyArray<IChatFollowup>,
	) {
		super();

		// If we are creating a response with some existing content, consider it stale
		this._isStale = Array.isArray(_response) && (_response.length !== 0 || isMarkdownString(_response) && _response.value.length !== 0);

		this._followups = followups ? [...followups] : undefined;
		this._response = this._register(new Response(_response));
		this._register(this._response.onDidChangeValue(() => this._onDidChange.fire()));
		this.id = 'response_' + ChatResponseModel.nextId++;
	}

	/**
	 * Apply a progress update to the actual response content.
	 */
	updateContent(responsePart: IChatProgressResponseContent | IChatTextEdit, quiet?: boolean) {
		this._response.updateContent(responsePart, quiet);
	}

	/**
	 * Apply one of the progress updates that are not part of the actual response content.
	 */
	applyReference(progress: IChatUsedContext | IChatContentReference) {
		if (progress.kind === 'usedContext') {
			this._usedContext = progress;
		} else if (progress.kind === 'reference') {
			this._contentReferences.push(progress);
			this._onDidChange.fire();
		}
	}

	async applyCodeEdit(codeEdit: IChatCodeEdit) {
		let editingSession = this._aideAgentCodeEditingService.getExistingCodeEditingSession(this.session.sessionId);
		if (!editingSession) {
			editingSession = this._register(this._aideAgentCodeEditingService.getOrStartCodeEditingSession(this.session.sessionId));
			this._register(editingSession.onDidChange(() => {
				this._onDidChange.fire();
			}));
			this._register(editingSession.onDidDispose(() => {
				this._editingSession = undefined;
			}));
		}
		this._editingSession = editingSession;

		for (const edit of codeEdit.edits.edits) {
			if (isWorkspaceTextEdit(edit)) {
				this._editingSession.apply(edit);
			}
		}
	}

	applyCodeCitation(progress: IChatCodeCitation) {
		this._codeCitations.push(progress);
		this._response.addCitation(progress);
		this._onDidChange.fire();
	}

	setAgent(agent: IChatAgentData, slashCommand?: IChatAgentCommand) {
		this._agent = agent;
		this._slashCommand = slashCommand;
		this._agentOrSlashCommandDetected = true;
		this._onDidChange.fire();
	}

	setResult(result: IChatAgentResult): void {
		this._result = result;
		this._onDidChange.fire();
	}

	complete(): void {
		if (this._result?.errorDetails?.responseIsRedacted) {
			this._response.clear();
		}

		this._editingSession?.complete();

		this._isComplete = true;
		this._onDidChange.fire();
	}

	cancel(): void {
		this._isComplete = true;
		this._isCanceled = true;
		this._onDidChange.fire();
	}

	setFollowups(followups: IChatFollowup[] | undefined): void {
		this._followups = followups;
		this._onDidChange.fire(); // Fire so that command followups get rendered on the row
	}

	setVote(vote: ChatAgentVoteDirection): void {
		this._vote = vote;
		this._onDidChange.fire();
	}

	setVoteDownReason(reason: ChatAgentVoteDownReason | undefined): void {
		this._voteDownReason = reason;
		this._onDidChange.fire();
	}

	setEditApplied(edit: IChatTextEditGroup, editCount: number): boolean {
		if (!this.response.value.includes(edit)) {
			return false;
		}
		if (!edit.state) {
			return false;
		}
		edit.state.applied = editCount; // must not be edit.edits.length
		this._onDidChange.fire();
		return true;
	}
}

export interface IChatModel {
	readonly onDidDispose: Event<void>;
	readonly onDidChange: Event<IChatChangeEvent>;
	readonly sessionId: string;
	readonly isPassthrough: boolean;
	readonly initState: ChatModelInitState;
	readonly initialLocation: ChatAgentLocation;
	readonly title: string;
	readonly welcomeMessage: IChatWelcomeMessageContent | undefined;
	readonly requestInProgress: boolean;
	readonly inputPlaceholder?: string;
	readonly plan?: IAideAgentPlanModel;
	isDevtoolsContext: boolean;
	getExchanges(): IChatExchangeModel[];
	toExport(): IExportableChatData;
	toJSON(): ISerializableChatData;
}

export interface ISerializableChatsData {
	[sessionId: string]: ISerializableChatData;
}

export type ISerializableChatAgentData = UriDto<IChatAgentData>;

export interface ISerializableChatRequestData {
	type: 'request';
	message: string | IParsedChatRequest; // string => old format
	/** Is really like "prompt data". This is the message in the format in which the agent gets it + variable values. */
	variableData: IChatRequestVariableData;
}

export interface ISerializableChatResponseData {
	type: 'response';
	response: ReadonlyArray<IMarkdownString | IChatResponseProgressFileTreeData | IChatContentInlineReference | IChatAgentMarkdownContentWithVulnerability> | undefined;
	agent?: ISerializableChatAgentData;
	slashCommand?: IChatAgentCommand;
	// responseErrorDetails: IChatResponseErrorDetails | undefined;
	result?: IChatAgentResult; // Optional for backcompat
	followups: ReadonlyArray<IChatFollowup> | undefined;
	isCanceled: boolean | undefined;
	vote: ChatAgentVoteDirection | undefined;
	voteDownReason?: ChatAgentVoteDownReason;
	/** For backward compat: should be optional */
	usedContext?: IChatUsedContext;
	contentReferences?: ReadonlyArray<IChatContentReference>;
	codeCitations?: ReadonlyArray<IChatCodeCitation>;
}

export type ISerializableExchange = ISerializableChatRequestData | ISerializableChatResponseData;

export interface IExportableChatData {
	initialLocation: ChatAgentLocation | undefined;
	exchanges: ISerializableExchange[];
	requesterUsername: string;
	responderUsername: string;
	requesterAvatarIconUri: UriComponents | undefined;
	responderAvatarIconUri: ThemeIcon | UriComponents | undefined; // Keeping Uri name for backcompat
}

/*
	NOTE: every time the serialized data format is updated, we need to create a new interface, because we may need to handle any old data format when parsing.
*/

export interface ISerializableChatData1 extends IExportableChatData {
	sessionId: string;
	creationDate: number;
	isImported: boolean;
	/** Indicates that this session was created in this window. Is cleared after the chat has been written to storage once. Needed to sync chat creations/deletions between empty windows. */
	isNew?: boolean;
	lastMessageDate: number;
	customTitle: string | undefined;
}


/**
 * Chat data that has been parsed and normalized to the current format.
 */
export type ISerializableChatData = ISerializableChatData1;

/**
 * Chat data that has been loaded but not normalized, and could be any format
 */
export type ISerializableChatDataIn = ISerializableChatData1;


export function isExportableSessionData(obj: unknown): obj is IExportableChatData {
	const data = obj as IExportableChatData;
	return typeof data === 'object' &&
		typeof data.requesterUsername === 'string';
}

export function isSerializableSessionData(obj: unknown): obj is ISerializableChatData {
	const data = obj as ISerializableChatData;
	return isExportableSessionData(obj) &&
		typeof data.creationDate === 'number' &&
		typeof data.sessionId === 'string' &&
		obj.exchanges.every((exchange: ISerializableExchange) =>
			exchange.type === 'request' || (exchange.type === 'response' && (!exchange.usedContext /* for backward compat allow missing usedContext */ || isIUsedContext(exchange.usedContext)))
		);
}

export type IChatChangeEvent =
	| IChatInitEvent
	| IChatAddRequestEvent | IChatChangedRequestEvent | IChatRemoveRequestEvent
	| IChatAddResponseEvent
	| IChatSetAgentEvent
	| IChatMoveEvent
	| IChatCodeEditEvent
	| IChatStartPlanEvent;

export interface IChatAddRequestEvent {
	kind: 'addRequest';
	request: IChatRequestModel;
}

export interface IChatChangedRequestEvent {
	kind: 'changedRequest';
	request: IChatRequestModel;
}

export interface IChatAddResponseEvent {
	kind: 'addResponse';
	response: IChatResponseModel;
}

export const enum ChatRequestRemovalReason {
	/**
	 * "Normal" remove
	 */
	Removal,

	/**
	 * Removed because the request will be resent
	 */
	Resend,
}

export interface IChatRemoveRequestEvent {
	kind: 'removeRequest';
	requestId: string;
	responseId?: string;
	reason: ChatRequestRemovalReason;
}

export interface IChatMoveEvent {
	kind: 'move';
	target: URI;
	range: IRange;
}

export interface IChatCodeEditEvent {
	kind: 'codeEdit';
	edits: WorkspaceEdit;
}

export interface IChatSetAgentEvent {
	kind: 'setAgent';
	agent: IChatAgentData;
	command?: IChatAgentCommand;
}

export interface IChatInitEvent {
	kind: 'initialize';
}

export interface IChatStartPlanEvent {
	kind: 'startPlan';
	plan: IAideAgentPlanModel;
}

export enum ChatModelInitState {
	Created,
	Initializing,
	Initialized
}

export enum AgentScope {
	Selection = 'Selection',
	PinnedContext = 'Pinned Context',
	Codebase = 'Codebase'
}

export class ChatModel extends Disposable implements IChatModel {
	static getDefaultTitle(exchanges: (ISerializableExchange | IChatExchangeModel)[]): string {
		const firstRequestMessage = exchanges.find(r => isRequestModel(r));
		const message = firstRequestMessage?.message.text ?? 'Session';
		return message.split('\n')[0].substring(0, 50);
	}

	private readonly _onDidDispose = this._register(new Emitter<void>());
	readonly onDidDispose = this._onDidDispose.event;

	private readonly _onDidChange = this._register(new Emitter<IChatChangeEvent>());
	readonly onDidChange = this._onDidChange.event;

	private _exchanges: IChatExchangeModel[];
	private _initState: ChatModelInitState = ChatModelInitState.Created;
	private _isInitializedDeferred = new DeferredPromise<void>();

	private _welcomeMessage: IChatWelcomeMessageContent | undefined;
	get welcomeMessage(): IChatWelcomeMessageContent | undefined {
		return this._welcomeMessage;
	}

	// TODO to be clear, this is not the same as the id from the session object, which belongs to the provider.
	// It's easier to be able to identify this model before its async initialization is complete
	private _sessionId: string;
	get sessionId(): string {
		return this._sessionId;
	}

	get requestInProgress(): boolean {
		if (this._exchanges.length === 0) {
			return false;
		} else {
			const lastExchange = this._exchanges.at(-1);
			if (isResponseModel(lastExchange)) {
				return !lastExchange.isComplete;
			} else {
				return true;
			}
		}
	}

	get hasRequests(): boolean {
		return this._exchanges.length > 0;
	}

	get lastExchange(): IChatExchangeModel | undefined {
		return this._exchanges.at(-1);
	}

	private _creationDate: number;
	get creationDate(): number {
		return this._creationDate;
	}

	private _lastMessageDate: number;
	get lastMessageDate(): number {
		return this._lastMessageDate;
	}

	private get _defaultAgent() {
		return this.chatAgentService.getDefaultAgent(ChatAgentLocation.Panel);
	}

	get requesterUsername(): string {
		return this._defaultAgent?.metadata.requester?.name ??
			this.initialData?.requesterUsername ?? '';
	}

	get responderUsername(): string {
		return this._defaultAgent?.fullName ??
			this.initialData?.responderUsername ?? '';
	}

	private readonly _initialRequesterAvatarIconUri: URI | undefined;
	get requesterAvatarIconUri(): URI | undefined {
		return this._defaultAgent?.metadata.requester?.icon ??
			this._initialRequesterAvatarIconUri;
	}

	private readonly _initialResponderAvatarIconUri: ThemeIcon | URI | undefined;
	get responderAvatarIcon(): ThemeIcon | URI | undefined {
		return this._defaultAgent?.metadata.themeIcon ??
			this._initialResponderAvatarIconUri;
	}

	get initState(): ChatModelInitState {
		return this._initState;
	}

	private _isImported = false;
	get isImported(): boolean {
		return this._isImported;
	}

	private _customTitle: string | undefined;
	get customTitle(): string | undefined {
		return this._customTitle;
	}

	get title(): string {
		return this._customTitle || ChatModel.getDefaultTitle(this._exchanges);
	}

	get initialLocation() {
		return this._initialLocation;
	}

	private _plan: AideAgentPlanModel | undefined;
	private isPlanVisible: IContextKey<boolean>;
	private lastExchangeComplete: IContextKey<boolean>;

	get plan(): AideAgentPlanModel | undefined {
		return this._plan;
	}

	set plan(plan: AideAgentPlanModel | undefined) {
		this._plan = plan;
		this.isPlanVisible.set(!!plan);
	}

	private _isDevtoolsContext: boolean = false;
	get isDevtoolsContext(): boolean {
		return this._isDevtoolsContext;
	}

	set isDevtoolsContext(isDevtoolsContext: boolean) {
		this._isDevtoolsContext = isDevtoolsContext;
	}

	constructor(
		private readonly initialData: ISerializableChatData | IExportableChatData | undefined,
		private readonly _initialLocation: ChatAgentLocation,
		readonly isPassthrough: boolean,
		@IContextKeyService contextKeyService: IContextKeyService,
		@ILogService private readonly logService: ILogService,
		@IAideAgentAgentService private readonly chatAgentService: IAideAgentAgentService,
		@IAideAgentCodeEditingService private readonly aideAgentCodeEditingService: IAideAgentCodeEditingService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IAideAgentTerminalService private readonly aideAgentTerminalService: IAideAgentTerminalService
	) {
		super();

		// we could pass the terminal to show output and name
		this.aideAgentTerminalService.onDidAgentAddTerminal(() => {
			console.log('terminal added by agent');
		});

		this._isImported = (!!initialData && !isSerializableSessionData(initialData)) || (initialData?.isImported ?? false);
		this._sessionId = (isSerializableSessionData(initialData) && initialData.sessionId) || generateUuid();
		this._exchanges = initialData ? this._deserialize(initialData) : [];
		this._creationDate = (isSerializableSessionData(initialData) && initialData.creationDate) || Date.now();
		this._lastMessageDate = (isSerializableSessionData(initialData) && initialData.lastMessageDate) || this._creationDate;
		this._customTitle = isSerializableSessionData(initialData) ? initialData.customTitle : undefined;

		this._initialRequesterAvatarIconUri = initialData?.requesterAvatarIconUri && URI.revive(initialData.requesterAvatarIconUri);
		this._initialResponderAvatarIconUri = isUriComponents(initialData?.responderAvatarIconUri) ? URI.revive(initialData.responderAvatarIconUri) : initialData?.responderAvatarIconUri;

		this.isPlanVisible = CONTEXT_CHAT_IS_PLAN_VISIBLE.bindTo(contextKeyService);
		this.lastExchangeComplete = CONTEXT_CHAT_LAST_EXCHANGE_COMPLETE.bindTo(contextKeyService);

		this._register(this.aideAgentCodeEditingService.onDidComplete(() => {
			// TODO(@ghostwriternr): Hmm, as per the original design, a plan could span multiple exchanges.
			// But because we want to reset the plan for new exchanges, we are currently resetting the plan here.
			// We should clean this up at some point.
			this.plan = undefined;
		}));
	}

	private _deserialize(obj: IExportableChatData): Array<ChatRequestModel | ChatResponseModel> {
		const exchanges = obj.exchanges;
		if (!Array.isArray(exchanges)) {
			this.logService.error(`Ignoring malformed session data: ${JSON.stringify(obj)}`);
			return [];
		}

		try {
			return exchanges.map((raw: ISerializableExchange) => {
				if (raw.type === 'request') {
					const parsedRequest =
						typeof raw.message === 'string'
							? this.getParsedRequestFromString(raw.message)
							: reviveParsedChatRequest(raw.message);

					// Old messages don't have variableData, or have it in the wrong (non-array) shape
					const variableData: IChatRequestVariableData = this.reviveVariableData(raw.variableData);
					return new ChatRequestModel(this, parsedRequest, variableData);
				} else if (raw.type === 'response') {
					if (raw.response || raw.result || (raw as any).responseErrorDetails) {
						const agent = (raw.agent && 'metadata' in raw.agent) ? // Check for the new format, ignore entries in the old format
							reviveSerializedAgent(raw.agent) : undefined;

						// Port entries from old format
						const result = 'responseErrorDetails' in raw ?
							// eslint-disable-next-line local/code-no-dangerous-type-assertions
							{ errorDetails: raw.responseErrorDetails } as IChatAgentResult : raw.result;
						// TODO(@ghostwriternr): We used to assign the response to the request here, but now we don't.
						const response = new ChatResponseModel(
							this.aideAgentCodeEditingService,
							raw.response ?? [new MarkdownString(raw.response)], this, agent, raw.slashCommand, true, raw.isCanceled, raw.vote, raw.voteDownReason, result, raw.followups
						);
						if (raw.usedContext) { // @ulugbekna: if this's a new vscode sessions, doc versions are incorrect anyway?
							response.applyReference(revive(raw.usedContext));
						}

						raw.contentReferences?.forEach(r => response.applyReference(revive(r)));
						raw.codeCitations?.forEach(c => response.applyCodeCitation(revive(c)));
						return response;
					} else {
						throw new Error('Unknown response');
					}
				}
				throw new Error('Unknown exchange');

			});
		} catch (error) {
			this.logService.error('Failed to parse chat data', error);
			return [];
		}
	}

	private reviveVariableData(raw: IChatRequestVariableData): IChatRequestVariableData {
		const variableData = raw && Array.isArray(raw.variables)
			? raw :
			{ variables: [] };

		variableData.variables = variableData.variables.map<IChatRequestVariableEntry>((v): IChatRequestVariableEntry => {
			// Old variables format
			if (v && 'values' in v && Array.isArray(v.values)) {
				return {
					id: v.id ?? '',
					name: v.name,
					value: v.values[0]?.value,
					range: v.range,
					modelDescription: v.modelDescription,
					references: v.references
				};
			} else {
				return v;
			}
		});

		return variableData;
	}

	private getParsedRequestFromString(message: string): IParsedChatRequest {
		// TODO These offsets won't be used, but chat replies need to go through the parser as well
		const parts = [new ChatRequestTextPart(new OffsetRange(0, message.length), { startColumn: 1, startLineNumber: 1, endColumn: 1, endLineNumber: 1 }, message)];
		return {
			text: message,
			parts
		};
	}

	startInitialize(): void {
		if (this.initState !== ChatModelInitState.Created) {
			throw new Error(`ChatModel is in the wrong state for startInitialize: ${ChatModelInitState[this.initState]}`);
		}
		this._initState = ChatModelInitState.Initializing;
	}

	deinitialize(): void {
		this._initState = ChatModelInitState.Created;
		this._isInitializedDeferred = new DeferredPromise<void>();
	}

	initialize(welcomeMessage: IChatWelcomeMessageContent | undefined): void {
		if (this.initState !== ChatModelInitState.Initializing) {
			// Must call startInitialize before initialize, and only call it once
			throw new Error(`ChatModel is in the wrong state for initialize: ${ChatModelInitState[this.initState]}`);
		}

		this._initState = ChatModelInitState.Initialized;
		this._welcomeMessage = welcomeMessage;

		this._isInitializedDeferred.complete();
		this._onDidChange.fire({ kind: 'initialize' });
	}

	setInitializationError(error: Error): void {
		if (this.initState !== ChatModelInitState.Initializing) {
			throw new Error(`ChatModel is in the wrong state for setInitializationError: ${ChatModelInitState[this.initState]}`);
		}

		if (!this._isInitializedDeferred.isSettled) {
			this._isInitializedDeferred.error(error);
		}
	}

	waitForInitialization(): Promise<void> {
		return this._isInitializedDeferred.p;
	}

	getExchanges(): IChatExchangeModel[] {
		return this._exchanges;
	}

	addRequest(message: IParsedChatRequest, variableData: IChatRequestVariableData, attempt: number, chatAgent?: IChatAgentData, slashCommand?: IChatAgentCommand, confirmation?: string, locationData?: IChatLocationData, attachments?: IChatRequestVariableEntry[]): ChatRequestModel {
		this.autoAcceptLastExchange();

		const request = new ChatRequestModel(this, message, variableData, attempt, confirmation, locationData, attachments);
		const response = new ChatResponseModel(
			this.aideAgentCodeEditingService,
			[], this, chatAgent, slashCommand
		);

		this._exchanges.push(request, response);
		this._lastMessageDate = Date.now();
		this.lastExchangeComplete.set(false);
		this._onDidChange.fire({ kind: 'addRequest', request });
		return request;
	}

	// TODO(@ghostwriternr): This might break if we do proactive agent?
	private autoAcceptLastExchange() {
		const editingSession = this.aideAgentCodeEditingService.getExistingCodeEditingSession(this.sessionId);
		if (editingSession) {
			editingSession.accept();
		}
	}

	addResponse(): ChatResponseModel {
		const response = new ChatResponseModel(
			this.aideAgentCodeEditingService,
			[], this, undefined, undefined
		);
		this._exchanges.push(response);
		// TODO(@ghostwriternr): Just looking at the above, do we need to update the last message date here? What is it used for?
		this._onDidChange.fire({ kind: 'addResponse', response });
		return response;
	}

	setCustomTitle(title: string): void {
		this._customTitle = title;
	}

	updateRequest(request: ChatRequestModel, variableData: IChatRequestVariableData) {
		request.variableData = variableData;
		this._onDidChange.fire({ kind: 'changedRequest', request });
	}

	acceptResponseProgress(response: ChatResponseModel | undefined, progress: IChatProgress, quiet?: boolean): void {
		/*
		if (!request.response) {
			request.response = new ChatResponseModel([], this, undefined, undefined, request.id);
		}

		if (request.response.isComplete) {
			throw new Error('acceptResponseProgress: Adding progress to a completed response');
		}
		*/
		// TODO(@ghostwriternr): This will break, because this node is not added to the exchanges.
		if (!response) {
			response = new ChatResponseModel(
				this.aideAgentCodeEditingService,
				[], this, undefined, undefined
			);
		}

		if (progress.kind === 'markdownContent' ||
			progress.kind === 'treeData' ||
			progress.kind === 'inlineReference' ||
			progress.kind === 'codeblockUri' ||
			progress.kind === 'markdownVuln' ||
			progress.kind === 'progressMessage' ||
			progress.kind === 'command' ||
			progress.kind === 'textEdit' ||
			progress.kind === 'warning' ||
			progress.kind === 'progressTask' ||
			progress.kind === 'confirmation' ||
			progress.kind === 'stage' ||
			progress.kind === 'toolTypeError'
		) {
			response.updateContent(progress, quiet);
		} else if (progress.kind === 'usedContext' || progress.kind === 'reference') {
			response.applyReference(progress);
		} else if (progress.kind === 'agentDetection') {
			const agent = this.chatAgentService.getAgent(progress.agentId);
			if (agent) {
				response.setAgent(agent, progress.command);
				this._onDidChange.fire({ kind: 'setAgent', agent, command: progress.command });
			}
		} else if (progress.kind === 'codeCitation') {
			response.applyCodeCitation(progress);
		} else if (progress.kind === 'move') {
			this._onDidChange.fire({ kind: 'move', target: progress.uri, range: progress.range });
		} else if (progress.kind === 'codeEdit') {
			response.applyCodeEdit(progress);
			this._onDidChange.fire({ kind: 'codeEdit', edits: progress.edits });
		} else if (progress.kind === 'planStep') {
			this.applyPlanStep(progress);
		} else {
			this.logService.error(`Couldn't handle progress: ${JSON.stringify(progress)}`);
		}

		this.lastExchangeComplete.set(false);
	}

	private applyPlanStep(progress: IAideAgentPlanStep) {
		if (!this.plan) {
			this.plan = this.instantiationService.createInstance(AideAgentPlanModel, this.sessionId);
			this._onDidChange.fire({ kind: 'startPlan', plan: this.plan });
		}

		this.plan.updateSteps(progress);
	}

	/* TODO(@ghostwriternr): This method was used to remove/resend requests. We can add it back in if we need it.
	removeRequest(id: string, reason: ChatRequestRemovalReason = ChatRequestRemovalReason.Removal): void {
		const index = this._exchanges.findIndex(request => request.id === id);
		const request = this._exchanges[index];

		if (index !== -1) {
			this._onDidChange.fire({ kind: 'removeRequest', requestId: request.id, responseId: request.response?.id, reason });
			this._exchanges.splice(index, 1);
			request.response?.dispose();
		}
	}
	*/

	cancelResponse(response: ChatResponseModel): void {
		if (response) {
			response.cancel();
		}
	}

	/* TODO(@ghostwriternr): This method was used to link a response with a request. We may need this, but I'm assuming the shape will be a bit different?
	setResponse(request: ChatRequestModel, result: IChatAgentResult): void {
		if (!request.response) {
			request.response = new ChatResponseModel([], this, undefined, undefined);
		}

		request.response.setResult(result);
	}
	*/

	completeResponse(response: ChatResponseModel): void {
		if (!response) {
			throw new Error('Call setResponse before completeResponse');
		}

		response.complete();
		this.lastExchangeComplete.set(true);
	}

	/* TODO(@ghostwriternr): Honestly, don't care about followups at the moment.
	setFollowups(request: ChatRequestModel, followups: IChatFollowup[] | undefined): void {
		if (!request.response) {
			// Maybe something went wrong?
			return;
		}

		request.response.setFollowups(followups);
	}
	*/

	toExport(): IExportableChatData {
		return {
			requesterUsername: this.requesterUsername,
			requesterAvatarIconUri: this.requesterAvatarIconUri,
			responderUsername: this.responderUsername,
			responderAvatarIconUri: this.responderAvatarIcon,
			initialLocation: this.initialLocation,
			exchanges: this._exchanges.map((r): ISerializableExchange => {
				if (isRequestModel(r)) {
					const message = {
						...r.message,
						parts: r.message.parts.map(p => p && 'toJSON' in p ? (p.toJSON as Function)() : p)
					};
					return {
						type: 'request',
						message,
						variableData: r.variableData
					};
				} else if (isResponseModel(r)) {
					const agent = r.agent;
					const agentJson = agent && 'toJSON' in agent ? (agent.toJSON as Function)() :
						agent ? { ...agent } : undefined;
					return {
						type: 'response',
						response: r ?
							r.response.value.map(item => {
								// Keeping the shape of the persisted data the same for back compat
								if (item.kind === 'treeData') {
									return item.treeData;
								} else if (item.kind === 'markdownContent') {
									return item.content;
								} else {
									return item as any; // TODO
								}
							})
							: undefined,
						result: r.result,
						followups: r.followups,
						isCanceled: r.isCanceled,
						vote: r.vote,
						voteDownReason: r.voteDownReason,
						agent: agentJson,
						slashCommand: r.slashCommand,
						usedContext: r.usedContext,
						contentReferences: r.contentReferences,
						codeCitations: r.codeCitations
					};
				} else {
					// TODO (g-danna) is it a good idea to throw an error here?
					throw new Error('Unknown exchange type');
				}
			}),
		};
	}

	toJSON(): ISerializableChatData {
		return {
			...this.toExport(),
			sessionId: this.sessionId,
			creationDate: this._creationDate,
			isImported: this._isImported,
			lastMessageDate: this._lastMessageDate,
			customTitle: this._customTitle
		};
	}

	override dispose() {
		this._exchanges.forEach(r => r instanceof ChatResponseModel ? r.dispose() : undefined);

		this.plan?.dispose();
		this.plan = undefined;

		this._onDidDispose.fire();

		super.dispose();
	}
}

export function updateRanges(variableData: IChatRequestVariableData, diff: number): IChatRequestVariableData {
	return {
		variables: variableData.variables.map(v => ({
			...v,
			range: v.range && {
				start: v.range.start - diff,
				endExclusive: v.range.endExclusive - diff
			}
		}))
	};
}

export function canMergeMarkdownStrings(md1: IMarkdownString, md2: IMarkdownString): boolean {
	if (md1.baseUri && md2.baseUri) {
		const baseUriEquals = md1.baseUri.scheme === md2.baseUri.scheme
			&& md1.baseUri.authority === md2.baseUri.authority
			&& md1.baseUri.path === md2.baseUri.path
			&& md1.baseUri.query === md2.baseUri.query
			&& md1.baseUri.fragment === md2.baseUri.fragment;
		if (!baseUriEquals) {
			return false;
		}
	} else if (md1.baseUri || md2.baseUri) {
		return false;
	}

	return equals(md1.isTrusted, md2.isTrusted) &&
		md1.supportHtml === md2.supportHtml &&
		md1.supportThemeIcons === md2.supportThemeIcons;
}

export function appendMarkdownString(md1: IMarkdownString, md2: IMarkdownString | string): IMarkdownString {
	const appendedValue = typeof md2 === 'string' ? md2 : md2.value;
	return {
		value: md1.value + appendedValue,
		isTrusted: md1.isTrusted,
		supportThemeIcons: md1.supportThemeIcons,
		supportHtml: md1.supportHtml,
		baseUri: md1.baseUri
	};
}

export function getCodeCitationsMessage(citations: ReadonlyArray<IChatCodeCitation>): string {
	if (citations.length === 0) {
		return '';
	}

	const licenseTypes = citations.reduce((set, c) => set.add(c.license), new Set<string>());
	const label = licenseTypes.size === 1 ?
		localize('codeCitation', "Similar code found with 1 license type", licenseTypes.size) :
		localize('codeCitations', "Similar code found with {0} license types", licenseTypes.size);
	return label;
}

function isWorkspaceTextEdit(candidate: IWorkspaceTextEdit | IWorkspaceFileEdit): candidate is IWorkspaceTextEdit {
	return isObject(candidate)
		&& URI.isUri((<IWorkspaceTextEdit>candidate).resource)
		&& isObject((<IWorkspaceTextEdit>candidate).textEdit);
}
