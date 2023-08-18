/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { v4 as uuidv4 } from 'uuid';
import { CodeSymbolInformation } from '../../utilities/types';
import { CodeGraph } from '../../codeGraph/graph';
import { number } from 'mathjs';
import {
	CodeModificationContextAndDiff,
	CodeSymbolModificationInstruction,
} from '../../llm/recipe/prompts';
import { EventType } from './type';
import { writeFile } from 'fs';
import { writeFileContents } from '../../llm/recipe/helpers';
import logger from '../../logger';
import { WebviewView } from 'vscode';
import { AgentViewProvider } from '../../views/AgentView';
import { CSChatProgressContent, CSChatProvider, CSChatRequest } from '../../chatprovider';

interface TestExecutionHarness {
	testScript: string;
	imports: string;
	planForTestScriptGeneration: string;
	thoughtsWithExplanation: string;
	codeSymbolName: string;
	testSetupRequired: string;
	testFileLocation: string;
}

function extractMarkdownWords(text: string): string[] {
	// ... implementation ...
	return [];
}

interface FileSaveEvent {
	filePath: string;
	codeSymbolName: string;
}

interface ToolingEvent {
	eventId: string;
	eventType: EventType;
	eventContext: string | null;
	eventInput: string;
	eventOutput: string | null;
	eventTimestamp: number;
	codeSymbolReference: CodeSymbolInformation[] | null;
	stdout: string | null;
	stderr: string | null;
	codeSymbolName: string | null;
	codeSymbolModificationInstruction: CodeSymbolModificationInstruction | null;
	codeModificationContextAndDiff: CodeModificationContextAndDiff | null;
	fileSaveEvent: FileSaveEvent | null;
	executionEventId: string | null;
	testExecutionHarness: TestExecutionHarness | null;
	exitCode: number | null;
	args: string[] | null;
	markdownReferences: Record<string, CodeSymbolInformation> | null;
	numberOfBranchElements: number | null;
	executionBranchFinishReason: string | null;
	codeModificationInstructionList: CodeSymbolModificationInstruction[] | null;
	// codeNodeReferencesForSymbol: GetReferencesForCodeNode | null;
	// planChangesForNode: PlanChangesForChildNode | null;
	// lookupCodeSnippetForSymbols: LookupCodeSnippetForSymbols | null;
	// changesToCurrentNodeOnDfs: ChangesToCurrentNode | null;
}

export const thinkingEvent = (
	userQuery: string,
	thinkingContext: string,
	references: CodeSymbolInformation[]
): ToolingEvent => {
	return {
		eventId: uuidv4(),
		eventType: 'initialThinking',
		eventContext: thinkingContext,
		eventInput: userQuery,
		eventOutput: null,
		eventTimestamp: Date.now(),
		codeSymbolReference: null,
		stdout: null,
		stderr: null,
		codeSymbolName: null,
		codeSymbolModificationInstruction: null,
		codeModificationContextAndDiff: null,
		fileSaveEvent: null,
		executionEventId: null,
		testExecutionHarness: null,
		exitCode: null,
		args: null,
		markdownReferences: null,
		numberOfBranchElements: null,
		executionBranchFinishReason: null,
		codeModificationInstructionList: null,
		// codeNodeReferencesForSymbol: null,
		// planChangesForNode: null,
		// lookupCodeSnippetForSymbols: null,
		// changesToCurrentNodeOnDfs: null,
	};
};

