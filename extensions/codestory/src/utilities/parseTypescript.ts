/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
	ArrowFunction,
	Block,
	FunctionDeclaration,
	MethodDeclaration,
	Project,
	SourceFile,
	SyntaxKind,
} from 'ts-morph';

import * as fs from 'fs';
import * as path from 'path';
import {
	CodeSymbolDependencies,
	CodeSymbolDependencyWithFileInformation,
	CodeSymbolInformation,
	CodeSymbolKind,
} from './types';
import { runCommandAsync } from './commandRunner';
import { getSymbolsFromDocumentUsingLSP } from './lspApi';
import { CodeSymbolsIndexer } from '../languages/codeSymbolsIndexerTypes';
import { isExcludedExtension } from './extensionBlockList';


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

// Declare an enum here going to a string type with typescript.function
// typescript.class etc
export enum TypescriptCodeType {
	typescriptFunction = 'typescript.function',
	typescriptClass = 'typescript.class',
	typescriptInterface = 'typescript.interface',
	typescriptClassMethod = 'typescript.classMethod',
	typescriptClassArrowFunction = 'typescript.classArrowFunction',
	typescriptArrowFunction = 'typescript.arrowFunction',
	typescriptTypeAlias = 'typescript.typeAlias',
}

export function getTitleForCodeType(codeType: string | null): string {
	switch (codeType) {
		case TypescriptCodeType.typescriptFunction:
			return 'Function';
		case TypescriptCodeType.typescriptClass:
			return 'Class';
		case TypescriptCodeType.typescriptInterface:
			return 'Interface';
		case TypescriptCodeType.typescriptClassMethod:
			return 'Class Method';
		case TypescriptCodeType.typescriptClassArrowFunction:
			return 'Class Arrow Function';
		case TypescriptCodeType.typescriptArrowFunction:
			return 'Arrow Function';
		case TypescriptCodeType.typescriptTypeAlias:
			return 'Type Alias';
		default:
			return 'Unknown';
	}
}

// Arrow functions are not handled yet, once we have that we can start indexing
// we already have some react code along with typescript code thrown in
// so we can use both to understand more completely whats happening

function parseFunctionNode(
	functionNode: FunctionDeclaration,
	moduleName: string,
	directoryPathString: string,
	project: Project,
	sourceFile: SourceFile,
	originalFilePath: string
): CodeSymbolInformation | null {
	const currentFunction = functionNode;
	const functionName = currentFunction.getName();
	// console.log(`[ts-morph][parseFunctionNode] We found function with name: ${functionName}`);
	if (functionName) {
		currentFunction.getStartLineNumber();
		currentFunction.getEndLineNumber();
		const codeSymbolInformation: CodeSymbolInformation = {
			symbolName: moduleName + '.' + functionName,
			symbolKind: CodeSymbolKind.function,
			symbolStartLine: currentFunction.getStartLineNumber(),
			symbolEndLine: currentFunction.getEndLineNumber(),
			codeSnippet: {
				languageId: 'typescript',
				code: functionNode.getText() || '',
			},
			extraSymbolHint: TypescriptCodeType.typescriptFunction,
			dependencies: currentFunction
				.getChildrenOfKind(SyntaxKind.Block)
				.map((block) =>
					parseCodeBlockForDependencies(
						block,
						functionName,
						moduleName,
						directoryPathString,
						project,
						sourceFile
					)
				)
				.reduce((acc, val) => acc.concat(val), []),
			fsFilePath: currentFunction.getSourceFile().getFilePath(),
			originalFilePath,
			workingDirectory: directoryPathString,
			displayName: `${functionName}()`,
			originalName: functionName,
			originalSymbolName: functionName,
			globalScope: moduleName,
		};
		return codeSymbolInformation;
	}
	return null;
}

// We are doing a quick check if this nodes belongs to another function,
// this is a dirty way to prevent many extra nodes and subfunctions from being
// recognized which is fine for now
function checkIfParentIsAFunction(arrowFunction: ArrowFunction): boolean {
	const arrowParent = arrowFunction.getFirstAncestorByKind(SyntaxKind.ArrowFunction);
	const functionParent = arrowFunction.getFirstAncestorByKind(SyntaxKind.FunctionDeclaration);
	if (arrowParent || functionParent) {
		return true;
	} else {
		return false;
	}
}

