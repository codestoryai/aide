/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { getPreviousWordRange } from '../utilities/previousWordInText';
import { SidecarGetPreviousWordRangeRequest, SidecarGetPreviousWordRangeResponse } from './types';

export async function getPreviousWordAtPosition(request: SidecarGetPreviousWordRangeRequest): Promise<SidecarGetPreviousWordRangeResponse> {
	const filePath = request.fs_file_path;
	const position = request.current_position;
	const vscodePosition = new vscode.Position(position.line, position.character);
	const textDocument = await vscode.workspace.openTextDocument(filePath);
	const previousWordRange = getPreviousWordRange(textDocument, vscodePosition);
	if (previousWordRange) {
		return {
			fs_file_path: filePath,
			range: {
				startPosition: {
					line: previousWordRange.start.line,
					character: previousWordRange.start.character,
					byteOffset: 0,
				},
				endPosition: {
					line: previousWordRange.end.line,
					character: previousWordRange.end.character,
					byteOffset: 0,
				}
			}
		};
	} else {
		return {
			fs_file_path: filePath,
			range: null,
		};
	}
}
