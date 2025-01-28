/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * We are going to report the stream of responses we get back from sidecar to
 * the schema which is required for the editor session provider to work
 */

import * as vscode from 'vscode';
import { DiagnosticCode, DiagnosticInformationFromEditor, DiagnosticSeverity, InLineAgentAction, InLineAgentContextSelection, InLineAgentLLMType, InLineAgentMessage } from '../../sidecar/types';
import { RepoRef, SideCarClient } from '../../sidecar/client';
import { IndentStyle, IndentStyleSpaces, IndentationHelper } from './editorSessionProvider';

export interface EditMessage {
	message: string | null;
}

export const reportFromStreamToEditorSessionProgress = async (
	stream: AsyncIterator<InLineAgentMessage>,
	progress: vscode.AideAgentResponseStream,
	cancellationToken: vscode.CancellationToken,
	_currentRepoRef: RepoRef,
	_workingDirectory: string,
	_sidecarClient: SideCarClient,
	_language: string,
	textDocument: vscode.TextDocument,
): Promise<EditMessage> => {
	if (cancellationToken.isCancellationRequested) {
		return {
			message: null,
		};
	}

	const asyncIterable = {
		[Symbol.asyncIterator]: () => stream
	};

	let enteredGenerationLoop = false;
	const skillUsed: InLineAgentAction | undefined = undefined;
	// let generatedAnswer: InLineAgentAnswer | null = null;
	const answerSplitOnNewLineAccumulator = new AnswerSplitOnNewLineAccumulator();
	let finalAnswer = '';
	let contextSelection = null;
	let streamProcessor = null;
	let modelReplying: InLineAgentLLMType | undefined = undefined;

	for await (const inlineAgentMessage of asyncIterable) {
		// Here we are going to go in a state machine like flow, where we are going
		// to stream back to the user whatever steps we get, and when we start
		// streaming the reply back, that's when we start sending TextEdit updates
		// to the editor
		// always send the keep alive message here
		if (inlineAgentMessage.keep_alive !== null && inlineAgentMessage.keep_alive !== undefined) {
			// for keep alive we just want to show the response
			// progress.report(CSInteractiveEditorProgressItem.normalMessage(inlineAgentMessage.keep_alive));
			continue;
		}
		modelReplying = inlineAgentMessage.answer?.model;
		const messageState = inlineAgentMessage.message_state;
		/*
		if (messageState === 'Pending') {
			// have a look at the steps here
			const stepsTaken = inlineAgentMessage.steps_taken;
			// take the last step and show that to the user, cause that's why
			// we got an update
			if (stepsTaken.length > 0) {
				const lastStep = stepsTaken[stepsTaken.length - 1];
				if (typeof lastStep === 'string') {
					// We are probably in an action, this is because of bad typing
					// on the server side, fix it later
					if (lastStep === 'Doc') {
						skillUsed = 'Doc';
						progress.report(CSInteractiveEditorProgressItem.documentationGeneration());
						continue;
					}
					if (lastStep === 'Edit' || lastStep === 'Code') {
						skillUsed = 'Edit';
						progress.report(CSInteractiveEditorProgressItem.editGeneration());
						continue;
					}
					if (lastStep === 'Fix') {
						skillUsed = 'Fix';
						progress.report(CSInteractiveEditorProgressItem.fixGeneration());
						continue;
					}
				}
				// @ts-ignore
				if ('DecideAction' in lastStep) {
					progress.report(CSInteractiveEditorProgressItem.normalMessage('Geneating code...'));
					continue;
				}
			}
		}
		*/


		if (messageState === 'StreamingAnswer') {
			// If this is the first time we are entering the generation loop,
			// we have to add the prefix for the generation
			if (!enteredGenerationLoop) {
				// We also check the model which is replying over here, if the model
				// is one of mistral or mixtral then we don't have the
				// ```{language}
				// // FILEPATH: {file_path}
				// // BEGIN: {hash}
				// prefix with us, so we have to manually add it back

				// TODO(skcd)[high_pri]: This will now break for other models which can't send
				// these leading and ending lines, so we should figure out how to
				// add these back afterwards
				if (shouldAddLeadingStrings(modelReplying)) {
					answerSplitOnNewLineAccumulator.addDelta('```\n');
					answerSplitOnNewLineAccumulator.addDelta('// FILEPATH: something\n');
					answerSplitOnNewLineAccumulator.addDelta('// BEGIN: hashsomething\n');
				}
			}
			enteredGenerationLoop = true;
			// We are now going to stream the answer, this is where we have to carefully
			// decide how we want to show the text edits on the UI
			if (skillUsed === 'Doc') {
				// for doc generation we just track the answer until we get the final
				// one and then apply it to the editor
				// generatedAnswer = inlineAgentMessage.answer;
				// console.log(generatedAnswer);
			}
			if (skillUsed === 'Edit' || skillUsed === 'Doc') {
				// we first add the delta
				answerSplitOnNewLineAccumulator.addDelta(inlineAgentMessage.answer?.delta);
				// lets check if we have the context ranges
				contextSelection = inlineAgentMessage.answer?.context_selection;
				if (streamProcessor === null) {
					streamProcessor = new StreamProcessor(
						progress,
						textDocument,
						textDocument.getText().split(/\r\n|\r|\n/g),
						// @ts-ignore
						contextSelection, // We always get this, I can type this up later
						undefined,
					);
				}
				// check if we can get any lines back here
				while (true) {
					const currentLine = answerSplitOnNewLineAccumulator.getLine();
					if (currentLine === null) {
						break;
					}
					// Let's process the line
					streamProcessor.processLine(currentLine);
					finalAnswer = finalAnswer + currentLine.line + '\n';
				}
				// Here we have to parse the answer properly and figure out how to send
				// the edits for the lines
			}
			if (skillUsed === 'Fix') {
				// console.log(inlineAgentMessage.answer);
				answerSplitOnNewLineAccumulator.addDelta(inlineAgentMessage.answer?.delta);
				contextSelection = inlineAgentMessage.answer?.context_selection;
				if (streamProcessor === null) {
					streamProcessor = new StreamProcessor(
						progress,
						textDocument,
						textDocument.getText().split(/\r\n|\r|\n/g),
						// @ts-ignore
						contextSelection, // We always get this, I can type this up later
						undefined,
					);
				}

				while (true) {
					const currentLine = answerSplitOnNewLineAccumulator.getLine();
					if (currentLine === null) {
						break;
					}
					// Let's process the line
					streamProcessor.processLine(currentLine);
					finalAnswer = finalAnswer + currentLine.line + '\n';
				}
			}
		}
		// Here we have to parse the data properly and get the answer back, implement
		// the logic for generating the reply properly here
	}

	if (skillUsed === 'Fix') {
		if (streamProcessor && !streamProcessor.sentEdits) {
			// Here we will clean up the // BEGIN and // END markers
			// and then send the edits
			const lines = finalAnswer.split(/\r\n|\r|\n/g);
			const newLines = lines.filter((line) => {
				return !line.startsWith('// BEGIN') && !line.startsWith('// END');
			}).join('\n');
			return {
				message: newLines,
			};
		}
	}

	return {
		message: null,
	};
};


