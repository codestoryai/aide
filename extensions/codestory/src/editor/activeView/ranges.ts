/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { ContextSelection, DeepContextForView, PreciseContext } from '../../sidecar/types';
import { createLimiter } from '../limiter';
import { getCodeSelection } from '../codeSelection';
import { RepoRef, SideCarClient } from '../../sidecar/client';

// We only go 3 levels down right now
const RECURSION_LIMIT = 2;

const limiter = createLimiter(
	// The concurrent requests limit is chosen very conservatively to avoid blocking the language
	// server.
	100,
	// If any language server API takes more than 2 seconds to answer, we should cancel the request
	5000
);

// const limiterGPTCall = createLimiter(
// 	// GPT3.5 has a very high limit so allow more connections
// 	1000,
// 	// even 2 seconds is super slow but its okay for now
// 	2000,
// );


// This is the main function which gives us context about what's present on the
// current view port of the user, this is important to get right
export const getLSPGraphContextForChat = async (workingDirectory: string, repoRef: RepoRef, threadId: string, sidecarClient: SideCarClient): Promise<DeepContextForView> => {
	const startTime = Date.now();
	const activeEditor = vscode.window.activeTextEditor;

	if (activeEditor === undefined) {
		return {
			repoRef: repoRef.getRepresentation(),
			preciseContext: [],
			cursorPosition: null,
			currentViewPort: null,
			language: 'not_present',
		};
	}

	const label = 'getLSPGraphContextForChat';
	performance.mark(label);

	const uri = vscode.Uri.file(activeEditor.document.fileName);
	// get the view port for the current open file
	// we do 2 things here, if we have the selection we should also note that
	// if we don't have any selection but just the view port we should take
	// a note of that
	const cursorPosition = activeEditor.selection;
	if (activeEditor.visibleRanges.length === 0) {
		return {
			repoRef: repoRef.getRepresentation(),
			preciseContext: [],
			cursorPosition: null,
			currentViewPort: {
				startPosition: {
					line: cursorPosition.start.line,
					character: cursorPosition.start.character,
				},
				endPosition: {
					line: cursorPosition.end.line,
					character: cursorPosition.end.character,
				},
				fsFilePath: uri.fsPath,
				relativePath: vscode.workspace.asRelativePath(uri.fsPath),
				// if there is no visible ranges on the screen, that implies
				// that there is no text on the screen (this might break tho)
				textOnScreen: '',
			},
			language: '',
		};
	}
	const viewPort = activeEditor.visibleRanges[0];
	const newViewPort = await getCodeSelection(viewPort, activeEditor.document.uri.fsPath);
	const finalRangeToUse = newViewPort;
	const currentFileText = activeEditor.document.getText().split('\n');

	// Also get the current cursor position
	// We will also send back this cursor position so we can feed this to the
	// LLM and ask it to select the relevant bits
	// If there is no selection we want to get the active view context which is
	// present on the editor
	const contexts = await getLSPContextFromSelection(
		[{
			relativePath: vscode.workspace.asRelativePath(uri.fsPath),
			fsFilePath: uri.fsPath,
			workingDirectory,
			startPosition: {
				line: finalRangeToUse.start.line,
				character: finalRangeToUse.start.character,
			},
			endPosition: {
				line: finalRangeToUse.end.line,
				character: finalRangeToUse.end.character,
			},
		}],
		// Let's try passing it without any arguments
		new Map([[uri.fsPath, activeEditor.document.getText().split('\n')]]),
		workingDirectory,
		sidecarClient,
		repoRef,
		threadId,
		RECURSION_LIMIT,
	);

	performance.mark(label);
	// The ranges here might be wrong, so we should fix it properly
	const result = {
		repoRef: repoRef.getRepresentation(),
		preciseContext: contexts,
		cursorPosition: {
			startPosition: {
				line: cursorPosition.start.line,
				character: cursorPosition.start.character,
			},
			endPosition: {
				line: cursorPosition.end.line,
				character: cursorPosition.end.character,
			},
		},
		currentViewPort: {
			startPosition: {
				line: finalRangeToUse.start.line,
				character: finalRangeToUse.start.character,
			},
			endPosition: {
				line: finalRangeToUse.end.line,
				character: finalRangeToUse.end.character,
			},
			fsFilePath: uri.fsPath,
			relativePath: vscode.workspace.asRelativePath(uri.fsPath),
			textOnScreen: currentFileText.slice(finalRangeToUse.start.line, finalRangeToUse.end.line + 1).join('\n'),
		},
		language: activeEditor.document.languageId,
	};
	const endTime = Date.now();
	console.log(`[time-taken][getLSPGraphContextForChat] time taken: ${endTime - startTime} for ${uri.fsPath} at location: ${finalRangeToUse.start.line}:${finalRangeToUse.start.character}`);
	return result;
};

