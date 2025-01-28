/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

const DEFAULT_URL = 'http://127.0.0.1:42424';

export const sidecarURL = (): string => {
	const aideConfiguration = vscode.workspace.getConfiguration('aide');
	const sideCarURL = aideConfiguration.get('sidecarURL') as string;
	return sideCarURL ?? DEFAULT_URL;
};

export const sidecarUseSelfRun = (): boolean => {
	const aideConfiguration = vscode.workspace.getConfiguration('aide');
	const sideCarUseSelfRun = aideConfiguration.get('sidecarUseSelfRun');
	return !!sideCarUseSelfRun;
};