export const extractCodeFromDocumentation = (input: string): string | null => {
	const codePattern = /\/\/ FILEPATH:.*?\n([\s\S]+?)```/;

	const match = input.match(codePattern);

	return match ? match[1].trim() : null;
};

export enum AnswerStreamContext {
	BeforeCodeBlock,
	InCodeBlock,
	AfterCodeBlock,
}

export interface AnswerStreamLine {
	line: string;
	context: AnswerStreamContext;
}

export class AnswerSplitOnNewLineAccumulator {
	accumulator: string;
	runningAnswer: string;
	lines: AnswerStreamLine[];
	codeBlockStringFound: boolean;
	runningState: AnswerStreamContext;

	constructor() {
		this.accumulator = '';
		this.runningAnswer = '';
		this.lines = [];
		this.codeBlockStringFound = false;
		this.runningState = AnswerStreamContext.BeforeCodeBlock;
	}

	addDelta(delta: string | null | undefined) {
		if (delta === null || delta === undefined) {
			return;
		}
		// When we are adding delta, we need to check if after adding the delta
		// we get a new line, and if we do we split it on the new line and add it
		// to our queue of events to push
		this.accumulator = this.accumulator + delta;
		while (true) {
			const newLineIndex = this.accumulator.indexOf('\n');
			// If we found no new line, lets just break here
			if (newLineIndex === -1) {
				break;
			}
			const completeLine = this.accumulator.substring(0, newLineIndex);
			if (/^```/.test(completeLine)) {
				if (!this.codeBlockStringFound) {
					this.codeBlockStringFound = true;
					this.runningState = AnswerStreamContext.InCodeBlock;
				} else {
					this.runningState = AnswerStreamContext.AfterCodeBlock;
				}
			}
			this.lines.push({
				line: completeLine,
				context: this.runningState,
			});
			// we set the accumulator to the remaining line
			this.accumulator = this.accumulator.substring(newLineIndex + 1);
		}
	}

	getLine(): AnswerStreamLine | null {
		if (this.lines.length === 0) {
			return null;
		}
		// or give back the first element of the string
		const line = this.lines[0];
		// remove the first element from the array
		this.lines = this.lines.slice(1);
		return line;
	}

	getLineLength(): number {
		return this.lines.length;
	}
}

