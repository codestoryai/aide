/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as path from 'path';
import { sleep } from '../utilities/sleep';
import { CodeSymbolInformationEmbeddings, CodeSymbolKind } from '../utilities/types';
import { callServerEventStreamingBufferedGET, callServerEventStreamingBufferedPOST } from './ssestream';
import { ConversationMessage, DeepContextForView, EditFileResponse, getSideCarModelConfiguration, InEditorRequest, InEditorTreeSitterDocumentationQuery, InEditorTreeSitterDocumentationReply, InLineAgentMessage, Position, RepoStatus, SemanticSearchResponse, SidecarVariableType, SidecarVariableTypes, SnippetInformation, SyncUpdate, TextDocument } from './types';
import { SelectionDataForExplain } from '../utilities/getSelectionContext';
import { sidecarNotIndexRepository } from '../utilities/sidecarUrl';

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
		return `${this._backend}/${this._path}`;
	}

	getPath(): string {
		return this._path;
	}
}


export class SideCarClient {
	private _url: string;
	private _openAIKey: string | null = null;
	private _modelConfiguration: vscode.ModelSelection;

	constructor(
		url: string,
		openAIKey: string | null,
		modelConfiguration: vscode.ModelSelection,
	) {
		this._url = url;
		this._openAIKey = openAIKey;
		this._modelConfiguration = modelConfiguration;
	}