const getLSPContextFromSelection = async (
	selections: ContextSelection[],
	contentMap: Map<string, string[]>,
	workingDirectory: string,
	sideCarClient: SideCarClient,
	repoRef: RepoRef,
	threadId: string,
	recursionLimit: number = RECURSION_LIMIT,
): Promise<PreciseContext[]> => {
	const startTimeGetLSPContextFromSelection = Date.now();
	const label = 'getLSPContextFromSelection';
	performance.mark(label);
	console.log('[getLSPContextFromSelection][working-directory]', workingDirectory);

	// Here we are going to do a hack and guard against references which are
	// not in the current working directory, this is to save the LSP and not
	// cause blowups from happening
	// TODO(codestory): Figure out how to properly gate this when we have documentation
	// search along with other things, it represents a way for us to go deeper
	// into a function call for a library if required
	const filteredSelections = selections.filter(selection => {
		const result = selection.fsFilePath.startsWith(workingDirectory);
		return result;
	});

	// Get the document symbols in the current file and extract their definition range
	const definitionSelections = await extractRelevantDocumentSymbolRanges(filteredSelections, workingDirectory);

	// Find the candidate identifiers to request definitions for in the selection
	const ranges = definitionSelections
		.map(({ fsFilePath, startPosition, endPosition }) =>
			new vscode.Location(
				vscode.Uri.file(fsFilePath),
				new vscode.Range(startPosition.line, startPosition.character, endPosition.line, endPosition.character)
			)
		)
		.filter(isDefined);
	const startTimeRequestCandidates = Date.now();
	const requestCandidates = await gatherDefinitionRequestCandidates(ranges, contentMap, repoRef, threadId, sideCarClient);
	console.log(`[time-taken][getLSPContextFromSelection][request-candidates] time taken: ${Date.now() - startTimeRequestCandidates} for ${ranges.length} ranges`);

	// Extract identifiers from the relevant document symbol ranges and request their definitions
	const startTimeDefinitionMatches = Date.now();
	const definitionMatches = await gatherDefinitions(definitionSelections, requestCandidates);
	console.log(`[time-taken][getLSPContextFromSelection][definition-matches] time taken: ${Date.now() - startTimeDefinitionMatches} for ${definitionSelections.length} ranges`);

	// NOTE: Before asking for data about a document it must be opened in the workspace. This forces
	// a resolution so that the following queries that require the document context will not fail with
	// an unknown document.
	await updateContentMap(
		contentMap,
		definitionMatches.map(({ definitionLocations }) => definitionLocations.map(({ uri }) => uri)).flat()
	);

	// Resolve, extract, and deduplicate the symbol and location match pairs from the definition matches
	const matches = dedupeWith(
		definitionMatches
			.map(({ definitionLocations, ...rest }) =>
				definitionLocations.map(location => ({ location, ...rest }))
			)
			.flat(),
		({ symbolName, location }) => `${symbolName}:${locationKeyFn(location)}`
	);

	// TODO - see if we can remove fields of types we've also captured?

	// Extract definition text from our matches
	const startTimeDefinitionContexts = Date.now();
	const contexts = await extractDefinitionContexts(matches, contentMap, workingDirectory);
	console.log(`[time-taken][getLSPContextFromSelection][definition-contexts] time taken: ${Date.now() - startTimeDefinitionContexts} for ${matches.length} matches`);
	// performance.mark(label);

	if (recursionLimit > 0) {
		contexts.push(
			...(await getLSPContextFromSelection(
				contexts.map(c => ({
					workingDirectory: workingDirectory,
					relativePath: vscode.workspace.asRelativePath(c.fsFilePath),
					fsFilePath: c.fsFilePath,
					startPosition: {
						line: c.range.startLine,
						character: c.range.startCharacter,
					},
					uri: vscode.Uri.file(c.fsFilePath),
					endPosition: {
						line: c.range.endLine,
						character: c.range.endCharacter,
					},
				})),
				contentMap,
				workingDirectory,
				sideCarClient,
				repoRef,
				threadId,
				recursionLimit - 1,
			))
		);
	}
	console.log(`[time-taken][getLSPContextFromSelection][total-time] time taken: ${Date.now() - startTimeGetLSPContextFromSelection} for ${selections.length} selections`);
	return contexts;
};