export const addPlanForHelp = (userQuery: string, planForHelp: string): ToolingEvent => {
	return {
		eventId: uuidv4(),
		eventType: 'planningOut',
		eventInput: userQuery,
		eventOutput: null,
		eventContext: planForHelp,
		eventTimestamp: Date.now(),
		codeSymbolReference: null,
		stdout: null,
		stderr: null,
		codeSymbolName: null,
		codeSymbolModificationInstruction: null,
		codeModificationContextAndDiff: null,
		fileSaveEvent: null,
		executionEventId: null,
		testExecutionHarness: null,
		exitCode: null,
		args: null,
		markdownReferences: null,
		numberOfBranchElements: null,
		executionBranchFinishReason: null,
		codeModificationInstructionList: null,
		// codeNodeReferencesForSymbol: null,
		// planChangesForNode: null,
		// lookupCodeSnippetForSymbols: null,
		// changesToCurrentNodeOnDfs: null,
	};
};

export const relevantSearchResults = (
	queries: string[],
	codeSymbolInformationList: CodeSymbolInformation[]
): ToolingEvent => {
	return {
		eventId: uuidv4(),
		eventType: 'searchResults',
		eventOutput: null,
		eventInput: queries.join('\n'),
		eventContext: null,
		eventTimestamp: Date.now(),
		codeSymbolReference: codeSymbolInformationList,
		stdout: null,
		stderr: null,
		codeSymbolName: null,
		codeSymbolModificationInstruction: null,
		codeModificationContextAndDiff: null,
		fileSaveEvent: null,
		executionEventId: null,
		testExecutionHarness: null,
		exitCode: null,
		args: null,
		markdownReferences: null,
		numberOfBranchElements: null,
		executionBranchFinishReason: null,
		codeModificationInstructionList: null,
		// codeNodeReferencesForSymbol: null,
		// planChangesForNode: null,
		// lookupCodeSnippetForSymbols: null,
		// changesToCurrentNodeOnDfs: null,
	};
};

export const searchForQuery = (userQuery: string): ToolingEvent => {
	return {
		eventId: uuidv4(),
		eventType: 'searchForCodeSnippets',
		eventOutput: null,
		eventInput: userQuery,
		eventContext: null,
		eventTimestamp: Date.now(),
		codeSymbolReference: null,
		stdout: null,
		stderr: null,
		codeSymbolName: null,
		codeSymbolModificationInstruction: null,
		codeModificationContextAndDiff: null,
		fileSaveEvent: null,
		executionEventId: null,
		testExecutionHarness: null,
		exitCode: null,
		args: null,
		markdownReferences: null,
		numberOfBranchElements: null,
		executionBranchFinishReason: null,
		codeModificationInstructionList: null,
		// codeNodeReferencesForSymbol: null,
		// planChangesForNode: null,
		// lookupCodeSnippetForSymbols: null,
		// changesToCurrentNodeOnDfs: null,
	};
};

export const branchElementsEvents = (
	numberOfBranchElements: number,
	codeModificationInstructionList: CodeSymbolModificationInstruction[]
): ToolingEvent => {
	return {
		eventId: uuidv4(),
		eventType: 'branchElements',
		eventOutput: null,
		eventInput: 'About to start branching',
		eventContext: null,
		eventTimestamp: Date.now(),
		numberOfBranchElements,
		codeSymbolReference: null,
		stdout: null,
		stderr: null,
		codeSymbolName: null,
		codeSymbolModificationInstruction: null,
		codeModificationContextAndDiff: null,
		fileSaveEvent: null,
		executionEventId: null,
		testExecutionHarness: null,
		exitCode: null,
		args: null,
		markdownReferences: null,
		executionBranchFinishReason: null,
		codeModificationInstructionList,
		// codeNodeReferencesForSymbol: null,
		// planChangesForNode: null,
		// lookupCodeSnippetForSymbols: null,
		// changesToCurrentNodeOnDfs: null,
	};
};

