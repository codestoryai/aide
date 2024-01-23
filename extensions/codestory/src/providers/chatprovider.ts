/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import { v4 as uuidv4 } from 'uuid';

import logger from '../logger';
import { CSChatState } from '../chatState/state';
import { getSelectedCodeContextForExplain } from '../utilities/getSelectionContext';
import { logChatPrompt, logSearchPrompt } from '../posthog/logChatPrompt';
import { reportFromStreamToSearchProgress } from '../chatState/convertStreamToMessage';
import { CodeGraph } from '../codeGraph/graph';
import { debuggingFlow } from '../llm/recipe/debugging';
import { ToolingEventCollection } from '../timeline/events/collection';
import { ActiveFilesTracker } from '../activeChanges/activeFilesTracker';
import { UserMessageType, deterministicClassifier } from '../chatState/promptClassifier';
import { CodeSymbolsLanguageCollection } from '../languages/codeSymbolsLanguageCollection';
import { RepoRef, SideCarClient } from '../sidecar/client';
import { ProjectContext } from '../utilities/workspaceContext';
import { AdjustedLineContent, AnswerSplitOnNewLineAccumulator, AnswerStreamContext, AnswerStreamLine, LineContent, LineIndentManager, StateEnum } from './reportEditorSessionAnswerStream';
import { IndentStyleSpaces, IndentationHelper } from './editorSessionProvider';
import { InLineAgentContextSelection } from '../sidecar/types';
import { getUniqueId } from '../utilities/uniqueId';

class CSChatParticipant implements vscode.CSChatSessionParticipantInformation {
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

class CSChatSession implements vscode.CSChatSession {
	requester: CSChatParticipant;
	responder: CSChatParticipant;
	inputPlaceholder?: string | undefined;

	constructor(
		requester: CSChatParticipant,
		responder: CSChatParticipant,
		agentCustomInstruction: string | null,
		inputPlaceholder?: string | undefined,
	) {
		this.requester = requester;
		this.responder = responder;
		this.inputPlaceholder = inputPlaceholder;
	}

	toString(): string {
		return `CSChatSession { requester: ${this.requester.toString()}, responder: ${this.responder.toString()}, inputPlaceholder: "${this.inputPlaceholder}" }`;
	}
}

class CSChatReplyFollowup implements vscode.CSChatSessionReplyFollowup {
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

export class CSChatRequest implements vscode.CSChatAgentRequest {
	threadId: string;
	prompt: string;
	variables: Record<string, vscode.CSChatVariableValue[]>;
	slashCommand?: vscode.ChatAgentSlashCommand;

	constructor(threadId: string, prompt: string, variables: Record<string, vscode.CSChatVariableValue[]> = {}, slashCommand?: vscode.ChatAgentSlashCommand) {
		this.threadId = threadId;
		this.prompt = prompt;
		this.variables = variables;
		this.slashCommand = slashCommand;
	}

	toString(): string {
		return `CSChatRequest { threadId: "${this.threadId}", prompt: "${this.prompt}", variables: ${JSON.stringify(this.variables, null, 2)}, slashCommand: ${this.slashCommand?.toString()} }`;
	}
}

class CSChatResponseErrorDetails implements vscode.ChatAgentErrorDetails {
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

export class CSChatProgressContent implements vscode.ChatAgentContent {
	content: string;

	constructor(content: string) {
		this.content = content;
	}

	toString(): string {
		return `CSChatProgressContent { content: "${this.content}" }`;
	}
}

export class CSChatProgressUsedContext implements vscode.ChatAgentUsedContext {
	documents: vscode.ChatAgentDocumentContext[];

	constructor(documents: vscode.ChatAgentDocumentContext[]) {
		this.documents = documents;
	}

	toString(): string {
		return `CSChatProgressUsedContext { documents: ${JSON.stringify(this.documents, null, 2)} }`;
	}
}

export class CSChatContentReference implements vscode.ChatAgentContentReference {
	reference: vscode.Uri | vscode.Location;

	constructor(reference: vscode.Uri | vscode.Location) {
		this.reference = reference;
	}

	toString(): string {
		return `CSChatContentReference { reference: "${this.reference}" }`;
	}
}

export class CSChatInlineContentReference implements vscode.ChatAgentInlineContentReference {
	inlineReference: vscode.Uri | vscode.Location;
	title?: string;

