/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { DocumentSymbol, SymbolInformation } from 'vscode';
import { LLMProviderAPIKeys } from '../sidecar/providerConfigTypes';
import { ConversationMessageVariableInformation, LLMProvider, LLMTypeVariant, SidecarVariableTypes } from '../sidecar/types';

type SidecarFileContent = {
	file_path: string;
	file_content: string;
	language: string;
};

export type SidecarImageContent = {
	type: string;
	media_type: string;
	data: string;
};

export type UserContext = {
	variables: SidecarVariableTypes[];
	file_content_map: SidecarFileContent[];
	images: SidecarImageContent[];
	terminal_selection: string | undefined;
	folder_paths: string[];
	is_plan_generation: boolean;
	is_plan_execution_until: number | null;
	is_plan_append: boolean;
	with_lsp_enrichment: boolean;
	is_plan_drop_from: number | null;
};

export type SymbolIdentifier = {
	symbol_name: string;
	fs_file_path?: string;
};

type ActiveWindowData = {
	file_path: string;
	file_content: string;
	language: string;
};

export type ProbeAgentBody = {
	query: string;
	editor_url: string;
	request_id: string;
	model_config: Record<string, any>;
	user_context: UserContext;
	active_window_data?: ActiveWindowData;
};

export type CodeEditAgentBody = {
	user_query: string;
	editor_url: string;
	request_id: string;
	user_context: UserContext;
	active_window_data?: ActiveWindowData;
	root_directory: string | undefined;
	codebase_search: boolean;
	anchor_editing: boolean;
	enable_import_nodes: boolean;
	deep_reasoning: boolean;
};

export type AnchorSessionStart = {
	editor_url: string;
	request_id: string;
	user_context: UserContext;
	active_window_data?: ActiveWindowData;
	root_directory: string | undefined;
};

export type SideCarAgentEvent = SideCarAgentStartStreamingEvent | SideCarAgentKeepAliveEvent | SideCarAgentUIEvent | SideCarAgentDoneEvent;

interface SideCarAgentKeepAliveEvent {
	keep_alive: 'alive';
}

interface SideCarAgentDoneEvent {
	done: '[CODESTORY_DONE]';
}

interface SideCarAgentStartStreamingEvent {
	session_id: string;
	started: boolean;
}

interface SideCarAgentUIEvent {
	request_id: string;
	exchange_id: string;
	event: UIEvent;
}

interface RequestEventProbeFinished {
	reply: string;
}

interface RequestEvents {
	ProbingStart?: {};
	ProbeFinished?: RequestEventProbeFinished;
}

export enum ToolParameter {
	FSFilePath = 'fs_file_path',
	DirectoryPath = 'directory_path',
	Instruction = 'instruction',
	Command = 'command',
	Question = 'question',
	Result = 'result',
	RegexPattern = 'regex_pattern',
	FilePattern = 'file_pattern',
	Recursive = 'recursive'
}

export type ToolParameterType = `${ToolParameter}`;

interface ToolParameterFoundEvent {
	tool_parameter_input: {
		field_name: ToolParameterType;
		field_content_up_until_now: string;
		field_content_delta: string;
	};
}

type ToolType = 'ListFiles' |
	'SearchFileContentWithRegex' |
	'OpenFile' |
	'CodeEditing' |
	'LSPDiagnostics' |
	'AskFollowupQuestions' |
	'AttemptCompletion' |
	'RepoMapGeneration';

interface ToolTypeFoundEvent {
	tool_type: ToolType;
}

interface ToolThinkingEvent {
	thinking: string;
}

interface ToolNotFoundEvent {
	full_output: string;
}

interface ToolTypeErrorEvent {
	error_string: string;
}