export const extractDefinitionContexts = async (
	matches: { symbolName: string; hover: vscode.Hover[]; location: vscode.Location }[],
	contentMap: Map<string, string[]>,
	workingDirectory: string,
	getDocumentSymbolRanges: typeof defaultGetDocumentSymbolRanges = defaultGetDocumentSymbolRanges
): Promise<PreciseContext[]> => {
	// Retrieve document symbols for each of the open documents, which we will use to extract the relevant
	// definition "bounds" given the range of the definition symbol (which is contained within the range).
	const documentSymbolsMap = new Map(
		[...contentMap.keys()]
			.filter(fsPath => matches.some(({ location }) => location.uri.fsPath === fsPath))
			// Here for getting the definitions we only want to get them for the
			// files which are part of the working directory and not for each
			// and every symbol
			.map(fsPath => [fsPath, getDocumentSymbolRanges(vscode.Uri.file(fsPath), {
				workingDirectory,
				extractOnlyInWorkingDirectory: true,
			})])
	);

	// NOTE: In order to make sure the loop below is unblocked we'll also force resolve the entirety
	// of the folding range requests. That way we don't have a situation where the first iteration of
	// the loop is waiting on the last promise to be resolved in the set.
	console.log('[extractDefinitionContexts] resolving all document symbols');
	console.log([...documentSymbolsMap.keys()]);
	const startTime = Date.now();
	await Promise.all([...documentSymbolsMap.values()]);
	console.log(`[time-taken][extractDefinitionContexts][resolve-all-document-symbols] time taken: ${Date.now() - startTime} for ${documentSymbolsMap.size} files`);

	// Piece everything together. For each matching definition, extract the relevant lines given the
	// containing document's content and folding range result. Downstream consumers of this function
	// are expected to filter and re-rank these results as needed for their specific use case.

	const startTimePreciseContext = Date.now();
	const contexts: PreciseContext[] = [];
	for (const { symbolName, hover, location } of matches) {
		const { uri, range } = location;
		const contentPromise = contentMap.get(uri.fsPath);
		const documentSymbolsPromises = documentSymbolsMap.get(uri.fsPath);

		if (contentPromise && documentSymbolsPromises) {
			const content = contentPromise;
			const documentSymbols = await documentSymbolsPromises; // NOTE: already resolved

			const definitionSnippets = extractSnippets(content, documentSymbols, [range]);

			for (const definitionSnippet of definitionSnippets) {
				contexts.push({
					symbol: {
						fuzzyName: symbolName,
					},
					fsFilePath: uri.fsPath,
					relativeFilePath: vscode.workspace.asRelativePath(uri.fsPath),
					range: {
						startLine: range.start.line,
						startCharacter: range.start.character,
						endLine: range.end.line,
						endCharacter: range.end.character,
					},
					hoverText: hover.flatMap(h => h.contents.map(c => (typeof c === 'string' ? c : c.value))),
					definitionSnippet,
				});
			}
		}
	}
	console.log(`[time-taken][extractDefinitionContexts][precise-context] time taken: ${Date.now() - startTimePreciseContext} for ${matches.length} matches`);

	return contexts;
};

