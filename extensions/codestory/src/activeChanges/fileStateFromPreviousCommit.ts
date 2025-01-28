/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { promisify } from 'util';
import { exec } from 'child_process';
import * as path from 'path';
// import path = require('path'); // Add this line to import the 'path' module
import { Logger } from 'winston';


export interface FileStateFromPreviousCommit {
	filePath: string;
	fileContent: string;
}


export const fileStateFromPreviousCommit = async (
	workingDirectory: string,
	logger: Logger,
): Promise<FileStateFromPreviousCommit[]> => {
	// First we need to get the list of files which changed by querying
	// git about it
	let fileList: string[] = [];
	try {
		const { stdout } = await promisify(exec)('git diff --name-only HEAD', { cwd: workingDirectory });
		fileList = stdout.split('\n').filter((file) => file !== '');
	} catch (error) {
		logger.info((error as Error).toString());
	}

	// Now that we the file list, lets get the content of the file at HEAD
	// so we have the initial state and the state of the file post HEAD
	// commit
	const fileStateFromPreviousCommit: FileStateFromPreviousCommit[] = [];
	for (const file of fileList) {
		try {
			const { stdout } = await promisify(exec)(`git show HEAD:${file}`, { cwd: workingDirectory });
			fileStateFromPreviousCommit.push({
				filePath: path.join(workingDirectory, file),
				fileContent: stdout,
			});
		} catch (error) {
			logger.error((error as Error).toString());
		}
	}
	return fileStateFromPreviousCommit;
};