export enum StateEnum {
	Initial,
	InitialAfterFilePath,
	InProgress,
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
	documentLineLimit: number;
	constructor(
		progress: vscode.AideAgentResponseStream,
		document: vscode.TextDocument,
		lines: string[],
		contextSelection: InLineAgentContextSelection,
		indentStyle: IndentStyleSpaces | undefined,
	) {
		// Initialize document with the given parameters
		const lastIndex = contextSelection.below.last_line_index !== -1 ? contextSelection.below.last_line_index : contextSelection.range.last_line_index;
		this.document = new DocumentManager(progress, document, lines, contextSelection, indentStyle, lastIndex);
		this.documentLineLimit = Math.min(contextSelection.range.last_line_index, this.document.getLineCount() - 1);

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
	}

	// TODO(skcd): We want to fix here how the lines are being processed and it should
	// only happen in the range we are interested in, if we hit the end then we should not delete
	// lines ever... so how do we do this?
	async processLine(answerStreamLine: AnswerStreamLine) {
		if (answerStreamLine.context !== AnswerStreamContext.InCodeBlock) {
			return;
		}
		const line = answerStreamLine.line;
		if (line.startsWith(this.filePathMarker) && this.currentState === StateEnum.Initial) {
			this.currentState = StateEnum.InitialAfterFilePath;
			return;
		}
		if (
			line.startsWith(this.beginMarker) ||
			line.startsWith(this.endMarker) ||
			line.endsWith(this.endMarker) ||
			line.endsWith(this.beginMarker) ||
			(line.indexOf('// END:') !== -1) ||
			(line.indexOf('// BEGIN:') !== -1)
		) {
			this.endDetected = true;
			if (line.indexOf('// END:') !== -1) {
				// send a \n here at the end of the inserted line, since append will send it along
				// with a \n so this should work?
				if (this.documentLineIndex < this.documentLineLimit) {
					// we have to replace the content between the index documentLineLimit and this.documentLineLimit
					// this way we can remove dangling code which is left over because we have already made the changes
					// and the length was shorter than the original implementation
					this.document.replaceLines(this.documentLineIndex, this.documentLineLimit, new AdjustedLineContent('', 0, '', 0));
				} else if (this.documentLineIndex === this.documentLineLimit) {
					this.document.appendLine(new AdjustedLineContent('', 0, '', 0));
				}
			}
			return;
		}
		if (this.endDetected && (this.currentState === StateEnum.InitialAfterFilePath || this.currentState === StateEnum.InProgress)) {
			if (this.previousLine) {
				const adjustedLine = this.previousLine.reindent(line, this.document.indentStyle);
				// anchor is null always
				const anchor = this.findAnchor(adjustedLine, this.documentLineIndex);
				if (anchor !== null) {
					this.sentEdits = true;
					this.documentLineIndex = this.document.replaceLines(this.documentLineIndex, anchor, adjustedLine);
				} else if (this.documentLineIndex >= this.documentLineLimit) {
					if (this.sentEdits) {
						// this is wrong, we should be using append here
						this.documentLineIndex = this.document.insertLineAfter(this.documentLineIndex - 1, adjustedLine);
						// this.documentLineIndex = this.document.appendLine(adjustedLine);
					} else {
						this.documentLineIndex = this.document.replaceLine(this.documentLineIndex, adjustedLine);
					}
					this.sentEdits = true;
				} else {
					// const currentLine = this.document.getLine(this.documentLineIndex);
					// this.sentEdits = true;
					// if (!currentLine.isSent || adjustedLine.adjustedContent === '' || (currentLine.content !== '')) {
					// 	this.documentLineIndex = this.document.insertLineAfter(this.documentLineIndex - 1, adjustedLine);
					// } else {
					// 	this.documentLineIndex = this.document.replaceLine(this.documentLineIndex, adjustedLine);
					// }
					this.documentLineIndex = this.document.replaceLine(this.documentLineIndex, adjustedLine);
				}
			} else {
				const initialAnchor = this.findInitialAnchor(line);
				this.previousLine = new LineIndentManager(this.document.getLine(initialAnchor).indentLevel, line);
				const adjustedInitialLine = this.previousLine.reindent(line, this.document.indentStyle);
				this.documentLineIndex = this.document.replaceLine(initialAnchor, adjustedInitialLine);
			}
			this.beginDetected = true;
		}
		return this.beginDetected;
	}

