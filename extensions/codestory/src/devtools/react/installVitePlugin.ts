/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import Parser from 'web-tree-sitter';
import { initTypescriptParser } from '../../languages/typescriptCodeSymbols';

/**
 * A simple interface to track text insertions or replacements.
 */
interface Edit {
	startIndex: number;
	endIndex: number; // For pure insertion, endIndex === startIndex
	text: string;
}

/**
 * Apply a list of edits to the original source code.
 * Edits should be sorted in descending order by startIndex
 * so we do not have to re-calculate offsets after each insertion.
 */
function applyEdits(source: string, edits: Edit[]): string {
	let result = source;
	// Process from largest startIndex to smallest
	for (const edit of edits.sort((a, b) => b.startIndex - a.startIndex)) {
		const before = result.slice(0, edit.startIndex);
		const after = result.slice(edit.endIndex);
		result = before + edit.text + after;
	}
	return result;
}


const NAMED_IMPORT = 'componentTagger';
export const PACKAGE_NAME = '@codestoryai/component-tagger';

export enum PackageManager {
	npm = 'npm',
	pnpm = 'pnpm',
	yarn = 'yarn',
	bun = 'bun'
}

export type PackageManagerType = `${PackageManager}`;

export const installCommandMap = new Map<PackageManagerType, string>();
installCommandMap.set(PackageManager.npm, `npm install ${PACKAGE_NAME} --save-dev`);
installCommandMap.set(PackageManager.pnpm, `pnpm add --save-dev ${PACKAGE_NAME}`);
installCommandMap.set(PackageManager.yarn, `yarn add ${PACKAGE_NAME} --dev`);
installCommandMap.set(PackageManager.bun, `bun add --dev ${PACKAGE_NAME}`);

/**
 * Quickly detect if the file is (mostly) ESM or CJS by scanning for import declarations.
 * This is a naive approach-your mileage may vary.
 */
function isLikelyESM(rootNode: Parser.SyntaxNode): { isESM: boolean; usesDoubleQuotes: boolean } {
	let isESM = false;
	let usesDoubleQuotes = false;

	const stack = [rootNode];
	while (stack.length > 0) {
		const node = stack.shift()!;

		// If we see an import_statement, consider this ESM.
		if (node.type === 'import_statement') {
			isESM = true;

			// Often the source is a child with type "string".
			// For example, import something from "module-name"
			// Check if the text starts with " rather than '.
			const sourceChild = node.children?.find(child => child.type === 'string');
			if (sourceChild && sourceChild.text.startsWith('"')) {
				usesDoubleQuotes = true;
			}
		}

		// Continue traversing child nodes
		for (let i = 0; i < node.childCount; i++) {
			const child = node.child(i);
			if (child) {
				stack.push(child);
			}
		}
	}

	return { isESM, usesDoubleQuotes };
}


/**
 * Check if we already import or require '@codestoryai/component-tagger'.
 */
