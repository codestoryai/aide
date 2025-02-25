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
    try {
        ensureDirectoryExists(destination);

        const platform = process.platform;
        const architecture = process.arch;
        const source = `${version}/${platform}/${architecture}/sidecar.zip`;
        console.log(`Downloading sidecar for ${platform}-${architecture} from version ${version}`);
        
        await downloadUsingURL(source, destination);
        console.log('Successfully downloaded sidecar binary');
    } catch (err) {
        console.error('Failed to download sidecar:', err);
        if (err.response) {
            console.error('Response status:', err.response.status);
            console.error('Response data:', err.response.data);
        }
        throw new Error(`Failed to download sidecar: ${err.message}`);
    }
};

const downloadUsingURL = async (source: string, destination: string) => {
    const url = `https://storage.googleapis.com/${BUCKET_NAME}/${source}`;
    console.log('Downloading from URL:', url);
    
    try {
        const response = await axios.get(url, { 
            responseType: 'stream',
            timeout: 30000 // 30 second timeout
        });
        
        const writer = fs.createWriteStream(destination);

        return new Promise((resolve, reject) => {
            response.data.pipe(writer);
            
            let error: Error | null = null;
            writer.on('error', err => {
                error = err;
                writer.close();
                reject(err);
            });
            
            writer.on('close', () => {
                if (!error) {
                    resolve(true);
                }
                // No need to reject here as it would have been handled in the error handler
            });
        });
    } catch (err) {
        if (err.code === 'ECONNREFUSED') {
            throw new Error('Connection refused. Please check your internet connection.');
        } else if (err.code === 'ETIMEDOUT') {
            throw new Error('Connection timed out. Please try again.');
        } else if (err.response && err.response.status === 404) {
            throw new Error(`Sidecar binary not found for your platform (${process.platform}-${process.arch}). Please check https://aide-updates.codestory.ai for supported platforms.`);
        }
        throw err;
    }
};