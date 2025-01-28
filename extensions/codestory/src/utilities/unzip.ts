/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as cp from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as yauzl from 'yauzl';

async function extractZipWithYauzl(zipPath: string, destinationDir: string): Promise<void> {
	return new Promise((resolve, reject) => {
		yauzl.open(zipPath, { lazyEntries: true }, (err, zipfile) => {
			if (err) { reject(err); return; }
			if (!zipfile) { reject(new Error('Failed to open zip file')); return; }

			zipfile.on('error', reject);
			zipfile.on('end', resolve);
			zipfile.on('entry', async (entry) => {
				const entryPath = path.join(destinationDir, entry.fileName);
				const entryDir = path.dirname(entryPath);

				try {
					// Create directory if it doesn't exist
					fs.mkdirSync(entryDir, { recursive: true });

					if (/\/$/.test(entry.fileName)) {
						// Directory entry
						fs.mkdirSync(entryPath, { recursive: true });
						zipfile.readEntry();
					} else {
						// File entry
						zipfile.openReadStream(entry, (err, readStream) => {
							if (err) { reject(err); return; }
							if (!readStream) { reject(new Error('Failed to open read stream')); return; }

							const writeStream = fs.createWriteStream(entryPath, { flags: 'w' });

							writeStream.on('error', (error) => {
								readStream.destroy();
								reject(error);
							});

							readStream.on('error', (error) => {
								writeStream.destroy();
								reject(error);
							});

							readStream.pipe(writeStream);
							writeStream.on('finish', () => {
								zipfile.readEntry();
							});
						});
					}
				} catch (error) {
					reject(error);
				}
			});

			zipfile.readEntry();
		});
	});
}

export async function unzip(source: string, destinationDir: string): Promise<void> {
	if (!source || !destinationDir) {
		throw new Error('Source and destination paths are required');
	}

	if (!fs.existsSync(source)) {
		throw new Error(`Source file does not exist: ${source}`);
	}

	try {
		if (source.endsWith('.zip')) {
			await extractZipWithYauzl(source, destinationDir);
		} else {
			// Ensure destination directory exists
			if (!fs.existsSync(destinationDir)) {
				fs.mkdirSync(destinationDir, { recursive: true });
			}

			const result = cp.spawnSync('tar', ['-xzf', source, '-C', destinationDir, '--strip-components', '1']);
			if (result.error) {
				throw result.error;
			}
			if (result.status !== 0) {
				throw new Error(`tar extraction failed with status ${result.status}: ${result.stderr.toString()}`);
			}
		}
	} catch (error) {
		// Add context to the error before rethrowing
		throw new Error(`Failed to extract ${source} to ${destinationDir}: ${error.message}`);
	}
}