function parseArrowFunctionNode(
	arrowFunction: ArrowFunction,
	className: string | null,
	moduleName: string,
	directoryPathString: string,
	project: Project,
	sourceFile: SourceFile,
	originalFilePath: string
): CodeSymbolInformation | null {
	const currentArrowExpression = arrowFunction;
	const parent = currentArrowExpression.getParent();
	if (checkIfParentIsAFunction(currentArrowExpression)) {
		return null;
	}
	if (parent) {
		const name = parent.getChildrenOfKind(SyntaxKind.Identifier);
		if (name.length > 0) {
			let symbolName = '';
			let extraSymbolHint = '';
			if (className !== null) {
				symbolName = moduleName + '.' + className + '.' + name[0].getText();
				extraSymbolHint = TypescriptCodeType.typescriptClassArrowFunction;
			} else {
				symbolName = moduleName + '.' + name[0].getText();
				extraSymbolHint = TypescriptCodeType.typescriptArrowFunction;
			}
			// console.log(
			//     `[ts-morph][parseArrowFunctionNode] We found arrow function with name: ${symbolName}`
			// );
			const codeSymbolInformation = {
				symbolName: symbolName,
				symbolKind: CodeSymbolKind.function,
				symbolStartLine: currentArrowExpression.getStartLineNumber(),
				symbolEndLine: currentArrowExpression.getEndLineNumber(),
				codeSnippet: {
					languageId: 'typescript',
					code: arrowFunction.getText() || '',
				},
				extraSymbolHint,
				dependencies: currentArrowExpression
					.getChildrenOfKind(SyntaxKind.Block)
					.map((block) =>
						parseCodeBlockForDependencies(
							block,
							symbolName,
							moduleName,
							directoryPathString,
							project,
							sourceFile
						)
					)
					.reduce((acc, val) => acc.concat(val), []),
				fsFilePath: currentArrowExpression.getSourceFile().getFilePath(),
				originalFilePath: originalFilePath,
				workingDirectory: directoryPathString,
				displayName: `${name[0].getText()} callback()`,
				originalName: name[0].getText(),
				originalSymbolName: name[0].getText(),
				globalScope: moduleName,
			};
			return codeSymbolInformation;
		}
	}
	return null;
}

function parseMethodDeclaration(
	className: string,
	methodDeclaration: MethodDeclaration,
	moduleName: string,
	directoryPathString: string,
	project: Project,
	sourceFile: SourceFile,
	originalFilePath: string,
): CodeSymbolInformation | null {
	const methodName = methodDeclaration.getName();
	if (methodName) {
		methodDeclaration.getStartLineNumber();
		methodDeclaration.getEndLineNumber();
		const codeSymbolInformation = {
			symbolName: moduleName + '.' + className + '.' + methodName,
			symbolKind: CodeSymbolKind.method,
			symbolStartLine: methodDeclaration.getStartLineNumber(),
			symbolEndLine: methodDeclaration.getEndLineNumber(),
			codeSnippet: {
				languageId: 'typescript',
				code: methodDeclaration.getText() || '',
			},
			dependencies: methodDeclaration
				.getChildrenOfKind(SyntaxKind.Block)
				.map((block) =>
					parseCodeBlockForDependencies(
						block,
						methodName,
						moduleName,
						directoryPathString,
						project,
						sourceFile
					)
				)
				.reduce((acc, val) => acc.concat(val), []),
			extraSymbolHint: TypescriptCodeType.typescriptClassMethod,
			fsFilePath: methodDeclaration.getSourceFile().getFilePath(),
			originalFilePath,
			workingDirectory: directoryPathString,
			displayName: `${methodName}()`,
			originalName: methodName,
			originalSymbolName: methodName,
			globalScope: className,
		};
		return codeSymbolInformation;
	}
	return null;
}

function getClassSymbolFromFile(
	sourceFile: SourceFile,
	directoryPath: string,
	project: Project,
	originalFilePath: string
): CodeSymbolInformation[] {
	const classes = sourceFile.getClasses();
	const moduleName = getCodeLocationPath(directoryPath, sourceFile.getFilePath());
	const codeSymbolInformationList: CodeSymbolInformation[] = [];
	for (let index = 0; index < classes.length; index++) {
		const currentClass = classes[index];
		const className = currentClass.getName();
		if (className) {
			currentClass.getStartLineNumber();
			currentClass.getEndLineNumber();
			const classCodeSymbolInformation: CodeSymbolInformation = {
				symbolName: moduleName + '.' + className,
				symbolKind: CodeSymbolKind.class,
				symbolStartLine: currentClass.getStartLineNumber(),
				symbolEndLine: currentClass.getEndLineNumber(),
				codeSnippet: {
					languageId: 'typescript',
					code: '',
				},
				extraSymbolHint: TypescriptCodeType.typescriptClass,
				dependencies: [],
				fsFilePath: sourceFile.getFilePath(),
				originalFilePath,
				workingDirectory: directoryPath,
				displayName: `class ${className}`,
				originalName: className,
				originalSymbolName: className,
				globalScope: moduleName,
			};

			const functions = currentClass.getMethods();
			const functionCodeSymbols = [];
			for (let index2 = 0; index2 < functions.length; index2++) {
				const currentFunction = functions[index2];
				const functionCodeSymbol = parseMethodDeclaration(
					className,
					currentFunction,
					moduleName,
					directoryPath,
					project,
					sourceFile,
					originalFilePath,
				);
				if (functionCodeSymbol !== null) {
					functionCodeSymbols.push(functionCodeSymbol);
					codeSymbolInformationList.push(functionCodeSymbol);
				}
			}
			classCodeSymbolInformation.dependencies = functionCodeSymbols.map((functionCodeSymbol) => {
				return {
					codeSymbolName: moduleName + '.' + className,
					codeSymbolKind: CodeSymbolKind.function,
					edges: [
						{
							codeSymbolName: functionCodeSymbol.symbolName,
							filePath: sourceFile.getFilePath(),
						},
					],
				};
			});
			codeSymbolInformationList.push(classCodeSymbolInformation);
		}
	}
	return codeSymbolInformationList;
}

