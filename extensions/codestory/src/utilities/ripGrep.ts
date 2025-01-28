/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Gets the ripgrep path which is bundled along with VSCode since the APIs
 * for findText is not stable yet
 * VSCode ships with an package which contains the ripgrep package and is bundled
 * along with the main app
 */

import fs from 'node:fs/promises';
import * as vscode from 'vscode';
import path from 'path';

export async function getRipGrepPath(): Promise<string | null> {
	const rgExe = process.platform === 'win32' ? 'rg.exe' : 'rg';
	const candidateDirs = ['node_modules/@vscode/ripgrep/bin', 'node_modules.asar.unpacked/@vscode/ripgrep/bin'];
	for (const dir of candidateDirs) {
		const rgPath = path.resolve(vscode.env.appRoot, dir, rgExe);
		const exists = await fs
			.access(rgPath)
			.then(() => true)
			.catch(() => false);
		if (exists) {
			return rgPath;
		}
	}

	console.log('rg not found');
	return null;
}