	constructor(inlineReference: vscode.Uri | vscode.Location) {
		this.inlineReference = inlineReference;
	}

	toString(): string {
		return `CSChatInlineContentReference { inlineReference: "${this.inlineReference}", title: "${this.title}" }`;
	}
}

export class CSChatFileTreeData implements vscode.ChatAgentFileTreeData {
	label: string;
	uri: vscode.Uri;
	children?: CSChatFileTreeData[] | undefined;

	constructor(label: string, uri: vscode.Uri, children?: CSChatFileTreeData[] | undefined) {
		this.label = label;
		this.uri = uri;
		this.children = children;
	}

	toString(): string {
		return `CSChatFileTreeData { label: "${this.label}", uri: "${this.uri}", children: ${JSON.stringify(this.children, null, 2)} }`;
	}
}

export class CSChatProgressFileTree implements vscode.ChatAgentFileTree {
	treeData: CSChatFileTreeData;

	constructor(treeData: CSChatFileTreeData) {
		this.treeData = treeData;
	}

	toString(): string {
		return `CSChatProgressFileTree { treeData: "${this.treeData}" }`;
	}
}

export class CSChatProgressTask implements vscode.ChatAgentTask {
	placeholder: string;
	resolvedContent: Thenable<CSChatProgressContent | CSChatProgressFileTree>;

	constructor(placeholder: string, resolvedContent: Thenable<CSChatProgressContent | CSChatProgressFileTree>) {
		this.placeholder = placeholder;
		this.resolvedContent = resolvedContent;
	}

	toString(): string {
		return `CSChatProgressTask { placeholder: "${this.placeholder}", resolvedContent: "${this.resolvedContent}" }`;
	}
}

export type CSChatProgress = CSChatProgressContent | CSChatProgressTask | CSChatProgressFileTree | CSChatProgressUsedContext | CSChatContentReference | CSChatInlineContentReference;

class CSChatResponseForProgress implements vscode.ChatAgentResult2 {
	errorDetails?: CSChatResponseErrorDetails | undefined;

	constructor(errorDetails?: CSChatResponseErrorDetails | undefined) {
		this.errorDetails = errorDetails;
	}

	toString(): string {
		return `CSChatResponseForProgress { errorDetails: ${this.errorDetails?.toString()} }`;
	}
}

export class CSChatCancellationToken implements vscode.CancellationToken {
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

export class CSChatSessionProvider implements vscode.CSChatSessionProvider<CSChatSession> {
	provideWelcomeMessage?(token: CSChatCancellationToken): vscode.ProviderResult<vscode.CSChatWelcomeMessageContent[]> {
		logger.info('provideWelcomeMessage', token);
		return [
			'Hi, I\'m **Aide**, your personal coding assistant! I can find, understand, explain, debug or write code for you. Here are a few things you can ask me:',
			[
				new CSChatReplyFollowup('Explain the active file in the editor'),
				new CSChatReplyFollowup('Add documentation to the selected code'),
				new CSChatReplyFollowup('How can I clean up this code?'),
			]
		];
	}

	prepareSession(token: CSChatCancellationToken): vscode.ProviderResult<CSChatSession> {
		logger.info('prepareSession', token);
		const userUri = vscode.Uri.joinPath(
			vscode.extensions.getExtension('codestory-ghost.codestoryai')?.extensionUri ?? vscode.Uri.parse(''),
			'assets',
			'aide-user.png'
		);
		const agentUri = vscode.Uri.joinPath(
			vscode.extensions.getExtension('codestory-ghost.codestoryai')?.extensionUri ?? vscode.Uri.parse(''),
			'assets',
			'aide-agent.png'
		);
		return new CSChatSession(
			new CSChatParticipant(getUniqueId(), userUri),
			new CSChatParticipant('Aide', agentUri),
			'',
			'Try using /, # or @ to find specific commands',
		);
	}
}

export class CSChatAgentProvider implements vscode.Disposable {
	private chatAgent: vscode.ChatAgent2;