function hasTaggerImportOrRequire(rootNode: Parser.SyntaxNode): boolean {
	const stack = [rootNode];
	while (stack.length > 0) {
		const node = stack.pop()!;

		// Look for import_statement with source '@codestoryai/component-tagger'
		if (node.type === 'import_statement') {
			// The last child is usually the string literal for import source
			const maybeSource = node.lastChild;
			if (maybeSource && maybeSource.text.replace(/['"]/g, '') === '@codestoryai/component-tagger') {
				return true;
			}
		}

		// Look for a call_expression that matches require('@codestoryai/component-tagger')
		if (node.type === 'call_expression') {
			const fn = node.firstChild;
			const arg = node.lastChild;
			if (
				fn?.type === 'identifier' &&
				fn.text === 'require' &&
				arg?.text.replace(/['"]/g, '') === '@codestoryai/component-tagger'
			) {
				return true;
			}
		}

		for (let i = 0; i < node.childCount; i++) {
			const child = node.child(i);
			if (child) { stack.push(child); }
		}
	}
	return false;
}

function createImportInsertion(source: string, useESM: boolean, usesDoubleQuotes: boolean): Edit {
	let insertionIndex = 0;

	// Try skipping a shebang or "use strict" line.
	const lines = source.split('\n');
	while (insertionIndex < source.length) {
		const firstLine = lines[0]?.trim() ?? '';
		if (firstLine.startsWith('#!') || firstLine === `'use strict';` || firstLine === `"use strict";`) {
			insertionIndex += lines[0].length + 1; // skip that line
			lines.shift();
		} else {
			break;
		}
	}

	const quote = usesDoubleQuotes ? '\"' : '\'';

	const importStatement = useESM
		? `import { ${NAMED_IMPORT} } from ${quote}${PACKAGE_NAME}${quote};\n`
		: `const { ${NAMED_IMPORT} } = require(${quote}${PACKAGE_NAME}${quote});\n`;

	return {
		startIndex: insertionIndex,
		endIndex: insertionIndex,
		text: importStatement,
	};
}

/**
 * Find the call to defineConfig(...) in the AST (if present).
 * Return the argument node of defineConfig (often an object literal or identifier).
 */
function findDefineConfigArgument(rootNode: Parser.SyntaxNode): Parser.SyntaxNode | null {
	const stack = [rootNode];
	while (stack.length > 0) {
		const node = stack.pop()!;
		// We look for a call_expression whose function is named 'defineConfig'
		if (node.type === 'call_expression') {
			const functionNode = node.child(0);
			if (functionNode?.text === 'defineConfig') {
				// The argument to defineConfig might be node.child(1)... but it depends on how
				// the grammar is recognized. In TypeScript, node.childForFieldName('arguments')
				// is the arguments list. We often see something like:
				//   call_expression
				//     - function: identifier (defineConfig)
				//     - arguments: arguments
				//         - "("
				//         - object (the inline config)
				//         - ")"
				const argsList = node.childForFieldName('arguments');
				if (argsList && argsList.childCount > 1) {
					// Typically child(0) is "(" and child(1) is the actual argument
					return argsList.child(1) || null;
				}
			}
		}
		for (let i = 0; i < node.childCount; i++) {
			const child = node.child(i);
			if (child) { stack.push(child); }
		}
	}
	return null;
}

/**
 * If the defineConfig argument is an identifier, find the variable declaration in the code
 * that matches this identifier, and return the initializer (object literal, presumably).
 */
function findObjectLiteralByIdentifierName(
	rootNode: Parser.SyntaxNode,
	identifierName: string
): Parser.SyntaxNode | null {
	const stack = [rootNode];
	while (stack.length > 0) {
		const node = stack.pop()!;
		if (
			(node.type === 'variable_declarator' || node.type === 'lexical_declaration') &&
			node.child(0)?.text === identifierName
		) {
			// child(1) might be "=", child(2) might be the initializer object
			const initializer = node.child(2);
			if (initializer && initializer.type === 'object') {
				return initializer;
			}
		}
		for (let i = 0; i < node.childCount; i++) {
			const child = node.child(i);
			if (child) { stack.push(child); }
		}
	}
	return null;
}

/**
 * Given an object literal node, ensure there's a 'plugins' property. If missing, add one.
 * Then ensure 'componentTagger()' is included in it. Return an array of needed edits.
 */
function ensurePluginsHasTagger(_source: string, objNode: Parser.SyntaxNode): Edit[] {
	const edits: Edit[] = [];

	// We'll search the object literal's children for a property named 'plugins'.
	const pluginsProp = findObjectProperty(objNode, 'plugins');
	if (!pluginsProp) {
		// Insert a new property at the start or end of the object, e.g.
		// plugins: [componentTagger()],
		const insertPos = objNode.startIndex + 1; // after the '{'
		const textToInsert = `\n  plugins: [componentTagger()],`;
		edits.push({
			startIndex: insertPos,
			endIndex: insertPos,
			text: textToInsert,
		});
		return edits;
	}

	// If we do have a 'plugins' property, find its array. If missing, we'll replace the value.
	const valueNode = findPropertyValueNode(pluginsProp);
	if (!valueNode) {
		return edits;
	}
	if (valueNode.type !== 'array') {
		// Replace the entire value with [componentTagger()]
		edits.push({
			startIndex: valueNode.startIndex,
			endIndex: valueNode.endIndex,
			text: `[componentTagger()]`,
		});
		return edits;
	}

	// We have an array for 'plugins'. Check if componentTagger() is already present.
	const alreadyHasTagger = arrayContainsCall(valueNode, 'componentTagger');
	if (!alreadyHasTagger) {
		// Insert right before the closing bracket ("]").
		const insertionPos = valueNode.endIndex - 1; // naive approach to skip the trailing "]"

		// If the array is empty, we insert just "componentTagger()".
		// If the array is not empty, we typically insert ", componentTagger()".
		// However, if there's already a trailing comma, we don't add another comma.
		const arrayEmpty = valueNode.namedChildCount === 0;
		let textToInsert = '';

		if (arrayEmpty) {
			textToInsert = `componentTagger()`;
		} else {
			// Check if the array has a trailing comma. Usually the last child is "]",
			// so the second to last child might be "," or an expression node.
			// Example: [ item(), ] => trailing comma before the bracket
			const secondLast = valueNode.child(valueNode.childCount - 2);
			if (secondLast?.type === ',') {
				// There's already a trailing comma in the array => insert "componentTagger()"
				textToInsert = `componentTagger()`;
			} else {
				// No trailing comma => insert ", componentTagger()"
				textToInsert = `, componentTagger()`;
			}
		}

		edits.push({
			startIndex: insertionPos,
			endIndex: insertionPos,
			text: textToInsert,
		});
	}

	return edits;
}

/**
 * Find a property assigned to 'propertyName' in an object literal node.
 */
function findObjectProperty(objectNode: Parser.SyntaxNode, propertyName: string): Parser.SyntaxNode | null {
	// The object literal has children of type 'pair' or 'property_signature'.
	for (let i = 0; i < objectNode.namedChildCount; i++) {
		const child = objectNode.namedChild(i);
		if (!child) { continue; }
		if (child.type === 'pair' || child.type === 'property_signature') {
			const key = child.child(0);
			if (key && key.text === propertyName) {
				return child;
			}
		}
	}
	return null;
}

/**
 * Given a property node (a 'pair'), retrieve the value node if it exists.
 * Typically child(0) is the key, child(1) might be ':', child(2) is the value.
 */
function findPropertyValueNode(propNode: Parser.SyntaxNode): Parser.SyntaxNode | null {
	if (propNode.childCount >= 3) {
		return propNode.child(propNode.childCount - 1) || null;
	}
	return null;
}

/**
 * Checks if an array node already has a call to a given functionName, e.g. 'componentTagger()'.
 */
function arrayContainsCall(arrayNode: Parser.SyntaxNode, funcName: string): boolean {
	// The array node's children might be call_expressions, identifiers, etc.
	const stack: Parser.SyntaxNode[] = [];
	for (let i = 0; i < arrayNode.namedChildCount; i++) {
		const child = arrayNode.namedChild(i);
		if (child) { stack.push(child); }
	}

	while (stack.length > 0) {
		const node = stack.pop()!;
		if (node.type === 'call_expression') {
			const fn = node.child(0);
			if (fn && fn.text === funcName) {
				return true;
			}
		}
	}
	return false;
}

/**
 * Transform a Vite config source string via Tree-sitter to ensure:
 *  1) We import "@codestoryai/component-tagger" (ESM or CJS style).
 *  2) We have a "plugins" array.
 *  3) The "componentTagger()" call is in the "plugins".
 *  4) We handle defineConfig(...) whether inline or with a variable.
 *
 * @param code The raw code of the Vite config file.
 * @returns The updated code (or null if parser init failed).
 */
export async function transformViteConfig(code: string): Promise<string | null> {
	const tsParser = await initTypescriptParser();
	if (!tsParser) {
		throw new Error('Tree-sitter parser was not initialized properly.');
	}

	// Parse the initial code
	const tree = tsParser.parse(code);
	if (!tree) { return null; }

	// 1) Detect ESM vs CJS
	const { isESM, usesDoubleQuotes } = isLikelyESM(tree.rootNode);

	// 2) If @codestoryai/component-tagger is not imported, insert it
	let edits: Edit[] = [];
	if (!hasTaggerImportOrRequire(tree.rootNode)) {
		edits.push(createImportInsertion(code, isESM, usesDoubleQuotes));
	}

	// If we need to insert the import statement, apply that now and re-parse
	if (edits.length > 0) {
		code = applyEdits(code, edits);
		edits = [];
	}

	const newTree = tsParser.parse(code);
	if (!newTree) { return null; }

	// 3) Find defineConfig(...) argument
	const defineArg = findDefineConfigArgument(newTree.rootNode);
	if (defineArg) {
		let objectNode: Parser.SyntaxNode | null = null;
		if (defineArg.type === 'object') {
			// e.g. export default defineConfig({ plugins: [...] })
			objectNode = defineArg;
		} else if (defineArg.type === 'identifier') {
			// Possibly: const config = { ... }; export default defineConfig(config)
			objectNode = findObjectLiteralByIdentifierName(newTree.rootNode, defineArg.text);
		}

		// If we find an object literal, ensure "plugins" and "componentTagger()"
		if (objectNode) {
			const pluginEdits = ensurePluginsHasTagger(code, objectNode);
			if (pluginEdits.length > 0) {
				code = applyEdits(code, pluginEdits);
			}
		}
	}
	return code;
}