function getInterfaceSymbolFromFile(
	sourceFile: SourceFile,
	directoryPath: string,
	project: Project,
	originalFilePath: string
): CodeSymbolInformation[] {
	const moduleName = getCodeLocationPath(directoryPath, sourceFile.getFilePath());
	// console.log('[ts-morph] Module name found: ' + moduleName);
	const codeSymbolInformationList: CodeSymbolInformation[] = [];

	const interfaces = sourceFile.getInterfaces();
	for (let index = 0; index < interfaces.length; index++) {
		const currentInterface = interfaces[index];
		const interfaceName = currentInterface.getName();
		if (interfaceName) {
			currentInterface.getStartLineNumber();
			currentInterface.getEndLineNumber();
			const codeSymbolInformation = {
				symbolName: moduleName + '.' + interfaceName,
				symbolKind: CodeSymbolKind.interface,
				symbolStartLine: currentInterface.getStartLineNumber(),
				symbolEndLine: currentInterface.getEndLineNumber(),
				codeSnippet: {
					languageId: 'typescript',
					code: currentInterface.getText() || '',
				},
				extraSymbolHint: TypescriptCodeType.typescriptInterface,
				dependencies: currentInterface
					.getChildrenOfKind(SyntaxKind.Block)
					.map((block) =>
						parseCodeBlockForDependencies(
							block,
							interfaceName,
							moduleName,
							directoryPath,
							project,
							sourceFile
						)
					)
					.reduce((acc, val) => acc.concat(val), []),
				fsFilePath: currentInterface.getSourceFile().getFilePath(),
				originalFilePath,
				workingDirectory: directoryPath,
				displayName: `interface ${interfaceName}`,
				originalName: interfaceName,
				originalSymbolName: interfaceName,
				globalScope: moduleName,
			};
			codeSymbolInformationList.push(codeSymbolInformation);
		}
	}
	return codeSymbolInformationList;
}

function getTypeAliasFromFile(
	sourceFile: SourceFile,
	directoryPath: string,
	project: Project,
	originalFilePath: string
): CodeSymbolInformation[] {
	const moduleName = getCodeLocationPath(directoryPath, sourceFile.getFilePath());
	// console.log('[ts-morph] Module name found: ' + moduleName);
	const codeSymbolInformationList: CodeSymbolInformation[] = [];

	const typeAliases = sourceFile.getTypeAliases();
	for (let index = 0; index < typeAliases.length; index++) {
		const currentTypeAlias = typeAliases[index];
		const typeAliasName = currentTypeAlias.getName();
		if (typeAliasName) {
			currentTypeAlias.getStartLineNumber();
			currentTypeAlias.getEndLineNumber();
			const codeSymbolInformation = {
				symbolName: moduleName + '.' + typeAliasName,
				symbolKind: CodeSymbolKind.typeParameter,
				symbolStartLine: currentTypeAlias.getStartLineNumber(),
				symbolEndLine: currentTypeAlias.getEndLineNumber(),
				codeSnippet: {
					languageId: 'typescript',
					code: currentTypeAlias.getText() || '',
				},
				extraSymbolHint: TypescriptCodeType.typescriptTypeAlias,
				dependencies: currentTypeAlias
					.getChildrenOfKind(SyntaxKind.Block)
					.map((block) =>
						parseCodeBlockForDependencies(
							block,
							typeAliasName,
							moduleName,
							directoryPath,
							project,
							sourceFile
						)
					)
					.reduce((acc, val) => acc.concat(val), []),
				fsFilePath: currentTypeAlias.getSourceFile().getFilePath(),
				originalFilePath,
				workingDirectory: directoryPath,
				displayName: `type ${typeAliasName}`,
				originalName: typeAliasName,
				originalSymbolName: typeAliasName,
				globalScope: moduleName,
			};
			codeSymbolInformationList.push(codeSymbolInformation);
		}
	}
	return codeSymbolInformationList;
}