type FrameworkEvent = {
	RepoMapGenerationStart: string;
	RepoMapGenerationFinished: string;
	LongContextSearchStart: string;
	LongContextSearchFinished: string;
	InitialSearchSymbols: InitialSearchSymbols;
	OpenFile: OpenFileRequestFrameworkEvent;
	CodeIterationFinished: string;
	ReferenceFound: FoundReference;
	RelevantReference: RelevantReference;
	GroupedReferences: GroupedReferences;
	ReferencesUsed: FrameworkReferencesUsed;
	SearchIteration: IterativeSearchEvent;
	AgenticTopLevelThinking: string;
	AgenticSymbolLevelThinking: StepListItem;
	ToolUseDetected: ToolUseDetectedEvent;
	ToolThinking: ToolThinkingEvent;
	ToolNotFound: ToolNotFoundEvent;
	ToolCallError: ToolTypeErrorEvent;
	ToolTypeFound: ToolTypeFoundEvent;
	ToolParameterFound: ToolParameterFoundEvent;
	ToolOutput: ToolOutputEvent;
};

type ToolOutputEvent = {
	ToolTypeForOutput: ToolTypeForOutputEvent;
	ToolOutputResponse: ToolOutputResponseEvent;
};

interface ToolTypeForOutputEvent {
	tool_type: ToolType;
}

interface ToolOutputResponseEvent {
	delta: string;
	answer_up_until_now: string;
}

interface ToolUseDetectedEvent {
	tool_use_partial_input: ToolInputPartial;
	thinking: string;
}

export type ToolInputPartial = {
	CodeEditing: CodeEditingPartialRequest;
	ListFiles: ListFilesInput;
	SearchFileContentWithRegex: SearchFileContentInputPartial;
	OpenFile: OpenFileRequestPartial;
	LSPDiagnostics: WorkspaceDiagnosticsPartial;
	TerminalCommand: TerminalInputPartial;
	AskFollowupQuestions: AskFollowupQuestionsRequest;
	AttemptCompletion: AttemptCompletionClientRequest;
};

interface CodeEditingPartialRequest {
	fs_file_path: string;
	instruction: string;
}

interface ListFilesInput {
	directory_path: string;
	recursive: boolean;
}

interface OpenFileRequestPartial {
	fs_file_path: string;
}

interface WorkspaceDiagnosticsPartial { }

interface TerminalInputPartial {
	command: string;
}

interface AskFollowupQuestionsRequest {
	question: string;
}

interface AttemptCompletionClientRequest {
	result: string;
	command: string | null;
}


interface SearchFileContentInputPartial {
	directory_path: string;
	regex_pattern: string;
	file_pattern: string | null;
}

type ExchangeMessageEvent = {
	FinishedExchange: FinishedExchangeEvent;
	EditsExchangeState: EditsExchangeEditsState;
	PlansExchangeState: EditsExchangeEditsState;
	ExecutionState: ExecutionExchangeStateEvent;
	RegeneratePlan: RegeneratePlanExchangeEvent;
	TerminalCommand: TerminalCommandEvent;
};

type ExecutionExchangeStateEvent = 'Inference' | 'InReview' | 'Cancelled';

interface EditsExchangeEditsState {
	edits_state: 'Loading' | 'Cancelled' | 'MarkedComplete' | 'Accepted';
	files: string[];
}

type PlanMessageEvent = {
	PlanStepCompleteAdded: PlanStepAddEvent;
	PlanStepTitleAdded: PlanStepTitleEvent;
	PlanStepDescriptionUpdate: PlanStepDescriptionUpdateEvent;
};

interface PlanStepAddEvent {
	session_id: string;
	exchange_id: string;
	files_to_edit: string[];
	title: string;
	description: string;
	index: number;
}

interface PlanStepTitleEvent {
	session_id: string;
	exchange_id: string;
	files_to_edit: string[];
	title: string;
	index: number;
}

interface PlanStepDescriptionUpdateEvent {
	session_id: string;
	exchange_id: string;
	files_to_edit: string[];
	delta: string | null;
	description_up_until_now: string;
	index: number;
}

interface RegeneratePlanExchangeEvent {
	exchange_id: string;
	session_id: string;
}

interface FinishedExchangeEvent {
	exchange_id: string;
	session_id: string;
}

interface ChatMessageEvent {
	answer_up_until_now: string;
	delta: string | null;
}

type StepListItem = {
	name: string;
	steps: string[];
	new: boolean;
	filePath: string;
};

enum SearchToolType {
	File = 'File',
	Keyword = 'Keyword'
}

interface SearchQuery {
	thinking: string;
	tool: SearchToolType;
	query: string;
}

