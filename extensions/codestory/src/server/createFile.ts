/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * We can create a file at any location using the vscode api over here
 */

import * as vscode from 'vscode';
import { SidecarCreateFileRequest, SidecarCreateFilResponse } from './types';

export async function createFileResponse(request: SidecarCreateFileRequest): Promise<SidecarCreateFilResponse> {
	const filePath = request.fs_file_path;
	const result = await createFileIfNotExists(vscode.Uri.file(filePath));
	return result;
}

export async function createFileIfNotExists(uri: vscode.Uri): Promise<SidecarCreateFilResponse> {
	try {
		await vscode.workspace.fs.stat(uri);
		return {
			success: false,
		};
	} catch (error) {
		if (error.code === 'FileNotFound' || error.code === 'ENOENT') {
			const content = new TextEncoder().encode(''); // Empty content
			await vscode.workspace.fs.writeFile(uri, content);
			vscode.window.showInformationMessage('File created successfully.');
			return {
				success: true,
			};
		} else {
			return {
				success: false,
			};
		}
	}
}