	private _chatSessionState: CSChatState;
	private _codeGraph: CodeGraph;
	private _codeSymbolsLanguageCollection: CodeSymbolsLanguageCollection;
	private _workingDirectory: string;
	private _testSuiteRunCommand: string;
	private _activeFilesTracker: ActiveFilesTracker;
	private _repoName: string;
	private _repoHash: string;
	private _uniqueUserId: string;
	private _agentCustomInformation: string | null;
	private _sideCarClient: SideCarClient;
	private _currentRepoRef: RepoRef;
	private _projectContext: ProjectContext;

	constructor(
		workingDirectory: string,
		codeGraph: CodeGraph,
		repoName: string,
		repoHash: string,
		codeSymbolsLanguageCollection: CodeSymbolsLanguageCollection,
		testSuiteRunCommand: string,
		activeFilesTracker: ActiveFilesTracker,
		uniqueUserId: string,
		agentCustomInstruction: string | null,
		sideCarClient: SideCarClient,
		repoRef: RepoRef,
		projectContext: ProjectContext,
	) {
		this._workingDirectory = workingDirectory;
		this._codeGraph = codeGraph;
		this._repoHash = repoHash;
		this._repoName = repoName;
		this._codeSymbolsLanguageCollection = codeSymbolsLanguageCollection;
		this._testSuiteRunCommand = testSuiteRunCommand;
		this._activeFilesTracker = activeFilesTracker;
		this._uniqueUserId = uniqueUserId;
		this._agentCustomInformation = agentCustomInstruction;
		this._sideCarClient = sideCarClient;
		this._currentRepoRef = repoRef;
		this._projectContext = projectContext;
		this._chatSessionState = new CSChatState(null);

		this.chatAgent = vscode.csChat.createChatAgent('', this.defaultAgent);
		this.chatAgent.isDefault = true;
		this.chatAgent.supportIssueReporting = true;
		this.chatAgent.description = 'Try using /, # or @ to find specific commands';
		this.chatAgent.sampleRequest = 'Explain the active file in the editor';
		this.chatAgent.iconPath = vscode.Uri.joinPath(
			vscode.extensions.getExtension('codestory-ghost.codestoryai')?.extensionUri ?? vscode.Uri.parse(''),
			'assets',
			'aide-white.svg'
		);
		this.chatAgent.slashCommandProvider = this.slashCommandProvider;
		this.chatAgent.editsProvider = this.editsProvider;
	}

	defaultAgent: vscode.CSChatAgentExtendedHandler = (request, context, progress, token) => {
		return (async () => {
			let requestType: UserMessageType = 'general';
			const slashCommand = request.slashCommand?.name;
			if (slashCommand) {
				requestType = slashCommand as UserMessageType;
			} else {
				const deterministicRequestType = deterministicClassifier(request.prompt.toString());
				if (deterministicRequestType) {
					requestType = deterministicRequestType;
				}
			}
			logger.info(`[codestory][request_type][provideResponseWithProgress] ${requestType}`);
			if (requestType === 'instruction') {
				const prompt = request.prompt.toString().slice(7).trim();
				if (prompt.length === 0) {
					return new CSChatResponseForProgress(new CSChatResponseErrorDetails('Please provide a prompt for the agent to work on'));
				}

				const toolingEventCollection = new ToolingEventCollection(
					`/tmp/${uuidv4()}`,
					{ progress, cancellationToken: token },
					prompt,
				);

				const uniqueId = uuidv4();
				await debuggingFlow(
					prompt,
					toolingEventCollection,
					this._sideCarClient,
					this._codeSymbolsLanguageCollection,
					this._workingDirectory,
					this._testSuiteRunCommand,
					this._activeFilesTracker,
					uniqueId,
					this._agentCustomInformation,
					this._currentRepoRef,
				);
				return new CSChatResponseForProgress();
			} else if (requestType === 'explain') {
				// Implement the explain feature here
				const explainString = request.prompt.toString().slice('/explain'.length).trim();
				const currentSelection = getSelectedCodeContextForExplain(this._workingDirectory, this._currentRepoRef);
				if (currentSelection === null) {
					progress.report(new CSChatProgressContent('Selecting code on the editor can help us explain it better'));
					return new CSChatResponseForProgress();
				} else {
					const explainResponse = await this._sideCarClient.explainQuery(explainString, this._currentRepoRef, currentSelection, request.threadId);
					await reportFromStreamToSearchProgress(explainResponse, progress, token, this._currentRepoRef, this._workingDirectory);
					return new CSChatResponseForProgress();
				}
			} else if (requestType === 'search') {
				logSearchPrompt(
					request.prompt.toString(),
					this._repoName,
					this._repoHash,
					this._uniqueUserId,
				);
				const searchString = request.prompt.toString().slice('/search'.length).trim();
				const searchResponse = await this._sideCarClient.searchQuery(searchString, this._currentRepoRef, request.threadId);
				await reportFromStreamToSearchProgress(searchResponse, progress, token, this._currentRepoRef, this._workingDirectory);
				// We get back here a bunch of responses which we have to pass properly to the agent
				return new CSChatResponseForProgress();
			} else {
				this._chatSessionState.cleanupChatHistory();
				this._chatSessionState.addUserMessage(request.prompt.toString());
				const query = request.prompt.toString().trim();
				logChatPrompt(
					request.prompt.toString(),
					this._repoName,
					this._repoHash,
					this._uniqueUserId,
				);
				const projectLabels = this._projectContext.labels;
				const followupResponse = await this._sideCarClient.followupQuestion(query, this._currentRepoRef, request.threadId, request.variables, projectLabels);
				await reportFromStreamToSearchProgress(followupResponse, progress, token, this._currentRepoRef, this._workingDirectory);
				return new CSChatResponseForProgress();
			}
		})();
	};

