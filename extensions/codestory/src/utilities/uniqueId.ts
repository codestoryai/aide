/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// We are going to capture a unique ID here for the user, for now we are going
// to look at the machine id and use that, if the telemetry is disabled, then
// we won't capture a unique-id.


import * as uuid from 'uuid';
import * as vscode from 'vscode';
import * as os from 'os';

const invalidMacAddresses = new Set([
	'00:00:00:00:00:00',
	'ff:ff:ff:ff:ff:ff',
	'ac:de:48:00:11:22'
]);

function validateMacAddress(candidate: string): boolean {
	const tempCandidate = candidate.replace(/\-/g, ':').toLowerCase();
	return !invalidMacAddresses.has(tempCandidate);
}

export function getMac(): string {
	const ifaces = os.networkInterfaces();
	for (const name in ifaces) {
		const networkInterface = ifaces[name];
		if (networkInterface) {
			for (const { mac } of networkInterface) {
				if (validateMacAddress(mac)) {
					return mac;
				}
			}
		}
	}

	throw new Error('Unable to retrieve mac address (unexpected format)');
}


let machineId: Promise<string>;
export async function getMachineId(): Promise<string> {
	if (!machineId) {
		machineId = (async () => {
			const id = await getMacMachineId();

			return id || uuid.v4(); // fallback, generate a UUID
		})();
	}

	return machineId;
}

async function getMacMachineId(): Promise<string | undefined> {
	try {
		const crypto = await import('crypto');
		const macAddress = getMac();
		return crypto.createHash('sha256').update(macAddress, 'utf8').digest('hex');
	} catch (err) {
		return undefined;
	}
}


export function getUniqueId(): string {
	try {
		const codestoryConfiguration = vscode.workspace.getConfiguration('codestory');
		const disableTelemetry = codestoryConfiguration.get('disableTelemetry');
		if (disableTelemetry) {
			return 'disabled-telemetry';
		} else {
			return getUserId();
		}
	} catch (err) {
		return 'You';
	}
}

export function getUserId(): string {
	try {
		const codestoryConfiguration = vscode.workspace.getConfiguration('codestory');
		const disableUserNameLookup = codestoryConfiguration.get('disableUserNameLookup');
		if (disableUserNameLookup) {
			return 'You';
		} else {
			return os.userInfo().username;
		}
	} catch (err) {
		// console.log('err', err);
		return 'You';
	}
}
