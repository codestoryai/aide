/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'path';
import * as vscode from 'vscode';
import { sidecarTypeDefinitionsWithNode } from '../completions/helpers/vscodeApi';
import { LoggingService } from '../completions/logger';
import { StreamCompletionResponse, StreamCompletionResponseUpdates } from '../completions/providers/fetch-and-process-completions';
import { CompletionRequest, CompletionResponse } from '../inlineCompletion/sidecarCompletion';
import { CodeEditAgentBody, ProbeAgentBody, SideCarAgentEvent, SidecarContextEvent, SidecarImageContent, UserContext } from '../server/types';
import { SelectionDataForExplain } from '../utilities/getSelectionContext';
import { AidePlanTimer } from '../utilities/planTimer';
import { sidecarURL } from '../utilities/sidecarUrl';
import { sleep } from '../utilities/sleep';
import { CodeSymbolInformationEmbeddings, CodeSymbolKind } from '../utilities/types';
import { getUserId } from '../utilities/uniqueId';
import { detectDefaultShell } from './default-shell';
import { callServerEventStreamingBufferedGET, callServerEventStreamingBufferedPOST } from './ssestream';
import { ConversationMessage, EditFileResponse, getSideCarModelConfiguration, IdentifierNodeType, InEditorRequest, InEditorTreeSitterDocumentationQuery, InEditorTreeSitterDocumentationReply, InLineAgentMessage, PlanResponse, RepoStatus, SemanticSearchResponse, SidecarVariableType, SidecarVariableTypes, SnippetInformation, SyncUpdate, TextDocument } from './types';
import { sidecarUsesAgentReasoning } from '../utilities/agentConfiguration';
import { readAideRulesContent } from '../utilities/aideRules';

export enum CompletionStopReason {
	/**
	 * Used to signal to the completion processing code that we're still streaming.
	 * Can be removed if we make `CompletionResponse.stopReason` optional. Then
	 * `{ stopReason: undefined }` can be used instead.
	 */
	StreamingChunk = 'aide-streaming-chunk',
	RequestAborted = 'aide-request-aborted',
	RequestFinished = 'aide-request-finished',
}

export enum RepoRefBackend {
	local = 'local',
	github = 'github',
}


export class RepoRef {
	private _path: string;
	private _backend: RepoRefBackend;

	constructor(
		path: string,
		backend: RepoRefBackend
	) {
		this._path = path;
		this._backend = backend;
	}

	getRepresentation(): string {
		const value = `${this._backend}/${this._path}`;
		if (this._path === '') {
			// we return the base path over here in case nothing is open in aide
			return `${this._backend}/${path.parse(process.cwd()).root}`;
		}
		return value;
	}

	getPath(): string {
		return this._path;
	}
}


export class SideCarClient {
	private _url: string;
	private _modelConfiguration: vscode.ModelSelection;
	private _userId: string | null;

	constructor(
		modelConfiguration: vscode.ModelSelection,
	) {
		this._url = sidecarURL();
		this._modelConfiguration = modelConfiguration;
		this._userId = getUserId();
	}

