/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
// We want to activate the LSPs of the language we are interested in before
// we start processing anything

import * as path from 'path';
import * as fs from 'fs';

import { ExtensionContext, extensions } from 'vscode';
import logger from '../logger';
import { isExcludedExtension } from './extensionBlockList';


export const getExtensionsInDirectory = (directory: string): Set<string> => {
	const extensions = new Set<string>();

	function traverse(dir: string) {
		// If the path ends with node_modules, lets skip looking at what the
		// extensions will be here
		if (dir.endsWith('node_modules')) {
			return;
		}
		if (isExcludedExtension(path.extname(dir))) {
			return;
		}
		try {
			const files = fs.readdirSync(dir);

			for (const file of files) {
				const filePath = path.join(dir, file);
				const stat = fs.statSync(filePath);

				if (!isExcludedExtension(path.extname(filePath))) {
					// If directory, recurse. If file, extract extension.
					if (stat.isDirectory()) {
						traverse(filePath);
					} else {
						const ext = path.extname(filePath);
						if (ext) {
							extensions.add(ext);
						}
					}
				}
			}
		} catch (e) {
			// console.log('[getExtensionsInDirectory] failing for directory', dir);
			console.error(e);
		}
	}

	traverse(directory);
	logger.info(`[extension_activate] Found extensions: ${Array.from(extensions).join(', ')}`);
	return extensions;
};


const isTypeScriptType = (fileExtension: string): boolean => {
	if (
		fileExtension === '.ts' ||
		fileExtension === '.tsx' ||
		fileExtension === '.js' ||
		fileExtension === '.jsx'
	) {
		return true;
	}
	return false;
};

const isPythonType = (fileExtension: string): boolean => {
	if (fileExtension === '.py') {
		return true;
	}
	return false;
};

const isGoType = (fileExtension: string): boolean => {
	if (fileExtension === '.go') {
		return true;
	}
	return false;
};

const isRustType = (fileExtension: string): boolean => {
	if (fileExtension === '.rs') {
		return true;
	}
	return false;
};

const activateTypeScriptExtensions = async () => {
	// Activate TypeScript LSP
	const alreadyActivatedExtensions: Set<string> = new Set<string>();
	extensions.all.forEach(async (extension) => {
		if (extension.isActive) {
			return;
		}
		if (alreadyActivatedExtensions.has(extension.id)) {
			return;
		}
		if (extension.id.includes('typescript') || extension.id.includes('javascript') || extension.id.includes('js') || extension.id.includes('ts')) {
			logger.info(`[extension_activate][ts] Activating ${extension.id}`);
			await extension.activate();
			alreadyActivatedExtensions.add(extension.id);
		}
	});
};


const activatePythonExtension = async () => {
	const alreadyActivatedExtensions: Set<string> = new Set<string>();
	extensions.all.forEach((extension) => {
		logger.info('[extension][present] ' + extension.id);
	});
	extensions.all.forEach(async (extension) => {
		if (extension.isActive) {
			logger.info('[extension] Already activated ' + extension.id);
			return;
		}
		if (alreadyActivatedExtensions.has(extension.id)) {
			return;
		}
		if (extension.id.includes('python') || extension.id.includes('py')) {
			logger.info(`[extension_activate][py] Activating ${extension.id}`);
			const output = await extension.activate();
			logger.info(`[extension_activate][py] Output: ${output}`);
		}
	});
};


const activateGoExtension = async () => {
	const alreadyActivatedExtensions: Set<string> = new Set<string>();
	extensions.all.forEach(async (extension) => {
		if (extension.isActive) {
			return;
		}
		if (alreadyActivatedExtensions.has(extension.id)) {
			return;
		}
		if (extension.id.includes('go')) {
			logger.info(`[extension_activate][go] Activating ${extension.id}`);
			await extension.activate();
		}
	});
};


/*
const restartGoLSP = async () => {
	// Use the most popular go lsp and restart it
	// This comes from here:
	// https://github.com/golang/vscode-go/blob/master/package.json#L501C21-L501C46
	await commands.executeCommand('go.languageserver.restart');
};
*/


const activateRustExtension = async () => {
	const alreadyActivatedExtensions: Set<string> = new Set<string>();
	extensions.all.forEach(async (extension) => {
		if (extension.isActive) {
			return;
		}
		if (alreadyActivatedExtensions.has(extension.id)) {
			return;
		}
		if (extension.id.includes('rust')) {
			logger.info(`[extension_activate][rust] Activating ${extension.id}`);
			await extension.activate();
		}
	});
};

export const activateExtensions = async (_context: ExtensionContext, languageTypes: Set<string>) => {
	// Check if any entry here is of typescript type
	languageTypes.forEach(async (fileExtension) => {
		if (isTypeScriptType(fileExtension)) {
			await activateTypeScriptExtensions();
		}
	});

	languageTypes.forEach(async (fileExtension) => {
		if (isPythonType(fileExtension)) {
			await activatePythonExtension();
		}
	});

	languageTypes.forEach(async (fileExtension) => {
		if (isGoType(fileExtension)) {
			await activateGoExtension();
		}
	});

	languageTypes.forEach(async (fileExtension) => {
		if (isRustType(fileExtension)) {
			await activateRustExtension();
		}
	});
};