export const addInstructionsForModification = (
	executionEventId: number,
	codeSymbolModificationInstruction: CodeSymbolModificationInstruction
): ToolingEvent => {
	return {
		eventId: uuidv4(),
		eventType: 'codeSymbolModificationInstruction',
		eventOutput: null,
		eventInput: 'Modification Instructions',
		eventContext: null,
		eventTimestamp: Date.now(),
		numberOfBranchElements: null,
		codeSymbolReference: null,
		stdout: null,
		stderr: null,
		codeSymbolName: null,
		codeSymbolModificationInstruction,
		codeModificationContextAndDiff: null,
		fileSaveEvent: null,
		executionEventId: executionEventId.toString(),
		testExecutionHarness: null,
		exitCode: null,
		args: null,
		markdownReferences: null,
		executionBranchFinishReason: null,
		codeModificationInstructionList: null,
		// codeNodeReferencesForSymbol: null,
		// planChangesForNode: null,
		// lookupCodeSnippetForSymbols: null,
		// changesToCurrentNodeOnDfs: null,
	};
};

export const saveFileToolingEvent = (
	filePath: string,
	codeSymbolName: string,
	executionEventId: string
): ToolingEvent => {
	return {
		eventId: uuidv4(),
		eventType: 'saveFile',
		eventInput: 'File is going to be saved',
		eventOutput: null,
		eventContext: null,
		eventTimestamp: Date.now(),
		numberOfBranchElements: null,
		codeSymbolReference: null,
		stdout: null,
		stderr: null,
		codeSymbolName,
		codeSymbolModificationInstruction: null,
		codeModificationContextAndDiff: null,
		fileSaveEvent: {
			filePath,
			codeSymbolName,
		},
		executionEventId,
		testExecutionHarness: null,
		exitCode: null,
		args: null,
		markdownReferences: null,
		executionBranchFinishReason: null,
		codeModificationInstructionList: null,
	};
};

export const addModificationDiffAndThoughts = (
	executionEventId: string,
	codeSymbolName: string,
	codeModificationContextAndDiff: CodeModificationContextAndDiff
): ToolingEvent => {
	return {
		eventId: uuidv4(),
		eventType: 'codeSymbolModificationEvent',
		eventInput: 'Code symbol is going to be modified',
		eventOutput: null,
		eventContext: null,
		eventTimestamp: Date.now(),
		numberOfBranchElements: null,
		codeSymbolReference: null,
		stdout: null,
		stderr: null,
		codeSymbolName,
		codeSymbolModificationInstruction: null,
		codeModificationContextAndDiff,
		fileSaveEvent: null,
		executionEventId,
		testExecutionHarness: null,
		exitCode: null,
		args: null,
		markdownReferences: null,
		executionBranchFinishReason: null,
		codeModificationInstructionList: null,
		// codeNodeReferencesForSymbol: null,
		// planChangesForNode: null,
		// lookupCodeSnippetForSymbols: null,
		// changesToCurrentNodeOnDfs: null,
	};
};

export const saveFileEvent = (filePath: string, codeSymbolName: string): ToolingEvent => {
	return {
		eventId: uuidv4(),
		eventType: 'saveFile',
		eventInput: 'File is going to be saved',
		eventOutput: null,
		eventContext: null,
		eventTimestamp: Date.now(),
		numberOfBranchElements: null,
		codeSymbolReference: null,
		stdout: null,
		stderr: null,
		codeSymbolName,
		codeSymbolModificationInstruction: null,
		codeModificationContextAndDiff: null,
		fileSaveEvent: {
			filePath,
			codeSymbolName,
		},
		executionEventId: null,
		testExecutionHarness: null,
		exitCode: null,
		args: null,
		markdownReferences: null,
		executionBranchFinishReason: null,
		codeModificationInstructionList: null,
		// codeNodeReferencesForSymbol: null,
		// planChangesForNode: null,
		// lookupCodeSnippetForSymbols: null,
		// changesToCurrentNodeOnDfs: null,
	};
};