	async validateModelConfiguration(config: Awaited<ReturnType<typeof getSideCarModelConfiguration>>): Promise<vscode.ModelConfigValidationResponse> {
		const baseUrl = new URL(this._url);
		baseUrl.pathname = '/api/agentic/verify_model_config';
		const url = baseUrl.toString();
		const body = {
			model_configuration: config,
		};
		try {
			const response = await fetch(url, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
				},
				body: JSON.stringify(body),
			});
			if (!response.ok) {
				return { valid: false, error: (await response.text()) };
			} else {
				return response.json();
			}
		} catch (err) {
			console.error(err);
			return { valid: false };
		}
	}

	updateModelConfiguration(modelConfiguration: vscode.ModelSelection) {
		this._modelConfiguration = modelConfiguration;
		console.log('updated model configuration', this._modelConfiguration);
	}

	getRepoListUrl(): string {
		const baseUrl = new URL(this._url);
		baseUrl.pathname = '/api/repo/repo_list';
		return baseUrl.toString();
	}

	async getRangeForDiagnostics(
		textDocumentWeb: TextDocument,
		snippetInformation: SnippetInformation,
		thresholdToExpand: number,
	) {
		const baseUrl = new URL(this._url);
		baseUrl.pathname = '/api/tree_sitter/diagnostic_parsing';
		const body = {
			text_document_web: textDocumentWeb,
			range: snippetInformation,
			threshold_to_expand: thresholdToExpand,
		};
		const url = baseUrl.toString();
		const response = await fetch(url, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
			},
			body: JSON.stringify(body),
		});
		const responseJson = await response.json();
		console.log(responseJson);
	}

	async getRepoStatus(): Promise<RepoStatus> {
		const response = await fetch(this.getRepoListUrl());
		const repoList = (await response.json()) as RepoStatus;
		return repoList;
	}


	async *getRepoSyncStatus(): AsyncIterableIterator<SyncUpdate> {
		const baseUrl = new URL(this._url);
		baseUrl.pathname = '/api/repo/status';
		const url = baseUrl.toString();
		const asyncIterableResponse = await callServerEventStreamingBufferedGET(url);
		for await (const line of asyncIterableResponse) {
			const lineParts = line.split('data:{');
			for (const lineSinglePart of lineParts) {
				const lineSinglePartTrimmed = lineSinglePart.trim();
				if (lineSinglePartTrimmed === '') {
					continue;
				}
				const finalString = '{' + lineSinglePartTrimmed;
				const syncUpdate = JSON.parse(finalString) as SyncUpdate;
				yield syncUpdate;
			}
		}
	}


	async *getInLineEditorResponse(
		context: InEditorRequest,
	): AsyncIterableIterator<InLineAgentMessage> {
		const baseUrl = new URL(this._url);
		baseUrl.pathname = '/api/in_editor/answer';
		const url = baseUrl.toString();
		const sideCarModelConfiguration = await getSideCarModelConfiguration(await vscode.modelSelection.getConfiguration(), ''); // Make typescript happy while keeping dead code
		const finalContext = {
			...context,
			modelConfig: sideCarModelConfiguration,
			userId: this._userId,
		};
		const asyncIterableResponse = await callServerEventStreamingBufferedPOST(url, finalContext);
		for await (const line of asyncIterableResponse) {
			const lineParts = line.split('data:{');
			for (const lineSinglePart of lineParts) {
				const lineSinglePartTrimmed = lineSinglePart.trim();
				if (lineSinglePartTrimmed === '') {
					continue;
				}
				try {
					// Attempt to parse JSON and yield
					const inlineAgentMessage = JSON.parse('{' + lineSinglePartTrimmed) as InLineAgentMessage;
					yield inlineAgentMessage;
				} catch (parseError) {
					// Log problematic content and error details
					console.error(`Failed to parse JSON. Raw content: '{${lineSinglePartTrimmed}'`);
					console.error('Parsing error details:', parseError);
				}
			}
		}
	}

	async getParsedComments(
		context: InEditorTreeSitterDocumentationQuery,
	): Promise<InEditorTreeSitterDocumentationReply> {
		const baseUrl = new URL(this._url);
		baseUrl.pathname = '/api/tree_sitter/documentation_parsing';
		const url = baseUrl.toString();
		const response = await fetch(url, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
			},
			body: JSON.stringify(context),
		});
		const responseJson = await response.json();
		return responseJson as InEditorTreeSitterDocumentationReply;
	}

	async *editFileRequest(
		filePath: string,
		fileContent: string,
		language: string,
		llmContent: string,
		userQuery: string,
		codeBlockIndex: number,
		sessionId: string,
	): AsyncIterableIterator<EditFileResponse> {
		const baseUrl = new URL(this._url);
		baseUrl.pathname = '/api/file/edit_file';
		const url = baseUrl.toString();
		const sideCarModelConfiguration = await getSideCarModelConfiguration(await vscode.modelSelection.getConfiguration(), ''); // Make typescript happy while keeping dead code
		const body = {
			file_path: filePath,
			file_content: fileContent,
			language: language,
			new_content: llmContent,
			user_query: userQuery,
			session_id: sessionId,
			code_block_index: codeBlockIndex,
			userId: this._userId,
			model_config: sideCarModelConfiguration,
		};
		const asyncIterableResponse = await callServerEventStreamingBufferedPOST(url, body);
		for await (const line of asyncIterableResponse) {
			const lineParts = line.split('data:{');
			for (const lineSinglePart of lineParts) {
				const lineSinglePartTrimmed = lineSinglePart.trim();
				if (lineSinglePartTrimmed === '') {
					continue;
				}
				try {
					// Attempt to parse JSON and yield
					const editFileResponse = JSON.parse('{' + lineSinglePartTrimmed) as EditFileResponse;
					yield editFileResponse;
				} catch (parseError) {
					// Log problematic content and error details
					console.error(`Failed to parse JSON. Raw content: '{${lineSinglePartTrimmed}'`);
					console.error('Parsing error details:', parseError);
				}
			}
		}
	}

	async createPlanRequest(
		query: string,
		threadId: string,
		variables: readonly vscode.ChatPromptReference[],
		editorUrl: string,
		// TODO(skcd): track the lsp enrichments properly later on
		withLspEnrichments: boolean,
	) {
		const baseUrl = new URL(this._url);
		baseUrl.pathname = '/api/plan/append';
		const url = baseUrl.toString();

		const body = {
			user_query: query,
			thread_id: threadId,
			user_context: await convertVSCodeVariableToSidecarHackingForPlan(variables, query),
			editor_url: editorUrl,
			is_deep_reasoning: true,
			with_lsp_enrichment: withLspEnrichments,
		};

		const response = await fetch(url, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'accept': 'text/event-stream',
			},
			body: JSON.stringify(body),
		});
		return await response.json() as PlanResponse;
	}

	async appendPlanRequest(
		query: string,
		threadId: string,
		editorUrl: string,
		variables: readonly vscode.ChatPromptReference[],
	) {
		console.log('appendPlanRequest');
		const baseUrl = new URL(this._url);
		baseUrl.pathname = '/api/plan/append';
		const url = baseUrl.toString();

		// we need with_lsp_enrichment flag

		const body = {
			user_query: query,
			thread_id: threadId,
			editor_url: editorUrl,
			user_context: await convertVSCodeVariableToSidecarHackingForPlan(variables, query),
			is_deep_reasoning: true,
			with_lsp_enrichment: false,
		};

		const response = await fetch(url, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'accept': 'text/event-stream',
			},
			body: JSON.stringify(body),
		});

		const result = await response.json().catch((e) => console.error(e));

		console.log({ result });

		return result as PlanResponse;
	}

	async *checkReferencesAtErrors(
		query: string,
		threadId: string,
		editorUrl: string,
		variables: readonly vscode.ChatPromptReference[],
	): AsyncIterableIterator<ConversationMessage> {
		console.log('appendPlanRequest');
		const baseUrl = new URL(this._url);
		baseUrl.pathname = '/api/plan/check_references';
		const url = baseUrl.toString();

		// we need with_lsp_enrichment flag

		const body = {
			user_query: query,
			thread_id: threadId,
			editor_url: editorUrl,
			user_context: await convertVSCodeVariableToSidecarHackingForPlan(variables, query),
			is_deep_reasoning: true,
			with_lsp_enrichment: false,
		};

		const asyncIterableResponse = await callServerEventStreamingBufferedPOST(url, body);
		for await (const line of asyncIterableResponse) {
			const lineParts = line.split('data:{');
			for (const lineSinglePart of lineParts) {
				const lineSinglePartTrimmed = lineSinglePart.trim();
				if (lineSinglePartTrimmed === '') {
					continue;
				}
				try {
					// Attempt to parse JSON and yield
					const conversationMessage = JSON.parse('{' + lineSinglePartTrimmed) as ConversationMessage;
					yield conversationMessage;
				} catch (parseError) {
					// Log problematic content and error details
					console.error(`Failed to parse JSON. Raw content: '{${lineSinglePartTrimmed}'`);
					console.error('Parsing error details:', parseError);
				}
			}
		}
	}

	// this streams
	async *executePlanUntilRequest(
		execution_until: number,
		threadId: string,
		editorUrl: string,
	): AsyncIterableIterator<ConversationMessage> {
		console.log('executePlanUntilRequest');
		const baseUrl = new URL(this._url);
		baseUrl.pathname = '/api/plan/execute';
		const url = baseUrl.toString();

		const body = {
			execution_until,
			thread_id: threadId,
			editor_url: editorUrl,
			// make this true so we can invoke the llm on its own
			self_feedback: true,
		};

		const asyncIterableResponse = await callServerEventStreamingBufferedPOST(url, body);
		for await (const line of asyncIterableResponse) {
			const lineParts = line.split('data:{');
			for (const lineSinglePart of lineParts) {
				const lineSinglePartTrimmed = lineSinglePart.trim();
				if (lineSinglePartTrimmed === '') {
					continue;
				}
				try {
					// Attempt to parse JSON and yield
					const conversationMessage = JSON.parse('{' + lineSinglePartTrimmed) as ConversationMessage;
					yield conversationMessage;
				} catch (parseError) {
					// Log problematic content and error details
					console.error(`Failed to parse JSON. Raw content: '{${lineSinglePartTrimmed}'`);
					console.error('Parsing error details:', parseError);
				}
			}
		}
	}

	async dropPlanFromRequest(
		drop_from: number,
		threadId: string,
	) {
		console.log('DropPlanFromRequest');
		const baseUrl = new URL(this._url);
		baseUrl.pathname = '/api/plan/drop';
		const url = baseUrl.toString();

		const body = {
			drop_from,
			thread_id: threadId,
		};

		const response = await fetch(url, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'accept': 'text/event-stream',
			},
			body: JSON.stringify(body),
		});

		const result = await response.json();

		console.log({ result });

		return result as PlanResponse;
	}

	async generatePlanRequest(
		query: string,
		threadId: string,
		variables: readonly vscode.ChatPromptReference[],
		editorUrl: string,
	) {
		const baseUrl = new URL(this._url);
		baseUrl.pathname = '/api/agentic/reasoning_thread_create';
		const url = baseUrl.toString();
		const body = {
			query: query,
			thread_id: threadId,
			user_context: await convertVSCodeVariableToSidecarHackingForPlan(variables, query), // this contains the variables, such as drop/add etc.
			editor_url: editorUrl,
		};
		const response = await fetch(url, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'accept': 'text/event-stream',
			},
			body: JSON.stringify(body),
		});
		return await response.json() as PlanResponse;
	}

	async *followupQuestion(
		query: string,
		repoRef: RepoRef,
		threadId: string,
		variables: readonly vscode.AideAgentPromptReference[],
		projectLabels: string[],
		editorUrl: string,
		// probeProvider: AideProbeProvider,
		aidePlanTimer: AidePlanTimer,
	): AsyncIterableIterator<ConversationMessage> {
		const baseUrl = new URL(this._url);
		baseUrl.pathname = '/api/agent/followup_chat';
		const url = baseUrl.toString();
		const activeWindowData = getCurrentActiveWindow();
		const sideCarModelConfiguration = await getSideCarModelConfiguration(await vscode.modelSelection.getConfiguration(), ''); // Make typescript happy while keeping dead code
		const userContext = await convertVSCodeVariableToSidecarHackingForPlan(variables, query);
		// starts the plan timer at this point if we are at plan generation step
		if (userContext.is_plan_generation) {
			aidePlanTimer.startPlanTimer();
		}

		const user_context = await convertVSCodeVariableToSidecarHackingForPlan(variables, query);

		const body = {
			repo_ref: repoRef.getRepresentation(),
			query: query,
			thread_id: threadId,
			user_context,
			project_labels: projectLabels,
			active_window_data: activeWindowData,
			model_config: sideCarModelConfiguration,
			user_id: this._userId,
			system_instruction: '',
			editor_url: editorUrl,
			is_deep_reasoning: true,
			with_lsp_enrichment: user_context.with_lsp_enrichment,
		};
		const asyncIterableResponse = await callServerEventStreamingBufferedPOST(url, body);
		for await (const line of asyncIterableResponse) {
			const lineParts = line.split('data:{');
			for (const lineSinglePart of lineParts) {
				const lineSinglePartTrimmed = lineSinglePart.trim();
				if (lineSinglePartTrimmed === '') {
					continue;
				}
				try {
					// Attempt to parse JSON and yield
					const conversationMessage = JSON.parse('{' + lineSinglePartTrimmed) as ConversationMessage;
					yield conversationMessage;
				} catch (parseError) {
					// Log problematic content and error details
					console.error(`Failed to parse JSON. Raw content: '{${lineSinglePartTrimmed}'`);
					console.error('Parsing error details:', parseError);
				}
			}
		}
	}

	async *explainQuery(
		query: string,
		repoRef: RepoRef,
		selection: SelectionDataForExplain,
		threadId: string,
	): AsyncIterableIterator<ConversationMessage> {
		const baseUrl = new URL(this._url);
		baseUrl.pathname = '/api/agent/explain';
		baseUrl.searchParams.set('repo_ref', repoRef.getRepresentation());
		baseUrl.searchParams.set('query', query);
		baseUrl.searchParams.set('start_line', selection.lineStart.toString());
		baseUrl.searchParams.set('end_line', selection.lineEnd.toString());
		baseUrl.searchParams.set('relative_path', selection.relativeFilePath);
		baseUrl.searchParams.set('thread_id', threadId);
		const url = baseUrl.toString();
		const asyncIterableResponse = await callServerEventStreamingBufferedGET(url);
		for await (const line of asyncIterableResponse) {
			const lineParts = line.split('data:{');
			for (const lineSinglePart of lineParts) {
				const lineSinglePartTrimmed = lineSinglePart.trim();
				if (lineSinglePartTrimmed === '') {
					continue;
				}
				try {
					// Attempt to parse JSON and yield
					const conversationMessage = JSON.parse('{' + lineSinglePartTrimmed) as ConversationMessage;
					yield conversationMessage;
				} catch (parseError) {
					// Log problematic content and error details
					console.error(`Failed to parse JSON. Raw content: '{${lineSinglePartTrimmed}'`);
					console.error('Parsing error details:', parseError);
				}
			}
		}
	}

	async *searchQuery(
		query: string,
		repoRef: RepoRef,
		threadId: string,
	): AsyncIterableIterator<ConversationMessage> {
		// how do we create the url properly here?
		const baseUrl = new URL(this._url);
		baseUrl.pathname = '/api/agent/search_agent';
		baseUrl.searchParams.set('reporef', repoRef.getRepresentation());
		baseUrl.searchParams.set('query', query);
		baseUrl.searchParams.set('thread_id', threadId);
		const url = baseUrl.toString();
		const asyncIterableResponse = await callServerEventStreamingBufferedGET(url);
		for await (const line of asyncIterableResponse) {
			// Now these responses can be parsed properly, since we are using our
			// own reader over sse, sometimes the reader might send multiple events
			// in a single line so we should split the lines by \n to get the
			// individual lines
			// console.log(line);
			// Is this a good placeholder? probably not, cause we can have instances
			// of this inside the string too, but for now lets check if this works as
			// want it to
			const lineParts = line.split('data:{');
			for (const lineSinglePart of lineParts) {
				const lineSinglePartTrimmed = lineSinglePart.trim();
				if (lineSinglePartTrimmed === '') {
					continue;
				}
				try {
					// Attempt to parse JSON and yield
					const conversationMessage = JSON.parse('{' + lineSinglePartTrimmed) as ConversationMessage;
					yield conversationMessage;
				} catch (parseError) {
					// Log problematic content and error details
					console.error(`Failed to parse JSON. Raw content: '{${lineSinglePartTrimmed}'`);
					console.error('Parsing error details:', parseError);
				}
			}
		}
	}

	async cancelInlineCompletion(
		requestId: string,
	): Promise<null> {
		const baseUrl = new URL(this._url);
		baseUrl.pathname = '/api/inline_completion/cancel_inline_completion';
		const body = {
			id: requestId,
		};
		const url = baseUrl.toString();
		await fetch(url, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
			},
			body: JSON.stringify(body),
		});
		return null;
	}

	async *inlineCompletionTextNewLine(
		completionRequest: CompletionRequest,
		signal: AbortSignal,
		logger: LoggingService,
		spanId: string,
		startTime: number,
	): AsyncIterable<StreamCompletionResponseUpdates> {
		const baseUrl = new URL(this._url);
		const sideCarModelConfiguration = await getSideCarModelConfiguration(
			await vscode.modelSelection.getConfiguration()
			, ''); // Make typescript happy while keeping dead code
		// console.log('sidecar.model_configuration');
		// console.log(JSON.stringify(sideCarModelConfiguration));
		baseUrl.pathname = '/api/inline_completion/inline_completion';

		const body = {
			filepath: completionRequest.filepath,
			language: completionRequest.language,
			text: completionRequest.text,
			// The cursor position in the editor
			position: {
				line: completionRequest.position.line,
				character: completionRequest.position.character,
				byteOffset: completionRequest.position.byteOffset,
			},
			model_config: sideCarModelConfiguration,
			id: completionRequest.id,
			clipboard_content: completionRequest.clipboard,
			type_identifiers: sidecarTypeDefinitionsWithNode(completionRequest.identifierNodes),
			user_id: this._userId,
		};
		const url = baseUrl.toString();
		let finalAnswer = '';

		// Set the combinedSignal as the signal option in the fetch request
		const asyncIterableResponse = await callServerEventStreamingBufferedPOST(url, body);
		let bufferedAnswer = '';
		let runningPreviousLines = '';
		let isNewLineStart = false;
		for await (const line of asyncIterableResponse) {
			if (signal.aborted) {
				return {
					completion: finalAnswer,
					stopReason: CompletionStopReason.RequestAborted,
				};
			}
			const lineParts = line.split('data:"{');
			for (const lineSinglePart of lineParts) {
				const lineSinglePartTrimmed = lineSinglePart.trim();
				if (lineSinglePartTrimmed === '') {
					continue;
				}
				const finalString = '{' + lineSinglePartTrimmed.slice(0, -1);
				const editFileResponse = JSON.parse(JSON.parse(`"${finalString}"`)) as CompletionResponse;
				// take the first provided completion here
				if (editFileResponse.completions.length > 0) {
					finalAnswer = editFileResponse.completions[0].insertText;
					// there are some terminating conditions here cause we only want to yield on new lines
					// the completion might start with \n if its at the end of a line
					// or it might start with blah ... \n
					// we have to yield only when we have a new complete line which will be useful
					const delta = editFileResponse.completions[0].delta;
					if (delta === null || delta === undefined) {
						// if its empty then we should always return it ASAP, since its the end of this completion
						logger.logInfo('sidecar.inline_completion.streaming', {
							'event_name': 'sidecar.inline_completion.streaming.no_delta',
							'completion': finalAnswer,
							'time_taken': performance.now() - startTime,
							'id': spanId,
							'stop_reason': CompletionStopReason.RequestFinished,
						});
						yield {
							completion: finalAnswer,
							stopReason: CompletionStopReason.RequestFinished,
							delta: null,
						};
						return;
					}

					// we want to keep the following things in order
					// - what new lines have we sent before
					// - merge the current line with the previously sent new lines
					// - send the whole answer when we finish streaming
					if (delta && delta === '\n' && finalAnswer === '') {
						// start of an empty line, so we handle it here
						isNewLineStart = true;
						continue;
					} else {
						bufferedAnswer = bufferedAnswer + delta;
						// find the index of \n here
						// else we have a new line! so we can split the string at that position and keep the rest and keep repeating
						while (true) {
							const indexOfNewLine = bufferedAnswer.indexOf('\n');
							if (indexOfNewLine === -1) {
								break;
							}
							const completeLine = bufferedAnswer.substring(0, indexOfNewLine);
							// if we are going to start with a new line, then we need to have \n as the prefix
							const prefix = isNewLineStart ? '\n' : '';
							// if the previous lines are there then we join it with \n else we just join with ''
							const joinString = runningPreviousLines === '' ? '' : '\n';
							const finalCompletion = prefix + runningPreviousLines + joinString + completeLine;
							logger.logInfo('sidecar.inline_completion.streaming', {
								'event_name': 'sidecar.inline_completion.streaming',
								'completion': finalCompletion,
								'startTime': startTime,
								'now': performance.now(),
								'time_taken': performance.now() - startTime,
								'id': spanId,
								'stop_reason': CompletionStopReason.StreamingChunk,
							});
							yield {
								completion: finalCompletion,
								stopReason: CompletionStopReason.StreamingChunk,
								delta: null,
							};
							// here we update our previous running lines
							if (runningPreviousLines === '') {
								runningPreviousLines = completeLine;
							} else {
								runningPreviousLines = runningPreviousLines + '\n' + completeLine;
							}
							// now move the buffered answer to after the position of the newline
							bufferedAnswer = bufferedAnswer.substring(indexOfNewLine + 1);
						}
					}
				}
			}
		}
		yield {
			completion: finalAnswer,
			delta: null,
			stopReason: CompletionStopReason.StreamingChunk,
		};
	}

	async *inlineCompletionText(
		completionRequest: CompletionRequest,
		signal: AbortSignal,
	): AsyncIterable<StreamCompletionResponse> {
		const baseUrl = new URL(this._url);
		const sideCarModelConfiguration = await getSideCarModelConfiguration(
			await vscode.modelSelection.getConfiguration()
			, ''); // Make typescript happy while keeping dead code
		baseUrl.pathname = '/api/inline_completion/inline_completion';

		const body = {
			filepath: completionRequest.filepath,
			language: completionRequest.language,
			text: completionRequest.text,
			// The cursor position in the editor
			position: {
				line: completionRequest.position.line,
				character: completionRequest.position.character,
				byteOffset: completionRequest.position.byteOffset,
			},
			model_config: sideCarModelConfiguration,
			id: completionRequest.id,
		};
		const url = baseUrl.toString();
		let finalAnswer = '';

		// Set the combinedSignal as the signal option in the fetch request
		const asyncIterableResponse = await callServerEventStreamingBufferedPOST(url, body);
		for await (const line of asyncIterableResponse) {
			if (signal.aborted) {
				return {
					completion: finalAnswer,
					stopReason: CompletionStopReason.RequestAborted,
				};
			}
			const lineParts = line.split('data:"{');
			for (const lineSinglePart of lineParts) {
				const lineSinglePartTrimmed = lineSinglePart.trim();
				if (lineSinglePartTrimmed === '') {
					continue;
				}
				const finalString = '{' + lineSinglePartTrimmed.slice(0, -1);
				const editFileResponse = JSON.parse(JSON.parse(`"${finalString}"`)) as CompletionResponse;
				// take the first provided completion here
				if (editFileResponse.completions.length > 0) {
					finalAnswer = editFileResponse.completions[0].insertText;
					yield {
						completion: finalAnswer,
						stopReason: CompletionStopReason.StreamingChunk,
					};
				}
			}
		}

		yield {
			completion: finalAnswer,
			stopReason: CompletionStopReason.RequestFinished,
		};
	}

	async getIdentifierNodes(
		filePath: string,
		fileContent: string,
		language: string,
		cursorLine: number,
		cursorColumn: number,
	): Promise<IdentifierNodeType> {
		const baseUrl = new URL(this._url);
		baseUrl.pathname = '/api/inline_completion/get_identifier_nodes';
		const body = {
			file_path: filePath,
			file_content: fileContent,
			language,
			cursor_line: cursorLine,
			cursor_column: cursorColumn,
		};
		const url = baseUrl.toString();
		const response = await fetch(url, {
			method: 'POST',
			body: JSON.stringify(body),
			headers: {
				'Content-Type': 'application/json',
			},
		});
		const finalResponse = await response.json() as IdentifierNodeType;
		return finalResponse;
	}

	async documentContentChange(
		filePath: string,
		events: readonly vscode.TextDocumentContentChangeEvent[],
		fileContent: string,
		language: string,
	): Promise<void> {
		const baseUrl = new URL(this._url);
		baseUrl.pathname = '/api/inline_completion/document_content_changed';
		const mappedEvents = events.map((event) => {
			return {
				range: {
					start_line: event.range.start.line,
					start_column: event.range.start.character,
					end_line: event.range.end.line,
					end_column: event.range.end.character,
				},
				text: event.text,
			};
		});
		const body = {
			file_path: filePath,
			file_content: fileContent,
			language,
			events: mappedEvents,
		};
		const url = baseUrl.toString();
		await fetch(url, {
			method: 'POST',
			body: JSON.stringify(body),
			headers: {
				'Content-Type': 'application/json',
			},
		});
	}

	async documentOpen(
		filePath: string,
		fileContent: string,
		language: string,
	): Promise<void> {
		// There might be files which have a .git extension we should not be sending
		// those to the sidecar
		if (filePath.endsWith('.git')) {
			return;
		}
		const baseUrl = new URL(this._url);
		baseUrl.pathname = '/api/inline_completion/document_open';
		const body = {
			file_path: filePath,
			file_content: fileContent,
			language,
		};
		const url = baseUrl.toString();
		const response = await fetch(url, {
			method: 'POST',
			body: JSON.stringify(body),
			headers: {
				'Content-Type': 'application/json',
			},
		});
		if (!response.ok) {
			throw new Error(`Error while opening file: ${response.statusText}`);
		}
	}

	async sendDiagnostics(
		filePath: string,
		diagnostics: readonly vscode.Diagnostic[]
	): Promise<void> {
		const textDocument = await vscode.workspace.openTextDocument(vscode.Uri.file(filePath));
		const baseUrl = new URL(this._url);
		baseUrl.pathname = '/api/agentic/diagnostics';  // New invented endpoint

		const body = {
			fs_file_path: filePath,
			diagnostics: diagnostics.map(diag => ({
				severity: diag.severity,
				message: diag.message,
				range: {
					start_position: { line: diag.range.start.line, character: diag.range.start.character, byte_offset: 0 },
					end_position: { line: diag.range.end.line, character: diag.range.end.character, byte_offset: 0 }
				},
				code: diag.code,
				source: diag.source,
				range_content: textDocument.getText(diag.range),
			}))
		};

		const url = baseUrl.toString();
		const response = await fetch(url, {
			method: 'POST',
			body: JSON.stringify(body),
			headers: {
				'Content-Type': 'application/json',
			},
		});

		if (!response.ok) {
			// throw new Error(`Error while sending diagnostics: ${response.statusText}`);
		}
	}

	async *inlineCompletion(
		completionRequest: CompletionRequest,
		_signal: AbortSignal,
	): AsyncIterable<CompletionResponse> {
		const baseUrl = new URL(this._url);
		const sideCarModelConfiguration = await getSideCarModelConfiguration(
			await vscode.modelSelection.getConfiguration()
			, ''); // Make typescript happy while keeping dead code
		baseUrl.pathname = '/api/inline_completion/inline_completion';

		const body = {
			filepath: completionRequest.filepath,
			language: completionRequest.language,
			text: completionRequest.text,
			// The cursor position in the editor
			position: {
				line: completionRequest.position.line,
				character: completionRequest.position.character,
				byteOffset: completionRequest.position.byteOffset,
			},
			model_config: sideCarModelConfiguration,
			id: completionRequest.id,
		};
		const url = baseUrl.toString();

		// Set the combinedSignal as the signal option in the fetch request
		const asyncIterableResponse = await callServerEventStreamingBufferedPOST(url, body);
		for await (const line of asyncIterableResponse) {
			const lineParts = line.split('data:"{');
			for (const lineSinglePart of lineParts) {
				const lineSinglePartTrimmed = lineSinglePart.trim();
				if (lineSinglePartTrimmed === '') {
					continue;
				}
				const finalString = '{' + lineSinglePartTrimmed.slice(0, -1);
				const editFileResponse = JSON.parse(JSON.parse(`"${finalString}"`)) as CompletionResponse;
				yield editFileResponse;
			}
		}
	}

	async waitForGreenHC(): Promise<boolean> {
		const baseUrl = new URL(this._url);
		baseUrl.pathname = '/api/health';
		let attempts = 0;
		const totalAttempts = 10;
		while (true) {
			try {
				// console.log('trying to HC for repo check');
				const url = baseUrl.toString();
				const response = await fetch(url);
				return response.status === 200;
			} catch (e) {
				// sleeping for a attempts * second here
				await sleep(1000 * (attempts + 1));
				attempts = attempts + 1;
				if (attempts < totalAttempts) {
					continue;
				} else {
					throw e;
				}
			}
		}
	}

	async getSemanticSearchResult(
		query: string,
		reporef: RepoRef,
	): Promise<CodeSymbolInformationEmbeddings[]> {
		const baseUrl = new URL(this._url);
		baseUrl.pathname = '/api/agent/hybrid_search';
		baseUrl.searchParams.set('repo', reporef.getRepresentation());
		baseUrl.searchParams.set('query', query);
		const url = baseUrl.toString();
		const response = await fetch(url);
		const responseJson = await response.json();
		const semanticSearchResult = responseJson as SemanticSearchResponse;
		const codeSymbols = semanticSearchResult.code_spans;
		const sortedCodeSymbols = codeSymbols.sort((a, b) => {
			if (b.score !== null && a.score !== null) {
				return b.score - a.score;
			}
			if (b.score !== null && a.score === null) {
				return 1;
			}
			if (b.score === null && a.score !== null) {
				return -1;
			}
			return 0;
		});
		const codeSymbolInformationEmbeddings: CodeSymbolInformationEmbeddings[] = sortedCodeSymbols.map((codeSpan) => {
			const filePath = path.join(reporef.getPath(), codeSpan.file_path);
			return {
				codeSymbolInformation: {
					symbolName: '',
					symbolKind: CodeSymbolKind.null,
					symbolStartLine: codeSpan.start_line,
					symbolEndLine: codeSpan.end_line,
					codeSnippet: {
						languageId: 'typescript',
						code: codeSpan.data,
					},
					extraSymbolHint: null,
					dependencies: [],
					fsFilePath: filePath,
					originalFilePath: filePath,
					workingDirectory: reporef.getPath(),
					displayName: '',
					originalName: '',
					originalSymbolName: '',
					globalScope: 'global',
				},
				codeSymbolEmbedding: [],
				fileHash: '',
			};
		});
		return codeSymbolInformationEmbeddings;
	}

	async stopAgentProbe(threadId: string): Promise<void> {
		const baseUrl = new URL(this._url);
		baseUrl.pathname = '/api/agentic/probe_request_stop';
		const url = baseUrl.toString();
		const body = {
			request_id: threadId,
		};
		await fetch(url, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
			},
			body: JSON.stringify(body),
		});
	}

	async *agentSessionPlanStep(
		query: string,
		sessionId: string,
		exchangeId: string,
		editorUrl: string,
		agentMode: vscode.AideAgentMode,
		variables: readonly vscode.ChatPromptReference[],
		repoRef: RepoRef,
		projectLabels: string[],
		codebaseSearch: boolean,
		workosAccessToken: string,
	): AsyncIterableIterator<SideCarAgentEvent> {
		try {
			if (agentMode !== vscode.AideAgentMode.Agentic && agentMode !== vscode.AideAgentMode.Plan) {
				throw new Error('Invalid agent mode');
			}

			const baseUrl = new URL(this._url);
			const sideCarModelConfiguration = await getSideCarModelConfiguration(await vscode.modelSelection.getConfiguration(), workosAccessToken);
			const allFiles = vscode.workspace.textDocuments.filter((textDocument) => {
				return textDocument.uri.scheme === 'file';
			}).map((textDocument) => {
				return textDocument.uri.fsPath;
			});
			// log here for debugging
			const openFiles = vscode.window.visibleTextEditors.filter((textDocument) => {
				return textDocument.document.uri.scheme === 'file';
			}).map((textDocument) => {
				return textDocument.document.uri.fsPath;
			});
			const currentShell = detectDefaultShell();
			if (agentMode === vscode.AideAgentMode.Agentic) {
				baseUrl.pathname = '/api/agentic/agent_tool_use';
			} else {
				baseUrl.pathname = '/api/agentic/agent_session_plan';
			}
			const sidecarAgentUsesReasoning = sidecarUsesAgentReasoning();
			const aideRulesContent = await readAideRulesContent();
			const url = baseUrl.toString();
			const body = {
				session_id: sessionId,
				exchange_id: exchangeId,
				editor_url: editorUrl,
				query,
				user_context: await convertVSCodeVariableToSidecarHackingForPlan(variables, query),
				agent_mode: agentMode.toString(),
				repo_ref: repoRef.getRepresentation(),
				root_directory: vscode.workspace.rootPath ?? '',
				project_labels: projectLabels,
				codebase_search: codebaseSearch,
				access_token: workosAccessToken,
				model_configuration: sideCarModelConfiguration,
				all_files: allFiles,
				open_files: openFiles,
				shell: currentShell,
				aide_rules: aideRulesContent,
				reasoning: sidecarAgentUsesReasoning,
			};

			const asyncIterableResponse = callServerEventStreamingBufferedPOST(url, body);
			for await (const line of asyncIterableResponse) {
				const lineParts = line.split('data:{');
				for (const lineSinglePart of lineParts) {
					const lineSinglePartTrimmed = lineSinglePart.trim();
					if (lineSinglePartTrimmed === '') {
						continue;
					}
					try {
						// Attempt to parse JSON and yield
						const conversationMessage = JSON.parse('{' + lineSinglePartTrimmed) as SideCarAgentEvent;
						yield conversationMessage;
					} catch (parseError) {
						// Log problematic content and error details
						console.error(`Failed to parse JSON. Raw content: '{${lineSinglePartTrimmed}'`);
						console.error('Parsing error details:', parseError);
					}
				}
			}
		} catch (error) {
			// Yield error event before throwing
			yield {
				session_id: sessionId,
				started: false,
			};
			throw error; // Re-throw to be caught by caller
		}
	}

	// hitting our midwit agent
	async *midwitAgent(
		query: string,
		sessionId: string,
		exchangeId: string,
		editorUrl: string,
		agentMode: vscode.AideAgentMode,
		variables: readonly vscode.ChatPromptReference[],
		workosAccessToken: string,
	): AsyncIterableIterator<SideCarAgentEvent> {
		if (agentMode !== vscode.AideAgentMode.Agentic && agentMode !== vscode.AideAgentMode.Plan) {
			throw new Error('Invalid agent mode');
		}

		const baseUrl = new URL(this._url);
		const sideCarModelConfiguration = await getSideCarModelConfiguration(await vscode.modelSelection.getConfiguration(), workosAccessToken);

		if (agentMode === vscode.AideAgentMode.Agentic) {
			baseUrl.pathname = '/api/agentic/midwit_agent';
		} else {
			baseUrl.pathname = '/api/agentic/agent_session_plan';
		}
		const url = baseUrl.toString();
		const body = {
			session_id: sessionId,
			exchange_id: exchangeId,
			editor_url: editorUrl,
			problem_statement: query,
			user_context: await convertVSCodeVariableToSidecarHackingForPlan(variables, query),
			root_directory: vscode.workspace.rootPath ?? '',
			access_token: workosAccessToken,
			model_configuration: sideCarModelConfiguration,
		};

		const asyncIterableResponse = callServerEventStreamingBufferedPOST(url, body);
		for await (const line of asyncIterableResponse) {
			const lineParts = line.split('data:{');
			for (const lineSinglePart of lineParts) {
				const lineSinglePartTrimmed = lineSinglePart.trim();
				if (lineSinglePartTrimmed === '') {
					continue;
				}
				const conversationMessage = JSON.parse('{' + lineSinglePartTrimmed) as SideCarAgentEvent;
				yield conversationMessage;
			}
		}
	}

	/**
	 * Cancels the running request if its not already terminated on the sidecar
	 */
	async *cancelRunningEvent(
		sessionId: string,
		exchangeId: string,
		editorUrl: string,
		accessToken: string,
	): AsyncIterableIterator<SideCarAgentEvent> {
		try {
			const baseUrl = new URL(this._url);
			baseUrl.pathname = '/api/agentic/cancel_running_event';
			const url = baseUrl.toString();
			const body = {
				session_id: sessionId,
				exchange_id: exchangeId,
				editor_url: editorUrl,
				access_token: accessToken,
				model_configuration: await getSideCarModelConfiguration(await vscode.modelSelection.getConfiguration(), accessToken),
			};
			const asyncIterableResponse = callServerEventStreamingBufferedPOST(url, body);
			for await (const line of asyncIterableResponse) {
				const lineParts = line.split('data:{');
				for (const lineSinglePart of lineParts) {
					const lineSinglePartTrimmed = lineSinglePart.trim();
					if (lineSinglePartTrimmed === '') {
						continue;
					}
					const conversationMessage = JSON.parse('{' + lineSinglePartTrimmed) as SideCarAgentEvent;
					yield conversationMessage;
				}
			}
		} catch (error) {
			// Yield error event before throwing
			yield {
				session_id: sessionId,
				started: false,
			};
			throw error; // Re-throw to be caught by caller
		}
	}

	async *agentSessionAgenticEdit(
		query: string,
		sessionId: string,
		exchangeId: string,
		editorUrl: string,
		agentMode: vscode.AideAgentMode,
		variables: readonly vscode.ChatPromptReference[],
		repoRef: RepoRef,
		projectLabels: string[],
		codebaseSearch: boolean,
	): AsyncIterableIterator<SideCarAgentEvent> {
		const baseUrl = new URL(this._url);
		const allFiles = vscode.workspace.textDocuments.filter((textDocument) => {
			return textDocument.uri.scheme === 'file';
		}).map((textDocument) => {
			return textDocument.uri.fsPath;
		});
		const openFiles = vscode.window.visibleTextEditors.filter((textDocument) => {
			return textDocument.document.uri.scheme === 'file';
		}).map((textDocument) => {
			return textDocument.document.uri.fsPath;
		});
		const currentShell = detectDefaultShell();
		const sideCarModelConfiguration = await getSideCarModelConfiguration(await vscode.modelSelection.getConfiguration(), ''); // Make Typescript happy while keeping dead code
		baseUrl.pathname = '/api/agentic/agent_session_edit_agentic';
		const url = baseUrl.toString();
		const body = {
			session_id: sessionId,
			exchange_id: exchangeId,
			editor_url: editorUrl,
			query,
			user_context: await convertVSCodeVariableToSidecarHackingForPlan(variables, query),
			agent_mode: agentMode.toString(),
			repo_ref: repoRef.getRepresentation(),
			root_directory: vscode.workspace.rootPath,
			project_labels: projectLabels,
			codebase_search: codebaseSearch,
			model_configuration: sideCarModelConfiguration,
			all_files: allFiles,
			open_files: openFiles,
			shell: currentShell,
		};

		const asyncIterableResponse = callServerEventStreamingBufferedPOST(url, body);
		for await (const line of asyncIterableResponse) {
			const lineParts = line.split('data:{');
			for (const lineSinglePart of lineParts) {
				const lineSinglePartTrimmed = lineSinglePart.trim();
				if (lineSinglePartTrimmed === '') {
					continue;
				}
				const conversationMessage = JSON.parse('{' + lineSinglePartTrimmed) as SideCarAgentEvent;
				yield conversationMessage;
			}
		}
	}

	async *agentSessionEditFeedback(
		query: string,
		sessionId: string,
		exchangeId: string,
		editorUrl: string,
		agentMode: vscode.AideAgentMode,
		variables: readonly vscode.ChatPromptReference[],
		repoRef: RepoRef,
		projectLabels: string[],
		workosAccessToken: string,
	): AsyncIterableIterator<SideCarAgentEvent> {
		try {
			const baseUrl = new URL(this._url);
			const allFiles = vscode.workspace.textDocuments.filter((textDocument) => {
				return textDocument.uri.scheme === 'file';
			}).map((textDocument) => {
				return textDocument.uri.fsPath;
			});
			const openFiles = vscode.window.visibleTextEditors.filter((textDocument) => {
				return textDocument.document.uri.scheme === 'file';
			}).map((textDocument) => {
				return textDocument.document.uri.fsPath;
			});
			const currentShell = detectDefaultShell();
			const sideCarModelConfiguration = await getSideCarModelConfiguration(await vscode.modelSelection.getConfiguration(), workosAccessToken);
			baseUrl.pathname = '/api/agentic/agent_session_plan_iterate';
			const url = baseUrl.toString();
			const body = {
				session_id: sessionId,
				exchange_id: exchangeId,
				editor_url: editorUrl,
				query,
				user_context: await convertVSCodeVariableToSidecarHackingForPlan(variables, query),
				agent_mode: agentMode.toString(),
				repo_ref: repoRef.getRepresentation(),
				project_labels: projectLabels,
				root_directory: vscode.workspace.rootPath,
				codebase_search: false,
				access_token: workosAccessToken,
				model_configuration: sideCarModelConfiguration,
				all_files: allFiles,
				open_files: openFiles,
				shell: currentShell,
			};

			const asyncIterableResponse = callServerEventStreamingBufferedPOST(url, body);
			for await (const line of asyncIterableResponse) {
				const lineParts = line.split('data:{');
				for (const lineSinglePart of lineParts) {
					const lineSinglePartTrimmed = lineSinglePart.trim();
					if (lineSinglePartTrimmed === '') {
						continue;
					}
					const conversationMessage = JSON.parse('{' + lineSinglePartTrimmed) as SideCarAgentEvent;
					yield conversationMessage;
				}
			}
		} catch (error) {
			// Yield error event before throwing
			yield {
				session_id: sessionId,
				started: false,
			};
			throw error; // Re-throw to be caught by caller
		}
	}

	async *agentSessionAnchoredEdit(
		query: string,
		sessionId: string,
		exchangeId: string,
		editorUrl: string,
		agentMode: vscode.AideAgentMode,
		variables: readonly vscode.ChatPromptReference[],
		repoRef: RepoRef,
		projectLabels: string[],
		workosAccessToken: string,
	): AsyncIterableIterator<SideCarAgentEvent> {
		try {
			const baseUrl = new URL(this._url);
			const sideCarModelConfiguration = await getSideCarModelConfiguration(await vscode.modelSelection.getConfiguration(), workosAccessToken);
			const allFiles = vscode.workspace.textDocuments.map((textDocument) => {
				return textDocument.uri.fsPath;
			});
			const openFiles = vscode.window.visibleTextEditors.map((textDocument) => {
				return textDocument.document.uri.fsPath;
			});
			const currentShell = detectDefaultShell();
			const sidecarAgentUsesReasoning = sidecarUsesAgentReasoning();
			baseUrl.pathname = '/api/agentic/agent_session_edit_anchored';
			const aideRulesContent = await readAideRulesContent();
			const url = baseUrl.toString();
			const body = {
				session_id: sessionId,
				exchange_id: exchangeId,
				editor_url: editorUrl,
				query,
				user_context: await convertVSCodeVariableToSidecarHackingForPlan(variables, query),
				agent_mode: agentMode.toString(),
				repo_ref: repoRef.getRepresentation(),
				project_labels: projectLabels,
				root_directory: vscode.workspace.rootPath,
				codebase_search: false,
				access_token: workosAccessToken,
				model_configuration: sideCarModelConfiguration,
				all_files: allFiles,
				open_files: openFiles,
				shell: currentShell,
				aide_rules: aideRulesContent,
				reasoning: sidecarAgentUsesReasoning,
			};

			const asyncIterableResponse = callServerEventStreamingBufferedPOST(url, body);
			for await (const line of asyncIterableResponse) {
				const lineParts = line.split('data:{');
				for (const lineSinglePart of lineParts) {
					const lineSinglePartTrimmed = lineSinglePart.trim();
					if (lineSinglePartTrimmed === '') {
						continue;
					}
					const conversationMessage = JSON.parse('{' + lineSinglePartTrimmed) as SideCarAgentEvent;
					yield conversationMessage;
				}
			}
		} catch (error) {
			// Yield error event before throwing
			yield {
				session_id: sessionId,
				started: false,
			};
			throw error; // Re-throw to be caught by caller
		}
	}

	async *handleSessionUndo(
		sessionId: string,
		exchangeId: string,
		editorUrl: string,
	) {
		const baseUrl = new URL(this._url);
		baseUrl.pathname = '/api/agentic/user_handle_session_undo';
		const url = baseUrl.toString();
		const body = {
			session_id: sessionId,
			exchange_id: exchangeId,
			editor_url: editorUrl,
		};
		await fetch(url, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
			},
			body: JSON.stringify(body),
		});
	}

	async *userFeedbackOnExchange(
		sessionId: string,
		exchangeId: string,
		stepIndex: number | undefined,
		editorUrl: string,
		accepted: boolean,
		accessToken: string,
	): AsyncIterableIterator<SideCarAgentEvent> {
		const baseUrl = new URL(this._url);
		baseUrl.pathname = '/api/agentic/user_feedback_on_exchange';
		const sideCarModelConfiguration = await getSideCarModelConfiguration(await vscode.modelSelection.getConfiguration(), ''); // Make Typescript happy while keeping dead code
		const url = baseUrl.toString();
		const body = {
			session_id: sessionId,
			exchange_id: exchangeId,
			editor_url: editorUrl,
			step_index: stepIndex,
			accepted,
			access_token: accessToken,
			model_configuration: sideCarModelConfiguration,
		};

		const asyncIterableResponse = callServerEventStreamingBufferedPOST(url, body);
		for await (const line of asyncIterableResponse) {
			const lineParts = line.split('data:{');
			for (const lineSinglePart of lineParts) {
				const lineSinglePartTrimmed = lineSinglePart.trim();
				if (lineSinglePartTrimmed === '') {
					continue;
				}
				const conversationMessage = JSON.parse('{' + lineSinglePartTrimmed) as SideCarAgentEvent;
				yield conversationMessage;
			}
		}
	}

	/**
	 * Sends a request over to the sidecar and waits for an ack and completes after
	 * that. The sidecar can create a new exchange or many new exchanges as required
	 * and keep working on the exchange as and when required
	 */
	async *agentSessionChat(
		query: string,
		sessionId: string,
		exchangeId: string,
		editorUrl: string,
		agentMode: vscode.AideAgentMode,
		variables: readonly vscode.ChatPromptReference[],
		repoRef: RepoRef,
		projectLabels: string[],
		workosAccessToken: string,
	): AsyncIterableIterator<SideCarAgentEvent> {
		try {
			const baseUrl = new URL(this._url);
			const allFiles = vscode.workspace.textDocuments.filter((textDocument) => {
				return textDocument.uri.scheme === 'file';
			}).map((textDocument) => {
				return textDocument.uri.fsPath;
			});
			const openFiles = vscode.window.visibleTextEditors.filter((textDocument) => {
				return textDocument.document.uri.scheme === 'file';
			}).map((textDocument) => {
				return textDocument.document.uri.fsPath;
			});
			const currentShell = detectDefaultShell();
			const sideCarModelConfiguration = await getSideCarModelConfiguration(await vscode.modelSelection.getConfiguration(), workosAccessToken);
			const userContext = await convertVSCodeVariableToSidecarHackingForPlan(variables, query);
			const sidecarAgentUsesReasoning = sidecarUsesAgentReasoning();
			baseUrl.pathname = '/api/agentic/agent_session_chat';
			const aideRulesContent = await readAideRulesContent();
			const url = baseUrl.toString();
			const body = {
				session_id: sessionId,
				exchange_id: exchangeId,
				editor_url: editorUrl,
				query,
				user_context: userContext,
				agent_mode: agentMode.toString(),
				repo_ref: repoRef.getRepresentation(),
				project_labels: projectLabels,
				root_directory: vscode.workspace.rootPath ?? '',
				codebase_search: false,
				access_token: workosAccessToken,
				model_configuration: sideCarModelConfiguration,
				all_files: allFiles,
				open_files: openFiles,
				shell: currentShell,
				aide_rules: aideRulesContent,
				reasoning: sidecarAgentUsesReasoning,
			};

			// consider using headers
			const headers = {
				'Authorization': `Bearer ${workosAccessToken}`,
			};

			const asyncIterableResponse = callServerEventStreamingBufferedPOST(url, body, headers);
			for await (const line of asyncIterableResponse) {
				const lineParts = line.split('data:{');
				for (const lineSinglePart of lineParts) {
					const lineSinglePartTrimmed = lineSinglePart.trim();
					if (lineSinglePartTrimmed === '') {
						continue;
					}
					const conversationMessage = JSON.parse('{' + lineSinglePartTrimmed) as SideCarAgentEvent;
					yield conversationMessage;
				}
			}
		} catch (error) {
			// Yield error event before throwing
			yield {
				session_id: sessionId,
				started: false,
			};
			throw error; // Re-throw to be caught by caller
		}
	}

	async *startAgentProbe(
		query: string,
		variables: readonly vscode.ChatPromptReference[],
		editorUrl: string,
		threadId: string,
	): AsyncIterableIterator<SideCarAgentEvent> {
		// console.log('starting agent probe');
		const baseUrl = new URL(this._url);
		baseUrl.pathname = '/api/agentic/probe_request';
		const url = baseUrl.toString();
		const activeWindowData = getCurrentActiveWindow();
		let activeWindowDataForProbing = undefined;
		if (activeWindowData !== undefined) {
			activeWindowDataForProbing = {
				file_path: activeWindowData.file_path,
				file_content: activeWindowData.file_content,
				language: activeWindowData.language,
			};
		}
		const sideCarModelConfiguration = await getSideCarModelConfiguration(await vscode.modelSelection.getConfiguration(), ''); // Make typescript happy while keeping dead code
		const body: ProbeAgentBody = {
			query,
			editor_url: editorUrl,
			request_id: threadId,
			model_config: sideCarModelConfiguration,
			user_context: await convertVSCodeVariableToSidecar(variables),
			active_window_data: activeWindowDataForProbing,
		};
		const asyncIterableResponse = await callServerEventStreamingBufferedPOST(url, body);
		for await (const line of asyncIterableResponse) {
			const lineParts = line.split('data:{');
			for (const lineSinglePart of lineParts) {
				const lineSinglePartTrimmed = lineSinglePart.trim();
				if (lineSinglePartTrimmed === '') {
					continue;
				}
				const conversationMessage = JSON.parse('{' + lineSinglePartTrimmed) as SideCarAgentEvent;
				yield conversationMessage;
			}
		}
	}

	async codeSculptingFollowups(
		request_id: string,
		root_directory: string,
	) {
		const baseUrl = new URL(this._url);
		baseUrl.pathname = '/api/agentic/code_sculpting_heal';
		const url = baseUrl.toString();
		const body = {
			request_id,
			root_directory,
		};
		await fetch(url, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
			},
			body: JSON.stringify(body),
		});
	}

	async warmupCodeSculptingCache(
		file_paths: string[],
		editorUrl: string,
	) {
		const baseUrl = new URL(this._url);
		baseUrl.pathname = '/api/agentic/code_sculpting_warmup';
		const url = baseUrl.toString();
		const body = {
			file_paths,
			editor_url: editorUrl,
			grab_import_nodes: false,
		};
		await fetch(url, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
			},
			body: JSON.stringify(body),
		});
	}

	async codeSculptingFollowup(
		instruction: string,
		request_id: string,
	) {
		const baseUrl = new URL(this._url);
		baseUrl.pathname = '/api/agentic/code_sculpting_followup';
		const url = baseUrl.toString();
		const body = {
			request_id,
			instruction,
		};
		await fetch(url, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
			},
			body: JSON.stringify(body),
		});
	}

	async *startAgentCodeEdit(
		query: string,
		variables: readonly vscode.ChatPromptReference[],
		editorUrl: string,
		threadId: string,
		codebaseSearch: boolean,
		isAnchorEditing: boolean,
	): AsyncIterableIterator<SideCarAgentEvent> {
		// console.log('starting agent code edit');
		const baseUrl = new URL(this._url);
		baseUrl.pathname = '/api/agentic/code_editing';
		const url = baseUrl.toString();
		const activeWindowData = getCurrentActiveWindow();
		let activeWindowDataForProbing = undefined;
		if (activeWindowData !== undefined) {
			activeWindowDataForProbing = {
				file_path: activeWindowData.file_path,
				file_content: activeWindowData.file_content,
				language: activeWindowData.language,
			};
		}

		const body: CodeEditAgentBody = {
			user_query: query,
			editor_url: editorUrl,
			request_id: threadId,
			user_context: await newConvertVSCodeVariableToSidecar(variables),
			active_window_data: activeWindowDataForProbing,
			root_directory: vscode.workspace.rootPath ?? '',
			codebase_search: codebaseSearch,
			anchor_editing: isAnchorEditing,
			enable_import_nodes: false,
			deep_reasoning: true,
		};
		const asyncIterableResponse = await callServerEventStreamingBufferedPOST(url, body);
		for await (const line of asyncIterableResponse) {
			const lineParts = line.split('data:{');
			for (const lineSinglePart of lineParts) {
				const lineSinglePartTrimmed = lineSinglePart.trim();
				if (lineSinglePartTrimmed === '') {
					continue;
				}
				const conversationMessage = JSON.parse('{' + lineSinglePartTrimmed) as SideCarAgentEvent;
				yield conversationMessage;
			}
		}
	}

	async sendContextRecording(
		contextEvents: readonly SidecarContextEvent[],
		editorUrl: string | undefined,
	) {
		if (editorUrl === undefined) {
			console.log('editorUrl not found');
			return;
		}
		const baseUrl = new URL(this._url);
		baseUrl.pathname = '/api/agentic/context_recording';
		const url = baseUrl.toString();
		const body = {
			context_events: contextEvents,
			editor_url: editorUrl,
		};
		await fetch(url, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
			},
			body: JSON.stringify(body),
		});
	}
}

