/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as os from 'os';
import { env } from 'vscode';

export function checkReadonlyFSMode() {
	const platform = os.platform();
	if (platform === 'darwin') {
		const appRoot = env.appRoot;
		if (appRoot.indexOf('AppTranslocation') !== -1) {
			return true;
		}
		// check if we are in readonly fs here
	}
	return false;
}
