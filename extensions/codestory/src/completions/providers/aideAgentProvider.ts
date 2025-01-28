/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as http from 'http';
import * as net from 'net';
import * as os from 'os';
import * as vscode from 'vscode';

import { AnswerSplitOnNewLineAccumulatorStreaming, StreamProcessor } from '../../chatState/convertStreamToMessage';
import { CSEventHandler } from '../../csEvents/csEventHandler';
import postHogClient from '../../posthog/client';
import { applyEdits, applyEditsDirectly, } from '../../server/applyEdits';
import { createFileIfNotExists } from '../../server/createFile';
import { RecentEditsRetriever } from '../../server/editedFiles';
import { handleRequest } from '../../server/requestHandler';
import { EditedCodeStreamingRequest, SideCarAgentEvent, SidecarApplyEditsRequest, SidecarContextEvent, SidecarUndoPlanStep, ToolInputPartial } from '../../server/types';
import { RepoRef, SideCarClient } from '../../sidecar/client';
import { getUniqueId, getUserId } from '../../utilities/uniqueId';
import { ProjectContext } from '../../utilities/workspaceContext';

/**
 * Stores the necessary identifiers required for identifying a response stream
 */
interface ResponseStreamIdentifier {
	sessionId: string;
	exchangeId: string;
}

class AideResponseStreamCollection {
	private responseStreamCollection: Map<string, vscode.AideAgentEventSenderResponse> = new Map();

	constructor(private extensionContext: vscode.ExtensionContext, private sidecarClient: SideCarClient, private aideAgentSessionProvider: AideAgentSessionProvider) {
		this.extensionContext = extensionContext;
		this.sidecarClient = sidecarClient;

	}
	getKey(responseStreamIdentifier: ResponseStreamIdentifier): string {
		return `${responseStreamIdentifier.sessionId}-${responseStreamIdentifier.exchangeId}`;
	}

	addResponseStream(responseStreamIdentifier: ResponseStreamIdentifier, responseStream: vscode.AideAgentEventSenderResponse) {
		this.extensionContext.subscriptions.push(responseStream.token.onCancellationRequested(() => {
			// over here we get the stream of events from the cancellation
			// we need to send it over on the stream as usual so we can work on it
			// we can send empty access token here since we are not making llm calls
			// on the sidecar... pretty sure I will forget and scream at myself later on
			// for having herd knowledged like this
			const responseStreamAnswer = this.sidecarClient.cancelRunningEvent(responseStreamIdentifier.sessionId, responseStreamIdentifier.exchangeId, this.aideAgentSessionProvider.editorUrl!, '');
			this.aideAgentSessionProvider.reportAgentEventsToChat(responseStreamIdentifier.sessionId, true, responseStreamAnswer);
		}));
		this.responseStreamCollection.set(this.getKey(responseStreamIdentifier), responseStream);
	}

	getResponseStream(responseStreamIdentifier: ResponseStreamIdentifier): vscode.AideAgentEventSenderResponse | undefined {
		return this.responseStreamCollection.get(this.getKey(responseStreamIdentifier));
	}

	removeResponseStream(responseStreamIdentifer: ResponseStreamIdentifier) {
		this.responseStreamCollection.delete(this.getKey(responseStreamIdentifer));
	}

	getAllResponseStreams(): vscode.AideAgentEventSenderResponse[] {
		return Array.from(this.responseStreamCollection.values());
	}
}

class SidecarConnectionFailedError extends Error {
	constructor(message = '', ...args: any[]) {
		const errorMessage = message || 'Connection error with sidecar. We\'d appreciate it if you could report this session using the feedback tool above - this is on us';
		super(errorMessage, ...args);
	}
}


export class AideAgentSessionProvider implements vscode.AideSessionParticipant {
	private aideAgent: vscode.AideSessionAgent;
	private lastThinkingText: Map<string, string> = new Map();

	editorUrl: string | undefined;
	private iterationEdits = new vscode.WorkspaceEdit();
	private requestHandler: http.Server | null = null;
	private editsMap = new Map();
	private eventQueue: vscode.AideAgentRequest[] = [];
	private openResponseStream: vscode.AideAgentResponseStream | undefined;
	private processingEvents: Map<string, boolean> = new Map();
	private responseStreamCollection: AideResponseStreamCollection;
	private recentEditsRetriever: RecentEditsRetriever;
	// private sessionId: string | undefined;
	// this is a hack to test the theory that we can keep snapshots and make
	// that work
	private editCounter = 0;
	private startedStreams = new Set<string>();