export const testExecutionEvent = (
	codeSymbolName: string,
	fileLocation: string,
	testPlan: TestExecutionHarness,
	executionEventId: string
): ToolingEvent => {
	return {
		eventId: uuidv4(),
		eventType: 'testExecutionHarness',
		eventInput: 'Test execution is going to be run',
		eventOutput: null,
		eventContext: null,
		eventTimestamp: Date.now(),
		numberOfBranchElements: null,
		codeSymbolReference: null,
		stdout: null,
		stderr: null,
		codeSymbolName,
		codeSymbolModificationInstruction: null,
		codeModificationContextAndDiff: null,
		fileSaveEvent: {
			filePath: fileLocation,
			codeSymbolName,
		},
		executionEventId,
		testExecutionHarness: testPlan,
		exitCode: null,
		args: null,
		markdownReferences: null,
		executionBranchFinishReason: null,
		codeModificationInstructionList: null,
		// codeNodeReferencesForSymbol: null,
		// planChangesForNode: null,
		// lookupCodeSnippetForSymbols: null,
		// changesToCurrentNodeOnDfs: null,
	};
};

export const terminalEvent = (
	codeSymbolName: string,
	fileLocation: string,
	stdout: string,
	stderr: string,
	exitCode: number,
	args: string[],
	executionEventId: string
): ToolingEvent => {
	return {
		eventId: uuidv4(),
		eventType: 'terminalExecution',
		eventInput: 'Terminal event is going to be run',
		eventOutput: null,
		eventContext: null,
		eventTimestamp: Date.now(),
		numberOfBranchElements: null,
		codeSymbolReference: null,
		stdout,
		stderr,
		codeSymbolName,
		codeSymbolModificationInstruction: null,
		codeModificationContextAndDiff: null,
		fileSaveEvent: {
			filePath: fileLocation,
			codeSymbolName,
		},
		executionEventId,
		testExecutionHarness: null,
		exitCode,
		args,
		markdownReferences: null,
		executionBranchFinishReason: null,
		codeModificationInstructionList: null,
	};
};

export const executionBranchFinishEvent = (
	executionEventId: string,
	codeSymbolName: string,
	executionBranchFinishReason: string
): ToolingEvent => {
	return {
		eventId: uuidv4(),
		eventType: 'executionBranchFinishReason',
		eventInput: 'Terminal event is going to be run',
		eventOutput: null,
		eventContext: null,
		eventTimestamp: Date.now(),
		numberOfBranchElements: null,
		codeSymbolReference: null,
		stdout: null,
		stderr: null,
		codeSymbolName,
		fileSaveEvent: null,
		codeSymbolModificationInstruction: null,
		codeModificationContextAndDiff: null,
		executionEventId,
		testExecutionHarness: null,
		exitCode: null,
		args: null,
		markdownReferences: null,
		executionBranchFinishReason,
		codeModificationInstructionList: null,
	};
};

export const taskComplete = (): ToolingEvent => {
	return {
		eventId: uuidv4(),
		eventType: 'taskComplete',
		eventInput: 'We finished the task',
		eventOutput: null,
		eventContext: null,
		eventTimestamp: Date.now(),
		numberOfBranchElements: null,
		codeSymbolReference: null,
		stdout: null,
		stderr: null,
		codeSymbolName: null,
		fileSaveEvent: null,
		codeSymbolModificationInstruction: null,
		codeModificationContextAndDiff: null,
		executionEventId: null,
		testExecutionHarness: null,
		exitCode: null,
		args: null,
		markdownReferences: null,
		executionBranchFinishReason: null,
		codeModificationInstructionList: null,
	};
};

export class ToolingEventCollection {
	events: ToolingEvent[];
	saveDestination: string;
	codeGraph: CodeGraph;
	provider?: AgentViewProvider;
	csChatRequest?: CSChatRequest;
	panelCommand: string;

	constructor(
		saveDestination: string,
		codeGraph: CodeGraph,
		provider: AgentViewProvider | undefined,
		csChatRequest: CSChatProvider | undefined,
		panelCommand: string
	) {
		this.events = [];
		this.codeGraph = codeGraph;
		this.saveDestination = saveDestination;
		this.provider = provider;
		this.csChatRequest = this.csChatRequest;
		this.panelCommand = panelCommand;
	}