const extractSnippets = (lines: string[], symbolRanges: vscode.Range[], targetRanges: vscode.Range[]): {
	context: string;
	startLine: number;
	endLine: number;
}[] => {
	const intersectingRanges = symbolRanges.filter(symbolRange =>
		targetRanges.some(targetRange => symbolRange.start.line <= targetRange.start.line && targetRange.end.line <= symbolRange.end.line)
	);

	// NOTE: inclusive upper bound
	return intersectingRanges.map(fr => {
		return {
			context: lines.slice(fr.start.line, fr.end.line + 1).join('\n'),
			startLine: fr.start.line,
			endLine: fr.end.line,
		};
	});
};

export const locationKeyFn = (location: vscode.Location): string =>
	`${location.uri?.fsPath}?L${location.range.start.line}:${location.range.start.character}`;

const updateContentMap = async (contentMap: Map<string, string[]>, locations: vscode.Uri[]): Promise<void> => {
	const unseenDefinitionUris = dedupeWith(locations, 'fsPath').filter(uri => !contentMap.has(uri.fsPath));

	// Remove ultra-common type definitions that are probably already known by the LLM
	const filteredUnseenDefinitionUris = unseenDefinitionUris.filter(uri => !isCommonImport(uri));

	const startTime = Date.now();
	const newContentMap = new Map(
		filteredUnseenDefinitionUris.map(uri => [
			uri.fsPath,
			vscode.workspace.openTextDocument(uri.fsPath).then(document => document.getText().split('\n')),
		])
	);
	const endTime = Date.now();
	console.log(`[time-taken][updateContentMap] time taken: ${endTime - startTime} for ${unseenDefinitionUris.length} files`);

	for (const [fsPath, lines] of await unwrapThenableMap(newContentMap)) {
		contentMap.set(fsPath, lines);
	}
};


const commonImportPaths = new Set([
	// ts common imports
	'node_modules/typescript/lib',
	'node_modules/@types/node',
	'node_modules/csstype',
	'node_modules/@types/prop-types',
	'node_modules/@types/react/',
	'node_modules/next/',

	// go common imports
	'libexec/src/',

	// python common imports
	'lib/python3.',
	'stdlib/builtins.pyi',
]);

export function isCommonImport(uri: vscode.Uri): boolean {
	for (const importPath of commonImportPaths) {
		if (uri.fsPath.includes(importPath)) {
			return true;
		}
	}
	return false;
}

const extractLocation = (l: vscode.Location | vscode.LocationLink): vscode.Location =>
	isLocationLink(l) ? new vscode.Location(l.targetUri, l.targetRange) : l;

const isLocationLink = (l: vscode.Location | vscode.LocationLink): l is vscode.LocationLink =>
	(l as vscode.LocationLink).targetUri !== undefined;

const defaultGetHover = async (uri: vscode.Uri, position: vscode.Position): Promise<vscode.Hover[]> => {
	const startTime = Date.now();
	const results = vscode.commands.executeCommand<vscode.Hover[]>('vscode.executeHoverProvider', uri, position);
	const endTime = Date.now();
	console.log(`[time-taken][getHover] time taken: ${endTime - startTime} for ${uri.fsPath} at location: ${position.line}:${position.character}`);
	return results;
};

const defaultGetDefinitions = async (uri: vscode.Uri, position: vscode.Position): Promise<vscode.Location[]> => {
	const startTime = Date.now();
	const results = vscode.commands
		.executeCommand<(vscode.Location | vscode.LocationLink)[]>('vscode.executeDefinitionProvider', uri, position)
		.then(locations => locations.flatMap(extractLocation));
	const endTime = Date.now();
	console.log(`[time-taken][getDefinitions] time taken: ${endTime - startTime} for ${uri.fsPath} at location: ${position.line}:${position.character}`);
	return results;
};

const defaultGetImplementations = async (uri: vscode.Uri, position: vscode.Position): Promise<vscode.Location[]> =>
	vscode.commands
		.executeCommand<(vscode.Location | vscode.LocationLink)[]>(
			'vscode.executeImplementationProvider',
			uri,
			position
		)
		.then(locations => locations.flatMap(extractLocation));