	private async isPortOpen(port: number): Promise<boolean> {
		return new Promise((resolve, _) => {
			const s = net.createServer();
			s.once('error', (err) => {
				s.close();
				// @ts-ignore
				if (err['code'] === 'EADDRINUSE') {
					resolve(false);
				} else {
					resolve(false); // or throw error!!
					// reject(err);
				}
			});
			s.once('listening', () => {
				resolve(true);
				s.close();
			});
			s.listen(port);
		});
	}

	private async getNextOpenPort(startFrom: number = 42427) {
		let openPort: number | null = null;
		while (startFrom < 65535 || !!openPort) {
			if (await this.isPortOpen(startFrom)) {
				openPort = startFrom;
				break;
			}
			startFrom++;
		}
		return openPort;
	}

	constructor(
		private currentRepoRef: RepoRef,
		private projectContext: ProjectContext,
		private sidecarClient: SideCarClient,
		private csEventHandler: CSEventHandler,
		recentEditsRetriever: RecentEditsRetriever,
		extensionContext: vscode.ExtensionContext,
	) {
		this.requestHandler = http.createServer(
			handleRequest(
				this.provideEdit.bind(this),
				this.provideEditStreamed.bind(this),
				this.newExchangeIdForSession.bind(this),
				recentEditsRetriever.retrieveSidecar.bind(recentEditsRetriever),
				this.undoToCheckpoint.bind(this),
			)
		);
		this.recentEditsRetriever = recentEditsRetriever;
		this.getNextOpenPort().then((port) => {
			if (port === null) {
				throw new Error('Could not find an open port');
			}

			// can still grab it by listenting to port 0
			this.requestHandler?.listen(port);
			const editorUrl = `http://localhost:${port}`;
			this.editorUrl = editorUrl;
		});

		this.aideAgent = vscode.aideAgent.createChatParticipant('aide', {
			newSession: this.newSession.bind(this),
			handleEvent: this.handleEvent.bind(this),
			// handleExchangeUserAction: this.handleExchangeUserAction.bind(this),
			// handleSessionUndo: this.handleSessionUndo.bind(this),
			// handleSessionIterationRequest: this.handleSessionIterationRequest.bind(this),
		});
		this.aideAgent.iconPath = vscode.Uri.joinPath(vscode.extensions.getExtension('codestory-ghost.codestoryai')?.extensionUri ?? vscode.Uri.parse(''), 'assets', 'aide-agent.png');
		this.aideAgent.requester = {
			name: getUserId(),
			icon: vscode.Uri.joinPath(vscode.extensions.getExtension('codestory-ghost.codestoryai')?.extensionUri ?? vscode.Uri.parse(''), 'assets', 'aide-user.png')
		};
		// our collection of active response streams for exchanges which are still running
		// apparantaly this also works??? crazy the world of js
		this.responseStreamCollection = new AideResponseStreamCollection(extensionContext, sidecarClient, this);
		this.aideAgent.supportIssueReporting = false;
		this.aideAgent.welcomeMessageProvider = {
			provideWelcomeMessage: async () => ({
				icon: new vscode.ThemeIcon('comment-discussion'),
				title: 'Assistant',
				message: new vscode.MarkdownString('Hi, I\'m **Aide**, your personal coding assistant! I can find, understand, explain, debug or write code for you.'),
			})
		};
	}

	async sendContextRecording(events: SidecarContextEvent[]) {
		await this.sidecarClient.sendContextRecording(events, this.editorUrl);
	}

