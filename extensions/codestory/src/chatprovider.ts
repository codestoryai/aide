/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import { v4 as uuidv4 } from 'uuid';

import logger from './logger';
import { CodeGraph } from './codeGraph/graph';
import { EmbeddingsSearch } from './codeGraph/embeddingsSearch';
import { CSChatProviderType } from './types';
import { TSMorphProjectManagement } from './utilities/parseTypescript';
import { PythonServer } from './utilities/pythonServerClient';
import { debuggingFlow } from './llm/recipe/debugging';
import { ToolingEventCollection } from './timeline/events/collection';

class CSChatSessionState implements vscode.InteractiveSessionState {
}

class CSChatParticipant implements vscode.InteractiveSessionParticipantInformation {
	name: string;
	icon?: vscode.Uri | undefined;

	constructor(name: string, icon?: vscode.Uri | undefined) {
		this.name = name;
		this.icon = icon;
	}

	toString(): string {
		return `CSChatParticipant { name: "${this.name}", icon: "${this.icon?.toString()}" }`;
	}
}

class CSChatSession implements vscode.InteractiveSession {
	requester: CSChatParticipant;
	responder: CSChatParticipant;
	inputPlaceholder?: string | undefined;

	sessionId: string;
	private _activeRequest: CSChatRequest | undefined;

	saveState(): CSChatSessionState {
		logger.info('Saving state' + this.toString());
		return new CSChatSessionState();
	}

	getActiveRequest(): CSChatRequest | undefined {
		return this._activeRequest;
	}

	setActiveRequest(request: CSChatRequest): void {
		logger.info('Adding active request' + request.toString());
		this._activeRequest = request;
	}

	// TODO: Implement this correctly
	removeActiveRequest(): void {
		logger.info('Removing active request');
		this._activeRequest = undefined;
	}

	constructor(requester: CSChatParticipant, responder: CSChatParticipant, inputPlaceholder?: string | undefined) {
		this.sessionId = uuidv4();
		this.requester = requester;
		this.responder = responder;
		this.inputPlaceholder = inputPlaceholder;
	}

	toString(): string {
		return `CSChatSession { requester: ${this.requester.toString()}, responder: ${this.responder.toString()}, inputPlaceholder: "${this.inputPlaceholder}" }`;
	}
}

class CSChatRequestArgs implements vscode.InteractiveSessionRequestArgs {
	command: string;
	args: any;

	constructor(command: string, args: any) {
		this.command = command;
		this.args = args;
	}

	toString(): string {
		return `CSChatRequestArgs { command: "${this.command}", args: ${JSON.stringify(this.args, null, 2)} }`;
	}
}

class CSChatReplyFollowup implements vscode.InteractiveSessionReplyFollowup {
	message: string;
	tooltip?: string | undefined;
	title?: string | undefined;
	metadata?: any;

	constructor(message: string, tooltip?: string | undefined, title?: string | undefined, metadata?: any) {
		this.message = message;
		this.tooltip = tooltip;
		this.title = title;
		this.metadata = metadata;
	}

	toString(): string {
		return `CSChatReplyFollowup { message: "${this.message}", tooltip: "${this.tooltip}", title: "${this.title}", metadata: ${JSON.stringify(this.metadata, null, 2)} }`;
	}
}

class CSChatResponseCommand implements vscode.InteractiveResponseCommand {
	commandId: string;
	args?: any[] | undefined;
	title: string;

	constructor(commandId: string, title: string, args?: any[] | undefined) {
		this.commandId = commandId;
		this.args = args;
		this.title = title;
	}

	toString(): string {
		return `CSChatResponseCommand { commandId: "${this.commandId}", args: ${JSON.stringify(this.args, null, 2)}, title: "${this.title}" }`;
	}
}

type CSChatSessionFollowup = CSChatReplyFollowup | CSChatResponseCommand;

export class CSChatRequest implements vscode.InteractiveRequest {
	session: CSChatSession;
	message: string | CSChatReplyFollowup;

	requestId: string;
	private _processing: boolean = false;
	private _pendingResponses: CSChatProgress[] = [];
	private _completedResponses: CSChatProgress[] = [];

	isProcessing(): boolean {
		return this._processing;
	}

