/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CodeSymbolsIndexer } from '../languages/codeSymbolsIndexerTypes';
import { CodeSymbolInformation } from './types';
import axios from 'axios';
import * as path from 'path';
import * as fs from 'fs';
import { v4 as uuidV4 } from 'uuid';

export class PythonServer extends CodeSymbolsIndexer {
	private _serverUrl: string;
	constructor(serverUrl: string) {
		super('python', ['py']);
		this._serverUrl = serverUrl;
	}

	async parseFile(filePath: string): Promise<CodeSymbolInformation[]> {
		const endpoint = `${this._serverUrl}/api/get_file_information_for_plugin`;
		try {
			const { data } = await axios.post(endpoint, {
				file_path: filePath,
			});
			// console.log('Whats the data after parsing the file');
			// console.log(data);
			const codeSymbols = JSON.parse(data).code_symbols as CodeSymbolInformation[];
			// console.log('How many code symbols do we have: ' + codeSymbols.length);
			return codeSymbols;
		} catch (e) {
			// console.log(e);
			return [];
		}
	}

	async parseFileWithDependencies(filePath: string, _workingDirectory: string, _useCache: boolean = false): Promise<CodeSymbolInformation[]> {
		return await this.parseFile(filePath);
	}

	async parseFileWithoutDependency(filePath: string, _workingDirectory: string, _storeInCache: boolean = true): Promise<CodeSymbolInformation[]> {
		return await this.parseFile(filePath);
	}

	async parseFileWithContent(filePath: string, fileContents: string): Promise<CodeSymbolInformation[]> {
		const dirName = path.dirname(filePath); // Get the directory name
		const extName = path.extname(filePath); // Get the extension name
		const newFileName = uuidV4(); // Your new file name without extension
		const newFilePath = path.join(dirName, `${newFileName}${extName}`);
		// write the content to this file for now
		fs.writeFileSync(newFilePath, fileContents);
		const codeSymbolInformationHackedTogether = await this.parseFile(newFilePath);
		// delete the file at this point
		fs.unlinkSync(newFilePath);
		const codeSymbolInformation = codeSymbolInformationHackedTogether.map((codeSymbol) => {
			codeSymbol.symbolName = codeSymbol.symbolName.replace(
				newFileName,
				path.basename(filePath).replace(extName, '')
			);
			codeSymbol.displayName = codeSymbol.displayName.replace(
				newFileName,
				path.basename(filePath).replace(extName, '')
			);
			return codeSymbol;
		});
		return codeSymbolInformation;
	}
}


// void (async () => {
// 	const server = new PythonServer(`http://localhost:${PORT}`);
// 	const result = await server.parseFile('/Users/skcd/scratch/anton/anton/server/start_server.py');
// 	console.log(result);
// })();
