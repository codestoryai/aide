/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// We are going to support the jest testing framework here
// jest config is present in either package.json or jest.config.js
// in package.json it is under the jest key
// in jest.config.js it is under the module.exports key
// I want to get the path to the jest config file
// and also the location for the tests
import { runCommandAsync } from '../utilities/commandRunner';

class JestTestSupport {
	private _testFramework: string;
	private _workingDirectory: string;

	constructor(workingDirectory: string) {
		this._testFramework = 'jest';
		this._workingDirectory = workingDirectory;
	}

	getTestFramework(): string {
		return this._testFramework;
	}

	// List all the tests that are present in the project
	async listTests(): Promise<string[]> {
		const { stdout } = await runCommandAsync(this._workingDirectory, 'node_modules/.bin/jest', [
			'--listTests',
			'--json',
			'--silent',
			'--passWithNoTests',
		]);
		return JSON.parse(stdout);
	}
}


void (async () => {
	const jestTestSupport = new JestTestSupport('/Users/skcd/scratch/ide/extensions/codestory');
	const tests = await jestTestSupport.listTests();
	console.log(tests);
})();