	// Find the initial anchor line in the document
	findInitialAnchor(lineContent: string): number {
		const trimmedContent = lineContent.trim();
		for (let index = this.document.firstSentLineIndex; index < this.documentLineLimit; index++) {
			const line = this.document.getLine(index);
			if (line.isSent && line.trimmedContent === trimmedContent) {
				return index;
			}
		}
		return this.document.firstRangeLine;
	}

	// Find the anchor line in the document based on indentation and content
	findAnchor(adjustedLine: AdjustedLineContent, startIndex: number): number | null {
		const endIndex = startIndex + 1;
		if (endIndex > 10000) {
			adjustedLine.adjustedContent = '';
		}
		// for (let index = startIndex; index < this.documentLineLimit; index++) {
		// 	const line = this.document.getLine(index);
		// 	if (line.isSent) {
		// 		if (line.trimmedContent.length > 0 && line.indentLevel < adjustedLine.adjustedIndentLevel) {
		// 			return null;
		// 		}
		// 		if (line.content === adjustedLine.adjustedContent) {
		// 			return index;
		// 		}
		// 	}
		// }
		return null;
	}
}


class DocumentManager {
	indentStyle: IndentStyleSpaces;
	progress: vscode.AideAgentResponseStream;
	lines: LineContent[];
	firstSentLineIndex: number;
	firstRangeLine: number;

