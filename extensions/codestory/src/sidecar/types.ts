/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ModelProviderConfiguration, ModelSelection, ProviderSpecificConfiguration } from 'vscode';


export type OptionString =
	| { type: 'Some'; value: string }
	| { type: 'None' };

export type AgentStep =
	| { Path: { query: string; response: string; paths: string[] } }
	| { Code: { query: string; response: string; code_snippets: CodeSpan[] } }
	| { Proc: { query: string; paths: string[]; response: string } };

export type AgentState =
	| 'Search'
	| 'Plan'
	| 'Explain'
	| 'CodeEdit'
	| 'FixSignals'
	| 'Finish';

export interface CodeSpan {
	file_path: string;
	alias: number;
	start_line: number;
	end_line: number;
	data: string;
	score: number | null;
}

export interface SemanticSearchResponse {
	session_id: string;
	query: string;
	code_spans: CodeSpan[];
}

export interface Answer {
	answer_up_until_now: string;
	delta: string | null;
}

export type ConversationState =
	| 'Pending'
	| 'Started'
	| 'StreamingAnswer'
	| 'ReRankingStarted'
	| 'ReRankingFinished'
	| 'Finished';

export interface ConversationMessage {
	message_id: string;
	// We also want to store the session id here so we can load it and save it
	session_id: string;
	// The query which the user has asked
	query: string;
	// The steps which the agent has taken up until now
	steps_taken: AgentStep[];
	// The state of the agent
	agent_state: AgentState;
	// The file paths we are interested in, can be populated via search or after
	// asking for more context
	file_paths: String[];
	// The span which we found after performing search
	code_spans: CodeSpan[];
	// The span which user has selected and added to the context
	user_selected_code_span: CodeSpan[];
	// The files which are open in the editor
	open_files: String[];
	// The status of this conversation
	conversation_state: ConversationState;
	// Final answer which is going to get stored here
	answer: Answer | null;
	// Last updated
	last_updated: number;
	// Created at
	created_at: number;
}

export type ConversationMessageOkay =
	| { type: 'Ok'; data: ConversationMessage };

export interface Repository {
	disk_path: string;
	sync_status: SyncStatus;
	last_commit_unix_secs: number;
	last_index_unix_secs: number;
}


export type SyncStatus =
	| { tag: 'error'; message: string }
	| { tag: 'uninitialized' }
	| { tag: 'cancelling' }
	| { tag: 'cancelled' }
	| { tag: 'queued' }
	| { tag: 'syncing' }
	| { tag: 'indexing' }
	| { tag: 'done' }
	| { tag: 'removed' }
	| { tag: 'remote_removed' };

export interface RepoStatus {
	// The string here is generated from RepoRef.to_string()
	repo_map: { [key: string]: Repository };
}


/**
 * The positions here start with 0 index
 */
export interface Position {
	line: number;
	character: number;
}


export interface ContextSelection {
	relativePath: string;
	fsFilePath: string;
	workingDirectory: string;
	startPosition: Position;
	endPosition: Position;
}

export interface CurrentViewContext {
	// The string here is generated from RepoRef.to_string()
	repo_ref: string;
	// The relative path of the file
	relative_path: string;
	// The line number
	line_number: number;
	// The column number
	column_number: number;
	// the current text which is present on the active editor
	current_text: string;
	// The active selection
	selection: ContextSelection[] | null;
}

// We also get the definitions of the symbols which are present
export interface PreciseContext {
	symbol: {
		fuzzyName?: string;
	};
	hoverText: string[];
	definitionSnippet: {
		context: string;
		startLine: number;
		endLine: number;
	};
	fsFilePath: string;
	relativeFilePath: string;
	range: {
		startLine: number;
		startCharacter: number;
		endLine: number;
		endCharacter: number;
	};
}

export interface DeepContextForView {
	// The string here is generated from RepoRef.to_string()
	repoRef: string;
	preciseContext: PreciseContext[];
	// Where is the cursor positioned, this will be useful context
	// for the llm
	cursorPosition: {
		startPosition: Position;
		endPosition: Position;
	} | null;
	// What is the data present in the current viewport
	currentViewPort: {
		startPosition: Position;
		endPosition: Position;
		relativePath: string;
		fsFilePath: string;
		textOnScreen: string;
	} | null;
	language: string;
}


export interface TextDocument {
	text: String;
	utf8Array: number[];
	language: String;
	fsFilePath: String;
	relativePath: String;
	lineCount: number;
}


