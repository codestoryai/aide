/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { DocumentSymbol, Position, SymbolInformation, SymbolKind, Uri, languages, workspace } from 'vscode';
import logger from '../logger';
import * as path from 'path';
import { sleep } from './sleep';
import * as fs from 'fs';
import { CodeSymbolInformation, CodeSymbolKind } from './types';


// function isSymbolInformationArray(symbols: SymbolInformation[] | DocumentSymbol[]): symbols is SymbolInformation[] {
// 	// Assuming SymbolInformation has a unique property 'location'
// 	return (symbols.length > 0 && 'containerName' in symbols[0]);
// }


function isDocumentSymbolArray(symbols: SymbolInformation[] | DocumentSymbol[]): symbols is DocumentSymbol[] {
	// Assuming DocumentSymbol has a unique property 'detail'
	return (symbols.length > 0 && 'children' in symbols[0]);
}


function convertVSCodeSymbolKind(symbolKind: SymbolKind): CodeSymbolKind {
	switch (symbolKind) {
		case SymbolKind.Array:
			return CodeSymbolKind.array;
		case SymbolKind.File:
			return CodeSymbolKind.file;
		case SymbolKind.Module:
			return CodeSymbolKind.module;
		case SymbolKind.Namespace:
			return CodeSymbolKind.namespace;
		case SymbolKind.Package:
			return CodeSymbolKind.package;
		case SymbolKind.Class:
			return CodeSymbolKind.class;
		case SymbolKind.Method:
			return CodeSymbolKind.method;
		case SymbolKind.Property:
			return CodeSymbolKind.property;
		case SymbolKind.Field:
			return CodeSymbolKind.field;
		case SymbolKind.Constructor:
			return CodeSymbolKind.constructor;
		case SymbolKind.Enum:
			return CodeSymbolKind.enum;
		case SymbolKind.Interface:
			return CodeSymbolKind.interface;
		case SymbolKind.Function:
			return CodeSymbolKind.function;
		case SymbolKind.Variable:
			return CodeSymbolKind.variable;
		case SymbolKind.Constant:
			return CodeSymbolKind.constant;
		case SymbolKind.String:
			return CodeSymbolKind.string;
		case SymbolKind.Number:
			return CodeSymbolKind.number;
		case SymbolKind.Boolean:
			return CodeSymbolKind.boolean;
		case SymbolKind.Object:
			return CodeSymbolKind.object;
		case SymbolKind.Key:
			return CodeSymbolKind.key;
		case SymbolKind.Null:
			return CodeSymbolKind.null;
		case SymbolKind.EnumMember:
			return CodeSymbolKind.enumMember;
		case SymbolKind.Struct:
			return CodeSymbolKind.struct;
		case SymbolKind.Event:
			return CodeSymbolKind.event;
		case SymbolKind.Operator:
			return CodeSymbolKind.operator;
		case SymbolKind.TypeParameter:
			return CodeSymbolKind.typeParameter;
	}
}

