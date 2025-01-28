/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'path';
import Parser from 'web-tree-sitter';

let TSX_PARSER: Parser | null = null;

export async function initTsxParser(): Promise<void> {
	if (TSX_PARSER) {
		return;
	}
	await Parser.init();
	const parser = new Parser();

	// Point this path at your tree-sitter-tsx.wasm file.
	// For example, if you placed it in your `out` or `dist` folder, you can do:
	const tsxWasmPath = path.join(__dirname, 'tree-sitter-tsx.wasm');

	const tsxLang = await Parser.Language.load(tsxWasmPath);
	parser.setLanguage(tsxLang);
	TSX_PARSER = parser;
}


export interface TsxNodeInfo {
	type: string;
	startLine: number;
	startColumn: number;
	endLine: number;
	endColumn: number;
	text: string;
}

/**
 * Parse JSX/TSX text, then recursively look for the node
 * whose startPosition.row == lineNumber. Adjust logic
 * as needed (e.g., to find the node enclosing lineNumber).
 */
export async function findTsxNodeAtLine(
	fileContent: string,
	lineNumber: number
): Promise<TsxNodeInfo | null> {
	await initTsxParser();
	if (!TSX_PARSER) {
		return null;
	}

	// Parse the code
	const tree = TSX_PARSER.parse(fileContent);
	const rootNode = tree.rootNode;

	// DFS to locate a node that begins exactly at lineNumber
	function traverse(node: Parser.SyntaxNode): TsxNodeInfo | null {
		if (node.startPosition.row === lineNumber) {
			// Return whatever info you need from the node
			return {
				type: node.type,
				startLine: node.startPosition.row,
				startColumn: node.startPosition.column,
				endLine: node.endPosition.row,
				endColumn: node.endPosition.column,
				text: node.text,
			};
		}
		for (const child of node.children || []) {
			const match = traverse(child);
			if (match) {
				return match;
			}
		}
		return null;
	}

	return traverse(rootNode);
}