export function isAideAgentImageAttachmentValue(obj: any): obj is vscode.AideAgentImageAttachmentValue {
	return 'mimeType' in obj && 'data' in obj;
}

/**
 * This is a copy of the function below we are using this to use the chat window as a plan generation cli
 */
export async function convertVSCodeVariableToSidecarHackingForPlan(
	variables: readonly vscode.ChatPromptReference[],
	query: string,
): Promise<UserContext> {
	const resolvedFileCache: Map<string, [string, string]> = new Map();

	const sidecarVariables: SidecarVariableTypes[] = [];
	const sidecarImages: SidecarImageContent[] = [];
	const fileCache: Map<string, vscode.TextDocument> = new Map();

	async function resolveFile(uri: vscode.Uri) {
		const cachedFile = fileCache.get(uri.fsPath);
		if (cachedFile === undefined) {
			const fileDocument = await vscode.workspace.openTextDocument(uri);
			fileCache.set(uri.fsPath, fileDocument);
		}
		return fileCache.get(uri.fsPath) as vscode.TextDocument;
	}

	for (const variable of variables) {
		// vscode.editor.selection is a special id which is also present in the editor
		// this help us understand that this is a selection and not a file reference
		if (variable.id === 'vscode.file' || variable.id === 'vscode.editor.selection' || variable.id === 'vscode.file.pinnedContext') {
			const v = variable as vscode.AideAgentFileReference;
			const value = v.value;
			const attachedFile = await resolveFile(value.uri);
			let range = value.range;
			let type: SidecarVariableType = 'File';
			if (variable.id === 'vscode.file' || variable.id === 'vscode.file.pinnedContext') {
				type = 'File';
			} else if (variable.id === 'vscode.editor.selection') {
				type = 'Selection';
			}
			// we do this shoe-horning over here to make sure that we do not perform
			// extensive reads or creation of the text models on the editor layer
			if (variable.id === 'vscode.file') {
				const textModel = await vscode.workspace.openTextDocument(v.value.uri);
				// get the full range over here somehow
				const lastLine = textModel.lineCount;
				if (lastLine === 0) {
					range = new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, 0));
				} else {
					const lastLineLength = textModel.lineAt(lastLine - 1).text.length;
					if (lastLineLength === 0) {
						range = new vscode.Range(new vscode.Position(0, 0), new vscode.Position(lastLine - 1, lastLineLength));
					} else {
						range = new vscode.Range(new vscode.Position(0, 0), new vscode.Position(lastLine - 1, lastLineLength - 1));
					}
				}
			}
			sidecarVariables.push({
				name: v.name,
				start_position: {
					line: range.start.line,
					character: range.start.character,
					byteOffset: 0,
				},
				end_position: {
					line: range.end.line,
					character: range.end.character,
					byteOffset: 0,
				},
				fs_file_path: value.uri.fsPath,
				type,
				content: attachedFile.getText(),
				language: attachedFile.languageId,
			});
		} else if (variable.id === 'vscode.code') {
			const v = variable as vscode.AideAgentCodeReference;
			const value = v.value;
			const attachedFile = await resolveFile(value.uri);
			const range = value.range;
			const type: SidecarVariableType = 'CodeSymbol';
			sidecarVariables.push({
				name: v.name,
				start_position: {
					line: range.start.line,
					character: range.start.character,
					byteOffset: 0,
				},
				end_position: {
					line: range.end.line,
					character: range.end.character,
					byteOffset: 0,
				},
				fs_file_path: value.uri.fsPath,
				type,
				content: attachedFile.getText(range),
				language: attachedFile.languageId,
			});
		} else if (isAideAgentImageAttachmentValue(variable.value)) {
			const value = variable.value;
			const imageData = await value.data();
			// Convert Uint8Array to base64
			const base64Data = Buffer.from(imageData).toString('base64');
			sidecarImages.push({
				type: 'base64',
				media_type: variable.id === 'screenshot-focused-window' ? 'image/jpeg' : value.mimeType,
				data: base64Data,
			});
		}
	}

	const folders: string[] = [];

	let isPlanGeneration = false;
	for (const variable of variables) {
		const variableName = variable.name;
		const name = variableName.split(':')[0];
		if (name === 'generatePlan') {
			isPlanGeneration = true;
		}
	}

	let isPlanExecutionUntil = null;
	for (const variable of variables) {
		const variableName = variable.name;
		const name = variableName.split(':')[0];
		if (name === 'EXECUTE_UNTIL') {
			const queryParts = query.split(' ');
			if (queryParts.length === 2) {
				isPlanExecutionUntil = parseInt(queryParts[1]);
			}
			// if we have execute until then we need to grab the number right after the range where we are at
		}
	}

	let isPlanAppend = false;
	for (const variable of variables) {
		const variableName = variable.name;
		const name = variableName.split(':')[0];
		if (name === 'APPEND_TO_PLAN') {
			isPlanAppend = true;
		}
	}

	let enrichLSP = false;
	for (const variable of variables) {
		const variableName = variable.name;
		const name = variableName.split(':')[0];
		if (name === 'enrichLSP') {
			console.log('LSP will be enriched');
			enrichLSP = true;
		}
	}

	let isPlanDropFrom = null;
	for (const variable of variables) {
		const variableName = variable.name;
		const name = variableName.split(':')[0];
		if (name === 'DROP_PLAN_STEP_FROM') {
			const queryParts = query.split(' ');
			if (queryParts.length === 2) {
				isPlanDropFrom = parseInt(queryParts[1]);
			}
			// if we have execute until then we need to grab the number right after the range where we are at
		}
	}

	return {
		variables: sidecarVariables,
		file_content_map: Array.from(resolvedFileCache.entries()).map(([filePath, fileContent]) => {
			return {
				file_path: filePath,
				file_content: fileContent[0],
				language: fileContent[1],
			};
		}),
		images: sidecarImages,
		terminal_selection: undefined,
		folder_paths: folders,
		is_plan_generation: isPlanGeneration,
		is_plan_execution_until: isPlanExecutionUntil,
		is_plan_append: isPlanAppend,
		with_lsp_enrichment: enrichLSP,
		is_plan_drop_from: isPlanDropFrom,
	};
}