	slashCommandProvider: vscode.ChatAgentSlashCommandProvider = {
		provideSlashCommands: (token: vscode.CancellationToken): vscode.ProviderResult<vscode.ChatAgentSlashCommand[]> => {
			return [
				{
					name: 'explain',
					description: 'Describe or refer to code you\'d like to understand',
				},
				{
					name: 'search',
					description: 'Describe a workflow to find',
				},
			];
		}
	};

	editsProvider: vscode.CSChatEditProvider = {
		provideEdits: async (request, progress, token) => {
			console.log('we are providing edits');
			logger.info('provideEditsWithProgress', request, progress, token);
			// Notes to @theskcd: This API currently applies the edits without any decoration.
			//
			// WIP items on editor side, in order of priority:
			// 1. When edits are made, add a decoration to the changes to highlight agent changes.
			// 2. Displaying the list of edits performed in the chat widget as links (something like the references box).
			// 3. Allow cancelling an ongoing edit operation.
			// 4. Add options above the inline decorations and in the chat widget to accept/reject the changes.
			// 5. Add an option to export all codeblocks within a response, rather than one at a time. The API already
			// accepts a list so your implementation need not change.
			//
			// The code below uses the open file for testing purposes.
			// You can pass in any file uri(s) and it should apply correctly.
			const activeDocument = vscode.window.activeTextEditor?.document;
			if (!activeDocument) {
				return { edits: new vscode.WorkspaceEdit(), codeBlockIndex: 0 };
			}
			const filePath = activeDocument.uri.fsPath;
			const fileContent = activeDocument.getText();
			const language = activeDocument.languageId;
			const activeEditorUri = vscode.window.activeTextEditor?.document.uri;
			const codeblocks = request.context;
			if (activeEditorUri && codeblocks.length > 0) {
				for (const codeblock of codeblocks) {
					const llmContent = codeblock.code;
					const codeBlockIndex = codeblock.codeBlockIndex;
					const messageContent = request.response;
					const sessionId = request.threadId;
					const editFileResponseStream = await this._sideCarClient.editFileRequest(
						filePath,
						fileContent,
						language,
						llmContent,
						messageContent,
						codeBlockIndex,
						sessionId,
					);
					let enteredTextEdit = false;
					let startOfEdit = false;
					let answerSplitOnNewLineAccumulator = new AnswerSplitOnNewLineAccumulator();
					let streamProcessor = null;
					let finalAnswer = '';
					for await (const editResponse of editFileResponseStream) {
						if ('TextEditStreaming' in editResponse) {
							const textEditStreaming = editResponse.TextEditStreaming.data;
							if ('Start' in textEditStreaming) {
								startOfEdit = true;
								const codeBlockIndex = textEditStreaming.Start.code_block_index;
								const agentContext = textEditStreaming.Start.context_selection;
								console.log('agentContext');
								console.log(agentContext);
								streamProcessor = new StreamProcessor(
									progress,
									activeDocument,
									activeDocument.getText().split(/\r\n|\r|\n/g),
									agentContext,
									undefined,
									activeEditorUri,
									codeBlockIndex,
								);
								answerSplitOnNewLineAccumulator = new AnswerSplitOnNewLineAccumulator();
								continue;
							}
							if ('EditStreaming' in textEditStreaming) {
								const codeBlockIndex = textEditStreaming.EditStreaming.code_block_index;
								answerSplitOnNewLineAccumulator.addDelta(textEditStreaming.EditStreaming.content_delta);
								// check if we can get any lines back here
								while (true) {
									const currentLine = answerSplitOnNewLineAccumulator.getLine();
									if (currentLine === null) {
										break;
									}
									// Let's process the line
									if (streamProcessor !== null) {
										streamProcessor.processLine(currentLine);
									}
									finalAnswer = finalAnswer + currentLine.line + '\n';
								}
							}
							if ('End' in textEditStreaming) {
								startOfEdit = false;
								enteredTextEdit = false;
								streamProcessor = null;
								answerSplitOnNewLineAccumulator = new AnswerSplitOnNewLineAccumulator();
								finalAnswer = '';
							}
						}
					}
				}
			}
			return { edits: new vscode.WorkspaceEdit(), codeBlockIndex: 0 };
		}
	};