type SearchResultSnippet =
	| { type: 'FileContent'; content: Uint8Array }
	| { type: 'Tag'; tag: string };

interface SearchResult {
	path: string;
	thinking: string;
	snippet: SearchResultSnippet;
}

interface IdentifiedFile {
	path: string;
	thinking: string;
}

interface IdentifyResponse {
	items: IdentifiedFile[];
	scratchPad: string;
}

interface DecideResponse {
	suggestions: string;
	complete: boolean;
}

type IterativeSearchEvent =
	| { type: 'SearchStarted' }
	| { type: 'SeedApplied'; duration: Duration }
	| { type: 'SearchQueriesGenerated'; queries: SearchQuery[]; duration: Duration }
	| { type: 'SearchExecuted'; results: SearchResult[]; duration: Duration }
	| { type: 'IdentificationCompleted'; response: IdentifyResponse; duration: Duration }
	| { type: 'FileOutlineGenerated'; duration: Duration }
	| { type: 'DecisionMade'; response: DecideResponse; duration: Duration }
	| { type: 'LoopCompleted'; iteration: number; duration: Duration }
	| { type: 'SearchCompleted'; duration: Duration };

interface Duration {
	secs: number;
	nanos: number;
}

// key represents a REASON
type GroupedReferences = { [key: string]: Location[] };

interface Location {
	fs_file_path: string;
	symbol_name: string;
}

interface UIEvent {
	SymbolEvent: SymbolEventRequest;
	ToolEvent: ToolInput;
	CodebaseEvent: SymbolInputEvent;
	SymbolLoctationUpdate: SymbolLocation;
	SymbolEventSubStep: SymbolEventSubStepRequest;
	RequestEvent: RequestEvents;
	EditRequestFinished: string;
	FrameworkEvent: FrameworkEvent;
	ChatEvent: ChatMessageEvent;
	ExchangeEvent: ExchangeMessageEvent;
	PlanEvent: PlanMessageEvent;
	Error: ErrorEvent;
}

interface ErrorEvent {
	message: string;
}

interface TerminalCommandEvent {
	exchange_id: string;
	session_id: string;
	command: string;
}

interface SymbolEventSubStepRequest {
	symbol_identifier: SymbolIdentifier;
	event: SymbolEventSubStep;
}

interface SymbolEventProbeRequest {
	SubSymbolSelection: {};
	ProbeDeeperSymbol: {};
	ProbeAnswer: string;
}

interface SymbolEventGoToDefinitionRequest {
	fs_file_path: string;
	range: SidecarRequestRange;
	thinking: string;
}

interface EditedCodeStreamingRequestEvent {
	Delta: string;
}

export interface EditedCodeStreamingRequest {
	edit_request_id: string;
	range: SidecarRequestRange;
	fs_file_path: string;
	event: 'Start' | 'End' | EditedCodeStreamingRequestEvent;
	apply_directly: boolean;
	session_id: string;
	exchange_id: string;
	// the plan step which the following edit belongs to
	plan_step_id: string | null;
}

interface SymbolEventEditRequest {
	RangeSelectionForEdit: RangeSelectionForEditRequest;
	InsertCode: InsertCodeForEditRequest;
	EditCode: EditedCodeForEditRequest;
	CodeCorrectionTool: CodeCorrectionToolSelection; // this indicates that code correction tool will be used.
	EditCodeStreaming: EditedCodeStreamingRequest;
	ThinkingForEdit: ThinkingForEditRequest;
}

interface ThinkingForEditRequest {
	thinking: string;
	delta: string | null;
}

interface RangeSelectionForEditRequest {
	range: SidecarRequestRange;
	fs_file_path: string;
}

interface InsertCodeForEditRequest {
	range: SidecarRequestRange;
	fs_file_path: string;
}

interface EditedCodeForEditRequest {
	range: SidecarRequestRange;
	fs_file_path: string;
	new_code: string;
}

interface CodeCorrectionToolSelection {
	range: SidecarRequestRange;
	fs_file_path: string;
	tool_use: string;
}

interface SymbolEventSubStep {
	Probe?: SymbolEventProbeRequest;
	GoToDefinition?: SymbolEventGoToDefinitionRequest;
	Edit?: SymbolEventEditRequest;
}

