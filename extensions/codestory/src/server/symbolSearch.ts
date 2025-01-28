/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { SidecarSymbolSearchRequest, SidecarSymbolSearchResponse } from './types';

export async function symbolSearch(request: SidecarSymbolSearchRequest): Promise<SidecarSymbolSearchResponse> {
	const responses: {
		name: string;
		kind: vscode.SymbolKind;
		containerName: string;
		location: vscode.Location;
	}[] = await vscode.commands.executeCommand(
		'vscode.executeWorkspaceSymbolProvider',
		request.search_string,
	);
	return {
		locations: responses.map((response) => {
			return {
				name: response.name,
				kind: response.kind.toString(),
				fs_file_path: response.location.uri.fsPath,
				range: {
					startPosition: {
						line: response.location.range.start.line,
						character: response.location.range.start.character,
						byteOffset: 0,
					},
					endPosition: {
						line: response.location.range.end.line,
						character: response.location.range.end.character,
						byteOffset: 0,
					},
				},
			};
		})
	};
}