const defaultGetTypeDefinitions = async (uri: vscode.Uri, position: vscode.Position): Promise<vscode.Location[]> =>
	vscode.commands
		.executeCommand<(vscode.Location | vscode.LocationLink)[]>(
			'vscode.executeTypeDefinitionProvider',
			uri,
			position
		)
		.then(locations => locations.flatMap(extractLocation))
		// Type definitions are not always well-defined for things like functions. In these cases
		// we'd like to fall back to a regular definition result which gives us the same class and
		// quality of information.
		.then(locations => (locations.length > 0 ? locations : defaultGetDefinitions(uri, position)));


interface LSPSymbolDefinitionMatches {
	symbolName: string;
	hover: vscode.Hover[];
	definitionLocations: vscode.Location[];
	// typeDefinitionLocations: vscode.Location[];
	// implementationLocations: vscode.Location[];
}

interface AwaitableLSPSymbolDefinitionMatches {
	symbolName: string;
	hover: Thenable<vscode.Hover[]>;
	definitionLocations: Thenable<vscode.Location[]>;
	// typeDefinitionLocations: Thenable<vscode.Location[]>;
	// implementationLocations: Thenable<vscode.Location[]>;
}

export const gatherDefinitions = async (
	selections: ContextSelection[],
	requests: LSPSymbolsRequest[],
	getHover: typeof defaultGetHover = defaultGetHover,
	getDefinitions: typeof defaultGetDefinitions = defaultGetDefinitions,
	_getTypeDefinitions: typeof defaultGetTypeDefinitions = defaultGetTypeDefinitions,
	_getImplementations: typeof defaultGetImplementations = defaultGetImplementations
): Promise<LSPSymbolDefinitionMatches[]> => {
	// Construct a list of symbol and definition location pairs by querying the LSP server with all
	// identifiers (heuristically chosen via regex) in the relevant code ranges.
	const definitionMatches: AwaitableLSPSymbolDefinitionMatches[] = [];

	// NOTE: deduplicating here will save duplicate queries that are _likely_ to point to the same
	// definition, but we may be culling aggressively here for some edge cases. I don't currently
	// think that these are likely to be make-or-break a quality response on any significant segment
	// of real world questions, though.
	for (const { symbolName, uri, position } of dedupeWith(requests, 'symbolName')) {
		definitionMatches.push({
			symbolName,
			hover: limiter(() => getHover(uri, position)),
			definitionLocations: limiter(() => getDefinitions(uri, position)),
			// typeDefinitionLocations: limiter(() => getTypeDefinitions(uri, position)),
			// implementationLocations: limiter(() => getImplementations(uri, position)),
		});
	}

	// Await in parallel, as its faster than doing it one by one
	const resolvedDefinitionMatches = await Promise.all(
		definitionMatches.map(
			async ({ symbolName, hover, definitionLocations }) => {
				let hoverValue: vscode.Hover[] = [];
				try {
					hoverValue = await hover;
				} catch {
					console.error('hover value generation failed');
				}
				let definitionLocationValues: vscode.Location[] = [];
				try {
					definitionLocationValues = await definitionLocations;
				} catch {
					console.error('definition location values failed');
				}
				return ({
					symbolName,
					hover: hoverValue,
					definitionLocations: definitionLocationValues,
				});
			}
		)
	);

	return (
		resolvedDefinitionMatches
			// Remove definition ranges that exist within one of the input definition selections
			// These are locals and don't give us any additional information in the context window.
			.map(({ definitionLocations, ...rest }) => ({
				definitionLocations: definitionLocations.filter(
					({ uri, range }) =>
						!selections.some(
							({ fsFilePath, startPosition, endPosition }) =>
								uri.fsPath === fsFilePath &&
								(startPosition === undefined ||
									(startPosition.line <= range.start.line &&
										range.end.line <= endPosition.line))
						)
				),
				...rest,
			}))
			// Remove empty locations
			.filter(
				({ definitionLocations }) =>
					definitionLocations.length !== 0
			)
	);
};