	dispose() {
		console.log('Dispose CSChatAgentProvider');
	}
}


class StreamProcessor {
	filePathMarker: string;
	beginMarker: string;
	endMarker: string;
	document: DocumentManager;
	currentState: StateEnum;
	endDetected: boolean;
	beginDetected: boolean;
	previousLine: LineIndentManager | null;
	documentLineIndex: number;
	sentEdits: boolean;
	uri: vscode.Uri;
	constructor(progress: vscode.Progress<vscode.CSChatAgentEditResponse>,
		document: vscode.TextDocument,
		lines: string[],
		contextSelection: InLineAgentContextSelection,
		indentStyle: IndentStyleSpaces | undefined,
		uri: vscode.Uri,
		codeBlockIndex: number,
	) {
		// Initialize document with the given parameters
		this.document = new DocumentManager(
			progress,
			document,
			lines,
			contextSelection,
			indentStyle,
			uri,
			codeBlockIndex,
		);

		// Set markers for file path, begin, and end
		this.filePathMarker = '// FILEPATH:';
		this.beginMarker = '// BEGIN';
		this.endMarker = '// END';
		this.beginDetected = false;
		this.endDetected = false;
		this.currentState = StateEnum.Initial;
		this.previousLine = null;
		this.documentLineIndex = this.document.firstSentLineIndex;
		this.sentEdits = false;
		this.uri = uri;
	}

