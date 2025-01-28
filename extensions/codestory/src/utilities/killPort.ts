/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as cp from 'child_process';
import { promisify } from 'util';

const exec = promisify(cp.exec);

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

function logDebug(message: string, ...args: any[]) {
	console.log(`[killPort] ${message}`, ...args);
}

export async function killProcessOnPort(port: number, method: string = 'tcp') {
	logDebug(`Attempting to kill process on port ${port} using ${method} protocol`);

	if (process.platform === 'win32') {
		logDebug('Detected Windows platform');
		try {
			const netstatResult = await exec('netstat -nao');
			const { stdout } = netstatResult;
			if (!stdout) {
				logDebug('No output from netstat command');
				return netstatResult;
			}

			const outputLines = stdout.split('\n');
			logDebug(`Found ${outputLines.length} total lines in netstat output`);

			const localPortPattern = new RegExp(`^ *${method.toUpperCase()} *[^ ]*:${port}`, 'gm');
			const matchingPortLines = outputLines.filter(line => line.match(localPortPattern));
			logDebug(`Found ${matchingPortLines.length} lines matching port ${port}`, matchingPortLines);

			const processIds = matchingPortLines.reduce<string[]>((accumulator, currentLine) => {
				const pidMatch = currentLine.match(/(\d*)\w*(\n|$)/gm);
				const result = pidMatch && pidMatch[0] && !accumulator.includes(pidMatch[0])
					? accumulator.concat(pidMatch[0])
					: accumulator;
				return result;
			}, []);

			logDebug(`Found process IDs:`, processIds);

			if (processIds.length === 0) {
				logDebug(`No process found running on port ${port} - considering this a success`);
				return Promise.resolve({ stdout: '', stderr: '' });
			}

			const killCommand = `TaskKill /F /PID ${processIds.join(' /PID ')}`;
			logDebug(`Executing kill command: ${killCommand}`);
			return exec(killCommand).then(async result => {
				logDebug('Successfully killed processes', result);
				logDebug('Waiting for 1s to ensure process cleanup');
				await sleep(1000);
				return result;
			}).catch(error => {
				logDebug('Error killing processes', error);
				throw error;
			});
		} catch (error) {
			logDebug('Error in Windows process killing', error);
			throw error;
		}
	}

	// Unix-like systems
	logDebug('Detected Unix-like platform');
	try {
		const lsofCommand = `lsof -i :${port} -P`;
		logDebug(`Executing lsof command: ${lsofCommand}`);
		const { stdout: lsofOutput } = await exec(lsofCommand);

		if (!lsofOutput.trim()) {
			logDebug(`No process found running on port ${port} - considering this a success`);
			return Promise.resolve({ stdout: '', stderr: '' });
		}

		const killCommand = `lsof -i ${method === 'udp' ? 'udp' : 'tcp'}:${port} | grep ${method === 'udp' ? 'UDP' : 'LISTEN'} | awk '{print $2}' | xargs kill -9`;
		logDebug(`Executing kill command: ${killCommand}`);

		return exec(killCommand).then(async result => {
			logDebug('Successfully killed processes', result);
			logDebug('Waiting for 1s to ensure process cleanup');
			await sleep(1000);
			return result;
		}).catch(error => {
			logDebug('Error killing processes', error);
			throw error;
		});
	} catch (error) {
		logDebug(`No process found running on port ${port} - considering this a success`);
		return Promise.resolve({ stdout: '', stderr: '' });
	}
}
