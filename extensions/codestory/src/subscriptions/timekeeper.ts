/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Keeps track of the last time some operation was performed.
// We can use this as a hack to restrict heavy operations to only under
// certain time period, yes it might kill the smoothness of the experience
// but it will help with perf issues

// This is 2 seconds represented as milliseconds (cause js works on ms)
export const FILE_SAVE_TIME_PERIOD = 2000;

export class TimeKeeper {
	private lastUpdated: number;
	private timeBetweenUpdates: number;

	constructor(
		timeBetweenUpdates: number,
	) {
		this.timeBetweenUpdates = timeBetweenUpdates;
		this.lastUpdated = -1;
	}

	public isInvocationAllowed(
		instant: number,
	): boolean {
		// Implicitly updates the last time we invoked the function
		// using this in async scope might mess things up, but its fine for
		// now
		if (this.lastUpdated + this.timeBetweenUpdates < instant) {
			this.lastUpdated = instant;
			return true;
		}
		return false;
	}
}