	async processLine(answerStreamLine: AnswerStreamLine) {
		// console.log('prepareLine', answerStreamLine.line, this.documentLineIndex);
		if (answerStreamLine.context !== AnswerStreamContext.InCodeBlock) {
			return;
		}
		const line = answerStreamLine.line;
		if (line.startsWith(this.filePathMarker) && this.currentState === StateEnum.Initial) {
			this.currentState = StateEnum.InitialAfterFilePath;
			return;
		}
		if (line.startsWith(this.beginMarker) || line.startsWith(this.endMarker)) {
			this.endDetected = true;
			return;
		}
		if (this.endDetected && (this.currentState === StateEnum.InitialAfterFilePath || this.currentState === StateEnum.InProgress)) {
			if (this.previousLine) {
				// if previous line is there, then we can reindent the current line
				// contents here
				const adjustedLine = this.previousLine.reindent(line, this.document.indentStyle);
				// find the anchor point for the current line
				const anchor = this.findAnchor(adjustedLine, this.documentLineIndex);
				if (anchor !== null) {
					this.sentEdits = true;
					// if no anchor line, then we have to replace the current line
					console.log('replaceLines', this.documentLineIndex, anchor, adjustedLine);
					this.documentLineIndex = this.document.replaceLines(this.documentLineIndex, anchor, adjustedLine);
				} else if (this.documentLineIndex >= this.document.getLineCount()) {
					// we found the anchor point but we have more lines in our own index
					// than the original document, so here the right thing to do is
					// append to the document
					this.sentEdits = true;
					console.log('appendLine', adjustedLine, this.document.getLineCount());
					this.documentLineIndex = this.document.appendLine(adjustedLine);
				} else {
					// we need to get the current line right now
					const currentLine = this.document.getLine(this.documentLineIndex);
					this.sentEdits = true;
					// console.log(this.documentLineIndex, currentLine.content);
					// TODO(skcd): This bit is a bit unclear, so lets try to understand this properly
					// isSent is set when we are part of the original lines
					// if the current line has an indent level which is less than the adjusted line indent level
					// then we are trying to insert the line after the previous line
					// otherwise we just replace
					// to think of this we can imagine a scenario like the following:
					// def fun(a, b):
					//    if a > 0:
					// 		return a + b <- adjusted line
					//   else: < - original current line
					//      return a - b
					// since adjusted line is indented more, we want to insert it after the previous document line
					// but if that's not the case, then we just replace the current line
					if (!currentLine.isSent || adjustedLine.adjustedContent === '' || (currentLine.content !== '' && currentLine.indentLevel < adjustedLine.adjustedIndentLevel)) {
						console.log('insertLineAfter', this.documentLineIndex - 1, adjustedLine);
						this.documentLineIndex = this.document.insertLineAfter(this.documentLineIndex - 1, adjustedLine);
					} else {
						console.log('replaceLine', this.documentLineIndex, adjustedLine);
						this.documentLineIndex = this.document.replaceLine(this.documentLineIndex, adjustedLine);
					}
				}
			} else {
				const initialAnchor = this.findInitialAnchor(line);
				this.previousLine = new LineIndentManager(this.document.getLine(initialAnchor).indentLevel, line);
				const adjustedInitialLine = this.previousLine.reindent(line, this.document.indentStyle);
				console.log('noPreviousLine', 'replaceLine', initialAnchor, adjustedInitialLine);
				this.documentLineIndex = this.document.replaceLine(initialAnchor, adjustedInitialLine);
			}
			this.beginDetected = true;
		}
		return this.beginDetected;
	}

	// Find the initial anchor line in the document
	findInitialAnchor(lineContent: string): number {
		const trimmedContent = lineContent.trim();
		for (let index = this.document.firstSentLineIndex; index < this.document.getLineCount(); index++) {
			const line = this.document.getLine(index);
			if (line.isSent && line.trimmedContent === trimmedContent) {
				return index;
			}
		}
		return this.document.firstRangeLine;
	}

	// Find the anchor line in the document based on indentation and content
	findAnchor(adjustedLine: AdjustedLineContent, startIndex: number): number | null {
		for (let index = startIndex; index < this.document.getLineCount(); index++) {
			const line = this.document.getLine(index);
			if (line.isSent) {
				// This checks for when we want to insert code which has more indent
				// that the current line, but in that case we can never find an anchor
				// cause our code is deeper than the code which is present on the line
				if (line.trimmedContent.length > 0 && line.indentLevel < adjustedLine.adjustedIndentLevel) {
					return null;
				}
				if (line.content === adjustedLine.adjustedContent) {
					return index;
				}
			}
		}
		return null;
	}
}


class DocumentManager {
	indentStyle: IndentStyleSpaces;
	progress: vscode.Progress<vscode.CSChatAgentEditResponse>;
	lines: LineContent[];
	firstSentLineIndex: number;
	firstRangeLine: number;
	uri: vscode.Uri;
	codeBlockIndex: number;