interface SymbolLocation {
	snippet: Snippet;
	symbol_identifier: SymbolIdentifier;
}

interface SymbolInputEvent {
	context: UserContext;
	llm: LLMTypeVariant;
	provider: LLMProvider;
	api_keys: LLMProviderAPIKeys;
	user_query: string;
	request_id: string;
	swe_bench_test_endpoint?: string;
	repo_map_fs_path?: string;
	gcloud_access_token?: string;
	swe_bench_id?: string;
	swe_bench_git_dname?: string;
	swe_bench_code_editing?: LLMProperties;
	swe_bench_gemini_api_keys?: LLMProperties;
	swe_bench_long_context_editing?: LLMProperties;
}

interface LLMProperties {
	llm: LLMTypeVariant;
	provider: LLMProvider;
	api_keys: LLMProviderAPIKeys;
}

interface ToolProperties {
	swe_bench_test_endpoint?: string;
	swe_bench_code_editing_llm?: LLMProperties;
	swe_bench_reranking_llm?: LLMProperties;
}

interface SymbolEventRequest {
	symbol: SymbolIdentifier;
	event: SymbolEvent;
	tool_properties: ToolProperties;
}

interface SymbolEvent {
	InitialRequest: InitialRequestData;
	AskQuestion: AskQuestionRequest;
	UserFeedback: {};
	Delete: {};
	Edit: SymbolToEditRequest;
	Outline: {};
	Probe: SymbolToProbeRequest;
}

interface InitialRequestData {
	original_question: string;
	plan_if_available?: string;
}

interface AskQuestionRequest {
	question: string;
}

interface SymbolToEdit {
	outline: boolean;
	range: SidecarRequestRange;
	fs_file_path: string;
	symbol_name: string;
	instructions: string[];
	is_new: boolean;
}

interface InitialSearchSymbols {
	request_id: string;
	symbols: InitialSearchSymbolInformation[];
}

interface OpenFileRequestFrameworkEvent {
	fs_file_path: string;
}

type FoundReference = Record<string, number>;

interface FrameworkReferencesUsed {
	exchange_id: String;
	variables: ConversationMessageVariableInformation[];
}

interface RelevantReference {
	fs_file_path: string;
	symbol_name: string;
	reason: string;
}

interface InitialSearchSymbolInformation {
	fs_file_path: string;
	symbol_name: string;
	is_new: boolean;
	thinking: string;
	range: Range;
}

interface SymbolToEditRequest {
	symbols: SymbolToEdit[];
	symbol_identifier: SymbolIdentifier;
}

interface SymbolToProbeHistory {
	symbol: string;
	fs_file_path: string;
	content: string;
	question: string;
}

interface SymbolToProbeRequest {
	symbol_identifier: SymbolIdentifier;
	probe_request: string;
	original_request: string;
	original_request_id: string;
	history: SymbolToProbeHistory[];
}

interface ToolInput {
	CodeEditing?: CodeEdit;
	LSPDiagnostics?: LSPDiagnostics;
	FindCodeSnippets?: FindCodeSnippets;
	ReRank?: ReRankEntriesForBroker;
	CodeSymbolUtilitySearch?: CodeSymbolUtilitySearch;
	RequestImportantSymbols?: CodeSymbolImportantRequest;
	RequestImportantSybmolsCodeWide?: CodeSymbolImportantWideSearch;
	GoToDefinition?: SidecarGoToDefinitionRequest;
	GoToReference?: SidecarGoToReferencesRequest;
	OpenFile?: OpenFileRequest;
	GrepSingleFile?: FindInFileRequest;
	SymbolImplementations?: SidecarGoToImplementationRequest;
	FilterCodeSnippetsForEditing?: CodeToEditFilterRequest;
	FilterCodeSnippetsForEditingSingleSymbols?: CodeToEditSymbolRequest;
	EditorApplyChange?: EditorApplyRequest;
	QuickFixRequest?: SidecarQuickFixRequest;
	QuickFixInvocationRequest?: LSPQuickFixInvocationRequest;
	CodeCorrectnessAction?: CodeCorrectnessRequest;
	CodeEditingError?: CodeEditingErrorRequest;
	ClassSymbolFollowup?: ClassSymbolFollowupRequest;
	ProbeCreateQuestionForSymbol?: ProbeQuestionForSymbolRequest;
	ProbeEnoughOrDeeper?: ProbeEnoughOrDeeperRequest;
	ProbeFilterSnippetsSingleSymbol?: CodeToProbeSubSymbolRequest;
	ProbeSubSymbol?: CodeToEditFilterRequest;
	ProbePossibleRequest?: CodeSymbolToAskQuestionsRequest;
	ProbeQuestionAskRequest?: CodeSymbolToAskQuestionsRequest;
	ProbeFollowAlongSymbol?: CodeSymbolFollowAlongForProbing;
	ProbeSummarizeAnswerRequest?: CodeSymbolProbingSummarize;
	RepoMapSearch?: RepoMapSearchQuery;
	SWEBenchTest?: SWEBenchTestRequest;
	TestOutputCorrection?: TestOutputCorrectionRequest;
	CodeSymbolFollowInitialRequest?: CodeSymbolFollowInitialRequest;
	PlanningBeforeCodeEdit?: PlanningBeforeCodeEditRequest;
	NewSubSymbolForCodeEditing?: NewSubSymbolRequiredRequest;
	GrepSymbolInCodebase?: LSPGrepSymbolInCodebaseRequest;
}