// Case this covers:
// export const revisit = createCookie('revisit', {
//   maxAge: 24 * 60 * 60, // one week
// });
// https://ts-ast-viewer.com/#code/JYWwDg9gTgLgBAbzgYygUwIYzQYQhAa2DTgF84AzKCEOAIgAF0RgAPAWigFcA7Aeh4QAJmjoBuAFAS0rSLBQQeAZ3joAbsCXB4AXhTosufETQAKOus3a6AGkQS4cEBlYBBAOZoAXHABMAFjgAKjgANgAGYLDwuz4+OEUSAHc0NAIJUgBKSSkZOXhkRRU4JRo0GAALYB53OD1TDB8VKGr3TLqAPntHQuUIABs0ADp+iHcG7McMsSA
// its a function invocation assigned to a global variable
// We literally check if its a variable declaration and then try to see if
// internally it has a child like: CallExpression
// using that we are able to get the variable declaration
function getVariableDeclarationFunctionFromFile(
	sourceFile: SourceFile,
	directoryPath: string,
	project: Project,
	originalFilePath: string
): CodeSymbolInformation[] {
	const moduleName = getCodeLocationPath(directoryPath, sourceFile.getFilePath());
	// console.log('[ts-morph] Module name found: ' + moduleName);
	const codeSymbolInformationList: CodeSymbolInformation[] = [];

	const variableDeclarations = sourceFile.getVariableDeclarations();
	for (let index = 0; index < variableDeclarations.length; index++) {
		const currentVariableDeclaration = variableDeclarations[index];
		// If there is one child of this type then we are okay
		const callExpressionChildren = currentVariableDeclaration.getDescendantsOfKind(
			SyntaxKind.CallExpression
		);
		// Check if one of the immediate child is of type Arrow Expression, if
		// thats the case, then its mostly covered by the arrow expression parsing
		// check before
		const arrowDeclarationChild = currentVariableDeclaration.getChildrenOfKind(
			SyntaxKind.ArrowFunction
		);
		if (arrowDeclarationChild.length !== 0) {
			continue;
		}
		if (callExpressionChildren.length === 0) {
			continue;
		}
		const variableDeclarationName = currentVariableDeclaration.getName();
		if (variableDeclarationName) {
			currentVariableDeclaration.getStartLineNumber();
			currentVariableDeclaration.getEndLineNumber();
			const codeSymbolInformation = {
				symbolName: moduleName + '.' + variableDeclarationName,
				symbolKind: CodeSymbolKind.function,
				symbolStartLine: currentVariableDeclaration.getStartLineNumber(),
				symbolEndLine: currentVariableDeclaration.getEndLineNumber(),
				codeSnippet: {
					languageId: 'typescript',
					code: currentVariableDeclaration.getText() || '',
				},
				extraSymbolHint: TypescriptCodeType.typescriptFunction,
				dependencies: currentVariableDeclaration
					.getChildrenOfKind(SyntaxKind.Block)
					.map((block) =>
						parseCodeBlockForDependencies(
							block,
							variableDeclarationName,
							moduleName,
							directoryPath,
							project,
							sourceFile
						)
					)
					.reduce((acc, val) => acc.concat(val), []),
				fsFilePath: currentVariableDeclaration.getSourceFile().getFilePath(),
				originalFilePath,
				workingDirectory: directoryPath,
				displayName: `${variableDeclarationName}()`,
				originalName: variableDeclarationName,
				originalSymbolName: variableDeclarationName,
				globalScope: moduleName,
			};
			codeSymbolInformationList.push(codeSymbolInformation);
		}
	}
	return codeSymbolInformationList;
}

function getFunctionSymbolFromFile(
	sourceFile: SourceFile,
	directoryPath: string,
	project: Project,
	originalFilePath: string
): CodeSymbolInformation[] {
	const moduleName = getCodeLocationPath(directoryPath, sourceFile.getFilePath());
	const codeSymbolInformationList: CodeSymbolInformation[] = [];

	const functions = sourceFile.getFunctions();
	for (let index = 0; index < functions.length; index++) {
		const currentFunction = functions[index];
		const functionCodeSymbol = parseFunctionNode(
			currentFunction,
			moduleName,
			directoryPath,
			project,
			sourceFile,
			originalFilePath
		);
		if (functionCodeSymbol !== null) {
			codeSymbolInformationList.push(functionCodeSymbol);
		}
	}

	const arrowExpressions = sourceFile.getDescendantsOfKind(SyntaxKind.ArrowFunction);
	for (let index = 0; index < arrowExpressions.length; index++) {
		const currentArrowExpression = arrowExpressions[index];
		const arrowFunctionSymbol = parseArrowFunctionNode(
			currentArrowExpression,
			null,
			moduleName,
			directoryPath,
			project,
			sourceFile,
			originalFilePath
		);
		if (arrowFunctionSymbol !== null) {
			codeSymbolInformationList.push(arrowFunctionSymbol);
		}
	}

	const variableDeclarationFunctions = getVariableDeclarationFunctionFromFile(
		sourceFile,
		directoryPath,
		project,
		originalFilePath
	);
	codeSymbolInformationList.push(...variableDeclarationFunctions);
	return codeSymbolInformationList;
}

