/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import { CodeSnippetInformation, CodeSymbolInformation, FileCodeSymbolInformation } from '../../utilities/types';

import * as fs from 'fs';
import { RepoRef, SideCarClient } from '../../sidecar/client';


export const generateCodeSymbolsForQueries = async (
	queries: string[],
	_sidecarClient: SideCarClient,
	_reporef: RepoRef,
): Promise<CodeSnippetInformation[]> => {
	// we will ping the sidecar binary to get the code snippets which are relevant
	// for the search
	const codeSnippetInformationList: CodeSnippetInformation[] = [];
	for (let index = 0; index < queries.length; index++) {
		const currentQuery = queries[index];
		if (currentQuery !== '') {
			// TODO(skcd): enable this for the agent once we have the search working and the rest
			// of the pipeline has been changed properly
			// const snippets = await sidecarClient.getSemanticSearchResult(currentQuery, reporef);
			// codeSnippetInformationList.push(...snippets.map((snippet) => CodeSnippetInformation.fromCodeSymbolInformation(snippet)));
		}
	}
	return codeSnippetInformationList;
};


export const getOpenFilesInWorkspace = (): string[] => {
	const openEditors = vscode.window.visibleTextEditors;

	// Filter out non-file editors (like output or debug console)
	const openFiles = openEditors
		.filter(editor => editor.document.uri.scheme === 'file')
		.map(editor => editor.document.uri.fsPath);

	// Display a message box to the user with open files
	return openFiles;
};


const formatFileInformationForPrompt = (
	fileCodeSymbolInformationList: FileCodeSymbolInformation
): string => {
	let prompt = `<file_path>${fileCodeSymbolInformationList.filePath}</file_path>\n`;
	fileCodeSymbolInformationList.codeSymbols.forEach((codeSymbol) => {
		prompt += `<code_symbol_name>${codeSymbol.symbolName}</code_symbol_name>\n`;
		// Now we need to split and add the code snippet here
		const splittedCodeSnippet = codeSymbol.codeSnippet.code.split('\n');
		prompt += '<snippet>\n';
		splittedCodeSnippet.forEach((codeSnippetLine) => {
			prompt += `${codeSnippetLine}\n`;
		});
		prompt += '</snippet>\n';
	});
	return prompt;
};

export const formatFileInformationListForPrompt = async (
	fileCodeSymbolInformationList: FileCodeSymbolInformation[]
): Promise<string> => {
	let relevantCodeSnippetPrompt = '<relevant_code_snippets_with_information>';
	for (let index = 0; index < fileCodeSymbolInformationList.length; index++) {
		relevantCodeSnippetPrompt +=
			formatFileInformationForPrompt(fileCodeSymbolInformationList[index]) + '\n';
	}
	relevantCodeSnippetPrompt += '</relevant_code_snippets_with_information>';
	return relevantCodeSnippetPrompt;
};


export const readFileContents = async (
	filePath: string,
): Promise<string> => {
	// Read the file from the location in the directory
	return fs.readFileSync(filePath, 'utf8');
};


export const writeFileContents = async (
	filePath: string,
	fileContent: string,
	isScratchFile: boolean = false,
): Promise<void> => {
	const resp = fs.writeFileSync(filePath, fileContent);

	if (!isScratchFile) {
		// Open the file in the editor
		await vscode.commands.executeCommand(
			'vscode.open',
			vscode.Uri.file(filePath),
		);

		// Call the git.refresh command to refresh the git status in the extension
		await vscode.commands.executeCommand('git.refresh');

		// Open the diff view for the file
		await vscode.commands.executeCommand(
			'git.openChange',
			vscode.Uri.file(filePath),
		);
	}

	return resp;
};


export const getCodeNodeForName = (
	codeSymbolNameMaybe: string,
	fileCodeSymbolInformationList: FileCodeSymbolInformation[],
): CodeSymbolInformation | null => {
	// console.log(`[getFilePathForCodeNode]: ${codeSymbolNameMaybe}`);
	const possibleNodesMaybe: CodeSymbolInformation[] = [];
	fileCodeSymbolInformationList.forEach((fileCodeSymbolInformation) => {
		const nodes = fileCodeSymbolInformation.codeSymbols;
		const possibleNodes = nodes.filter(
			(node) => {
				const symbolName = node.symbolName;
				const splittedSymbolName = symbolName.split('.').reverse();
				let accumulator = '';
				for (let index = 0; index < splittedSymbolName.length; index++) {
					const element = splittedSymbolName[index];
					if (index === 0) {
						accumulator = element;
						if (accumulator === codeSymbolNameMaybe) {
							return true;
						}
					} else {
						accumulator = `${element}.${accumulator}`;
						if (accumulator === codeSymbolNameMaybe) {
							return true;
						}
					}
				}
				return false;
			},
		);
		possibleNodesMaybe.push(...possibleNodes);
		return possibleNodes;
	});
	if (possibleNodesMaybe.length === 0) {
		return null;
	}
	return possibleNodesMaybe[0];
};


export const shouldExecuteTestHarness = (testRunCommand: string): boolean => {
	if (testRunCommand === 'NotPresent') {
		return false;
	}
	return true;
};