	updateModelConfiguration(modelConfiguration: vscode.ModelSelection) {
		this._modelConfiguration = modelConfiguration;
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

	async getSymbolsForGoToDefinition(
		codeSnippet: string,
		repoRef: RepoRef,
		threadId: string,
		language: string,
	): Promise<string[]> {
		const baseUrl = new URL(this._url);
		baseUrl.pathname = '/api/agent/goto_definition_symbols';
		const body = {
			repo_ref: repoRef.getRepresentation(),
			code_snippet: codeSnippet,
			thread_id: threadId,
			language: language,
			openai_key: this._openAIKey,
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
		const symbols = responseJson.symbols as string[];
		return symbols;
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
		const sideCarModelConfiguration = await getSideCarModelConfiguration(await vscode.modelSelection.getConfiguration());
		// This is where we have to send the model selection object
		// const modelConfig = {
		// 	slow_model: this._modelConfiguration.slowModel,
		// 	fast_model: this._modelConfiguration.fastModel,
		// 	models: this._modelConfiguration.models,
		// 	providers,
		// };
		console.log(JSON.stringify(sideCarModelConfiguration));
		const modelConfig = {
			slow_model: 'MistralInstruct',
			fast_model: 'MistralInstruct',
			models: {
				Mixtral: {
					context_length: 32000,
					temperature: 0.2,
					provider: 'TogetherAI',
				},
				MistralInstruct: {
					context_length: 8000,
					temperature: 0.2,
					provider: 'TogetherAI',
				},
			},
			providers: [
				{
					OpenAIAzureConfig: {
						deployment_id: 'gpt35-turbo-access',
						api_base: 'https://codestory-gpt4.openai.azure.com',
						api_key: '89ca8a49a33344c9b794b3dabcbbc5d0',
						api_version: '2023-08-01-preview',
					},
				},
				{
					TogetherAI: {
						api_key: 'cc10d6774e67efef2004b85efdb81a3c9ba0b7682cc33d59c30834183502208d',
					},
				},
			],
		};
		const finalContext = {
			...context,
			openai_key: this._openAIKey,
			modelConfig: sideCarModelConfiguration,
		};
		const asyncIterableResponse = await callServerEventStreamingBufferedPOST(url, finalContext);
		for await (const line of asyncIterableResponse) {
			const lineParts = line.split('data:{');
			for (const lineSinglePart of lineParts) {
				const lineSinglePartTrimmed = lineSinglePart.trim();
				if (lineSinglePartTrimmed === '') {
					continue;
				}
				const inlineAgentMessage = JSON.parse('{' + lineSinglePartTrimmed) as InLineAgentMessage;
				yield inlineAgentMessage;
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
		const body = {
			file_path: filePath,
			file_content: fileContent,
			language: language,
			new_content: llmContent,
			user_query: userQuery,
			session_id: sessionId,
			code_block_index: codeBlockIndex,
			openai_key: this._openAIKey,
		};
		const asyncIterableResponse = await callServerEventStreamingBufferedPOST(url, body);
		for await (const line of asyncIterableResponse) {
			const lineParts = line.split('data:{');
			for (const lineSinglePart of lineParts) {
				const lineSinglePartTrimmed = lineSinglePart.trim();
				if (lineSinglePartTrimmed === '') {
					continue;
				}
				const editFileResponse = JSON.parse('{' + lineSinglePartTrimmed) as EditFileResponse;
				yield editFileResponse;
			}
		}
	}

	async *followupQuestion(
		query: string,
		repoRef: RepoRef,
		threadId: string,
		variables: Record<string, vscode.CSChatVariableValue[]>,
		projectLabels: string[],
	): AsyncIterableIterator<ConversationMessage> {
		const baseUrl = new URL(this._url);
		baseUrl.pathname = '/api/agent/followup_chat';
		const url = baseUrl.toString();
		const activeWindowData = getCurrentActiveWindow();
		const sideCarModelConfiguration = await getSideCarModelConfiguration(await vscode.modelSelection.getConfiguration());
		const body = {
			repo_ref: repoRef.getRepresentation(),
			query: query,
			thread_id: threadId,
			user_context: await convertVSCodeVariableToSidecar(variables),
			project_labels: projectLabels,
			active_window_data: activeWindowData,
			openai_key: this._openAIKey,
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
				console.log(lineSinglePartTrimmed);
				const conversationMessage = JSON.parse('{' + lineSinglePartTrimmed) as ConversationMessage;
				yield conversationMessage;
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
		if (this._openAIKey !== null) {
			baseUrl.searchParams.set('openai_key', this._openAIKey);
		}
		const url = baseUrl.toString();
		const asyncIterableResponse = await callServerEventStreamingBufferedGET(url);
		for await (const line of asyncIterableResponse) {
			const lineParts = line.split('data:{');
			for (const lineSinglePart of lineParts) {
				const lineSinglePartTrimmed = lineSinglePart.trim();
				if (lineSinglePartTrimmed === '') {
					continue;
				}
				const conversationMessage = JSON.parse('{' + lineSinglePartTrimmed) as ConversationMessage;
				yield conversationMessage;
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
				const conversationMessage = JSON.parse('{' + lineSinglePartTrimmed) as ConversationMessage;
				console.log('[search][stream] whats the message from the stream');
				yield conversationMessage;
			}
		}
	}

	async indexRepositoryIfNotInvoked(repoRef: RepoRef): Promise<boolean> {
		// First get the list of indexed repositories
		await this.waitForGreenHC();
		console.log('fetching the status of the various repositories');
		const response = await fetch(this.getRepoListUrl());
		const repoList = (await response.json()) as RepoStatus;
		if (sidecarNotIndexRepository()) {
			return true;
		}
		if (!(repoRef.getRepresentation() in repoList.repo_map)) {
			// We need to index this repository
			const baseUrl = new URL(this._url);
			baseUrl.pathname = '/api/repo/sync';
			baseUrl.searchParams.set('repo', repoRef.getRepresentation());
			if (this._openAIKey !== null) {
				baseUrl.searchParams.set('openai_key', this._openAIKey);
			}
			const url = baseUrl.toString();
			const response = await fetch(url);
			const responseJson = await response.json();
			return responseJson.status === 'ok';
		} else {
			// We don't need to index this repository
			return true;
		}
	}

	async waitForGreenHC(): Promise<boolean> {
		const baseUrl = new URL(this._url);
		baseUrl.pathname = '/api/health';
		let attempts = 0;
		const totalAttempts = 10;
		while (true) {
			try {
				console.log('trying to HC for repo check');
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
		if (this._openAIKey !== null) {
			baseUrl.searchParams.set('openai_key', this._openAIKey);
		}
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
}

interface CodeSelectionUriRange {
	uri: string;
	range: {
		selection: {
			startLineNumber: number;
			startColumn: number;
			endLineNumber: number;
			endColumn: number;
		};
		decoration: {
			startLineNumber: number;
			startColumn: number;
			endLineNumber: number;
			endColumn: number;
		};
	};
}

async function convertVSCodeVariableToSidecar(
	variables: Record<string, vscode.CSChatVariableValue[]>,
): Promise<{ variables: SidecarVariableTypes[]; file_content_map: { file_path: string; file_content: string; language: string }[] }> {
	const sidecarVariables: SidecarVariableTypes[] = [];
	const fileCache: Map<string, vscode.TextDocument> = new Map();
	const resolvedFileCache: Map<string, [string, string]> = new Map();
	const variablesArr = Array.from(new Map(Object.entries(variables)).entries());
	for (let index = 0; index < variablesArr.length; index++) {
		const keyValue = variablesArr[index];
		const name = keyValue[0];
		const value = keyValue[1];
		if (value.length === 0) {
			continue;
		}
		const variableValue = value[0];
		if (typeof variableValue.value === 'string') {
			// TODO write code from here for the selection logic
			const parsedJson = JSON.parse(variableValue.value) as CodeSelectionUriRange;
			const filePath = vscode.Uri.parse(parsedJson.uri);
			const cachedFile = fileCache.get(filePath.fsPath);
			if (cachedFile === undefined) {
				const fileDocument = await vscode.workspace.openTextDocument(vscode.Uri.file(filePath.fsPath));
				fileCache.set(filePath.fsPath, fileDocument);
			}
			const fileDocument = fileCache.get(filePath.fsPath) as vscode.TextDocument;
			const startRange = {
				line: parsedJson.range.selection.startLineNumber,
				character: parsedJson.range.selection.startColumn,
			};
			const endRange = {
				line: parsedJson.range.selection.endLineNumber,
				character: parsedJson.range.selection.endColumn,
			};
			const variableType = getVariableType(
				name,
				startRange,
				endRange,
				fileDocument,
			);
			const content = fileDocument.getText(new vscode.Range(
				new vscode.Position(startRange.line, startRange.character),
				new vscode.Position(endRange.line, endRange.character),
			));
			resolvedFileCache.set(filePath.fsPath, [fileDocument.getText(), fileDocument.languageId]);
			if (variableType !== null) {
				sidecarVariables.push({
					name,
					start_position: startRange,
					end_position: endRange,
					fs_file_path: filePath.fsPath,
					type: variableType,
					content,
					language: fileDocument.languageId,
				});
			}
		} else {
			const parsedValue = variableValue.value as any;
			const fsFilePath = parsedValue.uri.fsPath;
			const cachedFile = fileCache.get(fsFilePath);
			if (cachedFile === undefined) {
				const fileDocument = await vscode.workspace.openTextDocument(vscode.Uri.file(fsFilePath));
				fileCache.set(fsFilePath, fileDocument);
			}
			const fileDocument = fileCache.get(fsFilePath) as vscode.TextDocument;
			const startRange = {
				line: parsedValue.range.startLineNumber,
				character: parsedValue.range.startColumn,
			};
			const endRange = {
				line: parsedValue.range.endLineNumber,
				character: parsedValue.range.endColumn,
			};
			const variableType = getVariableType(
				name,
				startRange,
				endRange,
				fileDocument,
			);
			const content = fileDocument.getText(new vscode.Range(
				new vscode.Position(startRange.line, startRange.character),
				new vscode.Position(endRange.line, endRange.character),
			));
			resolvedFileCache.set(fsFilePath, [fileDocument.getText(), fileDocument.languageId]);
			if (variableType !== null) {
				sidecarVariables.push({
					name,
					start_position: startRange,
					end_position: endRange,
					fs_file_path: fsFilePath,
					type: variableType,
					content,
					language: fileDocument.languageId,
				});
			}
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
	};
}

function getVariableType(
	name: string,
	startPosition: Position,
	endPosition: Position,
	textDocument: vscode.TextDocument,
): SidecarVariableType | null {
	if (name.startsWith('file')) {
		// here we have to check if the range is the full file or just a partial
		// range in which case its a selection
		const textLines = textDocument.lineCount;
		if (startPosition.line === 1 && endPosition.line === textLines) {
			return 'File';
		} else {
			return 'Selection';
		}
	}
	return 'CodeSymbol';
}

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
