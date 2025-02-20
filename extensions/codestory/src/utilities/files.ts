/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as path from 'path';
import * as fs from 'fs';

// Helper function to safely parse JSON
function safeJSONParse(text: string): any {
    try {
        text = text.replace(/^\uFEFF/, '').trim();
        return JSON.parse(text);
    } catch (error) {
        console.error('Failed to parse JSON:', error);
        console.error('Raw content:', text);
        throw error;
    }
}

// Read and return data from sample.json file in working directory
export const readJSONFromFile = () => {
	const filePath = path.join(__dirname, '../../sample.json');
	const fileData = fs.readFileSync(filePath, 'utf-8');
	return safeJSONParse(fileData);
};