export const IDENTIFIER_PATTERN = /[$A-Z_a-z][\w$]*/g;

const goKeywords = new Set([
	'break',
	'case',
	'chan',
	'const',
	'continue',
	'default',
	'defer',
	'else',
	'fallthrough',
	'for',
	'func',
	'go',
	'goto',
	'if',
	'import',
	'interface',
	'map',
	'package',
	'range',
	'return',
	'select',
	'struct',
	'switch',
	'type',
	'var',

	// common variables , types we don't need to follow
	'Context',
	'ctx',
	'err',
	'error',
	'ok',
]);

const typescriptKeywords = new Set([
	'any',
	'as',
	'async',
	'boolean',
	'break',
	'case',
	'catch',
	'class',
	'const',
	'constructor',
	'continue',
	'debugger',
	'declare',
	'default',
	'delete',
	'do',
	'else',
	'enum',
	'export',
	'extends',
	'false',
	'finally',
	'for',
	'from',
	'function',
	'if',
	'implements',
	'import',
	'in',
	'instanceof',
	'interface',
	'let',
	'module',
	'new',
	'null',
	'number',
	'of',
	'package',
	'private',
	'protected',
	'public',
	'require',
	'return',
	'static',
	'string',
	'super',
	'switch',
	'symbol',
	'this',
	'throw',
	'true',
	'try',
	'type',
	'typeof',
	'var',
	'void',
	'while',
	'with',
	'yield',
]);

const pythonKeywords = new Set([
	'and',
	'as',
	'assert',
	'async',
	'await',
	'break',
	'class',
	'continue',
	'def',
	'del',
	'elif',
	'else',
	'except',
	'False',
	'finally',
	'for',
	'from',
	'global',
	'if',
	'import',
	'in',
	'is',
	'lambda',
	'None',
	'nonlocal',
	'not',
	'or',
	'pass',
	'raise',
	'return',
	'True',
	'try',
	'while',
	'with',
	'yield',
]);

const rustKeywords = new Set([
	'as',          // Type casting
	'break',       // Loop control
	'const',       // Constant items and constant raw pointers
	'continue',    // Loop control
	'crate',       // External crate linkage or a macro variable representing the crate in which the macro is defined
	'dyn',         // Dynamic dispatch to a trait object
	'else',        // Conditional branches
	'enum',        // Enumerated type definition
	'extern',      // External linkage
	'false',       // Boolean false
	'fn',          // Function definition or lambda
	'for',         // Looping with an iterator or a range
	'if',          // Conditional branches
	'impl',        // Inherent implementations or trait implementations
	'in',          // Part of for loops
	'let',         // Variable binding
	'loop',        // Infinite looping
	'match',       // Pattern matching
	'mod',         // Module declaration or definition
	'move',        // Makes a closure take ownership of all its captures
	'mut',         // Denotes mutability in references, raw pointers, and pattern bindings
	'pub',         // Denotes public visibility in module structures
	'ref',         // Binding by reference in patterns
	'return',      // Return values from functions
	'Self',        // A type alias for the type being defined or implemented
	'self',        // A method's first parameter or within a let, pattern, or argument list, synonymous with &self or &mut self
	'static',      // Global variable or lifetime lasting the entire program execution
	'struct',      // Structure definition
	'super',       // Refers to the parent module
	'trait',       // Trait definition
	'true',        // Boolean true
	'type',        // Type aliasing or associated type
	'unsafe',      // Denotes unsafe code or functions
	'use',         // Import or rename items into scope
	'where',       // Trait bounds on generic type parameters
	'while',       // Conditional looping

	// Reserved for future use (these might not be in stable Rust yet but are reserved for future use):
	'abstract',
	'async',       // In Rust 1.39+, used for async functions and blocks
	'await',       // In Rust 1.39+, used in async functions and blocks
	'become',
	'box',
	'do',
	'final',
	'macro',
	'override',
	'priv',
	'try',
	'typeof',
	'unsized',
	'virtual',
	'yield',
	'Vec',
	'HashMap',
	'HashSet',
	'format!',
	'str',
	'String',
	'try_into',
	'expect',
	'collect',
	'join',
	'push',
]);

