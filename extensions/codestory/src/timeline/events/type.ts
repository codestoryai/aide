/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { CodeSymbolInformation } from '../../utilities/types';

export type EventType =
	| 'initialThinking'
	| 'planningOut'
	| 'searchForCodeSnippets'
	| 'searchResults'
	| 'branchElements'
	| 'codeSymbolModificationInstruction'
	| 'codeSymbolModificationEvent'
	| 'saveFile'
	| 'testExecutionHarness'
	| 'terminalExecution'
	| 'executionBranchFinishReason'
	| 'taskComplete';

export interface AntonData {
	events: AntonEvent[];
	saveDestination: string;
}

export interface AntonEvent {
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
}

/*
interface MarkdownReference {
	parseFileToOutput?: ParseFileToOutput;
}

interface ParseFileToOutput {
	id: string;
	name: string;
	codeLocation: CodeLocation;
	edges: string[];
	storageLocation: string;
	classInformation?: any;
	functionInformation: FunctionInformation;
}
*/

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

interface CodeModificationContextAndDiff {
	codeModification: string;
	codeDiff: string;
}

interface CodeSymbolModificationInstruction {
	codeSymbolName: string;
	instructions: string;
}

/*
interface CodeSymbolReference {
	id: string;
	name: string;
	codeLocation: CodeLocation;
	edges: string[];
	storageLocation: string;
	classInformation?: any;
	functionInformation: FunctionInformation;
}

interface FunctionInformation {
	name: string;
	codeLocation: CodeLocation;
	docstring?: any;
	decorators: string[];
	scopeType: string;
	className?: string;
	isAsync: boolean;
	rawCode: string;
	comments: string[];
	functionDependencies: FunctionDependency[];
}

interface FunctionDependency {
	functionCallInformation: FunctionCallInformation;
	jediType: JediType;
}

interface JediType {
	fullyQualifiedType?: string;
	attributeType: string;
	modulePath: string;
	isExternalLibraryImport: boolean;
}

interface FunctionCallInformation {
	value: string;
	line: number;
	startColumn: number;
	endColumn: number;
}

interface CodeLocation {
	path: string;
	lineStart: LineStart;
	lineEnd: LineStart;
	directory: string;
	fileName: string;
}

interface LineStart {
	line: number;
	column: number;
}
*/