async function convertVSCodeVariableToSidecar(
	variables: readonly vscode.ChatPromptReference[],
): Promise<UserContext> {
	const resolvedFileCache: Map<string, [string, string]> = new Map();

	const sidecarVariables: SidecarVariableTypes[] = [];
	const sidecarImages: SidecarImageContent[] = [];
	const fileCache: Map<string, vscode.TextDocument> = new Map();

	async function resolveFile(uri: vscode.Uri) {
		const cachedFile = fileCache.get(uri.fsPath);
		if (cachedFile === undefined) {
			const fileDocument = await vscode.workspace.openTextDocument(uri);
			fileCache.set(uri.fsPath, fileDocument);
		}
		return fileCache.get(uri.fsPath) as vscode.TextDocument;
	}

	for (const variable of variables) {
		// vscode.editor.selection is a special id which is also present in the editor
		// this help us understand that this is a selection and not a file reference
		if (variable.id === 'vscode.file' || variable.id === 'vscode.editor.selection') {
			const v = variable as vscode.AideAgentFileReference;
			const value = v.value;
			const attachedFile = await resolveFile(value.uri);
			const range = value.range;
			let type: SidecarVariableType = 'File';
			if (variable.id === 'vscode.file') {
				type = 'File';
			} else if (variable.id === 'vscode.editor.selection') {
				type = 'Selection';
			}
			sidecarVariables.push({
				name: v.name,
				start_position: {
					line: range.start.line,
					character: range.start.character,
					byteOffset: 0,
				},
				end_position: {
					line: range.end.line,
					character: range.end.character,
					byteOffset: 0,
				},
				fs_file_path: value.uri.fsPath,
				type,
				content: attachedFile.getText(),
				language: attachedFile.languageId,
			});
		} else if (variable.id === 'vscode.code') {
			const v = variable as vscode.AideAgentCodeReference;
			const value = v.value;
			const attachedFile = await resolveFile(value.uri);
			const range = value.range;
			const type: SidecarVariableType = 'CodeSymbol';
			sidecarVariables.push({
				name: v.name,
				start_position: {
					line: range.start.line,
					character: range.start.character,
					byteOffset: 0,
				},
				end_position: {
					line: range.end.line,
					character: range.end.character,
					byteOffset: 0,
				},
				fs_file_path: value.uri.fsPath,
				type,
				content: attachedFile.getText(range),
				language: attachedFile.languageId,
			});
		} else if (isAideAgentImageAttachmentValue(variable.value)) {
			const value = variable.value;
			const imageData = await value.data();
			// Convert Uint8Array to base64
			const base64Data = Buffer.from(imageData).toString('base64');
			sidecarImages.push({
				type: 'base64',
				media_type: variable.id === 'screenshot-focused-window' ? 'image/jpeg' : value.mimeType,
				data: base64Data,
			});
		}
	}

	const folders: string[] = [];

	let isPlanGeneration = false;
	for (const variable of variables) {
		const variableName = variable.name;
		const name = variableName.split(':')[0];
		if (name === 'generatePlan') {
			isPlanGeneration = true;
		}
	}

	let isIncludeLSP = false;
	for (const variable of variables) {
		const variableName = variable.name;
		const name = variableName.split(':')[0];
		if (name === 'LSP') {
			isIncludeLSP = true;
		}
	}

	// TODO(codestory): Fill this in properly
	const terminalSelection = undefined;

	return {
		variables: sidecarVariables,
		file_content_map: Array.from(resolvedFileCache.entries()).map(([filePath, fileContent]) => {
			return {
				file_path: filePath,
				file_content: fileContent[0],
				language: fileContent[1],
			};
		}),
		images: sidecarImages,
		terminal_selection: terminalSelection,
		folder_paths: folders,
		is_plan_generation: isPlanGeneration,
		is_plan_execution_until: null,
		is_plan_append: false,
		with_lsp_enrichment: isIncludeLSP,
		is_plan_drop_from: null,
	};
}