export const getCodeLocationPath = (directoryPath: string, filePath: string): string => {
	// Parse the filePath to get an object that includes properties like root, dir, base, ext and name
	const parsedFilePath = path.parse(filePath);

	// Remove the extension of the file
	const filePathWithoutExt = path.join(parsedFilePath.dir, parsedFilePath.name);

	// Find the relative path from directoryPath to filePathWithoutExt
	const relativePath = path.relative(directoryPath, filePathWithoutExt);

	// Replace backslashes with forward slashes to make it work consistently across different platforms (Windows uses backslashes)
	return relativePath.replace(/\//g, '.');
};

function convertDocumentSymbolToCodeSymbolInformation(
	documentSymbol: DocumentSymbol,
	fileSplitLines: string[],
	languageId: string,
	fsFilePath: string,
	workingDirectory: string,
	scope: string = 'global',
	extractChildren: boolean = true,
): CodeSymbolInformation[] {
	// For now I will look at the child of the class and see what I can get
	const codeSymbols: CodeSymbolInformation[] = [];
	if (documentSymbol.kind === SymbolKind.Class && extractChildren) {
		for (let index = 0; index < documentSymbol.children.length; index++) {
			const childSymbol = documentSymbol.children[index];
			if (childSymbol.kind === SymbolKind.Method) {
				codeSymbols.push(
					...convertDocumentSymbolToCodeSymbolInformation(
						childSymbol,
						fileSplitLines,
						languageId,
						fsFilePath,
						workingDirectory,
						'class_function',
						false,
					)
				);
			}
		}
	}
	const codeSymbolInformation: CodeSymbolInformation = {
		symbolName: getCodeLocationPath(workingDirectory, fsFilePath) + '.' + documentSymbol.name,
		symbolKind: convertVSCodeSymbolKind(documentSymbol.kind),
		symbolStartLine: documentSymbol.range.start.line,
		symbolEndLine: documentSymbol.range.end.line,
		codeSnippet: {
			languageId,
			code: fileSplitLines.slice(documentSymbol.range.start.line, documentSymbol.range.end.line).join('\n'),
		},
		extraSymbolHint: documentSymbol.detail,
		fsFilePath,
		originalFilePath: fsFilePath,
		workingDirectory: workingDirectory,
		displayName: documentSymbol.name,
		originalName: documentSymbol.detail,
		originalSymbolName: documentSymbol.name,
		globalScope: scope,
		dependencies: [],
	};
	return [codeSymbolInformation, ...codeSymbols];
}

const convertDocumentSymbolOutputToCodeSymbol = (
	workingDirectory: string,
	fileSplitLines: string[],
	languageId: string,
	fsFilePath: string,
	documentSymbols: SymbolInformation[] | DocumentSymbol[]
): CodeSymbolInformation[] => {
	const codeSymbols: CodeSymbolInformation[] = [];
	// if (isSymbolInformationArray(documentSymbols)) {
	// 	for (let index = 0; index < documentSymbols.length; index++) {
	// 		const symbolInformation = documentSymbols[index];
	// 		console.log('[symbolInformation]', symbolInformation);
	// 	}
	// }
	if (isDocumentSymbolArray(documentSymbols)) {
		for (let index = 0; index < documentSymbols.length; index++) {
			const documentInformation = documentSymbols[index];
			// TODO(codestory): Figure out the relevant symbols we want to pick
			// up globally for each language later on
			if (true) {
				codeSymbols.push(
					...convertDocumentSymbolToCodeSymbolInformation(
						documentInformation,
						fileSplitLines,
						languageId,
						fsFilePath,
						workingDirectory,
						'global',
						true,
					)
				);
			}
		}
	}
	return codeSymbols;
};

export const getSymbolsFromDocumentUsingLSP = async (
	filePath: string,
	languageId: string,
	workingDirectory: string,
): Promise<CodeSymbolInformation[]> => {
	// console.log('[getSymbolsFromDocumentUsingLSP][filePath] ' + filePath);
	// console.log(filePath);
	try {
		const fileSplitLines = (await fs.promises.readFile(filePath)).toString().split('\n');
		const documentSymbolProviders = languages.getDocumentSymbolProvider(
			'typescript'
		);
		const uri = Uri.file(filePath);
		const textDocument = await workspace.openTextDocument(uri);

		const timeout = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms, 'Timed out'));

		for (let index = 0; index < documentSymbolProviders.length; index++) {
			try {
				const symbols = await Promise.race([
					documentSymbolProviders[index].provideDocumentSymbols(
						textDocument,
						{
							isCancellationRequested: false,
							onCancellationRequested: () => ({ dispose() { } }),
						},
					),
					timeout(3000)
				]);

				// if promise timed out, continue to next iteration
				if (symbols === 'Timed out') {
					// console.log('provideDocumentSymbols timed out!');
					continue;
				}

				const castSymbols = symbols as SymbolInformation[] | DocumentSymbol[] | null | undefined;
				if (castSymbols === undefined || castSymbols === null) {
					continue;
				}
				if (castSymbols?.length === 0) {
					continue;
				}
				const codeSymbolInformation = convertDocumentSymbolOutputToCodeSymbol(
					workingDirectory,
					fileSplitLines,
					languageId,
					filePath,
					castSymbols ?? [],
				);
				if (codeSymbolInformation.length !== 0) {
					logger.info('[getSymbolsFromDocumentUsingLSP][codeSymbolInformation][length] ' + codeSymbolInformation.length + ' ' + filePath);
					return codeSymbolInformation;
				}
			} catch (e) {
				// console.log('[wtf3] we ran into an error' + e);
			}
		}
		return [];
	} catch (err) {
		// console.log(`[getSymbolsFromDocumentUsingLSP][error]: ${filePath}`);
		// console.log(err);
		return [];
	}
};