interface CodeEdit {
	code_above?: string;
	code_below?: string;
	fs_file_path: string;
	code_to_edit: string;
	extra_context: string;
	language: string;
	model: LLMTypeVariant;
	instruction: string;
	api_key: LLMProviderAPIKeys;
	provider: LLMProvider;
	is_swe_bench_initial_edit: boolean;
	is_new_symbol_request?: string;
}

export type LSPDiagnostics = {
	fs_file_path: string;
	range: SidecarRequestRange;
	editor_url: string;
};

export type LSPFileDiagnostics = {
	fs_file_path: string;
	editor_url: string;
	with_enrichment: boolean;
	with_hover_check: SidecarRequestPosition | undefined | null;
	// hacky toggle, but okay for now
	full_workspace: boolean;
};

export interface FindCodeSnippets {
	fs_file_path: string;
	file_content: string;
	language: string;
	file_path: string;
	user_query: string;
	llm_type: LLMTypeVariant;
	api_key: LLMProviderAPIKeys;
	provider: LLMProvider;
}

interface ReRankCodeSnippet {
	fs_file_path: string;
	range: SidecarRequestRange;
	content: string;
	language: string;
}

interface ReRankDocument {
	document_name: string;
	document_path: string;
	content: string;
}

interface ReRankWebExtract {
	url: string;
	content: string;
}

interface ReRankEntry {
	CodeSnippet: ReRankCodeSnippet;
	Document: ReRankDocument;
	WebExtract: ReRankWebExtract;
}

interface ReRankEntries {
	id: number;
	entry: ReRankEntry;
}

interface ReRankRequestMetadata {
	model: LLMTypeVariant;
	query: string;
	provider_keys: Record<string, any>;
	provider: LLMProvider;
}

export interface ReRankEntriesForBroker {
	entries: ReRankEntries[];
	metadata: ReRankRequestMetadata;
}

export interface CodeSymbolUtilitySearch {
	user_query: string;
	definitions_already_present: string[];
	fs_file_path: string;
	fs_file_content: string;
	selection_range: SidecarRequestRange;
	language: string;
	llm_type: LLMTypeVariant;
	llm_provider: LLMProvider;
	api_key: LLMProviderAPIKeys;
	user_context: UserContext;
}

interface CodeSymbolImportantRequest {
	symbol_identifier?: string;
	history: string[];
	fs_file_path: string;
	fs_file_content: string;
	selection_range: SidecarRequestRange;
	language: string;
	llm_type: LLMTypeVariant;
	llm_provider: LLMProvider;
	api_key: LLMProviderAPIKeys;
	query: string;
}


export interface CodeSymbolImportantWideSearch {
	user_context: UserContext;
	user_query: string;
	llm_type: LLMTypeVariant;
	llm_provider: LLMProvider;
	api_key: LLMProviderAPIKeys;
	file_extension_filters: Set<string>;
}

export type SidecarCreateFilResponse = {
	success: boolean;
};