async function newConvertVSCodeVariableToSidecar(
	variables: readonly vscode.AideAgentPromptReference[],
): Promise<UserContext> {
	const sidecarVariables: SidecarVariableTypes[] = [];
	const fileCache: Map<string, vscode.TextDocument> = new Map();

	async function resolveFile(uri: vscode.Uri) {
		const cachedFile = fileCache.get(uri.fsPath);
		if (cachedFile === undefined) {
			const fileDocument = await vscode.workspace.openTextDocument(uri);
			fileCache.set(uri.fsPath, fileDocument);
		}
		return fileCache.get(uri.fsPath) as vscode.TextDocument;
	}

	for (const variable of variables) {
		// vscode.editor.selection is a special id which is also present in the editor
		// this help us understand that this is a selection and not a file reference
		if (variable.id === 'vscode.file' || variable.id === 'vscode.editor.selection') {
			const v = variable as vscode.AideAgentFileReference;
			const value = v.value;
			const attachedFile = await resolveFile(value.uri);
			let range = value.range;
			let type: SidecarVariableType = 'File';
			if (variable.id === 'vscode.file') {
				type = 'File';
			} else if (variable.id === 'vscode.editor.selection') {
				type = 'Selection';
			}
			if (variable.id === 'vscode.file') {
				type = 'File';
			} else if (variable.id === 'vscode.editor.selection') {
				type = 'Selection';
			}
			// we do this shoe-horning over here to make sure that we do not perform
			// extensive reads or creation of the text models on the editor layer
			if (variable.id === 'vscode.file') {
				const textModel = await vscode.workspace.openTextDocument(v.value.uri);
				// get the full range over here somehow
				const lastLine = textModel.lineCount;
				if (lastLine === 0) {
					range = new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, 0));
				} else {
					const lastLineLength = textModel.lineAt(lastLine).text.length;
					range = new vscode.Range(new vscode.Position(0, 0), new vscode.Position(lastLine - 1, lastLineLength - 1));
				}
			}
			sidecarVariables.push({
				name: v.name,
				start_position: {
					line: range.start.line,
					character: range.start.character,
					byteOffset: 0,
				},
				end_position: {
					line: range.end.line,
					character: range.end.character,
					byteOffset: 0,
				},
				fs_file_path: value.uri.fsPath,
				type,
				content: attachedFile.getText(),
				language: attachedFile.languageId,
			});
		} else if (variable.id === 'vscode.code') {
			const v = variable as vscode.AideAgentCodeReference;
			const value = v.value;
			const attachedFile = await resolveFile(value.uri);
			const range = value.range;
			const type: SidecarVariableType = 'CodeSymbol';
			sidecarVariables.push({
				name: v.name,
				start_position: {
					line: range.start.line,
					character: range.start.character,
					byteOffset: 0,
				},
				end_position: {
					line: range.end.line,
					character: range.end.character,
					byteOffset: 0,
				},
				fs_file_path: value.uri.fsPath,
				type,
				content: attachedFile.getText(range),
				language: attachedFile.languageId,
			});
		}
	}

	return {
		variables: sidecarVariables,
		file_content_map: [],
		images: [],
		terminal_selection: undefined,
		folder_paths: [],
		is_plan_generation: false,
		is_plan_execution_until: null,
		is_plan_append: false,
		with_lsp_enrichment: false,
		is_plan_drop_from: null,
	};
}

