/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { SidecarGoToReferencesRequest, SidecarGoToRefernecesResponse } from './types';
import { shouldTrackFile } from '../utilities/openTabs';

export async function goToReferences(request: SidecarGoToReferencesRequest): Promise<SidecarGoToRefernecesResponse> {
	const locations: vscode.Location[] = await vscode.commands.executeCommand(
		'vscode.executeReferenceProvider',
		vscode.Uri.file(request.fs_file_path),
		new vscode.Position(request.position.line, request.position.character),
	);

	const implementations = await Promise.all(locations.map(async (location) => {
		const uri = location.uri;
		const range = location.range;
		if (shouldTrackFile(uri)) {
			// console.log('we are trakcing this uri');
			// console.log(uri);
		}
		return {
			fs_file_path: uri.fsPath,
			range: {
				startPosition: {
					line: range.start.line,
					character: range.start.character,
					byteOffset: 0,
				},
				endPosition: {
					line: range.end.line,
					character: range.end.character,
					byteOffset: 0,
				},
			}
		};
	}));
	return {
		reference_locations: implementations,
	};
}
