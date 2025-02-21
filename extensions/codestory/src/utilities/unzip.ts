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
            if (err) { 
                console.error('Failed to open zip file:', err);
                reject(new Error(`Failed to open zip file: ${err.message}`)); 
                return; 
            }
            if (!zipfile) { 
                console.error('Failed to open zip file: No zipfile object returned');
                reject(new Error('Failed to open zip file')); 
                return; 
            }

            zipfile.on('error', (err) => {
                console.error('Zip file error:', err);
                reject(err);
            });
            
            zipfile.on('end', () => {
                console.log('Successfully extracted all files');
                resolve();
            });
            
            zipfile.on('entry', async (entry) => {
                const entryPath = path.join(destinationDir, entry.fileName);
                const entryDir = path.dirname(entryPath);

                try {
                    // Validate entry path to prevent directory traversal
                    const normalizedEntryPath = path.normalize(entryPath);
                    if (!normalizedEntryPath.startsWith(destinationDir)) {
                        console.error('Invalid zip entry path:', entry.fileName);
                        reject(new Error(`Invalid zip entry path: ${entry.fileName}`));
                        return;
                    }

                    // Create directory if it doesn't exist
                    fs.mkdirSync(entryDir, { recursive: true });

                    if (/\/$/.test(entry.fileName)) {
                        // Directory entry
                        fs.mkdirSync(entryPath, { recursive: true });
                        zipfile.readEntry();
                    } else {
                        // File entry
                        zipfile.openReadStream(entry, (err, readStream) => {
                            if (err) { 
                                console.error('Failed to open read stream:', err);
                                reject(new Error(`Failed to open read stream: ${err.message}`)); 
                                return; 
                            }
                            if (!readStream) { 
                                console.error('Failed to open read stream: No stream object returned');
                                reject(new Error('Failed to open read stream')); 
                                return; 
                            }

                            const writeStream = fs.createWriteStream(entryPath, { flags: 'w' });

                            writeStream.on('error', (error) => {
                                console.error('Write stream error:', error);
                                readStream.destroy();
                                reject(new Error(`Failed to write file ${entry.fileName}: ${error.message}`));
                            });

                            readStream.on('error', (error) => {
                                console.error('Read stream error:', error);
                                writeStream.destroy();
                                reject(new Error(`Failed to read file ${entry.fileName}: ${error.message}`));
                            });

                            readStream.pipe(writeStream);
                            writeStream.on('finish', () => {
                                zipfile.readEntry();
                            });
                        });
                    }
                } catch (error) {
                    console.error('Error processing zip entry:', error);
                    reject(new Error(`Failed to process zip entry ${entry.fileName}: ${error.message}`));
                }
            });

            zipfile.readEntry();
        });
    });
}

export async function unzip(source: string, destinationDir: string): Promise<void> {
    console.log(`Extracting ${source} to ${destinationDir}`);

    if (!source || !destinationDir) {
        throw new Error('Source and destination paths are required');
    }

    if (!fs.existsSync(source)) {
        throw new Error(`Source file does not exist: ${source}`);
    }

    try {
        // Check if destination directory is writable
        try {
            const testFile = path.join(destinationDir, '.write-test');
            fs.mkdirSync(destinationDir, { recursive: true });
            fs.writeFileSync(testFile, '');
            fs.unlinkSync(testFile);
        } catch (error) {
            throw new Error(`Destination directory is not writable: ${error.message}`);
        }

        if (source.endsWith('.zip')) {
            await extractZipWithYauzl(source, destinationDir);
        } else {
            // Ensure destination directory exists
            if (!fs.existsSync(destinationDir)) {
                fs.mkdirSync(destinationDir, { recursive: true });
            }

            console.log('Using tar for extraction');
            const result = cp.spawnSync('tar', ['-xzf', source, '-C', destinationDir, '--strip-components', '1']);
            
            if (result.error) {
                console.error('Tar extraction error:', result.error);
                throw result.error;
            }
            
            if (result.status !== 0) {
                const errorMessage = result.stderr.toString();
                console.error('Tar extraction failed:', errorMessage);
                throw new Error(`tar extraction failed with status ${result.status}: ${errorMessage}`);
            }
            
            console.log('Tar extraction completed successfully');
        }
    } catch (error) {
        console.error('Extraction error:', error);
        throw new Error(`Failed to extract ${source} to ${destinationDir}: ${error.message}`);
    }
}