// function getFileType(): SidecarVariableType {
// 	return 'File';
// }

// function getVariableType(
// 	name: string,
// 	variableId: string,
// 	startPosition: Position,
// 	endPosition: Position,
// 	textDocument: vscode.TextDocument,
// ): SidecarVariableType | null {
// 	if (name === 'currentFile') {
// 		return 'File';
// 	} else if (variableId === 'vscode.file') {
// 		return 'File';
// 	} else if (name.startsWith('file')) {
// 		// here we have to check if the range is the full file or just a partial
// 		// range in which case its a selection
// 		const textLines = textDocument.lineCount;
// 		if (startPosition.line === 1 && endPosition.line === textLines) {
// 			return 'File';
// 		} else {
// 			return 'Selection';
// 		}
// 	}
// 	return 'CodeSymbol';
// }

function getCurrentActiveWindow(): {
	file_path: string;
	file_content: string;
	visible_range_content: string;
	start_line: number;
	end_line: number;
	language: string;
} | undefined {
	const activeWindow = vscode.window.activeTextEditor;
	if (activeWindow === undefined) {
		return undefined;
	}
	if (activeWindow.visibleRanges.length === 0) {
		// Then we return the full length of the file here or otherwise
		// we return whats present in the range
		return undefined;
	}
	const visibleRanges = activeWindow.visibleRanges;
	const startPosition = activeWindow.visibleRanges[0].start;
	const endPosition = activeWindow.visibleRanges[visibleRanges.length - 1].end;
	const fsFilePath = activeWindow.document.uri.fsPath;
	const range = new vscode.Range(
		startPosition.line,
		0,
		endPosition.line,
		activeWindow.document.lineAt(endPosition.line).text.length
	);
	const visibleRagneContents = activeWindow.document.getText(range);
	const contents = activeWindow.document.getText();
	return {
		file_path: fsFilePath,
		file_content: contents,
		visible_range_content: visibleRagneContents,
		// as these are 0 indexed
		start_line: startPosition.line + 1,
		end_line: endPosition.line + 1,
		language: activeWindow.document.languageId,
	};
}