export interface SnippetInformation {
	startPosition: {
		line: number;
		character: number;
		byteOffset: number;
	};
	endPosition: {
		line: number;
		character: number;
		byteOffset: number;
	};
}

export enum DiagnosticSeverity {
	Error = 0,
	Warning = 1,
	Information = 2,
	Hint = 3,
}

export interface DiagnosticCode {
	strValue: string | null;
	numValue: number | null;
	information: {
		strValue: string | null;
		numValue: number | null;
		fsFilePath: string;
	} | null;
}


export interface InEditorRequest {
	repoRef: string;
	query: string;
	threadId: string;
	language: string;
	snippetInformation: SnippetInformation;
	textDocumentWeb: TextDocument;
	diagnosticsInformation: DiagnosticInformationFromEditor | null;
}

export interface DiagnosticInformationFromEditor {
	firstMessage: string;
	diagnosticInformation: DiagnosticInformation[];
}

export interface DiagnosticInformation {
	promptParts: string[];
	relatedInformation: DiagnosticRelatedInformation[];
}

export interface DiagnosticRelatedInformation {
	text: string;
	language: string;
	range: {
		startPosition: {
			line: number;
			character: number;
			byteOffset: number;
		};
		endPosition: {
			line: number;
			character: number;
			byteOffset: number;
		};
	};
}


export type InLineAgentAction =
	| 'Code'
	| 'Doc'
	| 'Edit'
	| 'Tests'
	| 'Fix'
	| 'Explain'
	| 'Unknown'
	| { type: 'DecideAction'; query: string };


export type InLineAgentMessageState =
	| 'Pending'
	| 'Started'
	| 'StreamingAnswer'
	| 'Finished'
	| 'Errored';

export type InLineAgentLLMType =
	| 'CodeLLama70BInstruct'
	| 'MistralInstruct'
	| 'Mixtral'
	| 'Gpt4'
	| 'GPT3_5_16k'
	| 'Gpt4_32k'
	| 'Gpt4Turbo';

export interface InLineAgentDocumentSymbol {
	name: string | null;
	start_position: Position;
	end_position: Position;
	kind: string | null;
	code: string;
}


export interface InLineAgentAnswer {
	answer_up_until_now: string;
	delta: string | null;
	state: InLineAgentMessageState;
	document_symbol: InLineAgentDocumentSymbol | null;
	context_selection: InLineAgentContextSelection | null;
	model: InLineAgentLLMType;
}


export interface InLineAgentMessage {
	session_id: string;
	message_id: string;
	query: string;
	steps_taken: InLineAgentAction[];
	message_state: InLineAgentMessageState;
	answer: InLineAgentAnswer | null;
	last_updated: number;
	created_at: number;
	keep_alive: string | undefined;
}

export interface InLineAgentContextSelection {
	above: InLineAgentSelectionData;
	below: InLineAgentSelectionData;
	range: InLineAgentSelectionData;
}

export interface InLineAgentSelectionData {
	has_content: boolean;
	first_line_index: number;
	last_line_index: number;
	lines: string[];
}


export interface InEditorTreeSitterDocumentationQuery {
	language: string;
	source: string;
}

export interface InEditorTreeSitterDocumentationReply {
	documentation: string;
}

export type SidecarVariableType =
	| 'File'
	| 'CodeSymbol'
	| 'Selection';

export interface SidecarVariableTypes {
	name: string;
	start_position: Position;
	end_position: Position;
	fs_file_path: string;
	type: SidecarVariableType;
	content: string;
	language: string;
}


export type DiffActionResponse =
	| 'AcceptCurrentChanges'
	| 'AcceptIncomingChanges'
	| 'AcceptBothChanges';

export type TextEditStreaming =
	| {
		Start: {
			code_block_index: number;
			context_selection: InLineAgentContextSelection;
		};
	}
	| {
		End: {
			code_block_index: number;
			reason: string;
		};
	}
	| {
		EditStreaming: {
			code_block_index: number;
			range: {
				startPosition: {
					line: number;
					character: number;
				};
				endPosition: {
					line: number;
					character: number;
				};
			};
			content_up_until_now: string;
			content_delta: string;
		};
	};


