/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/


// We use this module to grab the relevant context for the code selection, this
// will allow us to better explain code and also as a feeder for the higher
// level context which is required when generating explanation

import * as vscode from 'vscode';
import { CodeSymbolInformation } from '../utilities/types';

export interface SelectionReferenceData {
	documentFilePath: string;
	currentSelection: string;
	currentCodeSymbol: CodeSymbolInformation;
	symbolUsedInReferences: CodeSymbolInformation[];
}


export const getContextForPromptFromUserContext = (
	selectionContext: any,
): string => {
	const fileList = selectionContext.fileContext;
	const codeSnippetInformation = selectionContext.codeSymbolsContext;
	const alreadySeenFilePaths: Set<string> = new Set();
	const filePathToContent: Map<string, string> = new Map();
	vscode.workspace.textDocuments.forEach((document) => {
		const documentPath = document.uri.fsPath;
		if (fileList.includes(documentPath)) {
			alreadySeenFilePaths.add(documentPath);
			filePathToContent.set(documentPath, document.getText());
		}
	});

	const codeSnippetInformationMap: Map<number, string> = new Map();

	// Now we need to get the symbols in the range
	vscode.workspace.textDocuments.forEach((document) => {
		for (let index = 0; index < codeSnippetInformation.length; index++) {
			if (codeSnippetInformationMap.has(index)) {
				continue;
			}
			const filePathForCodeSnippet = codeSnippetInformation[index].filePath;
			if (document.uri.fsPath === filePathForCodeSnippet) {
				const startLine = Math.max(0, codeSnippetInformation[index].startLineNumber - 5);
				const endLine = Math.min(document.lineCount - 1, codeSnippetInformation[index].endLineNumber + 5);
				const content = document.getText(new vscode.Range(
					new vscode.Position(
						startLine,
						0,
					),
					new vscode.Position(
						endLine,
						0,
					)
				));
				codeSnippetInformationMap.set(index, content);
			}
		}
	});
	return `
You are given the context for the code snippet the user has asked you to look at:
<code_snippet_context>
${Array.from(codeSnippetInformationMap.values()).map((codeSnippet) => {
		return `<code_snippet>\n${codeSnippet}</code_snippet>\n`;
	})}
</code_snippet_context>

You are also given the full file context for certain files which the user has asked you to look at:
<file_context>
${Array.from(filePathToContent.entries()).map(([filePath, content]) => {
		return `<file_path>${filePath}</file_path>\n<file_content>\n${content}</file_content>\n`;
	})}
</file_context>
	`;
};


export const createContextPrompt = (selectionReferenceData: SelectionReferenceData): string => {
	return `
You are given the context for the following code snippet:
${selectionReferenceData.currentSelection}

The code snippet belongs to the following code symbol:
${selectionReferenceData.currentCodeSymbol.symbolName}
<code_snippet_for_symbol>
${selectionReferenceData.currentCodeSymbol.codeSnippet.code}
</code_snippet_for_symbol>

The code symbol is used in other parts of the codebase, you can use this to get a higher level understanding of how the code symbol is used in the codebase:
<code_symbol_references>
${selectionReferenceData.symbolUsedInReferences.map((reference) => {
		return `<code_symbol_name>${reference.symbolName}</code_symbol_name>\n<code_snippet_for_symbol>${reference.codeSnippet.code}</code_snippet_for_symbol>\n`;
	})}
</code_symbol_references>

Remember to be concise and explain the code like a professor in computer science, use the references provided to quote how its used in the codebase.
	`;
};
