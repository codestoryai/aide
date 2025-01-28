/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { LRUCache } from 'lru-cache';
import path from 'path';
import * as vscode from 'vscode';
import type { default as Parser, Tree } from 'web-tree-sitter';
const ParserImpl = require('web-tree-sitter') as typeof Parser;

const PARSERS_LOCAL_CACHE: Partial<Record<SupportedLanguage, Parser>> = {};


enum SupportedLanguage {
	JavaScript = 'javascript',
	JSX = 'javascriptreact',
	TypeScript = 'typescript',
	TSX = 'typescriptreact',
	Go = 'go',
	Python = 'python',
	Rust = 'rust',
}

const SUPPORTED_LANGUAGES: Record<SupportedLanguage, string> = {
	[SupportedLanguage.JavaScript]: 'tree-sitter-javascript.wasm',
	[SupportedLanguage.JSX]: 'tree-sitter-javascript.wasm',
	[SupportedLanguage.TypeScript]: 'tree-sitter-typescript.wasm',
	[SupportedLanguage.TSX]: 'tree-sitter-tsx.wasm',
	[SupportedLanguage.Go]: 'tree-sitter-go.wasm',
	[SupportedLanguage.Python]: 'tree-sitter-python.wasm',
	[SupportedLanguage.Rust]: 'tree-sitter-rust.wasm',
};

export function getParser(language: SupportedLanguage): Parser | undefined {
	return PARSERS_LOCAL_CACHE[language];
}

const getParseLanguage = (languageId: string): SupportedLanguage | null => {
	const matchedLang = Object.entries(SupportedLanguage).find(
		([_key, value]) => value === (languageId as SupportedLanguage)
	);
	// console.log('sidecar.tree-sitter.parse-tree-cache.check-language', languageId, matchedLang);

	return matchedLang ? (languageId as SupportedLanguage) : null;
};

async function isRegularFile(uri: vscode.Uri): Promise<boolean> {
	try {
		const stat = await vscode.workspace.fs.stat(uri);
		return stat.type === vscode.FileType.File;
	} catch {
		return false;
	}
}

export async function createParser(language: SupportedLanguage): Promise<Parser | undefined> {
	const cachedParser = PARSERS_LOCAL_CACHE[language];

	if (cachedParser) {
		return cachedParser;
	}

	const wasmPath = path.resolve('./extensions/codestory/src/completions/text-processing/treeSitter/wasm', SUPPORTED_LANGUAGES[language]);
	if (!(await isRegularFile(vscode.Uri.file(wasmPath)))) {
		// console.log('sidecar.tree-sitter.parse-tree-cache.missing-wasm', wasmPath, 'for', language);
		return undefined;
	}

	await ParserImpl.init();
	const parser = new ParserImpl();

	const languageGrammar = await ParserImpl.Language.load(wasmPath);

	parser.setLanguage(languageGrammar);
	PARSERS_LOCAL_CACHE[language] = parser;

	return parser;
}

const parseTreesPerFile = new LRUCache<string, Tree>({
	max: 10,
});

interface ParseTreeCache {
	tree: Tree;
	parser: Parser;
	cacheKey: string;
}

export function getCachedParseTreeForDocument(document: vscode.TextDocument): ParseTreeCache | null {
	const parseLanguage = getLanguageIfTreeSitterEnabled(document);

	if (!parseLanguage) {
		// console.log('sidecar.tree-sitter.parse-tree-cache.miss', document.uri.toString());
		return null;
	}

	const parser = getParser(parseLanguage);
	const cacheKey = document.uri.toString();
	const tree = parseTreesPerFile.get(cacheKey);

	if (!tree || !parser) {
		return null;
	}

	// console.log('sidecar.tree-sitter.parse-tree-cache.hit', cacheKey);

	return { tree, parser, cacheKey };
}

async function parseDocument(document: vscode.TextDocument): Promise<void> {
	const parseLanguage = getLanguageIfTreeSitterEnabled(document);

	if (!parseLanguage) {
		// console.log('sidecar.tree-sitter.parse_document.not_present_language', document.uri.toString());
		return;
	}

	const parser = await createParser(parseLanguage);
	if (!parser) {
		// console.log('sidecar.tree-sitter.parse_document.missing_parser', document.uri.toString());
		return;
	}

	// console.log('sidecar.tree-sitter.parse_document.parse', document.uri.toString());

	updateParseTreeCache(document, parser);
}

export function updateParseTreeCache(document: vscode.TextDocument, parser: Parser): void {
	const tree = parser.parse(document.getText());
	parseTreesPerFile.set(document.uri.toString(), tree);
}

function getLanguageIfTreeSitterEnabled(document: vscode.TextDocument): SupportedLanguage | null {
	const parseLanguage = getParseLanguage(document.languageId);

	/**
	 * 1. Do not use tree-sitter for unsupported languages.
	 * 2. Do not use tree-sitter for files with more than N lines to avoid performance issues.
	 *    - https://github.com/tree-sitter/tree-sitter/issues/2144
	 *    - https://github.com/neovim/neovim/issues/22426
	 *
	 *    Needs more testing to figure out if we need it. Playing it safe for the initial integration.
	 */
	if (document.lineCount <= 10_000 && parseLanguage) {
		return parseLanguage;
	}

	return null;
}

export function updateParseTreeOnEdit(edit: vscode.TextDocumentChangeEvent): void {
	const { document, contentChanges } = edit;
	if (contentChanges.length === 0) {
		return;
	}

	const cache = getCachedParseTreeForDocument(document);
	if (!cache) {
		return;
	}

	const { tree, parser, cacheKey } = cache;

	for (const change of contentChanges) {
		// start index here is from the older range which is provided
		// as rangeOffset
		const startIndex = change.rangeOffset;
		// old end index here is provided by the rangeLength (which we can
		// also derive from the original range which is edited)
		const oldEndIndex = change.rangeOffset + change.rangeLength;
		// the new end index is legit taken as the range offset from the start
		// and we add the length of the text being inserted
		const newEndIndex = change.rangeOffset + change.text.length;
		const startPosition = document.positionAt(startIndex);
		const oldEndPosition = document.positionAt(oldEndIndex);
		const newEndPosition = document.positionAt(newEndIndex);
		const startPoint = asPoint(startPosition);
		const oldEndPoint = asPoint(oldEndPosition);
		const newEndPoint = asPoint(newEndPosition);

		tree.edit({
			startIndex,
			oldEndIndex,
			newEndIndex,
			startPosition: startPoint,
			oldEndPosition: oldEndPoint,
			newEndPosition: newEndPoint,
		});
	}

	const updatedTree = parser.parse(document.getText(), tree);
	parseTreesPerFile.set(cacheKey, updatedTree);
}

export function asPoint(position: Pick<vscode.Position, 'line' | 'character'>): Parser.Point {
	return { row: position.line, column: position.character };
}

export function parseAllVisibleDocuments(): void {
	for (const editor of vscode.window.visibleTextEditors) {
		// console.log('sidecar.parse_all_visialbe_documents', editor.document.uri.toString());
		void parseDocument(editor.document);
	}
}