	addResponse(response: CSChatProgress): void {
		logger.info('Adding response' + response.toString());
		this._pendingResponses.push(response);
	}

	getCompletedResponses(): CSChatProgress[] {
		return this._completedResponses;
	}

	processPendingResponses(): CSChatProgress[] {
		logger.info('Processing pending responses');
		const pendingResponses = this._pendingResponses;
		this._completedResponses = this._completedResponses.concat(pendingResponses);
		this._pendingResponses = [];
		return pendingResponses;
	}

	completeProcessing(): void {
		logger.info('Completing processing');
		this._processing = false;
	}

	constructor(session: CSChatSession, message: string | CSChatReplyFollowup) {
		this.requestId = uuidv4();
		this._processing = true;
		this.session = session;
		this.message = message;
	}

	toString(): string {
		return `CSChatRequest { session: ${this.session.toString()}, message: ${this.message.toString()} }`;
	}
}

class CSChatResponseErrorDetails implements vscode.InteractiveResponseErrorDetails {
	message: string;
	responseIsIncomplete?: boolean | undefined;
	responseIsFiltered?: boolean | undefined;

	constructor(message: string, responseIsIncomplete?: boolean | undefined, responseIsFiltered?: boolean | undefined) {
		this.message = message;
		this.responseIsIncomplete = responseIsIncomplete;
		this.responseIsFiltered = responseIsFiltered;
	}

	toString(): string {
		return `CSChatResponseErrorDetails { message: "${this.message}", responseIsIncomplete: "${this.responseIsIncomplete}", responseIsFiltered: "${this.responseIsFiltered}" }`;
	}
}

class CSChatProgressId implements vscode.InteractiveProgressId {
	responseId: string;

	constructor() {
		this.responseId = uuidv4();
	}

	toString(): string {
		return `CSChatProgressId { responseId: "${this.responseId}" }`;
	}
}

export class CSChatProgressContent extends CSChatProgressId implements vscode.InteractiveProgressContent {
	content: string;

	constructor(content: string) {
		super();
		this.content = content;
	}

	toString(): string {
		return `CSChatProgressContent { content: "${this.content}" }`;
	}
}

class CSChatFileTreeData implements vscode.FileTreeData {
	label: string;
	uri: vscode.Uri;
	children?: vscode.FileTreeData[] | undefined;

	ftdId: string;

	constructor(label: string, uri: vscode.Uri, children?: vscode.FileTreeData[] | undefined) {
		this.ftdId = uuidv4();
		this.label = label;
		this.uri = uri;
		this.children = children;
	}

	toString(): string {
		return `CSChatFileTreeData { label: "${this.label}", uri: "${this.uri}", children: ${JSON.stringify(this.children, null, 2)} }`;
	}
}

class CSChatProgressFileTree extends CSChatProgressId implements vscode.InteractiveProgressFileTree {
	treeData: CSChatFileTreeData;

	constructor(treeData: CSChatFileTreeData) {
		super();
		this.treeData = treeData;
	}

	toString(): string {
		return `CSChatProgressFileTree { treeData: "${this.treeData}" }`;
	}
}

class CSChatProgressTask extends CSChatProgressId implements vscode.InteractiveProgressTask {
	placeholder: string;
	resolvedContent: Thenable<CSChatProgressContent | CSChatProgressFileTree>;

	constructor(placeholder: string, resolvedContent: Thenable<CSChatProgressContent | CSChatProgressFileTree>) {
		super();
		this.placeholder = placeholder;
		this.resolvedContent = resolvedContent;
	}

	toString(): string {
		return `CSChatProgressTask { placeholder: "${this.placeholder}", resolvedContent: "${this.resolvedContent}" }`;
	}
}

type CSChatProgress = CSChatProgressId | CSChatProgressContent | CSChatProgressTask | CSChatProgressFileTree;

class CSChatResponseForProgress implements vscode.InteractiveResponseForProgress {
	errorDetails?: CSChatResponseErrorDetails | undefined;

	constructor(errorDetails?: CSChatResponseErrorDetails | undefined) {
		this.errorDetails = errorDetails;
	}

	toString(): string {
		return `CSChatResponseForProgress { errorDetails: ${this.errorDetails?.toString()} }`;
	}
}