	constructor(
		progress: vscode.AideAgentResponseStream,
		private document: vscode.TextDocument,
		lines: string[],
		contextSelection: InLineAgentContextSelection,
		indentStyle: IndentStyleSpaces | undefined,
		lineLimit: number,
	) {
		this.progress = progress; // Progress tracking
		this.lines = []; // Stores all the lines in the document
		this.indentStyle = IndentationHelper.getDocumentIndentStyle(lines, indentStyle);
		// this.indentStyle = IndentationHelper.getDocumentIndentStyleUsingSelection(contextSelection); // Determines the indentation style

		// Split the editor's text into lines and initialize each line
		const editorLines = document.getText().split(/\r\n|\r|\n/g);
		const newDocumentLineLimit = Math.min(editorLines.length - 1, lineLimit);
		for (let i = 0; i <= newDocumentLineLimit; i++) {
			this.lines[i] = new LineContent(editorLines[i], this.indentStyle);
		}

		// Mark the lines as 'sent' based on the location provided
		const locationSections = [contextSelection.above, contextSelection.range, contextSelection.below];
		for (const section of locationSections) {
			for (let j = 0; j < section.lines.length; j++) {
				const lineIndex = section.first_line_index + j;
				if (lineIndex >= this.lines.length) {
					// console.log('sidecar.document_manager.getLineCount.greater', this.lines.length, lineIndex);
				}
				this.lines[lineIndex].markSent();
			}
		}

		// Determine the index of the first 'sent' line
		this.firstSentLineIndex = contextSelection.above.has_content
			? contextSelection.above.first_line_index
			: contextSelection.range.first_line_index;

		this.firstRangeLine = contextSelection.range.first_line_index;
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
		// console.log('sidecar.replaceLine');
		// console.log('sidecar.replaceLine', index, newLine.adjustedContent);
		this.lines[index] = new LineContent(newLine.adjustedContent, this.indentStyle);
		this.progress.textEdit(
			this.document.uri,
			[
				{
					range: new vscode.Range(index, 0, index, 1000),
					newText: newLine.adjustedContent
				}
			]
		);
		return index + 1;
	}

	// Replace multiple lines starting from a specific index
	replaceLines(startIndex: number, endIndex: number, newLine: AdjustedLineContent) {
		// console.log('sidecar.replaceLines');
		// console.log('sidecar.replaceLines', startIndex, endIndex, newLine.adjustedContent);
		if (startIndex === endIndex) {
			return this.replaceLine(startIndex, newLine);
		} else {
			this.lines.splice(
				startIndex,
				endIndex - startIndex + 1,
				new LineContent(newLine.adjustedContent, this.indentStyle)
			);
			this.progress.textEdit(
				this.document.uri,
				[
					{
						range: new vscode.Range(startIndex, 0, endIndex, 1000),
						newText: newLine.adjustedContent
					}
				]
			);
			return startIndex + 1;
		}
	}

	// Add a new line at the end
	appendLine(newLine: AdjustedLineContent) {
		// console.log('sidecar.appendLine');
		// console.log('sidecar.appendLine', this.lines.length, newLine.adjustedContent);
		this.lines.push(new LineContent(newLine.adjustedContent, this.indentStyle));
		this.progress.textEdit(
			this.document.uri,
			[
				{
					range: new vscode.Range(this.lines.length - 1, 1000, this.lines.length - 1, 1000),
					newText: '\n' + newLine.adjustedContent,
				},
			]
		);
		return this.lines.length;
	}

	// Insert a new line after a specific index
	insertLineAfter(index: number, newLine: AdjustedLineContent) {
		// console.log('sidecar.insertLineAfter');
		// console.log('sidecar.insertLineAfter', index, newLine.adjustedContent);
		this.lines.splice(index + 1, 0, new LineContent(newLine.adjustedContent, this.indentStyle));
		this.progress.textEdit(
			this.document.uri,
			[
				{
					range: new vscode.Range(index, 1000, index, 1000),
					newText: '\n' + newLine.adjustedContent,
				}
			]
		);
		return index + 2;
	}
}

export class LineContent {
	content: string;
	_indentStyle: IndentStyleSpaces;
	_isSent: boolean;
	_trimmedContent: string | null;
	_indentLevel: number;

	constructor(content: string, indentStyle: IndentStyleSpaces) {
		this.content = content;
		this._indentStyle = indentStyle;
		this._isSent = false;
		this._trimmedContent = null;
		this._indentLevel = -1;
	}

	// Getter to check if the content has been marked as 'sent'
	get isSent() {
		return this._isSent;
	}

	// Getter to retrieve the trimmed version of the content
	get trimmedContent() {
		if (this._trimmedContent === null) {
			this._trimmedContent = this.content.trim();
		}
		return this._trimmedContent;
	}

