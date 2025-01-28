/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { SidecarInlayHintResponse, SidecarInlayHintsRequest } from './types';
import * as vscode from 'vscode';

export async function inlayHints(
	request: SidecarInlayHintsRequest,
): Promise<SidecarInlayHintResponse> {
	const filePath = request.fs_file_path;
	const requestRange = request.range;
	const range = new vscode.Range(new vscode.Position(requestRange.startPosition.line, 0), new vscode.Position(requestRange.endPosition.line, requestRange.endPosition.character));
	const inlayHintsProvider = await vscode.languages.getInlayHintsProvider('*');
	const textDocument = await vscode.workspace.openTextDocument(vscode.Uri.file(filePath));
	const evenEmitter = new vscode.EventEmitter();
	try {
		const hints = await inlayHintsProvider?.provideInlayHints(textDocument, range, {
			isCancellationRequested: false,
			onCancellationRequested: evenEmitter.event,
		});
		console.log('inlayHints::generated_hints');
		console.log('inlayHints::generated_hints::len', hints?.length);
		if (hints !== null && hints !== undefined) {
			const answerHints = hints.map((hint) => {
				const position = {
					line: hint.position.line,
					character: hint.position.character,
					byteOffset: 0,
				};
				const paddingLeft = hint.paddingLeft ?? false;
				const paddingRight = hint.paddingRight ?? false;
				let values = null;
				if (typeof hint.label === 'string') {
					values = [hint.label];
				} else {
					// its an array of inlay hints, and we have to grab the values
					// from here
					values = hint.label.map((hint) => {
						return hint.value;
					});
				}
				return {
					position,
					padding_left: paddingLeft,
					padding_right: paddingRight,
					values,
				};
			});
			return {
				parts: answerHints,
			};
		}
	} catch (exception) {
		console.log('exception');
		console.log(exception);
	}
	return {
		parts: [],
	};
}
