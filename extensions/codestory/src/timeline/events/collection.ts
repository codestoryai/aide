/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import { v4 as uuidv4 } from 'uuid';

import { CodeSnippetInformation, CodeSymbolInformation } from '../../utilities/types';
import {
	CodeModificationContextAndDiff,
	CodeSymbolModificationInstruction,
} from '../../llm/recipe/prompts';
import { EventType } from './type';
import { writeFileContents } from '../../llm/recipe/helpers';

interface TestExecutionHarness {
	testScript: string;
	imports: string;
	planForTestScriptGeneration: string;
	thoughtsWithExplanation: string;
	codeSymbolName: string;
	testSetupRequired: string;
	testFileLocation: string;
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
	codeSnippetInformationList: CodeSnippetInformation[] | null;
}

export const thinkingEvent = (
	userQuery: string,
	thinkingContext: string,
	_references: CodeSymbolInformation[]
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
		codeSnippetInformationList: null,
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
		codeSnippetInformationList: null,
	};
};

export const relevantSearchResults = (
	queries: string[],
	codeSnippetInformationList: CodeSnippetInformation[],
): ToolingEvent => {
	return {
		eventId: uuidv4(),
		eventType: 'searchResults',
		eventOutput: null,
		eventInput: queries.join('\n'),
		eventContext: null,
		eventTimestamp: Date.now(),
		codeSymbolReference: [],
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
		codeSnippetInformationList,
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
		codeSnippetInformationList: null,
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
		codeSnippetInformationList: null,
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
		codeSnippetInformationList: null,
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
		codeSnippetInformationList: null,
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
		codeSnippetInformationList: null,
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
		codeSnippetInformationList: null,
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
		codeSnippetInformationList: null,
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
		codeSnippetInformationList: null,
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
		codeSnippetInformationList: null,
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
		codeSnippetInformationList: null,
	};
};

type ChatProgress = {
	response: vscode.AideAgentResponseStream;
	cancellationToken: vscode.CancellationToken;
};

export class ToolingEventCollection {
	events: ToolingEvent[];
	saveDestination: string;
	chatProgress?: ChatProgress;
	panelCommand: string;

	constructor(
		saveDestination: string,
		chatProgress: ChatProgress | undefined,
		panelCommand: string
	) {
		this.events = [];
		this.saveDestination = saveDestination;
		this.chatProgress = chatProgress;
		this.panelCommand = panelCommand;
	}

	public async addThinkingEvent(userQuery: string, thinkingContext: string) {
		const event = thinkingEvent(userQuery, thinkingContext, []);
		this.events.push(event);
		this.chatProgress?.response.markdown(`${event.eventContext ?? ''}\n\n---\n`);
		await this.save();
	}

	public async addPlanForHelp(userQuery: string, planForHelp: string) {
		const event = addPlanForHelp(userQuery, planForHelp);
		this.events.push(event);
		await this.save();
	}

	public async addSearchEvent(queries: string[]) {
		const event = searchForQuery(queries.join('\n'));
		this.events.push(event);
		this.chatProgress?.response.markdown(`## Searching the codebase\n\n\`\`\`\n${event.eventInput ?? ''}\`\`\``);
		await this.save();
	}

	public async addRelevantSearchResults(
		queries: string[],
		codeSymbolInformationList: CodeSnippetInformation[],
		_workingDirectory: string
	) {
		const event = relevantSearchResults(queries, codeSymbolInformationList);
		this.events.push(event);
		for (const codeSnippet of event.codeSnippetInformationList?.slice(0, 5) ?? []) {
			this.chatProgress?.response.markdown(`${codeSnippet.filePath}\n`);
		}
		this.chatProgress?.response.markdown(`\n---\n`);
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
		const event = addInstructionsForModification(executionEventId, codeSymbolModificationInstruction);
		this.events.push(event);
		await this.save();
	}

	public async addModificationDiffAndThoughts(
		codeModificationContextAndDiff: CodeModificationContextAndDiff,
		codeSymbolName: string,
		executionEventId: string,
	) {
		const event = addModificationDiffAndThoughts(
			executionEventId,
			codeSymbolName,
			codeModificationContextAndDiff
		);
		this.events.push(event);
		const codeModificationEvent = event.codeModificationContextAndDiff;
		const codeModification = codeModificationEvent?.codeModification ?? '';
		const codeModificationPlan = codeModification.split('Detailed plan of modifications:')[1];
		this.chatProgress?.response.markdown(`## Modification #${Number(executionEventId) + 1}\n${codeModificationPlan}\n`);
		await this.save();
	}

	public async saveFileEvent(filePath: string, codeSymbolName: string, executionEventId: string) {
		const event = saveFileToolingEvent(filePath, codeSymbolName, executionEventId);
		this.events.push(event);
		await this.save();
	}

	public async testExecutionEvent(
		codeSymbolName: string,
		fileLocation: string,
		testPlan: TestExecutionHarness,
		executionEventId: string
	) {
		const event = testExecutionEvent(codeSymbolName, fileLocation, testPlan, executionEventId);
		this.events.push(event);
		this.chatProgress?.response.markdown(`${event.testExecutionHarness?.planForTestScriptGeneration ?? ''}
\`\`\`\n\n${event.testExecutionHarness?.testScript ?? ''}\n\`\`\`
\n---\n
					`);
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
		const event = terminalEvent(codeSymbolName, fileLocation, stdout, stderr, exitCode, args, executionEventId);
		this.events.push(event);
		this.chatProgress?.response.markdown(`## Running commands\n\`\`\`sh\n\n> ${event.args?.join(' ')}\n\n${event.stdout}\n\`\`\``);
		await this.save();
	}

	public async executionBranchFinished(
		executionEventId: string,
		codeSymbolName: string,
		executionBranchFinishReason: string
	) {
		const event = executionBranchFinishEvent(executionEventId, codeSymbolName, executionBranchFinishReason);
		this.events.push(event);
		this.chatProgress?.response.markdown(event.executionBranchFinishReason ?? '');
		this.chatProgress?.response.markdown(`\n---\n`);
		await this.save();
	}

	public async taskComplete() {
		this.events.push(taskComplete());
		this.chatProgress?.response.markdown(`## Task complete!`);
		await this.save();
	}

	public async save() {
		await writeFileContents(
			this.saveDestination,
			JSON.stringify({
				events: this.events,
				saveDestination: this.saveDestination,
			}),
			true
		);
	}
}