	// Getter to compute and retrieve the indentation level of the content
	get indentLevel() {
		if (this._indentLevel === -1) {
			const [_indentChars, level] = IndentationHelper.guessIndentLevel(this.content, this._indentStyle);
			this._indentLevel = level;
		}
		return this._indentLevel;
	}

	// Mark the content as 'sent'
	markSent() {
		this._isSent = true;
	}
}

export class LineIndentManager {
	indentDelta: number;
	_replyIndentStyle: IndentStyleSpaces | undefined | null;
	constructor(indentLevel: number, line: string) {
		const [, indentLevelForLine] = this.guessIndentLevel(line);
		// @ts-ignore
		this.indentDelta = indentLevelForLine - indentLevel;
	}

	reindent(line: string, style: IndentStyleSpaces): AdjustedLineContent {
		if (line === '') {
			return new AdjustedLineContent('', 0, '', 0);
		}
		const [whitespace, indentationLevel] = this.guessIndentLevel(line);
		const indentationNewLevel = indentationLevel - this.indentDelta;
		const adjustedContent = this.getIndentString(style).repeat(indentationNewLevel) + line.substring(whitespace.length);
		return new AdjustedLineContent(line, indentationLevel, adjustedContent, indentationNewLevel);
	}

	guessIndentLevel(line: string): [string, number] {
		const whiteSpace = IndentationHelper.getLeadingWhitespace(line);
		return whiteSpace === '' || line === ' '
			? ['', 0]
			: (this._replyIndentStyle ||
				(this._replyIndentStyle =
					IndentationHelper.guessIndentStyleFromLeadingWhitespace(whiteSpace)),
				// @ts-ignore
				IndentationHelper.guessIndentLevel(line, this._replyIndentStyle));
	}

	getIndentString(indentStyle: IndentStyleSpaces) {
		return indentStyle.kind === IndentStyle.Tabs ? '\t' : ' '.repeat(indentStyle.indentSize ?? 0);
	}
}

export class AdjustedLineContent {
	public originalContent: string;
	public originalIndentLevel: number;
	public adjustedContent: string;
	public adjustedIndentLevel: number;

	constructor(originalContent: string, originalIndentLevel: number, adjustedContent: string, adjustedIndentLevel: number) {
		this.originalContent = originalContent;
		this.originalIndentLevel = originalIndentLevel;
		this.adjustedContent = adjustedContent;
		this.adjustedIndentLevel = adjustedIndentLevel;
	}
}


// Try to get all the diagnostic information from the editor
export const parseDiagnosticsInformation = async (
	diagnosticsForFile: vscode.Diagnostic[],
	textDocument: vscode.TextDocument,
	selection: vscode.Range,
): Promise<DiagnosticInformationFromEditor | null> => {
	// First we have to filter out the diagnostics which are in the selection
	const diagnostics = diagnosticsForFile.filter((diagnostic) => {
		return !!diagnostic.range.intersection(selection);
	});
	if (diagnostics.length === 0) {
		// return something here;
		return null;
	}
	const diagnosticValue = [];
	const firstDiagnostic = diagnostics[0];
	const userPromptFirstMessage = `The code has the following ${firstDiagnostic.source + ' '}problems`;
	for (let index = 0; index < diagnostics.length; index++) {
		const currentProblemPrompts = [];
		currentProblemPrompts.push(`Problem ${index + 1}:`);
		const diagnostic = diagnostics[index];
		const textInDocument =
			textDocument.getText(new vscode.Range(diagnostic.range.start.line, 0, diagnostic.range.end.line + 1, 0))
				.trim();
		if (textInDocument.length > 0 && textInDocument.length < 200) {
			currentProblemPrompts.push('This code');
			currentProblemPrompts.push(wrapInCodeBlock('', textInDocument));
			currentProblemPrompts.push('has the problem reported:');
			currentProblemPrompts.push(wrapInCodeBlock('', `${diagnostic.message}`));
		}
		const relatedInfoToDiagnostic = [];
		// What other info do we need here to parse it properly?
		const relatedInformation = diagnostic.relatedInformation;
		if (relatedInformation) {
			for (let relatedInfoIndex = 0; relatedInfoIndex < relatedInformation.length; relatedInfoIndex++) {
				const relatedInfoVal = relatedInformation[relatedInfoIndex];
				const textDocumentPath = relatedInfoVal.location.uri;
				const range = relatedInfoVal.location.range;
				const textDocument = await vscode.workspace.openTextDocument(textDocumentPath);
				const textValue = textDocument.getText();
				const languageId = textDocument.languageId;
				relatedInfoToDiagnostic.push({
					text: textValue,
					language: languageId,
					range: {
						startPosition: {
							line: range.start.line,
							character: range.start.character,
							byteOffset: textDocument.offsetAt(range.start),
						},
						endPosition: {
							line: range.end.line,
							character: range.end.character,
							byteOffset: textDocument.offsetAt(range.end),
						},
					}
				});
			}
		}
		diagnosticValue.push({
			promptParts: currentProblemPrompts,
			relatedInformation: relatedInfoToDiagnostic,
		});
	}
	return {
		firstMessage: userPromptFirstMessage,
		diagnosticInformation: diagnosticValue,
	};
};