	async undoToCheckpoint(request: SidecarUndoPlanStep): Promise<{
		success: boolean;
	}> {
		const exchangeId = request.exchange_id;
		const sessionId = request.session_id;
		const planStep = request.index;
		const responseStream = this.responseStreamCollection.getResponseStream({
			sessionId,
			exchangeId,
		});
		if (responseStream === undefined) {
			return {
				success: false,
			};
		}
		let label = exchangeId;
		if (planStep !== null) {
			label = `${exchangeId}::${planStep}`;
		}

		// This creates a very special code edit which is handled by the aideAgentCodeEditingService
		// where we intercept this edit and instead do a global rollback
		const edit = new vscode.WorkspaceEdit();
		edit.delete(vscode.Uri.file('/undoCheck'), new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, 0)), {
			label,
			needsConfirmation: false,
		});
		responseStream.stream.codeEdit(edit);
		return {
			success: true,
		};
	}

	async newExchangeIdForSession(sessionId: string): Promise<{
		exchange_id: string | undefined;
	}> {
		// TODO(skcd): Figure out when the close the exchange? This is not really
		// well understood but we should have an explicit way to do that
		const response = await this.aideAgent.initResponse(sessionId);
		if (response !== undefined) {
			this.responseStreamCollection.addResponseStream({
				sessionId,
				exchangeId: response.exchangeId,
			}, response);
		}
		return {
			exchange_id: response?.exchangeId,
		};
	}

	async provideEditStreamed(request: EditedCodeStreamingRequest): Promise<{
		fs_file_path: string;
		success: boolean;
	}> {
		// how does the response stream look over here
		const responseStream = this.responseStreamCollection.getResponseStream({
			exchangeId: request.exchange_id,
			sessionId: request.session_id,
		});

		// This is our uniqueEditId which we are using to tag the edits and make
		// sure that we can roll-back if required on the undo-stack
		let uniqueEditId = request.exchange_id;
		if (request.plan_step_id) {
			uniqueEditId = `${uniqueEditId}::${request.plan_step_id}`;
		}
		if (!request.apply_directly && !this.openResponseStream && !responseStream) {
			return {
				fs_file_path: '',
				success: false,
			};
		}
		// send a streamingstate widget over here that we have started editing
		/*
		responseStream?.stream.streamingState({
			exchangeId: request.exchange_id,
			sessionId: request.session_id,
			files: [request.fs_file_path],
			isError: false,
			state: 'editsStarted',
			loadingLabel: 'generating',
			message: 'Started editing',
		});
		*/
		const editStreamEvent = request;
		const fileDocument = editStreamEvent.fs_file_path;
		if ('Start' === editStreamEvent.event) {
			let document;
			try {
				document = await vscode.workspace.openTextDocument(fileDocument);
			} catch (exception) {
				// we might have an error here if the document does not exist on the disk
				// so we should create it at the very least and then try to open it
				const fileCreation = await createFileIfNotExists(vscode.Uri.file(fileDocument));
				if (fileCreation.success) {
					this.recentEditsRetriever.onDidCreateFiles({
						files: [vscode.Uri.file(fileDocument)]
					});
					// yay all good
					document = await vscode.workspace.openTextDocument(fileDocument);
				} else {
					vscode.window.showErrorMessage(`File creation at ${fileDocument} failed, please tell the devs!`);
				}
			}
			if (document === undefined || document === null) {
				return {
					fs_file_path: '',
					success: false,
				};
			}
			const documentLines = document.getText().split(/\r\n|\r|\n/g);
			this.editsMap.set(editStreamEvent.edit_request_id, {
				answerSplitter: new AnswerSplitOnNewLineAccumulatorStreaming(),
				// Now here we want to pass a proper id as we want to make sure that
				// things work out so the edit event should send some metadata with the
				// edits so we can keep track of it and use it, but for now we go
				// with the iteration numbers on the aideagentsessionprovider itself
				streamProcessor: new StreamProcessor(
					responseStream?.stream!,
					documentLines,
					undefined,
					vscode.Uri.file(editStreamEvent.fs_file_path),
					editStreamEvent.range,
					null,
					this.iterationEdits,
					editStreamEvent.apply_directly,
					// send an id over here which is unique to this run
					// over here we want to send the plan-id or a unique reference
					// which tracks this edit in our system so we can track it as a timeline
					// for the editor
					uniqueEditId,
				),
			});
		} else if ('End' === editStreamEvent.event) {
			// drain the lines which might be still present
			const editsManager = this.editsMap.get(editStreamEvent.edit_request_id);
			while (true) {
				const currentLine = editsManager.answerSplitter.getLine();
				if (currentLine === null) {
					break;
				}
				await editsManager.streamProcessor.processLine(currentLine);
			}
			editsManager.streamProcessor.cleanup();

			await vscode.workspace.save(vscode.Uri.file(editStreamEvent.fs_file_path)); // save files upon stream completion
			// delete this from our map
			this.editsMap.delete(editStreamEvent.edit_request_id);
			// incrementing the counter over here
			this.editCounter = this.editCounter + 1;
			// we have the updated code (we know this will be always present, the types are a bit meh)
		} else if (editStreamEvent.event.Delta) {
			const editsManager = this.editsMap.get(editStreamEvent.edit_request_id);
			if (editsManager !== undefined) {
				editsManager.answerSplitter.addDelta(editStreamEvent.event.Delta);
				while (true) {
					const currentLine = editsManager.answerSplitter.getLine();
					if (currentLine === null) {
						break;
					}
					await editsManager.streamProcessor.processLine(currentLine);
				}
			}
		}
		return {
			fs_file_path: '',
			success: true,
		};
	}

	async provideEdit(request: SidecarApplyEditsRequest): Promise<{
		fs_file_path: string;
		success: boolean;
	}> {
		if (request.apply_directly) {
			applyEditsDirectly(request);
			return {
				fs_file_path: request.fs_file_path,
				success: true,
			};
		}
		if (!this.openResponseStream) {
			return {
				fs_file_path: request.fs_file_path,
				success: true,
			};
		}
		const response = await applyEdits(request, this.openResponseStream, this.iterationEdits);
		return response;
	}

	newSession(sessionId: string): void {
		console.log('newSessionStarting', sessionId);
		// this.sessionId = sessionId;
	}

	async handleSessionIterationRequest(sessionId: string, exchangeId: string, iterationQuery: string, references: readonly vscode.AideAgentPromptReference[]): Promise<void> {
		// check here that we do not look at the user info over here if the llm keys are set
		const session = await vscode.csAuthentication.getSession();
		const token = session?.accessToken ?? '';
		const stream = this.sidecarClient.agentSessionEditFeedback(iterationQuery, sessionId, exchangeId, this.editorUrl!, vscode.AideAgentMode.Edit, references, this.currentRepoRef, this.projectContext.labels, token);
		this.reportAgentEventsToChat(sessionId, true, stream);
	}

	handleSessionUndo(sessionId: string, exchangeId: string): void {
		// TODO(skcd): Handle this properly that we are doing an undo over here
		this.sidecarClient.handleSessionUndo(sessionId, exchangeId, this.editorUrl!);
	}

	/**
	 * TODO(codestory): We want to get this exchange feedback on each exchange
	 * either automagically or when the user invokes it
	 * Its the responsibility of the editor for now to make sure that the feedback
	 * is give, the sidecar should not close the exchange until we have this feedback
	 * this also updates the feedback on the sidecar side so we can tell the agent if its
	 * chagnes were accepted or not
	 */
	/*
	async handleExchangeUserAction(sessionId: string, exchangeId: string, stepIndex: number | undefined, action: vscode.AideSessionExchangeUserAction): Promise<void> {
		// we ping the sidecar over here telling it about the state of the edits after
		// the user has reacted to it appropriately
		const editorUrl = this.editorUrl;
		let isAccepted = false;
		if (action === vscode.AideSessionExchangeUserAction.AcceptAll) {
			isAccepted = true;
		}
		if (editorUrl) {
			// TODO(skcd): Not sure if an async stream like this works, but considering
			// js/ts this should be okay from what I remember, pending futures do not
			// get cleaned up via GC
			const session = await vscode.csAuthentication.getSession();
			const accessToken = session?.accessToken ?? '';
			const responseStream = this.sidecarClient.userFeedbackOnExchange(sessionId, exchangeId, stepIndex, editorUrl, isAccepted, accessToken);
			this.reportAgentEventsToChat(true, responseStream);
		}
	}
	*/

	handleEvent(event: vscode.AideAgentRequest): void {
		this.eventQueue.push(event);
		const uniqueId = `${event.sessionId}-${event.exchangeId}`;
		if (!this.processingEvents.has(uniqueId)) {
			this.processingEvents.set(uniqueId, true);
			this.processEvent(event);
		}
	}

	// consider putting posthog event here?
	private async processEvent(event: vscode.AideAgentRequest): Promise<void> {
		if (!this.editorUrl) {
			return;
		}

		const session = await vscode.csAuthentication.getSession();
		const email = session?.account.email ?? '';

		// accessToken required for sidecar requests (through codestory provider)
		const token = session?.accessToken ?? '';

		// capture launch success metric
		postHogClient?.capture({
			distinctId: getUniqueId(),
			event: 'processEvent',
			properties: {
				platform: os.platform(),
				product: 'aide',
				email,
				query: event.prompt,
				mode: event.mode,
			},
		});

		await this.streamResponse(event, event.sessionId, this.editorUrl, token);
	}

	/**
	 * A uniform reply stream over here which transparently handles any kind of request
	 * type, since on the sidecar side we are taking care of streaming the right thing
	 * depending on the agent mode
	 */
	private async streamResponse(event: vscode.AideAgentRequest, sessionId: string, editorUrl: string, workosAccessToken: string) {
		const prompt = event.prompt;
		const exchangeIdForEvent = event.exchangeId;
		const agentMode = event.mode;
		const variables = event.references;

		// Closure to refactor as little as possible
		let errored = false;
		const addError = () => {
			errored = true;
		};

		if (event.mode === vscode.AideAgentMode.Chat) {
			const responseStream = this.sidecarClient.agentSessionChat(prompt, sessionId, exchangeIdForEvent, editorUrl, agentMode, variables, this.currentRepoRef, this.projectContext.labels, workosAccessToken);
			await this.reportAgentEventsToChat(sessionId, true, responseStream, addError);
		} else if (event.mode === vscode.AideAgentMode.Edit) {
			// Now lets try to handle the edit event first
			// there are 2 kinds of edit events:
			// - anchored and agentic events
			// if its anchored, then we have the sscope as selection
			// if its selection scope then its agentic
			if (event.scope === vscode.AideAgentScope.Selection) {
				const responseStream = await this.sidecarClient.agentSessionAnchoredEdit(prompt, sessionId, exchangeIdForEvent, editorUrl, agentMode, variables, this.currentRepoRef, this.projectContext.labels, workosAccessToken);
				await this.reportAgentEventsToChat(sessionId, true, responseStream, addError);
			} else {
				const isWholeCodebase = event.scope === vscode.AideAgentScope.Codebase;
				const responseStream = await this.sidecarClient.agentSessionPlanStep(prompt, sessionId, exchangeIdForEvent, editorUrl, agentMode, variables, this.currentRepoRef, this.projectContext.labels, isWholeCodebase, workosAccessToken);
				await this.reportAgentEventsToChat(sessionId, true, responseStream, addError);
			}
		} else if (event.mode === vscode.AideAgentMode.Plan || event.mode === vscode.AideAgentMode.Agentic) {
			// For plan generation we have 2 things which can happen:
			// plan gets generated incrementally or in an instant depending on people using
			// o1 or not
			// once we have a step of the plan we should stream it along with the edits of the plan
			// and keep doing that until we are done completely
			const responseStream = await this.sidecarClient.agentSessionPlanStep(prompt, sessionId, exchangeIdForEvent, editorUrl, agentMode, variables, this.currentRepoRef, this.projectContext.labels, false, workosAccessToken);
			await this.reportAgentEventsToChat(sessionId, true, responseStream, addError);
		}
		// This we use to track agent usage - only hit this if we didn't fail
		if (!errored) {
			this.csEventHandler.handleNewRequest(event.mode === vscode.AideAgentMode.Agentic ? 'AgenticRequest' : 'ChatRequest');
		}
	}

	/**
	 * We might be streaming back chat events or something else on the exchange we are
	 * interested in, so we want to close the stream when we want to
	 */
	async reportAgentEventsToChat(
		sessionId: string,
		editMode: boolean,
		stream: AsyncIterableIterator<SideCarAgentEvent>,
		errorCallback?: () => void
	): Promise<void> {
		const asyncIterable = {
			[Symbol.asyncIterator]: () => stream
		};

		let latestResponseStream: vscode.AideAgentEventSenderResponse | undefined = undefined;
		try {
			let streamStarted = false;

			for await (const event of asyncIterable) {
				// print debug events if we are in dev mode
				if (process.env.VSCODE_DEV === '1') {
					printEventDebug(event);
				}

				if ('keep_alive' in event) {
					continue;
				}

				if ('session_id' in event && 'started' in event) {
					if (!event.started) {
						streamStarted = false;
						throw new SidecarConnectionFailedError();
					}

					continue;
				}

				if ('done' in event) {
					continue;
				}

				if (event.event.Error) {
					const stream = latestResponseStream ?? await this.createNewResponseStream(event.request_id);
					if (stream) {
						stream.stream.toolTypeError({
							message: `${event.event.Error.message}.\n\nWe\'d appreciate it if you could report this session using the feedback tool above - this is on us. Please try again.`
						});
						stream.stream.stage({ message: 'Error' });
						errorCallback?.();
						const openStreams = this.responseStreamCollection.getAllResponseStreams();
						for (const openStream of openStreams) {
							this.closeAndRemoveResponseStream(event.request_id, openStream.exchangeId);
						}
					}
					return;
				}

				const sessionId = event.request_id;
				const exchangeId = event.exchange_id;
				const responseStream = latestResponseStream = this.responseStreamCollection.getResponseStream({
					sessionId,
					exchangeId,
				});
				if (responseStream === undefined) {
					continue;
				}
				streamStarted = true;

				// Call this only once per session-exchange
				const key = `${sessionId}-${exchangeId}`;
				if (!this.startedStreams.has(key)) {
					responseStream.stream.stage({ message: 'Loading...' });
					this.startedStreams.add(key);
				}

				if (event.event.FrameworkEvent) {
					if (event.event.FrameworkEvent.OpenFile) {
						const filePath = event.event.FrameworkEvent.OpenFile.fs_file_path;
						if (filePath) {
							responseStream.stream.reference(vscode.Uri.file(filePath));
						}
					} else if (event.event.FrameworkEvent.ToolThinking) {
						const currentText = event.event.FrameworkEvent.ToolThinking.thinking;
						const key = `${sessionId}-${exchangeId}`;
						const lastText = this.lastThinkingText.get(key) || '';

						// Calculate the delta (everything after the last text)
						const delta = currentText.slice(lastText.length);

						// Only send if there's new content
						if (delta) {
							responseStream.stream.markdown(`${delta}\n`);
						}

						// Update the stored text
						this.lastThinkingText.set(key, currentText);
					} else if (event.event.FrameworkEvent.ToolParameterFound) {
						const toolParameterInput = event.event.FrameworkEvent.ToolParameterFound.tool_parameter_input;
						const fieldName = toolParameterInput.field_name;
						if (fieldName === 'fs_file_path' || fieldName === 'directory_path') {
							responseStream.stream.reference(vscode.Uri.file(toolParameterInput.field_content_delta));
						} else if (fieldName === 'instruction' || fieldName === 'result' || fieldName === 'question') {
							responseStream.stream.markdown(`${toolParameterInput.field_content_delta}\n`);
							if (fieldName === 'question') {
								this.markLastMessageAsComplete(sessionId, exchangeId);
							}
						} else if (fieldName === 'command') {
							responseStream.stream.markdown(`Running command: \`${toolParameterInput.field_content_delta}\`\n`);
						} else if (fieldName === 'regex_pattern') {
							responseStream.stream.markdown(`\nSearching the codebase: \`${toolParameterInput.field_content_delta}\`\n`);
						} else if (fieldName === 'file_pattern') {
							responseStream.stream.markdown(`\nLooking for files: \`${toolParameterInput.field_content_delta}\`\n`);
						}
					} else if (event.event.FrameworkEvent.ToolUseDetected) {
						const toolUsePartialInput = event.event.FrameworkEvent.ToolUseDetected.tool_use_partial_input;
						if (toolUsePartialInput) {
							const toolUseKey = Object.keys(toolUsePartialInput)[0] as keyof ToolInputPartial;
							if (toolUseKey === 'AttemptCompletion') {
								responseStream.stream.stage({ message: 'Complete' });
								const openStreams = this.responseStreamCollection.getAllResponseStreams();
								for (const stream of openStreams) {
									this.closeAndRemoveResponseStream(sessionId, stream.exchangeId);
								}
								return;
							} else if (toolUseKey === 'OpenFile') {
								const filePath = toolUsePartialInput.OpenFile.fs_file_path;
								if (filePath) {
									responseStream.stream.reference(vscode.Uri.file(filePath));
								}
							} else if (toolUseKey === 'AskFollowupQuestions') {
								responseStream.stream.stage({ message: 'Complete' });
								const openStreams = this.responseStreamCollection.getAllResponseStreams();
								for (const stream of openStreams) {
									this.closeAndRemoveResponseStream(sessionId, stream.exchangeId);
								}
							}
						}
					} else if (event.event.FrameworkEvent.ToolCallError) {
						responseStream.stream.toolTypeError({ message: event.event.FrameworkEvent.ToolCallError.error_string });
						responseStream.stream.stage({ message: 'Error' });
						errorCallback?.();
						const openStreams = this.responseStreamCollection.getAllResponseStreams();
						for (const stream of openStreams) {
							this.closeAndRemoveResponseStream(sessionId, stream.exchangeId);
						}
						return;
					} else if (event.event.FrameworkEvent.ToolNotFound) {
						// Todo (@g-danna @theskcd) make the tool not found error more descriptive and use its own type
						responseStream.stream.toolTypeError({ message: 'An LLM error occurred, please try again later.' });
						responseStream.stream.stage({ message: 'Error' });
						errorCallback?.();
						const openStreams = this.responseStreamCollection.getAllResponseStreams();
						for (const stream of openStreams) {
							this.closeAndRemoveResponseStream(sessionId, stream.exchangeId);
						}
						return;
					}
				} else if (event.event.SymbolEvent) {
					const symbolEvent = event.event.SymbolEvent.event;
					const symbolEventKeys = Object.keys(symbolEvent);
					if (symbolEventKeys.length === 0) {
						continue;
					}
					const symbolEventKey = symbolEventKeys[0] as keyof typeof symbolEvent;
					// If this is a symbol event then we have to make sure that we are getting the probe request over here
					if (!editMode && symbolEventKey === 'Probe' && symbolEvent.Probe !== undefined) {
						// response.breakdown({
						// 	reference: {
						// 		uri: vscode.Uri.file(symbolEvent.Probe.symbol_identifier.fs_file_path ?? 'symbol_not_found'),
						// 		name: symbolEvent.Probe.symbol_identifier.symbol_name,
						// 	},
						// 	query: new vscode.MarkdownString(symbolEvent.Probe.probe_request)
						// });
					}
				} else if (event.event.SymbolEventSubStep) {
					const { symbol_identifier, event: symbolEventSubStep } = event.event.SymbolEventSubStep;

					if (symbolEventSubStep.GoToDefinition) {
						if (!symbol_identifier.fs_file_path) {
							continue;
						}
						// const goToDefinition = symbolEventSubStep.GoToDefinition;
						// const uri = vscode.Uri.file(goToDefinition.fs_file_path);
						// const startPosition = new vscode.Position(goToDefinition.range.startPosition.line, goToDefinition.range.startPosition.character);
						// const endPosition = new vscode.Position(goToDefinition.range.endPosition.line, goToDefinition.range.endPosition.character);
						// const _range = new vscode.Range(startPosition, endPosition);
						// response.location({ uri, range, name: symbol_identifier.symbol_name, thinking: goToDefinition.thinking });
						continue;
					} else if (symbolEventSubStep.Edit) {
						if (!symbol_identifier.fs_file_path && !symbol_identifier.symbol_name) {
							continue;
						}
						const editEvent = symbolEventSubStep.Edit;

						// UX handle for code correction tool usage - consider using
						if (editEvent.CodeCorrectionTool) { }

						if (editEvent.ThinkingForEdit.delta) {
							responseStream.stream.markdown(editEvent.ThinkingForEdit.delta);
						}
						if (editEvent.RangeSelectionForEdit) {
							// response.breakdown({
							// 	reference: {
							// 		uri: vscode.Uri.file(symbol_identifier.fs_file_path),
							// 		name: symbol	_identifier.symbol_name,
							// 	}
							// });
						}
					} else if (symbolEventSubStep.Probe) {
						if (!symbol_identifier.fs_file_path) {
							continue;
						}
						const probeSubStep = symbolEventSubStep.Probe;
						const probeRequestKeys = Object.keys(probeSubStep) as (keyof typeof symbolEventSubStep.Probe)[];
						if (!symbol_identifier.fs_file_path || probeRequestKeys.length === 0) {
							continue;
						}

						const subStepType = probeRequestKeys[0];
						if (!editMode && subStepType === 'ProbeAnswer' && probeSubStep.ProbeAnswer !== undefined) {
							// const probeAnswer = probeSubStep.ProbeAnswer;
							// response.breakdown({
							// 	reference: {
							// 		uri: vscode.Uri.file(symbol_identifier.fs_file_path),
							// 		name: symbol_identifier.symbol_name
							// 	},
							// 	response: new vscode.MarkdownString(probeAnswer)
							// });
						}
					}
				} else if (event.event.RequestEvent) {
					// const { ProbeFinished } = event.event.RequestEvent;
					// if (!ProbeFinished) {
					// 	continue;
					// }

					// const { reply } = ProbeFinished;
					// if (reply === null) {
					// 	continue;
					// }

					// // The sidecar currently sends '<symbolName> at <fileName>' at the start of the response. Remove it.
					// const match = reply.match(pattern);
					// if (match) {
					// 	const suffix = match[2].trim();
					// 	response.markdown(suffix);
					// } else {
					// 	response.markdown(reply);
					// }

					// break;
				} else if (event.event.EditRequestFinished) {
					// break;
				} else if (event.event.ChatEvent) {
					// responses to the chat
					const sessionId = event.request_id;
					const exchangeId = event.exchange_id;
					const responseStream = this.responseStreamCollection.getResponseStream({ sessionId, exchangeId });

					const { delta } = event.event.ChatEvent;
					if (delta !== null) {
						responseStream?.stream.markdown(delta);
					}
				} else if (event.event.PlanEvent) {
					const sessionId = event.request_id;
					const exchangeId = event.exchange_id;
					const responseStream = this.responseStreamCollection.getResponseStream({
						sessionId, exchangeId,
					});
					// we also have a plan step description updated event which we are going
					// to handle on the review panel
					if (event.event.PlanEvent.PlanStepTitleAdded) {
						// we still want to send the planInfo over here (we should check
						// why the rendering is so slow for this... weird reason)
						responseStream?.stream.stage({ message: 'Planning' });
						responseStream?.stream.step({
							index: event.event.PlanEvent.PlanStepTitleAdded.index,
							description: new vscode.MarkdownString(`### ${event.event.PlanEvent.PlanStepTitleAdded.title}`),
						});
					}
					if (event.event.PlanEvent.PlanStepDescriptionUpdate) {
						responseStream?.stream.step({
							index: event.event.PlanEvent.PlanStepDescriptionUpdate.index,
							description: `\n${event.event.PlanEvent.PlanStepDescriptionUpdate.delta}`,
						});
					}
				} else if (event.event.ExchangeEvent) {
					const sessionId = event.request_id;
					const exchangeId = event.exchange_id;
					const responseStream = this.responseStreamCollection.getResponseStream({
						sessionId,
						exchangeId,
					});
					if (event.event.ExchangeEvent.PlansExchangeState) {
						const editsState = event.event.ExchangeEvent.PlansExchangeState.edits_state;
						if (editsState === 'Loading') {
							responseStream?.stream.stage({ message: 'Planning' });
						} else if (editsState === 'Cancelled') {
							responseStream?.stream.stage({ message: 'Cancelled' });
							this.markLastMessageAsComplete(sessionId, exchangeId);
						} else if (editsState === 'MarkedComplete') {
							responseStream?.stream.stage({ message: 'Complete' });
							this.closeAndRemoveResponseStream(sessionId, exchangeId);
							return;
						} else if (editsState === 'Accepted') {
							responseStream?.stream.stage({ message: 'Accepted' });
						}
						continue;
					}
					if (event.event.ExchangeEvent.EditsExchangeState) {
						const editsState = event.event.ExchangeEvent.EditsExchangeState.edits_state;
						// const files = event.event.ExchangeEvent.EditsExchangeState.files.map((file) => vscode.Uri.file(file));
						if (editsState === 'Loading') {
							responseStream?.stream.stage({ message: 'Editing' });
						} else if (editsState === 'Cancelled') {
							responseStream?.stream.stage({ message: 'Cancelled' });
							this.markLastMessageAsComplete(sessionId, exchangeId);
						} else if (editsState === 'MarkedComplete') {
							responseStream?.stream.stage({ message: 'Complete' });
							this.closeAndRemoveResponseStream(sessionId, exchangeId);
							return;
						}
						continue;
					}
					if (event.event.ExchangeEvent.ExecutionState) {
						const executionState = event.event.ExchangeEvent.ExecutionState;
						if (executionState === 'Inference') {
							responseStream?.stream.stage({ message: 'Reasoning' });
						} else if (executionState === 'InReview') {
							responseStream?.stream.stage({ message: 'Review' });
						} else if (executionState === 'Cancelled') {
							responseStream?.stream.stage({ message: 'Cancelled' });
							this.markLastMessageAsComplete(sessionId, exchangeId);
						}
						continue;
					}
					if (event.event.ExchangeEvent.FinishedExchange) {
						responseStream?.stream.stage({ message: 'Complete' });
						this.closeAndRemoveResponseStream(sessionId, exchangeId);
					}
				}
			}

			if (!streamStarted) {
				throw new SidecarConnectionFailedError();
			}
		} catch (error) {
			const responseStream = latestResponseStream ?? await this.createNewResponseStream(sessionId);
			if (!responseStream) {
				throw error;
			}

			responseStream.stream.toolTypeError({
				message: `${error.message}. Please try again.`
			});
			responseStream.stream.stage({ message: 'Error' });
			errorCallback?.();

			// Clean up any open streams
			const openStreams = this.responseStreamCollection.getAllResponseStreams();
			for (const stream of openStreams) {
				this.closeAndRemoveResponseStream(sessionId, stream.exchangeId);
			}
		}
	}

	private async createNewResponseStream(sessionId: string) {
		let responseStream: vscode.AideAgentEventSenderResponse | undefined;
		const { exchange_id: exchangeId } = await this.newExchangeIdForSession(sessionId);
		if (exchangeId) {
			responseStream = this.responseStreamCollection.getResponseStream({ sessionId, exchangeId });
		}

		return responseStream;
	}

	// TODO (@g-danna, @theskcd) workaround to close the message visually but keep
	// the stream open for whatever reason
	private markLastMessageAsComplete(sessionId: string, exchangeId: string) {
		const responseStreamIdentifier: ResponseStreamIdentifier = { sessionId, exchangeId };
		const responseStream = this.responseStreamCollection.getResponseStream(responseStreamIdentifier);
		responseStream?.stream.markLastMessageAsComplete();

		// Clean up the thinking text tracking
		const key = `${sessionId}-${exchangeId}`;
		this.lastThinkingText.delete(key);
	}

	private closeAndRemoveResponseStream(sessionId: string, exchangeId: string) {
		const responseStreamIdentifier: ResponseStreamIdentifier = { sessionId, exchangeId };
		const responseStream = this.responseStreamCollection.getResponseStream(responseStreamIdentifier);
		responseStream?.stream.close();
		this.responseStreamCollection.removeResponseStream(responseStreamIdentifier);

		// Clean up the thinking text tracking
		const key = `${sessionId}-${exchangeId}`;
		this.lastThinkingText.delete(key);
	}

	dispose() {
		this.aideAgent.dispose();
	}
}

function printEventDebug(event: SideCarAgentEvent) {
	if ('event' in event) {
		for (const [eventType, value] of Object.entries(event.event)) {
			console.info('[debug events]', eventType, value);
		}
	}
}