export type SidecarGetPreviousWordRangeRequest = {
	fs_file_path: string;
	current_position: SidecarRequestPosition;
};

export type SidecarGetPreviousWordRangeResponse = {
	fs_file_path: string;
	range: SidecarRequestRange | null;
};

export type SidecarCreateFileRequest = {
	fs_file_path: string;
};

export type SidecarOutlineNodesWithContentRequest = {
	content: string;
	file_extension: string;
};

export type SidecarGetOutlineNodesRequest = {
	fs_file_path: string;
};

export type SidecarGetOutlineNodesResponse = {
	file_content: string;
	language: string;
	outline_nodes: SymbolInformation[] | DocumentSymbol[] | null | undefined;
};

export type SidecarCreateNewExchangeRequest = {
	session_id: string;
};

export type SidecarGoToDefinitionRequest = {
	fs_file_path: string;
	position: SidecarRequestPosition;
};

export type SidecarListFilesEndpoint = {
	directory_path: string;
	recursive: boolean;
};

export type SidecarListFilesOutput = {
	files: string[];
	limit_reached: boolean;
};

export type SidecarExecuteTerminalCommandRequest = {
	command: string;
	wait_for_exit: boolean;
};

interface OpenFileRequest {
	fs_file_path: string;
	editor_url: string;
}

interface FindInFileRequest {
	file_contents: string;
	file_symbol: string;
}

export type SidecarGoToDefinitionResponse = {
	definitions: FileAndRange[];
};

export type FileAndRange = {
	fs_file_path: string;
	range: SidecarRequestRange;
};

export type SidecarOpenFileToolRequest = {
	fs_file_path: string;
};

export type SidecarOpenFileToolResponse = {
	fs_file_path: string;
	file_contents: string;
	language: string;
	exists: boolean;
};

export type SidecarGoToImplementationRequest = {
	fs_file_path: string;
	position: SidecarRequestPosition;
	editor_url: string;
};

export enum OutlineNodeType {
	ClassDefinition = 'ClassDefinition',
	Class = 'Class',
	ClassName = 'ClassName',
	Function = 'Function',
	FunctionName = 'FunctionName',
	FunctionBody = 'FunctionBody',
	FunctionClassName = 'FunctionClassName',
	FunctionParameterIdentifier = 'FunctionParameterIdentifier',
	Decorator = 'Decorator',
}

export type OutlineNodeContent = {
	range: SidecarRequestRange;
	name: string;
	'r#type': OutlineNodeType;
	content: string;
	fs_file_path: string;
	identifier_range: SidecarRequestRange;
	body_range: SidecarRequestRange;
};

export type Snippet = {
	range: SidecarRequestRange;
	symbol_name: string;
	fs_file_path: string;
	content: string;
	language?: string;
	// this represents completely a snippet of code which is a logical symbol
	outline_node_content: OutlineNodeContent;
};

export type ProbeQuestionForSymbolRequest = {
	symbol_name: string;
	next_symbol_name: string;
	next_symbol_file_path: string;
	history: string[];
	hyperlinks: string[];
	original_user_query: string;
	llm_properties: LLMProperties;
};

export type ProbeEnoughOrDeeperRequest = {
	symbol_name: string;
	xml_string: string;
	query: string;
	llm_properties: LLMProperties;
};

export type CodeToProbeSubSymbolRequest = {
	xml_symbol: string;
	query: string;
	llm: LLMTypeVariant;
	provider: LLMProvider;
	api_key: LLMProviderAPIKeys;
};

export type CodeToEditFilterRequest = {
	snippets: Snippet[];
	query: string;
	llm_type: LLMTypeVariant;
	llm_provider: LLMProvider;
	api_key: LLMProviderAPIKeys;
};

export type CodeSymbolToAskQuestionsRequest = {
	history: string;
	symbol_identifier: string;
	fs_file_path: string;
	language: string;
	extra_data: string;
	code_above?: string;
	code_below?: string;
	code_in_selection: string;
	llm_type: LLMTypeVariant;
	provider: LLMProvider;
	api_key: LLMProviderAPIKeys;
	query: string;
};