function wrapInCodeBlock(t: string, e: string): string {
	const r = e.matchAll(/^\s*(```+)/gm);
	const n = Math.max(3, ...Array.from(r, (o) => o[1].length + 1));
	const i = '`'.repeat(n);
	return `${i}${t}\n${e.trim()}\n${i}`;
}


export const convertVSCodeDiagnosticSeverity = (
	diagnostic: vscode.DiagnosticSeverity,
): DiagnosticSeverity => {
	switch (diagnostic) {
		case vscode.DiagnosticSeverity.Error:
			return DiagnosticSeverity.Error;
		case vscode.DiagnosticSeverity.Warning:
			return DiagnosticSeverity.Warning;
		case vscode.DiagnosticSeverity.Information:
			return DiagnosticSeverity.Information;
		case vscode.DiagnosticSeverity.Hint:
			return DiagnosticSeverity.Hint;
		default:
			return DiagnosticSeverity.Error;
	}
};

export const convertVSCodeDiagnostic = (
	diagnosticCode: string | number | {
		value: string | number;
		target: vscode.Uri;
	} | undefined,
): DiagnosticCode | null => {
	if (diagnosticCode === undefined) {
		return null;
	}
	if (typeof diagnosticCode === 'string') {
		return {
			strValue: diagnosticCode,
			numValue: null,
			information: null,
		};
	}
	if (typeof diagnosticCode === 'number') {
		return {
			strValue: null,
			numValue: diagnosticCode,
			information: null,
		};
	}
	if (typeof diagnosticCode === 'object') {
		if (typeof diagnosticCode.value === 'string') {
			return {
				strValue: null,
				numValue: null,
				information: {
					strValue: diagnosticCode.value,
					numValue: null,
					fsFilePath: diagnosticCode.target.fsPath,
				},
			};
		}
		if (typeof diagnosticCode.value === 'number') {
			return {
				strValue: null,
				numValue: null,
				information: {
					strValue: null,
					numValue: diagnosticCode.value,
					fsFilePath: diagnosticCode.target.fsPath,
				},
			};
		}
	}
	return null;
};


export const shouldAddLeadingStrings = (
	model: InLineAgentLLMType | undefined,
): boolean => {
	// console.log('mode being used', model);
	if (model === 'MistralInstruct' || model === 'Mixtral' || model === 'DeepSeekCoder1_3BInstruct' || model === 'DeepSeekCoder33BInstruct' || model === 'DeepSeekCoder6BInstruct' || model === 'CodeLLama70BInstruct' || model === 'CodeLlama13BInstruct' || model === 'CodeLlama7BInstruct') {
		return true;
	}
	return false;
};