class CSChatCancellationToken implements vscode.CancellationToken {
	isCancellationRequested: boolean;
	onCancellationRequested: vscode.Event<any>;

	constructor(isCancellationRequested: boolean, onCancellationRequested: vscode.Event<any>) {
		this.isCancellationRequested = isCancellationRequested;
		this.onCancellationRequested = onCancellationRequested;
	}

	toString(): string {
		return `CSChatCancellationToken { isCancellationRequested: "${this.isCancellationRequested}", onCancellationRequested: "${this.onCancellationRequested}" }`;
	}
}

export class CSChatProvider implements vscode.InteractiveSessionProvider<CSChatSession> {
	chatSession: CSChatSession | undefined;

	codeGraph: CodeGraph;
	embeddingsIndex: EmbeddingsSearch;
	projectManagement: TSMorphProjectManagement;
	pythonServer: PythonServer;
	workingDirectory: string;
	testSuiteRunCommand: string;

	constructor({
		codeGraph, embeddingsIndex, projectManagement, pythonServer, workingDirectory, testSuiteRunCommand
	}: CSChatProviderType) {
		logger.info('CSChatProvider constructor');
		this.embeddingsIndex = embeddingsIndex;
		this.codeGraph = codeGraph;
		this.projectManagement = projectManagement;
		this.pythonServer = pythonServer;
		this.workingDirectory = workingDirectory;
		this.testSuiteRunCommand = testSuiteRunCommand;
	}

	prepareSession(initialState: CSChatSessionState | undefined, token: CSChatCancellationToken): vscode.ProviderResult<CSChatSession> {
		logger.info('prepareSession', initialState, token);
		this.chatSession = new CSChatSession(
			new CSChatParticipant('You'),
			new CSChatParticipant('Aide'),
			'What can I help you accomplish today?'
		);
		return this.chatSession;
	}

	resolveRequest(session: CSChatSession, context: CSChatRequestArgs | string, token: CSChatCancellationToken): vscode.ProviderResult<CSChatRequest> {
		logger.info('resolveRequest', session, context, token);
		return new CSChatRequest(session, new CSChatReplyFollowup('Hello there!'));
	}

	provideResponseWithProgress(request: CSChatRequest, progress: vscode.Progress<CSChatProgress>, token: CSChatCancellationToken): vscode.ProviderResult<CSChatResponseForProgress> {
		logger.info(`[provideResponseWithProgress]: ${request.toString()} ${progress.toString()} ${token.toString()}`);
		const requestSession = request.session;
		const activeRequest = requestSession.getActiveRequest();
		const message = request.message;

		if (!activeRequest || activeRequest.requestId !== request.requestId) {
			if (activeRequest) {
				logger.info(`[provideResponseWithProgress]: Removing active request: ${activeRequest.toString()}`);
				requestSession.removeActiveRequest();
			}

			logger.info('Starting debug flow');
			const toolingEventCollection = new ToolingEventCollection(
				`/tmp/${uuidv4()}`,
				this.codeGraph,
				undefined,
				this,
				message.toString(),
			);

			debuggingFlow(
				request.toString(),
				toolingEventCollection,
				this.codeGraph,
				this.embeddingsIndex,
				this.projectManagement,
				this.pythonServer,
				this.workingDirectory,
				this.testSuiteRunCommand,
			);

			return new CSChatResponseForProgress(new CSChatResponseErrorDetails('Procesing', true));
		} else if (activeRequest.requestId === request.requestId) {
			logger.info(`Preparing responses for requestId: ${request.requestId}`);
			const responses = request.processPendingResponses();
			logger.info(`Found ${responses.length} responses`);
			for (const response of responses) {
				logger.info('Sending response to chat:' + response.toString());
				progress.report(response);
			}
			return new CSChatResponseForProgress(new CSChatResponseErrorDetails('Response', request.isProcessing()));
		}
	}

	provideFollowups(session: CSChatSession, token: vscode.CancellationToken): vscode.ProviderResult<(string | CSChatSessionFollowup)[]> {
		logger.info('provideFollowups', session, token);
		return [
			new CSChatReplyFollowup('Hello there followup!'),
		];
	}

	removeRequest(session: CSChatSession, requestId: string) {
		logger.info('removeRequest', session, requestId);
		session.removeActiveRequest();
	}
}
