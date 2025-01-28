/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/* Credit to Cline: https://github.com/cline/cline/blob/main/src/integrations/terminal/TerminalManager.ts */

import * as vscode from 'vscode';
import { arePathsEqual } from '../utilities/paths';
import { mergePromise, TerminalProcess, TerminalProcessResultPromise } from './TerminalProcess';
import { TerminalInfo, TerminalRegistry } from './TerminalRegistry';
import pTimeout from './p-timeout';

/*
TerminalManager:
- Creates/reuses terminals
- Runs commands via runCommand(), returning a TerminalProcess
- Handles shell integration events

TerminalProcess extends EventEmitter and implements Promise:
- Emits 'line' events with output while promise is pending
- process.continue() resolves promise and stops event emission
- Allows real-time output handling or background execution

getUnretrievedOutput() fetches latest output for ongoing commands

Enables flexible command execution:
- Await for completion
- Listen to real-time events
- Continue execution in background
- Retrieve missed output later

Notes:
- it turns out some shellIntegration APIs are available on cursor, although not on older versions of vscode
- "By default, the shell integration script should automatically activate on supported shells launched from VS Code."
Supported shells:
Linux/macOS: bash, fish, pwsh, zsh
Windows: pwsh


Example:

const terminalManager = new TerminalManager(context);

// Run a command
const process = terminalManager.runCommand('npm install', '/path/to/project');

process.on('line', (line) => {
	console.log(line);
});

// To wait for the process to complete naturally:
await process;

// Or to continue execution even if the command is still running:
process.continue();

// Later, if you need to get the unretrieved output:
const unretrievedOutput = terminalManager.getUnretrievedOutput(terminalId);
console.log('Unretrieved output:', unretrievedOutput);

Resources:
- https://github.com/microsoft/vscode/issues/226655
- https://code.visualstudio.com/updates/v1_93#_terminal-shell-integration-api
- https://code.visualstudio.com/docs/terminal/shell-integration
- https://code.visualstudio.com/api/references/vscode-api#Terminal
- https://github.com/microsoft/vscode-extension-samples/blob/main/terminal-sample/src/extension.ts
- https://github.com/microsoft/vscode-extension-samples/blob/main/shell-integration-sample/src/extension.ts
*/

export class TerminalManager {
	private terminalIds: Set<number> = new Set();
	private processes: Map<number, TerminalProcess> = new Map();
	private disposables: vscode.Disposable[] = [];

	constructor() {
		let disposable: vscode.Disposable | undefined;
		try {
			disposable = vscode.window.onDidStartTerminalShellExecution?.(async (e) => {
				// Creating a read stream here results in a more consistent output. This is most obvious when running the `date` command.
				e?.execution?.read();
			});
		} catch (error) {
			// console.error('Error setting up onDidEndTerminalShellExecution', error)
		}
		if (disposable) {
			this.disposables.push(disposable);
		}
	}

	runCommand(terminalInfo: TerminalInfo, command: string): TerminalProcessResultPromise {
		terminalInfo.busy = true;
		terminalInfo.lastCommand = command;
		const process = new TerminalProcess();
		this.processes.set(terminalInfo.id, process);

		process.once('completed', () => {
			terminalInfo.busy = false;
		});

		// if shell integration is not available, remove terminal so it does not get reused as it may be running a long-running process
		process.once('no_shell_integration', () => {
			console.log(`no_shell_integration received for terminal ${terminalInfo.id}`);
			// Remove the terminal so we can't reuse it (in case it's running a long-running process)
			TerminalRegistry.removeTerminal(terminalInfo.id);
			this.terminalIds.delete(terminalInfo.id);
			this.processes.delete(terminalInfo.id);
		});

		const promise = new Promise<void>((resolve, reject) => {
			process.once('continue', () => {
				resolve();
			});
			process.once('error', (error) => {
				console.error(`Error in terminal ${terminalInfo.id}:`, error);
				reject(error);
			});
		});

		// if shell integration is already active, run the command immediately
		if (terminalInfo.terminal.shellIntegration) {
			process.waitForShellIntegration = false;
			process.run(terminalInfo.terminal, command);
		} else {
			// docs recommend waiting 3s for shell integration to activate
			pWaitFor(() => terminalInfo.terminal.shellIntegration !== undefined, { timeout: 4000 }).finally(() => {
				const existingProcess = this.processes.get(terminalInfo.id);
				if (existingProcess && existingProcess.waitForShellIntegration) {
					existingProcess.waitForShellIntegration = false;
					existingProcess.run(terminalInfo.terminal, command);
				}
			});
		}

		return mergePromise(process, promise);
	}