export type CodeSymbolFollowAlongForProbing = {
	history: string;
	symbol_identifier: string;
	fs_file_path: string;
	language: string;
	next_symbol_names: string[];
	next_symbol_outlines: string[];
	code_above?: string;
	code_below?: string;
	code_in_selection: string;
	llm_type: LLMTypeVariant;
	provider: LLMProvider;
	api_key: LLMProviderAPIKeys;
	query: string;
	next_symbol_link: string;
};

export type CodeSubSymbolProbingResult = {
	symbol_name: string;
	fs_file_path: string;
	probing_results: string[];
	content: string;
};

export type CodeSymbolProbingSummarize = {
	query: string;
	history: string;
	symbol_identifier: string;
	symbol_outline: string;
	fs_file_path: string;
	probing_results: CodeSubSymbolProbingResult[];
	llm: LLMTypeVariant;
	provider: LLMProvider;
	api_key: LLMProviderAPIKeys;
};

export type RepoMapSearchQuery = {
	repo_map: string;
	user_query: string;
	llm: LLMTypeVariant;
	provider: LLMProvider;
	api_key: LLMProviderAPIKeys;
};

export type SWEBenchTestRequest = {
	swe_bench_test_endpoint: string;
};

export type TestOutputCorrectionRequest = {
	fs_file_path: string;
	file_contents: string;
	user_instructions: string;
	code_above: string | undefined;
	code_below: string | undefined;
	code_in_selection: string;
	original_code: string;
	language: string;
	test_output_logs: string;
	llm: LLMTypeVariant;
	provider: LLMProvider;
	api_keys: LLMProviderAPIKeys;
	extra_code_context: string;
};

export type CodeSymbolFollowInitialRequest = {
	code_symbol_content: string[];
	user_query: string;
	llm: LLMTypeVariant;
	provider: LLMProvider;
	api_keys: LLMProviderAPIKeys;
};

export type PlanningBeforeCodeEditRequest = {
	user_query: string;
	files_with_content: Record<string, string>;
	original_plan: string;
	llm_properties: LLMProperties;
};

export type NewSubSymbolRequiredRequest = {
	user_query: string;
	plan: string;
	symbol_content: string;
	llm_properties: LLMProperties;
};

export type LSPGrepSymbolInCodebaseRequest = {
	editor_url: string;
	search_string: string;
};

export type CodeToEditSymbolRequest = {
	xml_symbol: string;
	query: string;
	llm: LLMTypeVariant;
	provider: LLMProvider;
	api_key: LLMProviderAPIKeys;
};

export type EditorApplyRequest = {
	fs_file_path: string;
	edited_content: string;
	selected_range: SidecarRequestRange;
	editor_url: string;
};

export type SidecarGoToImplementationResponse = {
	implementation_locations: FileAndRange[];
};

export type SidecarSymbolSearchRequest = {
	search_string: string;
};

export type SidecarGoToReferencesRequest = {
	fs_file_path: string;
	position: SidecarRequestPosition;
};

export type SidecarGoToRefernecesResponse = {
	reference_locations: FileAndRange[];
};

export type SidecarSymbolSearchInformation = {
	name: String;
	kind: String;
	fs_file_path: String;
	range: SidecarRequestRange;
};

export type SidecarSymbolSearchResponse = {
	locations: SidecarSymbolSearchInformation[];
};

export type SidecarQuickFixRequest = {
	fs_file_path: string;
	editor_url: string;
	range: SidecarRequestRange; // the exact range of the quick fix invocation
	request_id: string;
};

// Keeping it simple for now
export type SidecarQuickFixResponse = {
	options: {
		label: string;
		index: number;
	}[];
};

export type LSPQuickFixInvocationRequest = {
	request_id: string;
	index: number;
	fs_file_path: string;
	editor_url: string;
};

export type Diagnostic = {
	diagnostic: string;
	range: SidecarRequestRange;
};

export type QuickFixOption = {
	label: string;
	number: number;
};

export type CodeCorrectnessRequest = {
	fs_file_contents: string;
	fs_file_path: string;
	code_above?: string;
	code_below?: string;
	code_in_selection: string;
	symbol_name: string;
	instruction: string;
	previous_code: string;
	diagnostics: Diagnostic[];
	quick_fix_actions: QuickFixOption[];
	llm: LLMTypeVariant;
	provider: LLMProvider;
	api_keys: LLMProviderAPIKeys;
};