	constructor(
		progress: vscode.Progress<vscode.CSChatAgentEditResponse>,
		document: vscode.TextDocument,
		lines: string[],
		// Fix the way we provide context over here?
		contextSelection: InLineAgentContextSelection,
		indentStyle: IndentStyleSpaces | undefined,
		uri: vscode.Uri,
		codeBlockIndex: number,
	) {
		this.progress = progress; // Progress tracking
		this.lines = []; // Stores all the lines in the document
		this.indentStyle = IndentationHelper.getDocumentIndentStyle(lines, indentStyle);
		this.codeBlockIndex = codeBlockIndex;
		// this.indentStyle = IndentationHelper.getDocumentIndentStyleUsingSelection(contextSelection); // Determines the indentation style

		// Split the editor's text into lines and initialize each line
		const editorLines = document.getText().split(/\r\n|\r|\n/g);
		for (let i = 0; i < editorLines.length; i++) {
			this.lines[i] = new LineContent(editorLines[i], this.indentStyle);
		}

		// Mark the lines as 'sent' based on the location provided
		const locationSections = [contextSelection.range];
		for (const section of locationSections) {
			for (let j = 0; j < section.lines.length; j++) {
				const lineIndex = section.first_line_index + j;
				this.lines[lineIndex].markSent();
			}
		}

		this.firstSentLineIndex = contextSelection.range.first_line_index;

		// Determine the index of the first 'sent' line
		// this.firstSentLineIndex = contextSelection.above.has_content
		// 	? contextSelection.above.first_line_index
		// 	: contextSelection.range.first_line_index;

		// this.firstRangeLine = contextSelection.range.first_line_index;
		this.firstRangeLine = contextSelection.range.first_line_index;
		this.uri = uri;
	}

	// Returns the total number of lines
	getLineCount() {
		return this.lines.length;
	}

	// Retrieve a specific line
	getLine(index: number): LineContent {
		return this.lines[index];
	}

	// Replace a specific line and report the change
	replaceLine(index: number, newLine: AdjustedLineContent) {
		// console.log('replaceLine');
		// console.log('replaceLine', index, newLine);
		this.lines[index] = new LineContent(newLine.adjustedContent, this.indentStyle);
		const edits = new vscode.WorkspaceEdit();
		// console.log('What line are we replaceLine', newLine.adjustedContent);
		edits.replace(this.uri, new vscode.Range(index, 0, index, 1000), newLine.adjustedContent);
		this.progress.report({ edits, codeBlockIndex: this.codeBlockIndex });
		return index + 1;
	}

	// Replace multiple lines starting from a specific index
	replaceLines(startIndex: number, endIndex: number, newLine: AdjustedLineContent) {
		// console.log('replaceLine');
		// console.log('replaceLines', startIndex, endIndex, newLine);
		if (startIndex === endIndex) {
			return this.replaceLine(startIndex, newLine);
		} else {
			this.lines.splice(
				startIndex,
				endIndex - startIndex + 1,
				new LineContent(newLine.adjustedContent, this.indentStyle)
			);
			const edits = new vscode.WorkspaceEdit();
			if (newLine.adjustedContent === '') {
				console.log('[extension]empty_line', 'replace_lines');
			}
			console.log('What line are we replaceLines', newLine.adjustedContent, startIndex, endIndex);
			edits.replace(this.uri, new vscode.Range(startIndex, 0, endIndex, 1000), newLine.adjustedContent);
			this.progress.report({ edits, codeBlockIndex: this.codeBlockIndex });
			return startIndex + 1;
		}
	}

	// Add a new line at the end
	appendLine(newLine: AdjustedLineContent) {
		// console.log('appendLine');
		// console.log('appendLine', newLine);
		this.lines.push(new LineContent(newLine.adjustedContent, this.indentStyle));
		const edits = new vscode.WorkspaceEdit();
		// console.log('what line are we appendLine', newLine.adjustedContent);
		edits.replace(this.uri, new vscode.Range(this.lines.length - 1, 1000, this.lines.length - 1, 1000), '\n' + newLine.adjustedContent);
		this.progress.report({ edits, codeBlockIndex: this.codeBlockIndex });
		return this.lines.length;
	}

	// Insert a new line after a specific index
	insertLineAfter(index: number, newLine: AdjustedLineContent) {
		// console.log('insertLineAfter');
		// console.log('insertLineAfter', index, newLine);
		this.lines.splice(index + 1, 0, new LineContent(newLine.adjustedContent, this.indentStyle));
		const edits = new vscode.WorkspaceEdit();
		// console.log('what line are we inserting insertLineAfter', newLine.adjustedContent);
		edits.replace(this.uri, new vscode.Range(index, 1000, index, 1000), '\n' + newLine.adjustedContent);
		this.progress.report({ edits, codeBlockIndex: this.codeBlockIndex });
		return index + 2;
	}
}
