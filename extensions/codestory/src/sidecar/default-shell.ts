/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// This is a copy of the default-shell package, not installed as a dependency due to module system conflict.
// https://github.com/sindresorhus/default-shell/blob/8313d3750fc88653956228ff5f0f90cad2eee51f/index.d.ts

import process from 'node:process';
import { userInfo } from 'node:os';

export const detectDefaultShell = () => {
	const { env } = process;

	if (process.platform === 'win32') {
		return env.COMSPEC || 'cmd.exe';
	}

	try {
		const { shell } = userInfo();
		if (shell) {
			return shell;
		}
	} catch { }

	if (process.platform === 'darwin') {
		return env.SHELL || '/bin/zsh';
	}

	return env.SHELL || '/bin/sh';
};
