/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export type PortPosition = {
	start: number;
	end: number;
	port: string;
};

export function findPortPosition(url: string): PortPosition | null {
	const regex = /^https?:\/\/localhost:(\d+)/;
	const match = regex.exec(url);

	if (match) {
		const portStart = match[0].lastIndexOf(':') + 1;
		const start = match.index + portStart;
		const port = match[1];

		return {
			start,
			end: start + port.length,
			port
		};
	}
	return null;
}