	private async sendEventsToChatViewPanel() {
		const value = await this.provider?.getView()?.webview.postMessage({
			payload: {
				events: this.events,
				saveDestination: this.saveDestination,
			},
			command: this.panelCommand,
		});
		logger.info(`Sent events to chat view panel: ${value}`);
	}

	private async sendEventsToChatProvider() {
		const payload = JSON.stringify({
			events: this.events,
			saveDestination: this.saveDestination,
		});
		logger.info(`Sending events to chat provider: ${payload}`);
		this.csChatRequest?.addResponse(
			new CSChatProgressContent(payload)
		);
	}

	public async addThinkingEvent(userQuery: string, thinkingContext: string) {
		this.events.push(thinkingEvent(userQuery, thinkingContext, []));
		await this.save();
	}

	public async addPlanForHelp(userQuery: string, planForHelp: string) {
		this.events.push(addPlanForHelp(userQuery, planForHelp));
		await this.save();
	}

	public async addSearchEvent(queries: string[]) {
		this.events.push(searchForQuery(queries.join('\n')));
		await this.save();
	}

	public async addRelevantSearchResults(
		queries: string[],
		codeSymbolInformationList: CodeSymbolInformation[]
	) {
		this.events.push(relevantSearchResults(queries, codeSymbolInformationList));
		await this.save();
	}

	public async branchingStartEvent(
		numberOfBranchElements: number,
		codeModificationInstructionList: CodeSymbolModificationInstruction[]
	) {
		this.events.push(branchElementsEvents(numberOfBranchElements, codeModificationInstructionList));
		await this.save();
	}

	public async addInstructionsForModification(
		executionEventId: number,
		codeSymbolModificationInstruction: CodeSymbolModificationInstruction
	) {
		this.events.push(
			addInstructionsForModification(executionEventId, codeSymbolModificationInstruction)
		);
		await this.save();
	}

	public async addModificationDiffAndThoughts(
		codeModificationContextAndDiff: CodeModificationContextAndDiff,
		codeSymbolName: string,
		executionEventId: string
	) {
		this.events.push(
			addModificationDiffAndThoughts(
				executionEventId,
				codeSymbolName,
				codeModificationContextAndDiff
			)
		);
		await this.save();
	}

	public async saveFileEvent(filePath: string, codeSymbolName: string, executionEventId: string) {
		this.events.push(saveFileToolingEvent(filePath, codeSymbolName, executionEventId));
		await this.save();
	}

	public async testExecutionEvent(
		codeSymbolName: string,
		fileLocation: string,
		testPlan: TestExecutionHarness,
		executionEventId: string
	) {
		this.events.push(testExecutionEvent(codeSymbolName, fileLocation, testPlan, executionEventId));
		await this.save();
	}

	public async terminalEvent(
		codeSymbolName: string,
		fileLocation: string,
		stdout: string,
		stderr: string,
		exitCode: number,
		args: string[],
		executionEventId: string
	) {
		this.events.push(
			terminalEvent(codeSymbolName, fileLocation, stdout, stderr, exitCode, args, executionEventId)
		);
		await this.save();
	}

	public async executionBranchFinished(
		executionEventId: string,
		codeSymbolName: string,
		executionBranchFinishReason: string
	) {
		this.events.push(
			executionBranchFinishEvent(executionEventId, codeSymbolName, executionBranchFinishReason)
		);
		await this.save();
	}

	public async taskComplete() {
		this.events.push(taskComplete());
		await this.save();
	}

	public async save() {
		// We always want to send it to the view
		this.sendEventsToChatViewPanel();
		this.sendEventsToChatProvider();
		await writeFileContents(
			this.saveDestination,
			JSON.stringify({
				events: this.events,
				saveDestination: this.saveDestination,
			})
		);
	}
}
