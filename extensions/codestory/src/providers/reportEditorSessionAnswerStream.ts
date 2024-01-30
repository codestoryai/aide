/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * We are going to report the stream of responses we get back from sidecar to
 * the schema which is required for the editor session provider to work
 */

import * as vscode from 'vscode';
import { ContextSelection, DiagnosticCode, DiagnosticInformation, DiagnosticInformationFromEditor, DiagnosticSeverity, InLineAgentAction, InLineAgentAnswer, InLineAgentContextSelection, InLineAgentLLMType, InLineAgentMessage } from '../sidecar/types';
import { RepoRef, SideCarClient } from '../sidecar/client';
import { CSInteractiveEditorProgressItem, IndentStyle, IndentStyleSpaces, IndentationHelper, IndentationUtils } from './editorSessionProvider';

export interface EditMessage {
	message: string | null;
}

export const reportFromStreamToEditorSessionProgress = async (
	stream: AsyncIterator<InLineAgentMessage>,
	progress: vscode.Progress<vscode.CSChatEditorProgressItem>,
	cancellationToken: vscode.CancellationToken,
	currentRepoRef: RepoRef,
	workingDirectory: string,
	sidecarClient: SideCarClient,
	language: string,
	textDocument: vscode.TextDocument,
): Promise<EditMessage> => {
	if (cancellationToken.isCancellationRequested) {
		return {
			message: null,
		};
	}
	const firstPartOfMessage = async () => {
		const firstPart = await stream.next();
		if (firstPart.done) {
			return CSInteractiveEditorProgressItem.normalMessage('Failed to fetch response');
		}
		const sessionId = firstPart.value.session_id;
		return CSInteractiveEditorProgressItem.normalMessage(`Session ID: ${sessionId}`);
	};

	progress.report(await firstPartOfMessage());

	if (cancellationToken.isCancellationRequested) {
		return {
			message: null,
		};
	}

	const asyncIterable = {
		[Symbol.asyncIterator]: () => stream
	};

	let enteredGenerationLoop = false;
	let skillUsed: InLineAgentAction | undefined = undefined;
	let generatedAnswer: InLineAgentAnswer | null = null;
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
					progress.report(CSInteractiveEditorProgressItem.normalMessage('Deciding action...'));
					continue;
				}
			}
		}


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
				generatedAnswer = inlineAgentMessage.answer;
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
				console.log(inlineAgentMessage.answer);
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


	// if (skillUsed === 'Doc' && generatedAnswer !== null) {
	// 	// Here we will send over the updates
	// 	const cleanedUpAnswer = extractCodeFromDocumentation(generatedAnswer.answer_up_until_now);
	// 	if (cleanedUpAnswer === null) {
	// 		progress.report(CSInteractiveEditorProgressItem.normalMessage('Failed to parse the output'));
	// 		return {
	// 			message: cleanedUpAnswer,
	// 		};
	// 	}
	// 	const parsedComments = await sidecarClient.getParsedComments({
	// 		language,
	// 		source: cleanedUpAnswer,
	// 	});
	// 	const textEdits: vscode.TextEdit[] = [];
	// 	if (parsedComments.documentation.length === 1) {
	// 		// we can just show this snippet on top of the current expanded
	// 		// block which has been selected
	// 		// If this is the case, then we just have to check the indentation
	// 		// style and apply the edits accordingly
	// 		// 1. get the first line in the selection
	// 		const selectionText = textDocument.getText(new vscode.Range(
	// 			new vscode.Position(generatedAnswer.document_symbol?.start_position.line ?? 0, 0),
	// 			new vscode.Position(generatedAnswer.document_symbol?.end_position.line ?? 0, generatedAnswer.document_symbol?.end_position.character ?? 0),
	// 		));
	// 		const lines = selectionText.split(/\r\n|\r|\n/g);
	// 		const originalDocIndentationStyle = IndentationHelper.getDocumentIndentStyle(lines, undefined);
	// 		let originalDocIndentationLevel = ['', 0];
	// 		if (lines.length > 0) {
	// 			// get the style from the first line
	// 			const firstLine = lines[0];
	// 			originalDocIndentationLevel = IndentationHelper.guessIndentLevel(firstLine, originalDocIndentationStyle);
	// 		}
	// 		// Now that we have the indentation level, we can apply the edits accordingly
	// 		const edits: vscode.TextEdit[] = [];
	// 		const documentation = parsedComments.documentation[0];
	// 		const documentationLines = documentation.split(/\r\n|\r|\n/g);
	// 		const documentationIndentStyle = IndentationHelper.getDocumentIndentStyle(documentationLines, undefined);
	// 		// Now we trim all the whitespace at the start of this line
	// 		const fixedDocumentationLines = documentationLines.map((documentationLine) => {
	// 			const generatedDocIndentation = IndentationHelper.guessIndentLevel(documentationLine, documentationIndentStyle);
	// 			// Now I have to replace the indentation on the generated documentation with the one I have from the original text
	// 			// - first I trim it
	// 			const trimmedDocumentationLine = documentationLine.trim();
	// 			// This is the indentation from the original document
	// 			// @ts-ignore
	// 			const indentationString = originalDocIndentationStyle.kind === IndentStyle.Tabs ? '\t' : ' '.repeat(originalDocIndentationStyle.indentSize).repeat(originalDocIndentationLevel[1]);
	// 			// original document whitespace + original document indentation for the line we are going to put it above + comments if they have any indentation
	// 			const fixedDocumentationLine = indentationString + trimmedDocumentationLine;
	// 			return fixedDocumentationLine;
	// 		});
	// 		// Now I have the start position for this answer
	// 		const startPosition = generatedAnswer.document_symbol?.start_position.line ?? 0;
	// 		let finalDocumentationString = fixedDocumentationLines.join('\n');
	// 		// It needs one more \n at the end of the input
	// 		finalDocumentationString = finalDocumentationString + '\n';
	// 		textEdits.push(vscode.TextEdit.insert(new vscode.Position(startPosition, 0), finalDocumentationString));
	// 		// we report back the edits
	// 	} else {
	// 		// we have to show the whole block as an edit
	// 		const selectionTextRange = new vscode.Range(
	// 			new vscode.Position(generatedAnswer.document_symbol?.start_position.line ?? 0, 0),
	// 			new vscode.Position(generatedAnswer.document_symbol?.end_position.line ?? 0, generatedAnswer.document_symbol?.end_position.character ?? 0),
	// 		);
	// 		const startPositionLine = generatedAnswer.document_symbol?.start_position.line ?? 0;
	// 		const selectionText = textDocument.getText(selectionTextRange);
	// 		const selectionTextLines = selectionText.split(/\r\n|\r|\n/g);
	// 		const originalDocIndentationStyle = IndentationHelper.getDocumentIndentStyle(selectionTextLines, undefined);
	// 		let originalDocIndentationLevel = ['', 0];
	// 		if (selectionTextLines.length > 0) {
	// 			// get the style from the first line
	// 			const firstLine = selectionTextLines[0];
	// 			originalDocIndentationLevel = IndentationHelper.guessIndentLevel(firstLine, originalDocIndentationStyle);
	// 		}
	// 		// we are going to replace the whole block with the generated text
	// 		const codeBlockReplacement = cleanedUpAnswer;
	// 		const codeblockReplacementLines = codeBlockReplacement.split(/\r\n|\r|\n/g);
	// 		// get the indent style for the code block replacement
	// 		const codeBlockReplacementIndentStyle = IndentationHelper.getDocumentIndentStyle(codeblockReplacementLines, undefined);
	// 		let codeBlockReplacementIndentLevel = ['', 0];
	// 		if (codeBlockReplacement.length > 0) {
	// 			// get the style from the first line
	// 			const firstLine = codeBlockReplacement.split(/\r\n|\r|\n/g)[0];
	// 			codeBlockReplacementIndentLevel = IndentationHelper.guessIndentLevel(firstLine, codeBlockReplacementIndentStyle);
	// 		}
	// 		const newContent = IndentationHelper.changeIndentStyle(codeblockReplacementLines, codeBlockReplacementIndentStyle, originalDocIndentationStyle).join('\n');
	// 		textEdits.push(vscode.TextEdit.replace(selectionTextRange, newContent));
	// 		// now we have the original doc, indent style and the new text indent style
	// 		// we want to make sure the generated doc has the same indent level as the original doc
	// 		// and then we want to fix the indent style on the generated doc
	// 	}
	// 	progress.report({
	// 		edits: textEdits,
	// 	});
	// }
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
	constructor(progress: vscode.Progress<vscode.CSChatEditorProgressItem>,
		document: vscode.TextDocument,
		lines: string[],
		contextSelection: InLineAgentContextSelection,
		indentStyle: IndentStyleSpaces | undefined,
	) {
		// Initialize document with the given parameters
		this.document = new DocumentManager(progress, document, lines, contextSelection, indentStyle);

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

	async processLine(answerStreamLine: AnswerStreamLine) {
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
				const adjustedLine = this.previousLine.reindent(line, this.document.indentStyle);
				const anchor = this.findAnchor(adjustedLine, this.documentLineIndex);
				if (anchor !== null) {
					this.sentEdits = true;
					this.documentLineIndex = this.document.replaceLines(this.documentLineIndex, anchor, adjustedLine);
				} else if (this.documentLineIndex >= this.document.getLineCount()) {
					this.sentEdits = true;
					this.documentLineIndex = this.document.appendLine(adjustedLine);
				} else {
					const currentLine = this.document.getLine(this.documentLineIndex);
					this.sentEdits = true;
					if (!currentLine.isSent || adjustedLine.adjustedContent === '' || (currentLine.content !== '' && currentLine.indentLevel < adjustedLine.adjustedIndentLevel)) {
						this.documentLineIndex = this.document.insertLineAfter(this.documentLineIndex - 1, adjustedLine);
					} else {
						this.documentLineIndex = this.document.replaceLine(this.documentLineIndex, adjustedLine);
					}
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
	progress: vscode.Progress<vscode.CSChatEditorProgressItem>;
	lines: LineContent[];
	firstSentLineIndex: number;
	firstRangeLine: number;

	constructor(
		progress: vscode.Progress<vscode.CSChatEditorProgressItem>,
		document: vscode.TextDocument,
		lines: string[],
		contextSelection: InLineAgentContextSelection,
		indentStyle: IndentStyleSpaces | undefined,
	) {
		this.progress = progress; // Progress tracking
		this.lines = []; // Stores all the lines in the document
		this.indentStyle = IndentationHelper.getDocumentIndentStyle(lines, indentStyle);
		// this.indentStyle = IndentationHelper.getDocumentIndentStyleUsingSelection(contextSelection); // Determines the indentation style

		// Split the editor's text into lines and initialize each line
		const editorLines = document.getText().split(/\r\n|\r|\n/g);
		for (let i = 0; i < editorLines.length; i++) {
			this.lines[i] = new LineContent(editorLines[i], this.indentStyle);
		}

		// Mark the lines as 'sent' based on the location provided
		const locationSections = [contextSelection.above, contextSelection.range, contextSelection.below];
		for (const section of locationSections) {
			for (let j = 0; j < section.lines.length; j++) {
				const lineIndex = section.first_line_index + j;
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
		// console.log('replaceLine');
		// console.log('replaceLine', index, newLine.adjustedContent);
		this.lines[index] = new LineContent(newLine.adjustedContent, this.indentStyle);
		this.progress.report({
			edits: [
				{
					range: new vscode.Range(index, 0, index, 1000),
					newText: newLine.adjustedContent
				}
			]
		});
		return index + 1;
	}

	// Replace multiple lines starting from a specific index
	replaceLines(startIndex: number, endIndex: number, newLine: AdjustedLineContent) {
		// console.log('replaceLines');
		// console.log('replaceLines', startIndex, endIndex, newLine.adjustedContent);
		if (startIndex === endIndex) {
			return this.replaceLine(startIndex, newLine);
		} else {
			this.lines.splice(
				startIndex,
				endIndex - startIndex + 1,
				new LineContent(newLine.adjustedContent, this.indentStyle)
			);
			this.progress.report({
				edits: [
					{
						range: new vscode.Range(startIndex, 0, endIndex, 1000),
						newText: newLine.adjustedContent
					}
				]
			});
			return startIndex + 1;
		}
	}

	// Add a new line at the end
	appendLine(newLine: AdjustedLineContent) {
		// console.log('appendLine');
		// console.log('appendLine', newLine.adjustedContent);
		this.lines.push(new LineContent(newLine.adjustedContent, this.indentStyle));
		this.progress.report({
			edits: [
				{
					range: new vscode.Range(this.lines.length - 1, 1000, this.lines.length - 1, 1000),
					newText: '\n' + newLine.adjustedContent
				}
			]
		});
		return this.lines.length;
	}

	// Insert a new line after a specific index
	insertLineAfter(index: number, newLine: AdjustedLineContent) {
		// console.log('insertLineAfter');
		// console.log('insertLineAfter', index, newLine.adjustedContent);
		this.lines.splice(index + 1, 0, new LineContent(newLine.adjustedContent, this.indentStyle));
		this.progress.report({
			edits: [
				{
					range: new vscode.Range(index, 1000, index, 1000),
					newText: '\n' + newLine.adjustedContent,
				}
			]
		});
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
			const [indentChars, level] = IndentationHelper.guessIndentLevel(this.content, this._indentStyle);
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
	if (model === 'MistralInstruct' || model === 'Mixtral' || model === 'CodeLLama70BInstruct') {
		return true;
	}
	return false;
};
