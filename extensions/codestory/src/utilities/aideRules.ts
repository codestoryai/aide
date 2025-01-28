/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

/**
 * We attempt the read the .aiderules file which is present in the root directory
 * of the repository if it exists
 *
 * We will feed this file into the system prompt of the chat/edit/agent regardless
 * of which flow it is
 */
export const readAideRulesContent = async (): Promise<string | null> => {
	const rootDirectory = vscode.workspace.rootPath;

	if (!rootDirectory) {
		return null;
	}

	const aideRulesUri = vscode.Uri.joinPath(vscode.Uri.file(rootDirectory), '.aiderules');

	try {
		const fileContent = await vscode.workspace.fs.readFile(aideRulesUri);
		return Buffer.from(fileContent).toString('utf-8');
	} catch (error) {
		// File doesn't exist or couldn't be read
		return null;
	}
};