export const commonKeywords = new Set([...goKeywords, ...typescriptKeywords, ...pythonKeywords, ...rustKeywords]);

interface LSPSymbolsRequest {
	symbolName: string;
	uri: vscode.Uri;
	position: vscode.Position;
}

export const gatherDefinitionRequestCandidates = async (
	locations: vscode.Location[],
	contentMap: Map<string, string[]>,
	_repoRef: RepoRef,
	_threadId: string,
	_sideCarClient: SideCarClient,
): Promise<LSPSymbolsRequest[]> => {
	const requestCandidates: LSPSymbolsRequest[] = [];

	for (const { uri, range } of locations) {
		const lines = contentMap.get(uri.fsPath);
		if (!range || !lines) {
			continue;
		}
		for (const { start, end } of [range]) {
			// const lineContent = lines.slice(start.line, end.line + 1).join('\n');
			// const language = identifyLanguage(uri.fsPath) ?? 'not_present';
			// We set this in a limier so we don't create too many requests
			// and add a tight timeout to the llm call
			let symbolsToPayAttentionTo: string[] = [];
			try {
				symbolsToPayAttentionTo = [];
				// symbolsToPayAttentionTo = await limiterGPTCall(() => sideCarClient.getSymbolsForGoToDefinition(lineContent, repoRef, threadId, language));
			} catch (err) {
				symbolsToPayAttentionTo = [];
			}
			for (const [lineIndex, line] of lines.slice(start.line, end.line + 1).entries()) {
				// NOTE: pretty hacky - strip out C-style line comments and find everything that
				// might look like it could be an identifier. If we end up running a VSCode provider
				// over this cursor position and it's not a symbol we can use, we'll just get back
				// an empty location list.
				const identifierMatches = line.replace(/\/\/.*$/, '').matchAll(IDENTIFIER_PATTERN);

				for (const match of identifierMatches) {
					if (match.index === undefined || commonKeywords.has(match[0])) {
						continue;
					}
					// If the symbol does not match the one we need to pay attention to, we skip it, this saves
					// some LSP calls which is what we need anyways
					if (symbolsToPayAttentionTo.length !== 0 && !symbolsToPayAttentionTo.includes(match[0])) {
						continue;
					}

					requestCandidates.push({
						symbolName: match[0],
						uri,
						position: new vscode.Position(start.line + lineIndex, match.index + 1),
					});
				}
			}
		}
	}

	return requestCandidates;
};

export const extractRelevantDocumentSymbolRanges = async (
	selections: ContextSelection[],
	workingDirectory: string,
): Promise<ContextSelection[]> => {
	const startTime = Date.now();
	const rangeMap = await unwrapThenableMap(
		new Map(
			dedupeWith(
				selections.map((selection) => selection),
				'fsFilePath'
			).map(selectionContext => {
				return [selectionContext.fsFilePath, defaultGetDocumentSymbolRanges(vscode.Uri.file(selectionContext.fsFilePath), {
					workingDirectory,
					extractOnlyInWorkingDirectory: false,
				})];
			})
		)
	);
	const endTime = Date.now();
	console.log('[time-taken][extractRelevantDocumentSymbolRanges] time taken: ' + (endTime - startTime) + ' for ' + selections.length + ' selections');

	const pathsByUri = new Map<string, (ContextSelection | undefined)[]>();
	for (const selection of selections) {
		pathsByUri.set(selection.fsFilePath, [...(pathsByUri.get(selection.fsFilePath) ?? []), selection]);
	}

	const combinedRanges: ContextSelection[] = [];
	for (const [fsPath, ranges] of pathsByUri.entries()) {
		const documentSymbolRanges = rangeMap.get(fsPath);
		if (!documentSymbolRanges) {
			continue;
		}

		// Filter the document symbol ranges to just those whose range intersects the selection.
		// If no selection exists (if we have an undefined in the ranges list), keep all symbols,
		// we'll utilize all document symbol ranges.
		const definedRanges = ranges.filter(isDefined);
		combinedRanges.push(
			...(definedRanges.length < ranges.length ? documentSymbolRanges.map(range => {
				return {
					relativePath: vscode.workspace.asRelativePath(fsPath),
					fsFilePath: fsPath,
					workingDirectory,
					startPosition: range.start,
					endPosition: range.end,
					uri: vscode.Uri.file(fsPath),
				};
			}) : documentSymbolRanges.filter(range => {
				const result = definedRanges.some(selectionRanges => range.start.line <= selectionRanges.endPosition.line && selectionRanges.startPosition.line <= range.end.line);
				return result;
			}).map(range => {
				return {
					relativePath: vscode.workspace.asRelativePath(fsPath),
					fsFilePath: fsPath,
					workingDirectory,
					startPosition: range.start,
					endPosition: range.end,
					uri: vscode.Uri.file(fsPath),
				};
			}))
		);
	}

	return combinedRanges;
};


