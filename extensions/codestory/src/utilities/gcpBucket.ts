/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';

const BUCKET_NAME = 'sidecar-bin';

function ensureDirectoryExists(filePath: string): void {
	const parentDir = path.dirname(filePath);
	try {
		fs.mkdirSync(parentDir, { recursive: true });
	} catch (error) {
		// Only throw if the error is not "directory already exists"
		if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
			throw error;
		}
	}
}

export const downloadSidecarZip = async (
	destination: string,
	version: string = 'latest'
) => {
	ensureDirectoryExists(destination);

	const platform = process.platform;
	const architecture = process.arch;
	const source = `${version}/${platform}/${architecture}/sidecar.zip`;
	try {
		await downloadUsingURL(source, destination);
	} catch (err) {
		console.error(err);
		throw new Error(`Failed to download sidecar`);
	}
};

const downloadUsingURL = async (source: string, destination: string) => {
	const url = `https://storage.googleapis.com/${BUCKET_NAME}/${source}`;
	const response = await axios.get(url, { responseType: 'stream' });
	const writer = fs.createWriteStream(destination);

	response.data.pipe(writer);

	return new Promise((resolve, reject) => {
		writer.on('finish', resolve);
		writer.on('error', reject);
	});
};
