/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
export enum CodeSymbolKind {
	file = 0,
	module = 1,
	namespace = 2,
	package = 3,
	class = 4,
	method = 5,
	property = 6,
	field = 7,
	constructor = 8,
	enum = 9,
	interface = 10,
	function = 11,
	variable = 12,
	constant = 13,
	string = 14,
	number = 15,
	boolean = 16,
	array = 17,
	object = 18,
	key = 19,
	null = 20,
	enumMember = 21,
	struct = 22,
	event = 23,
	operator = 24,
	typeParameter = 25
}

export interface CodeSymbolInformation {
	symbolName: string;
	symbolKind: CodeSymbolKind;
	symbolStartLine: number;
	symbolEndLine: number;
	codeSnippet:
	{ languageId: string; code: string };
	extraSymbolHint: string | null;
	dependencies: CodeSymbolDependencies[];
	fsFilePath: string;
	originalFilePath: string;
	workingDirectory: string;
	displayName: string;
	originalName: string;
	originalSymbolName: string;
	globalScope: string;
}

export interface FileCodeSymbolInformation {
	workingDirectory: string;
	filePath: string;
	codeSymbols: CodeSymbolInformation[];
}


export interface CodeSymbolDependencies {
	codeSymbolName: string;
	codeSymbolKind: CodeSymbolKind;
	// The edges here are to the code symbol node in our graph
	edges: CodeSymbolDependencyWithFileInformation[];
}

export interface CodeSymbolDependencyWithFileInformation {
	codeSymbolName: string;
	filePath: string;
}

export interface CodeSymbolInformationEmbeddings {
	codeSymbolInformation: CodeSymbolInformation;
	codeSymbolEmbedding: number[];
	fileHash: string;
}

export interface CodeSnippetInformationEmbeddings {
	codeSnippetInformation: CodeSnippetInformation;
	codeSnippetEmbedding: number[];
}


// Snippet here refers to a chunk of the code which is present in a file
// it has the start and end line numbers and the content from the file in
// between, it also contains the code symbol information which is present
// inside the snippet and the code symbol it belongs to (if this part of
// a code symbol)
export class CodeSnippetInformation {
	content: string;
	start: number;
	end: number;
	filePath: string;
	// This shows the code symbols which are inside the snippet
	codeSymbolsInside: CodeSymbolInformation[] | null;
	// This contains information about the outer code symbol this snippet is
	// part of
	outerCodeSymbol: CodeSymbolInformation | null;
	// If there is an overlap with a previous code symbol with this snippet
	codeSymbolOverlapPrefix: CodeSymbolInformation | null;
	// If there is an overlap with a code symbol in the suffix but its not
	// contained completely within this snippet
	codeSymbolOverlapSuffix: CodeSymbolInformation | null;

	constructor(
		content: string,
		start: number,
		end: number,
		filePath: string,
		codeSymbolsInside: CodeSymbolInformation[] | null,
		outerCodeSymbol: CodeSymbolInformation | null,
		codeSymbolOverlapPrefix: CodeSymbolInformation | null,
		codeSymbolOverlapSuffix: CodeSymbolInformation | null,
	) {
		this.content = content;
		this.start = start;
		this.end = end;
		this.filePath = filePath;
		this.codeSymbolsInside = codeSymbolsInside;
		this.outerCodeSymbol = outerCodeSymbol;
		this.codeSymbolOverlapPrefix = codeSymbolOverlapPrefix;
		this.codeSymbolOverlapSuffix = codeSymbolOverlapSuffix;
	}

	static fromCodeSymbolInformation(
		codeSymbolInformation: CodeSymbolInformation,
	): CodeSnippetInformation {
		return new CodeSnippetInformation(
			codeSymbolInformation.codeSnippet.code,
			codeSymbolInformation.symbolStartLine,
			codeSymbolInformation.symbolEndLine,
			codeSymbolInformation.fsFilePath,
			null,
			codeSymbolInformation,
			null,
			null,
		);
	}

	getNameForSnippet(): string {
		return `${this.filePath}:${this.start}:${this.end}`;
	}
}


// A span defines the range of code we are going to coalesce into a single chunk
export class Span {
	start: number;
	end: number;

	constructor(start: number, end?: number) {
		this.start = start;
		this.end = end !== undefined ? end : start;
	}

	extract(s: string): string {
		return s.slice(this.start, this.end);
	}

	extractLines(s: string): string {
		return s.split('\n').slice(this.start, this.end).join('\n');
	}

	add(other: Span | number): Span {
		if (typeof other === 'number') {
			return new Span(this.start + other, this.end + other);
		} else if (other instanceof Span) {
			return new Span(this.start, other.end);
		} else {
			throw new Error('Not implemented for the given type');
		}
	}

	length(): number {
		return this.end - this.start;
	}
}