// If its a valid import then we get something like this:
// [dependency] Parsing code block for dependencies: searchCodeSymbols
// [dependency] Why is this not working??
// [dependency] Identifier: logger
// [dependency] Symbol: logger
// [dependency] whats the full qualified name: '/Users/skcd/scratch/vscode_plugin/src/codeSymbols/extractFromFile'.FileSymbolCache.logger
// Whats the type here: import('vscode').OutputChannel
// [dependency] Identifier: appendLine
// [dependency] Symbol: appendLine
// [dependency] whats the full qualified name: 'vscode'.OutputChannel.appendLine
// Whats the type here: (value: string) => void
// If the import is valid it will start with your workspace path in the name
// this really translates to check if the qualified name starts with:
// '{full_path}'.{symbol_in_file}
// ^ this is very easy to parse, so we can get the edges for the nodes of this
// workspace
function checkIfSymbolIsImportedFromWorkspace(
	fullyQualifiedName: string,
	workingDirectoryPath: string,
	moduleName: string
): string | null {
	// Check if the fully qualified name starts with the working directory path
	if (!fullyQualifiedName.startsWith(`'${workingDirectoryPath}`)) {
		return moduleName + '.' + fullyQualifiedName;
	}

	// We might have a case where the symbol belongs to the current file, since
	// we are going with the best effort route, we can do something about it
	// otherwise building and indexing it up will be hard (we might have to do
	// another pass on dependencies to make sure we dont have nodes which dont
	// exist) (better to be small scoped but do it well)

	// Split the fully qualified name into parts
	const parts = fullyQualifiedName.split('.');
	if (parts.length === 3) {
		const pathPart = parts[0].replace(/'/g, '');
		if (!pathPart.startsWith(workingDirectoryPath)) {
			return null;
		}
		const removePrefix = path.relative(workingDirectoryPath, pathPart);
		return [
			removePrefix
				.split('/')
				.filter((pathPart) => pathPart !== '')
				.join('.'),
			parts[1],
			parts[2],
		].join('.');
	} else if (parts.length === 2) {
		const pathPart = parts[0].replace(/'/g, '');
		if (!pathPart.startsWith(workingDirectoryPath)) {
			return null;
		}
		const removePrefix = path.relative(workingDirectoryPath, pathPart);
		return [
			removePrefix
				.split('/')
				.filter((pathPart) => pathPart !== '')
				.join('.'),
			parts[1],
		].join('.');
	} else {
		return null;
	}
}

function parseCodeBlockForDependencies(
	block: Block,
	blockCodeSymbolName: string,
	moduleName: string,
	workingDirectoryPath: string,
	_project: Project,
	_sourceFile: SourceFile
): CodeSymbolDependencies[] {
	try {
		const codeSymbolDependencies: CodeSymbolDependencies[] = [];
		block.getDescendantsOfKind(SyntaxKind.CallExpression).forEach((callExpression) => {
			callExpression.getDescendantsOfKind(SyntaxKind.Identifier).forEach((identifier) => {
				const symbol = identifier.getSymbol();
				if (symbol) {
					const qualifiedNamesFromAliasSymbol: CodeSymbolDependencyWithFileInformation[] | undefined =
						symbol
							.getAliasedSymbol()
							?.getDeclarations()
							.map((declaration) => {
								return {
									codeSymbolName: declaration.getSymbol()?.getFullyQualifiedName(),
									filePath: declaration.getSourceFile().getFilePath(),
								};
							})
							.filter((codeSymbolInformation) => codeSymbolInformation.codeSymbolName !== undefined)
							.map(
								// Stupid typescript type checker
								(codeSymbolInformation) =>
									codeSymbolInformation as CodeSymbolDependencyWithFileInformation
							);
					// const declarations = symbol.getDeclarations();
					// if (declarations.length !== 0) {
					//     return;
					// }
					// console.log(
					//     '[dependency] Identifier: ' + identifier.getText() + ' ' + symbol.getDeclarations()[0]
					// );
					// Not sure why this is happening, but this was causing the
					// extension to crash, so we guard against this
					// if (symbol.getDeclarations()[0] === undefined) {
					//     return;
					// }
					// Fix this later
					let originalDeclaration: CodeSymbolDependencyWithFileInformation = {
						codeSymbolName: symbol.getFullyQualifiedName(),
						filePath: 'symbol.getDeclarations()[0].getSourceFile().getFilePath()',
					};

					// We pick the aliased symbol name if its present
					if (
						qualifiedNamesFromAliasSymbol !== undefined &&
						qualifiedNamesFromAliasSymbol?.length !== 0
					) {
						for (const aliasQualifiedName of qualifiedNamesFromAliasSymbol) {
							if (aliasQualifiedName !== undefined) {
								originalDeclaration = aliasQualifiedName;
							}
						}
					}
					const relativeDependency = checkIfSymbolIsImportedFromWorkspace(
						originalDeclaration.codeSymbolName,
						workingDirectoryPath,
						moduleName
					);
					if (relativeDependency === null) {
						return;
					}
					const dependency: CodeSymbolDependencies = {
						codeSymbolName: blockCodeSymbolName,
						codeSymbolKind: CodeSymbolKind.function,
						edges: [
							{
								codeSymbolName: relativeDependency,
								filePath: originalDeclaration.filePath,
							},
						],
					};
					codeSymbolDependencies.push(dependency);
					return;
				} else {
					// console.log('[dependency] No symbol found, probably imported from another file');
				}
			});
		});
		// console.log(
		//     '[dependency] Code symbol dependencies: ' +
		//     blockCodeSymbolName +
		//     ' ' +
		//     JSON.stringify(codeSymbolDependencies)
		// );
		return codeSymbolDependencies;
	} catch (e) {
		// console.log('[dependency] Why is this not working??');
		// console.log(e);
		return [];
	}
}

export function parseCodeBlocksForDependencies(
	sourceFile: SourceFile,
	blockCodeSymbolName: string,
	workingDirectoryPath: string,
	moduleName: string,
	project: Project
): CodeSymbolDependencies[] {
	const blocks = sourceFile.getDescendantsOfKind(SyntaxKind.Block);
	const codeSymbolDependencies: CodeSymbolDependencies[] = [];
	blocks.forEach((block) => {
		const blockDependencies = parseCodeBlockForDependencies(
			block,
			blockCodeSymbolName,
			moduleName,
			workingDirectoryPath,
			project,
			sourceFile
		);
		blockDependencies.forEach((blockDependency) => {
			if (blockDependency.edges.length > 0) {
				codeSymbolDependencies.push(blockDependency);
			}
		});
	});
	return codeSymbolDependencies;
}

/*
// This is just a hack for now to not kill vscode while we try to many many
// times parse the same file to get information about the code lens.
interface ParseFileContent {
	codeSymbolInformationList: CodeSymbolInformation[];
	lastUpdatedTime: number;
}

const PARSE_FILE_CACHE: Map<string, ParseFileContent> = new Map();
*/

export function parseSourceFile(
	sourceFile: SourceFile,
	project: Project,
	directoryPath: string,
	_sourceFilePath: string,
	originalFilePath: string
): CodeSymbolInformation[] {
	if (sourceFile !== undefined) {
		const classSymbols = getClassSymbolFromFile(
			sourceFile,
			directoryPath,
			project,
			originalFilePath
		);
		// console.log(
		//     '[ts-morph]Class Symbols from ts-morph: ' +
		//     sourceFilePath +
		//     '   ' +
		//     classSymbols.length +
		//     ' ' +
		//     JSON.stringify(classSymbols)
		// );
		const functionSymbols = getFunctionSymbolFromFile(
			sourceFile,
			directoryPath,
			project,
			originalFilePath
		);
		// console.log(
		//     '[ts-morph]Function Symbols from ts-morph: ' +
		//     sourceFilePath +
		//     '   ' +
		//     functionSymbols.length +
		//     ' ' +
		//     JSON.stringify(
		//         functionSymbols.map((value) => `${value.symbolName} ${value.extraSymbolHint}`)
		//     )
		// );
		const typeAliasSymbols = getTypeAliasFromFile(
			sourceFile,
			directoryPath,
			project,
			originalFilePath
		);
		// console.log('[ts-morph]Type Alias Symbols from ts-morph: ' + sourceFilePath + '   ' + typeAliasSymbols.length + ' ' + JSON.stringify(typeAliasSymbols));
		const interfaceSymbols = getInterfaceSymbolFromFile(
			sourceFile,
			directoryPath,
			project,
			originalFilePath
		);
		return classSymbols.concat(functionSymbols).concat(typeAliasSymbols).concat(interfaceSymbols);
	} else {
		// console.log('[ts-morph]Source file is undefined: ' + sourceFilePath);
		return [];
	}
}

export async function parseFileUsingTsMorph(
	sourceFilePath: string,
	project: Project,
	directoryPath: string,
	originalFilePath: string
): Promise<CodeSymbolInformation[]> {
	// console.log('[ts-morph] Parsing file: ' + sourceFilePath);
	const sourceFile = project.getSourceFile(sourceFilePath);
	// We sync from the fs again if the file has changed meanwhile, this is not
	// important for onboarding but super important when we are doing things live
	// and on every save
	// const syncData = await sourceFile?.refreshFromFileSystem();
	await sourceFile?.refreshFromFileSystem();
	if (sourceFile) {
		const codeSymbols = parseSourceFile(sourceFile, project, directoryPath, sourceFilePath, originalFilePath);
		// console.log('[ts-morph] Code symbols: ' + codeSymbols.length);
		if (codeSymbols.length === 0) {
			return await getSymbolsFromDocumentUsingLSP(
				sourceFilePath,
				'typescript',
				directoryPath,
			);
		}
		return codeSymbols;
	} else {
		return [];
	}
}


// We can have multiple ts-configs present in the repo, we should be able to
// handle that on our own, an easy way to do that right now is to create a class
// which provides projects as required and takes care of the construction
// upon getting a file we look at the longest prefix match with the path and the
// the tsconfig to see which one we should be using for that file (simple hack
// works pretty well)
// Note: This does mean we have to keep all the projects in memory, but vscode
// is doing something on those lines too, so we are not too far away

export class TSMorphProjectManagement extends CodeSymbolsIndexer {
	public directoryToProjectMapping: Map<string, Project>;
	private fileToTSConfigDirectoryMapping: Map<string, string>;
	private _workingDirectory: string;

	constructor(workingDirectory: string) {
		super('typescript', ['ts', 'tsx', 'js', 'jsx']);
		this._workingDirectory = workingDirectory;
		this.fileToTSConfigDirectoryMapping = new Map();
		this.directoryToProjectMapping = new Map();
	}

	public addProjectWithDirectoryToMapping(
		project: Project,
		directoryPath: string,
	) {
		this.directoryToProjectMapping.set(directoryPath, project);
	}

	public addTsConfigPath(
		tsConfigPath: string,
	) {
		// console.log(`[addTsConfigPath]: ${tsConfigPath}`);
		const dirName = path.dirname(tsConfigPath);
		try {
			const tsConfigProject = new Project({
				tsConfigFilePath: tsConfigPath,
			});
			// console.log('[ts-morph-project] adding tsconfig path: ' + tsConfigPath);
			this.directoryToProjectMapping.set(dirName, tsConfigProject);
		} catch (err) {
			// console.log('[ts-morph-project] Error while creating project: ' + err);
			// console.log((err as Error).toString());
			return;
		}
	}

	// We might be comparing /a/b/c/ with /a/b/c (notice the missing '/' in one
	// of the paths)
	private checkIfDirectoryPathsAreEqual(
		firstPath: string,
		secondPath: string,
	): boolean {
		if (firstPath === secondPath) {
			return true;
		}
		if (firstPath + '/' === secondPath) {
			return true;
		}
		if (secondPath + '/' === firstPath) {
			return true;
		}
		return false;
	}

	public getTsMorphProjectForFile(
		filePath: string,
	): Project | null {
		const possibleTsConfig = this.fileToTSConfigDirectoryMapping.get(filePath);
		if (possibleTsConfig) {
			// console.log('Are we early bailing here?????', filePath);
			return this.directoryToProjectMapping.get(possibleTsConfig) ?? null;
		}
		// TODO(skcd): This will break for windows, but we don't have that
		// problem yet and if we do, we will solve it.
		const fileDirectory = path.dirname(filePath);
		const fileParts = fileDirectory.split('/');
		let filePartsLen = fileParts.length;
		while (filePartsLen > 0) {
			let pathToCheck = '';
			const filePartsToJoin: string[] = [];
			for (let index = 0; index < filePartsLen; index++) {
				filePartsToJoin.push(fileParts[index]);
			}
			pathToCheck = filePartsToJoin.join('/');
			// now we look at the keys in our map if anything matches up
			// and if it does we return the project
			for (
				const directoryPath of Array.from(this.directoryToProjectMapping.keys())
			) {
				if (
					this.checkIfDirectoryPathsAreEqual(
						directoryPath,
						pathToCheck,
					)
				) {
					this.fileToTSConfigDirectoryMapping.set(
						filePath,
						directoryPath,
					);
					// console.log('Found ts config path :' + directoryPath);
					return this.directoryToProjectMapping.get(directoryPath) ?? null;
				}
			}
			filePartsLen = filePartsLen - 1;
		}
		return null;
	}

	async parseFileWithoutDependency(filePath: string, workingDirectory: string, storeInCache: boolean): Promise<CodeSymbolInformation[]> {
		return await this.parseFileWithDependencies(filePath, workingDirectory, storeInCache);
	}

	async parseFileWithDependencies(filePath: string, workingDirectory: string, _storeInCache: boolean): Promise<CodeSymbolInformation[]> {
		const project = this.getTsMorphProjectForFile(filePath);
		if (project === null) {
			return [];
		}
		// const sourceFile = project.getSourceFile(filePath);
		const codeSymbols = await parseFileUsingTsMorph(
			filePath,
			project,
			workingDirectory,
			filePath,
		);
		return codeSymbols;
	}

	async parseFileWithContent(filePath: string, fileContents: string): Promise<CodeSymbolInformation[]> {
		const tsProject = this.getTsMorphProjectForFile(filePath);
		if (tsProject === null) {
			return [];
		}
		const dirName = path.dirname(filePath); // Get the directory name
		const extName = path.extname(filePath); // Get the extension name
		const newFileName = 'CODESTORY_RANDOM'; // Your new file name without extension
		const newFilePath = path.join(dirName, `${newFileName}${extName}`);
		const sourceFile = tsProject.createSourceFile(newFilePath, fileContents);
		const codeSymbolInformationHackedTogether = parseSourceFile(
			sourceFile,
			tsProject,
			this._workingDirectory,
			newFilePath,
			filePath
		);
		tsProject.removeSourceFile(sourceFile);
		const codeSymbolInformation = codeSymbolInformationHackedTogether.map((codeSymbol) => {
			codeSymbol.symbolName = codeSymbol.symbolName.replace(
				newFileName,
				path.basename(filePath).replace(extName, '')
			);
			codeSymbol.displayName = codeSymbol.displayName.replace(
				newFileName,
				path.basename(filePath).replace(extName, '')
			);
			return codeSymbol;
		});
		return codeSymbolInformation;
	}
}

export const checkIfFileExists = async (filePath: string): Promise<boolean> => {
	try {
		await fs.promises.stat(filePath);
		return true;
	} catch (err) {
		return false;
	}
};


export const getTsConfigFiles = async (
	activeDirectories: string[],
): Promise<string[]> => {
	const tsConfigFiles: string[] = [];
	for (let index = 0; index < activeDirectories.length; index++) {
		// I have to run this command and get all the places where we have a tsconfig
		// file and get them back
		const workingDirectory = activeDirectories[index];
		// find $(pwd) -name 'tsconfig*.json' ! -path './node_modules/*'
		const findCommandOutput = await runCommandAsync(workingDirectory, 'find', [
			workingDirectory,
			'-name',
			'tsconfig*.json',
			'!',
			'-path',
			'$(pwd)/*node_modules*',
		]);
		const findCommandOutputLines = findCommandOutput.stdout?.toString().split('\n') ?? [];
		// logger.info('[getTsConfigFiles] What did we get from find command: ' + findCommandOutputLines);
		for (const findCommandOutputLine of findCommandOutputLines) {
			if (findCommandOutputLine.trim() !== '' && findCommandOutputLine) {
				tsConfigFiles.push(findCommandOutputLine.trim());
			}
		}
	}
	return tsConfigFiles.filter((value) => value.indexOf('node_modules') === -1);
};


const checkIfTypescriptLikeFiles = (
	fileExtensionSet: Set<string>,
): boolean => {
	if (fileExtensionSet.has('.ts') || fileExtensionSet.has('.tsx') || fileExtensionSet.has('.js') || fileExtensionSet.has('.jsx')) {
		return true;
	}
	return false;
};

const isMinifiedFile = (filePath: string): boolean => {
	const fileExtension = path.extname(filePath);
	if (fileExtension === '.min.js' || fileExtension === '.min.ts') {
		return true;
	}
	return false;
};


const isDistFolder = (filePath: string): boolean => {
	const fileParts = filePath.split('/');
	const lastPart = fileParts[fileParts.length - 1];
	if (lastPart === 'dist') {
		return true;
	}
	return false;
};


export const getTypescriptLikeFilesInDirectory = (directory: string): string[] => {
	const interestedFiles: string[] = [];

	function traverse(dir: string) {
		if (isExcludedExtension(path.extname(dir))) {
			return;
		}
		const files = fs.readdirSync(dir);

		for (const file of files) {
			const filePath = path.join(dir, file);
			const stat = fs.statSync(filePath);

			// If directory, recurse. If file, extract extension.
			if (stat.isDirectory()) {
				traverse(filePath);
			} else {
				const ext = path.extname(filePath);
				if (checkIfTypescriptLikeFiles(new Set([ext])) && !isMinifiedFile(filePath) && !isDistFolder(filePath)) {
					interestedFiles.push(filePath);
				} else {
				}
			}
		}
	}

	traverse(directory);
	return interestedFiles;
};


export const getProject = async (
	activeDirectories: string[],
	fileExtensionSet: Set<string>,
	workingDirectory: string,
): Promise<TSMorphProjectManagement> => {
	const tsConfigFiles = await getTsConfigFiles(
		activeDirectories,
	);
	// console.log('[getProject] What tsconfig files exist?: ' + tsConfigFiles);
	const filteredTsConfigFiles: string[] = [];
	for (const tsConfigFile of tsConfigFiles) {
		// console.log('[getProject] checking if file exists: ' + tsConfigFile);
		const fileExists = await checkIfFileExists(tsConfigFile);
		if (fileExists) {
			filteredTsConfigFiles.push(tsConfigFile);
		}
	}

	const tsProjectManagement = new TSMorphProjectManagement(workingDirectory);

	if (filteredTsConfigFiles.length === 0 && checkIfTypescriptLikeFiles(fileExtensionSet)) {
		// Here we will create a blank project and manually add all the files which
		// are jsx or ts or js types to the project in the directory
		const interestingFiles = getTypescriptLikeFilesInDirectory(workingDirectory);
		const tsMorphProject = new Project();
		interestingFiles.forEach((filePath) => {
			// console.log('[ts-morph][add file]: ' + filePath);
			try {
				tsMorphProject.addSourceFileAtPath(filePath);
			} catch (error) {
				// console.log('[ts-morph][add file][error]: ' + error);
			}
		});
		tsProjectManagement.addProjectWithDirectoryToMapping(
			tsMorphProject,
			workingDirectory,
		);
		return tsProjectManagement;
	}
	// Now we will filter out paths which are not in the file system
	for (const filteredTsConfig of filteredTsConfigFiles) {
		tsProjectManagement.addTsConfigPath(
			filteredTsConfig,
		);
	}
	return tsProjectManagement;
};

// const project = new Project({});

// const filePath = process.argv[3];
// const directoryPath = process.argv[2];
// const outputFile = process.argv[4];
// const originalFilePath = process.argv[5];

// void (async () => {
//     console.log('We are over here....');
//     console.log(filePath);
//     console.log(directoryPath);
//     project.addSourceFileAtPath(
//         filePath,
//     );
//     const parsedOutput = parseFileUsingTsMorph(
//         filePath,
//         project,
//         directoryPath,
//         originalFilePath,
//     );
//     const output = {
//         'output': parsedOutput,
//     };
//     JSON.stringify(output);
//     fs.writeFileSync(outputFile, JSON.stringify(output));
// })();