export type EditFileResponse =
	| { Message: { message: string } }
	| {
		Action: {
			action: DiffActionResponse; range: {
				start_position: {
					line: number;
					character: number;
				};
				end_position: {
					line: number;
					character: number;
				};
			}; content: string; previous_content: string;
		};
	}
	| {
		TextEdit: {
			range: {
				startPosition: {
					line: number;
					character: number;
				};
				endPosition: {
					line: number;
					character: number;
				};
			}; content: string;
			should_insert: boolean;
		};
	}
	| { Status: { session_id: string; status: string } }
	| { TextEditStreaming: { data: TextEditStreaming } };

export type SyncUpdate =
	| { ProgressEvent: { ref: string; ev: ProgressEvent } }
	| { KeepAlive: { timestamp: number } };

export interface Progress {
	ref: string;
	ev: ProgressEvent;
}

export type ProgressEvent =
	| { index_percent: number }
	| { sync_status: SyncStatus };


export enum LLMType {
	Mixtral,
	MistralInstruct,
	CodeLLama70BInstruct,
	Gpt4,
	GPT3_5_16k,
	Gpt4_32k,
	Gpt4Turbo
}

export type CustomLLMType = {
	kind: 'Custom';
	value: string;
};

export type LLMTypeVariant = LLMType | CustomLLMType;


// Helper function to convert the model configuration to the sidecar type
// the final json should look like this:
// {
// 	"slow_model":"slow_model",
// 	"fast_model":"fast_model",
// 	"models":{
// 		"slow_model":
// 			{
// 				"context_length":16000,
// 				"temperature":0.2,
// 				"provider":{
// 					"Azure":{
// 						"deployment_id":"gpt35-turbo-access"
// 					}
// 				}
// 			}
// 		},
// 		"providers":[
// 			{"OpenAIAzureConfig":{
// 				"deployment_id":"gpt35-turbo-access",
// 				"api_base":"https://codestory-gpt4.openai.azure.com",
// 				"api_key":"89ca8a49a33344c9b794b3dabcbbc5d0",
// 				"api_version":"v1"
// 			}
// 		}
// 	]
// }
export async function getSideCarModelConfiguration(modelSelection: ModelSelection) {
	const slowModel = modelSelection.slowModel;
	const fastModel = modelSelection.fastModel;
	const models = modelSelection.models;
	const modelRecord = {};
	for (const [key, value] of Object.entries(models)) {
		const modelConfiguration = {
			context_length: value.contextLength,
			temperature: value.temperature,
			provider: getModelProviderConfiguration(value.provider, key),
		};
		// @ts-ignore
		modelRecord[key] = modelConfiguration;
		console.log('modelRecord');
		console.log(modelConfiguration);
		console.log(modelRecord);
	}
	const providers = modelSelection.providers;
	const finalProviders = [];
	for (const [key, value] of Object.entries(providers)) {
		const providerConfigSideCar = getProviderconfiguration(key, value);
		if (providerConfigSideCar !== null) {
			finalProviders.push(providerConfigSideCar);
		}
	}
	return {
		'slow_model': slowModel,
		'fast_model': fastModel,
		'models': modelRecord,
		'providers': finalProviders,
	};
}

// The various types are present in aiModels.ts
function getProviderconfiguration(type: string, value: ModelProviderConfiguration) {
	if (type === 'openai-default') {
		return {
			'OpenAI': {
				'api_key': value.apiKey,
			}
		};
	}
	if (type === 'azure-openai') {
		return {
			'OpenAIAzureConfig': {
				'deployment_id': '',
				'api_base': value.apiBase,
				'api_key': value.apiKey,
				// TODO(skcd): Fix the hardcoding of api version here, this will
				// probably come from the api version in azure config
				'api_version': '2023-08-01-preview',
			}
		};
	}
	if (type === 'togetherai') {
		return {
			'TogetherAI': {
				'api_key': value.apiKey,
			}
		};
	}
	if (type === 'ollama') {
		return {
			'Ollama': {}
		};
	}
	return null;
}

function getModelProviderConfiguration(providerConfiguration: ProviderSpecificConfiguration, llmType: string) {
	if (providerConfiguration.type === 'openai-default') {
		return 'OpenAI';
	}
	if (providerConfiguration.type === 'azure-openai') {
		return {
			'Azure': {
				'deployment_id': providerConfiguration.deploymentID,
			}
		};
	}
	if (providerConfiguration.type === 'togetherai') {
		return 'TogetherAI';
	}
	if (providerConfiguration.type === 'ollama') {
		return 'Ollama';
	}
	if (providerConfiguration.type === 'codestory') {
		return {
			'CodeStory': {
				'llm_type': llmType,
			}
		};
	}
}