export const dedupeWith = <T>(items: T[], key: keyof T | ((item: T) => string)): T[] => [
	...new Map(items.map(item => [typeof key === 'function' ? key(item) : item[key], item])).values(),
];

export const isDefined = <T>(value: T): value is NonNullable<T> => value !== undefined && value !== null;

const unwrapThenableMap = async <K, V>(map: Map<K, Thenable<V>>): Promise<Map<K, V>> => {
	const resolved = new Map<K, V>();
	for (const [k, v] of map) {
		const result = await v;
		resolved.set(k, result);
	}
	return resolved;
};

interface ExtractOnlyInWorkingDirectory {
	workingDirectory: string;
	extractOnlyInWorkingDirectory: boolean;
}

export const defaultGetDocumentSymbolRanges = async (uri: vscode.Uri, extractionMode: ExtractOnlyInWorkingDirectory): Promise<vscode.Range[]> => {
	if (extractionMode.extractOnlyInWorkingDirectory && !uri.fsPath.startsWith(extractionMode.workingDirectory)) {
		console.log(`[defaultGetDocumentSymbolRanges] skipping file: ${uri.fsPath} as it is not in the working directory: ${extractionMode.workingDirectory}`);
		return [];
	}
	const startTime = Date.now();
	const results = vscode.commands
		.executeCommand<(vscode.SymbolInformation | vscode.DocumentSymbol)[] | undefined>(
			'vscode.executeDocumentSymbolProvider',
			uri
		)
		.then(result => {
			if (!result) {
				return [];
			}
			const newResults = result.map(extractSymbolRange);
			return newResults;
		}, _reason => {
			return [];
		});
	const endTime = Date.now();
	console.log(`[time-taken][defaultGetDocumentSymbolRanges] time taken: ${endTime - startTime} for ${uri.fsPath}`);
	return await results;
};

const extractSymbolRange = (d: vscode.SymbolInformation | vscode.DocumentSymbol): vscode.Range =>
	isDocumentSymbol(d) ? d.range : d.location.range;

const isDocumentSymbol = (s: vscode.SymbolInformation | vscode.DocumentSymbol): s is vscode.DocumentSymbol =>
	(s as vscode.DocumentSymbol).range !== undefined;


/*
function identifyLanguage(fileName: string): string | null {
	// Define a mapping from file extensions to languages
	const extensionToLanguage: { [key: string]: string } = {
		'.py': 'Python',
		'.java': 'Java',
		'.html': 'HTML',
		'.js': 'JavaScript',
		'.ts': 'TypeScript',
		'.cs': 'C#',
		'.cpp': 'C++',
		'.c': 'C',
		'.rb': 'Ruby',
		'.php': 'PHP',
		'.tsx': 'typescript',
		'.jsx': 'javascript',
		'.rs': 'rust',
	};

	// Extract the extension from the fileName
	const extension = path.extname(fileName);

	// Look up the extension in the dictionary and return the result, if found
	if (extension in extensionToLanguage) {
		return extensionToLanguage[extension];
	} else {
		return null; // or some default value, or throw an error, depending on your needs
	}
}
*/
