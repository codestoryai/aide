/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';

export interface PromptData {
	type: string;
	prompt: {
		prefix: string;
		suffix: string;
		isFimEnabled: boolean;
	};
	trailingWs: string;
	computeTimeMs: number;
}

export async function getPromptHelper(
	docText: string,
	insertOffset: number,
	_docRelPath: string,
	_docUri: vscode.Uri,
	_docLangId: string,
): Promise<PromptData> {
	// const suffixPercent = SUFFIX_PERCENT;

	const now = Date.now();

	const completePrefix = docText.slice(0, insertOffset);
	const completeSuffix = docText.slice(insertOffset, docText.length - 1);

	const [trimmedPrefix, trailingWs] = trimLastLine(completePrefix);
	const now2 = Date.now();

	return {
		type: 'prompt',
		prompt: {
			prefix: trimmedPrefix,
			suffix: completeSuffix,
			isFimEnabled: true,
		},
		trailingWs: trailingWs,
		computeTimeMs: now2 - now,
	};
}

export function trimLastLine(str: string): [string, string] { // returns [trimmedString, ws]
	const lines = str.split('\n');
	// this is the last line
	const lastLine = lines[lines.length - 1];
	// trim the last line
	const nTrailingWS = lastLine.length - lastLine.trimRight().length;
	// before the whitespace what is the whole prompt here
	const beforeWS = str.slice(0, str.length - nTrailingWS);
	// gets the trailing whitespace which is remaining in the complete string
	const ws = str.substr(beforeWS.length);
	return [lastLine.length === nTrailingWS ? beforeWS : str, ws];
}