export type CodeEditingErrorRequest = {
	fs_file_path: string;
	code_above?: string;
	code_below?: string;
	code_in_selection: string;
	extra_context: string;
	original_code: string;
	error_instructions: string;
	previous_instructions: string;
	llm: LLMTypeVariant;
	provider: LLMProvider;
	api_keys: LLMProviderAPIKeys;
};

export type ClassSymbolFollowupRequest = {
	fs_file_path: string;
	original_code: string;
	language: string;
	edited_code: string;
	instructions: string;
	llm: LLMTypeVariant;
	provider: LLMProvider;
	api_keys: LLMProviderAPIKeys;
};

export type SidecarQuickFixInvocationResponse = {
	request_id: string;
	invocation_success: boolean;
};

export type SidecarInlayHintsRequest = {
	fs_file_path: string;
	range: SidecarRequestRange;
};

export type SidecarInlayHintsResponsePart = {
	position: SidecarRequestPosition;
	padding_left: boolean;
	padding_right: boolean;
	// the value of the inlay hint
	values: string[];
};

/**
 * Contains the response from grabbing the inlay hints in a given range
 */
export type SidecarInlayHintResponse = {
	parts: SidecarInlayHintsResponsePart[];
};

export type SidecarRecentEditsRetrieverDiff = {
	fs_file_path: string;
	diff: string;
	updated_timestamp_ms: number;
	current_content: string;
};

export type SidecarRecentEditsRetrieverResponse = {
	changed_files: SidecarRecentEditsRetrieverDiff[];
};

export type SidecarRecentEditsFilePreviousContent = {
	fs_file_path: string;
	file_content_latest: string;
	// if this gets sent over from the sidecar, we use this instead of using
	// the editor
	file_content_updated: string | null;
};

export type SidecarUndoPlanStep = {
	exchange_id: string;
	session_id: string;
	index: number | null;
};

export type SidecarRecentEditsRetrieverRequest = {
	fs_file_paths: string[] | null;
	diff_file_content: SidecarRecentEditsFilePreviousContent[];
};

export type SidecarApplyEditsRequest = {
	fs_file_path: string;
	edited_content: string;
	selected_range: SidecarRequestRange;
	apply_directly: boolean;
};

export interface SidecarRequestRange {
	startPosition: SidecarRequestPosition;
	endPosition: SidecarRequestPosition;
}

export interface SidecarRequestPosition {
	line: number;
	character: number;
	byteOffset: number;
}

export interface SidecarResponseRange {
	startPosition: SidecarResponsePosition;
	endPosition: SidecarResponsePosition;
}

export interface SidecarResponsePosition {
	line: number;
	character: number;
	byteOffset: number;
}

export type SidecarApplyEditsResponse = {
	fs_file_path: string;
	success: boolean;
	new_range: SidecarResponseRange;
};

export type SidecarDiagnosticsResponse = {
	message: string;
	range: SidecarResponseRange;
	quick_fix_labels?: string[];
	parameter_hints?: string[];
	fs_file_path: string;
};

export type SidecarParameterHints = {
	signature_labels: string[];
};

export interface SidecarOpenFileContextEvent {
	fs_file_path: string;
}

/**
 * The destiation after doing a lsp action
 */
export interface SidecarLSPDestination {
	position: SidecarRequestPosition;
	fs_file_path: string;
	line_content: string;
}

export interface SidecarLSPContextEvent {
	fs_file_path: string;
	position: SidecarRequestPosition;
	source_word: string | undefined;
	source_line: string;
	// destination where we land after invoking a lsp destination
	destination: SidecarLSPDestination | null;
	event_type: string;
}

export interface SidecarSelectionContextEvent {
	fs_file_path: string;
	range: SidecarRequestRange;
}

/**
 * All the context driven events which can happen in the editor which are useful
 * and done by the user in a quest to provide additional context to the agent
 */
export interface SidecarContextEvent {
	OpenFile?: SidecarOpenFileContextEvent;
	LSPContextEvent?: SidecarLSPContextEvent;
	Selection?: SidecarSelectionContextEvent;
}