// export const getDocumentSymbols = async () => {
// 	await sleep(1000);
// 	logger.info('[document-symbols-testing] we are here');
// 	const documentSymbolProviders = languages.getDocumentSymbolProvider(
// 		'typescript'
// 	);
// 	logger.info('[document-symbol-providers] length ' + documentSymbolProviders.length);
// 	const uri = Uri.file('/Users/skcd/Downloads/mugavari-main/internal/pkg/health/heartbeat.go');
// 	const textDocument = await workspace.openTextDocument(uri);
// 	logger.info('[text documents]');
// 	logger.info(textDocument.getText());
// 	for (let index = 0; index < documentSymbolProviders.length; index++) {
// 		const documentSymbols = await documentSymbolProviders[index].provideDocumentSymbols(
// 			textDocument,
// 			{
// 				isCancellationRequested: false,
// 				onCancellationRequested: () => ({ dispose() { } }),
// 			},
// 		);
// 		// Now we want to write this to a file
// 		if (documentSymbols === null || documentSymbols === undefined || documentSymbols?.length === 0) {
// 			logger.info('[document-symbols-testing] no symbols found');
// 			continue;
// 		}
// 		logger.info('[document-symbols-testing]');
// 		logger.info(documentSymbols);
// 		fs.writeFileSync('/tmp/documentSymbols', JSON.stringify(documentSymbols), 'utf-8');
// 	}
// };

export const lspHacking = async () => {
	await sleep(1000);
	const documentSymbolProviders = languages.getDocumentSymbolProvider(
		'typescript'
	);
	logger.info('[document-symbol-providers golang]');
	logger.info(documentSymbolProviders);
	const uri = Uri.file('/Users/skcd/test_repo/ripgrep/crates/core/logger.rs');
	const textDocument = await workspace.openTextDocument(uri);
	for (let index = 0; index < documentSymbolProviders.length; index++) {
		logger.info('[text documents]');
		logger.info(workspace.textDocuments.map(document => document.uri.fsPath));
		if (textDocument) {
			logger.info('[textDocuments]');
			const documentSymbols = await documentSymbolProviders[index].provideDocumentSymbols(
				textDocument,
				{
					isCancellationRequested: false,
					onCancellationRequested: () => ({ dispose() { } }),
				},
			);
			logger.info('[symbolsDocument]');
			logger.info(documentSymbols?.map((symbol) => symbol.name));
		} else {
			logger.info('file not found');
		}
	}
	logger.info('[document-symbol-providers] ' + documentSymbolProviders.length);


	const providers = languages.getDefinitionProvider({
		language: 'typescript',
		scheme: 'file',
	});
	logger.info('[providers for language ss]' + providers.length);
	for (let index = 0; index < providers.length; index++) {
		logger.info('asking for definitions');
		try {
			const definitions = await providers[index].provideDefinition(
				textDocument,
				new Position(37, 29),
				{
					isCancellationRequested: false,
					onCancellationRequested: () => ({ dispose() { } }),
				}
			);
			logger.info('[definitions sss]');
			logger.info(definitions);
		} catch (e) {
			logger.info(e);
		}
	}

	const referencesProviders = languages.getReferenceProvider({
		language: 'typescript',
		scheme: 'file',
	});
	logger.info('[references for language ss]' + referencesProviders.length);
	for (let index = 0; index < referencesProviders.length; index++) {
		try {
			logger.info('asking for references');
			const references = await referencesProviders[index].provideReferences(
				textDocument,
				new Position(25, 16),
				{
					includeDeclaration: true,
				},
				{
					isCancellationRequested: false,
					onCancellationRequested: () => ({ dispose() { } }),
				}
			);
			logger.info('[references sss]');
			logger.info(references);
		} catch (e) {
			logger.info(e);
		}
	}
};
