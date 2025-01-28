/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'path';
import Parser from 'web-tree-sitter';

let TS_PARSER: Parser | null = null;

/**
 * Initialize the Tree-sitter parser for TypeScript/TSX.
 * Adjust the .wasm file path as noted in the docstring below.
 */
export async function initTypescriptParser(): Promise<Parser> {
	if (TS_PARSER) {
		return TS_PARSER;
	}
	await Parser.init();
	const parser = new Parser();
	// Point this path at your tree-sitter-typescript.wasm file.
	const tsWasmPath = path.resolve(__dirname, 'tree-sitter-typescript.wasm');
	const tsLang = await Parser.Language.load(tsWasmPath);

	parser.setLanguage(tsLang);
	TS_PARSER = parser;
	return TS_PARSER;
}