	async getOrCreateTerminal(cwd: string): Promise<TerminalInfo> {
		// Find available terminal from our pool first (created for this task)
		const availableTerminal = TerminalRegistry.getAllTerminals().find((t) => {
			if (t.busy) {
				return false;
			}
			const terminalCwd = t.terminal.shellIntegration?.cwd; // one of cline's commands could have changed the cwd of the terminal
			if (!terminalCwd) {
				return false;
			}
			return arePathsEqual(vscode.Uri.file(cwd).fsPath, terminalCwd.fsPath);
		});
		if (availableTerminal) {
			this.terminalIds.add(availableTerminal.id);
			return availableTerminal;
		}

		console.log('creating new terminal at', cwd);

		const newTerminalInfo = TerminalRegistry.createTerminal(cwd);
		vscode.aideAgentTerminals.showTerminal(newTerminalInfo.id.toString());
		console.log('newTerminalInfo', newTerminalInfo);
		this.terminalIds.add(newTerminalInfo.id);
		return newTerminalInfo;
	}

	getTerminals(busy: boolean): { id: number; lastCommand: string }[] {
		return Array.from(this.terminalIds)
			.map((id) => TerminalRegistry.getTerminal(id))
			.filter((t): t is TerminalInfo => t !== undefined && t.busy === busy)
			.map((t) => ({ id: t.id, lastCommand: t.lastCommand }));
	}

	getUnretrievedOutput(terminalId: number): string {
		if (!this.terminalIds.has(terminalId)) {
			return '';
		}
		const process = this.processes.get(terminalId);
		return process ? process.getUnretrievedOutput() : '';
	}

	isProcessHot(terminalId: number): boolean {
		const process = this.processes.get(terminalId);
		return process ? process.isHot : false;
	}

	disposeAll() {
		// for (const info of this.terminals) {
		// 	//info.terminal.dispose() // dont want to dispose terminals when task is aborted
		// }
		this.terminalIds.clear();
		this.processes.clear();
		this.disposables.forEach((disposable) => disposable.dispose());
		this.disposables = [];
	}
}

export async function executeTerminalCommand(
	command: string,
	cwd: string = process.cwd(),
	wait_for_exit: boolean = true
): Promise<string> {
	// Create a terminal manager instance
	const terminalManager = new TerminalManager();

	try {
		const terminalInfo = await terminalManager.getOrCreateTerminal(cwd);

		const process = terminalManager.runCommand(terminalInfo, command);

		let buffer = '';
		process.on('line', (line) => {
			buffer += line + '\n';
		});

		if (!wait_for_exit) {
			// Return immediately for long-running processes
			return buffer;
		}

		// Wait for process completion and return output for regular commands
		await process;
		return buffer;
	} finally {
		// Only dispose if we're waiting for exit
		if (wait_for_exit) {
			terminalManager.disposeAll();
		}
	}
}

interface WaitForOptions {
	interval?: number;
	timeout?: number;
	before?: boolean;
}

export default async function pWaitFor(
	condition: () => boolean | Promise<boolean>,
	options: WaitForOptions = {}
): Promise<void> {
	const {
		interval = 20,
		timeout = Number.POSITIVE_INFINITY,
		before = true,
	} = options;

	let retryTimeout: NodeJS.Timeout | undefined;  // Initialize as undefined

	let abort = false;

	const promise = new Promise<void>((resolve, reject) => {
		const check = async () => {
			try {
				const value = await condition();

				if (typeof value !== 'boolean') {
					throw new TypeError('Expected condition to return a boolean');
				} else if (value === true) {
					resolve();
				} else if (!abort) {
					retryTimeout = setTimeout(check, interval);
				}
			} catch (error) {
				reject(error);
			}
		};

		if (before) {
			check();
		} else {
			retryTimeout = setTimeout(check, interval);
		}
	});

	if (timeout === Number.POSITIVE_INFINITY) {
		return promise;
	}

	try {
		// Note: pTimeout function needs to be imported or defined
		return await pTimeout(promise, typeof timeout === 'number' ? { milliseconds: timeout } : timeout);
	} finally {
		abort = true;
		clearTimeout(retryTimeout);
	}
}
