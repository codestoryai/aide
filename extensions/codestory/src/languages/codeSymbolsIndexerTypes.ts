/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CodeSymbolInformation } from '../utilities/types';


export abstract class CodeSymbolsIndexer {
	public supportedFileFormats: string[];
	public indexerType: string;

	constructor(indexerType: string, supportedFileFormats: string[]) {
		this.supportedFileFormats = supportedFileFormats;
		this.indexerType = indexerType;
	}

	abstract parseFileWithoutDependency(filePath: string, workingDirectory: string, storeInCache: boolean): Promise<CodeSymbolInformation[]>;

	abstract parseFileWithDependencies(filePath: string, workingDirectory: string, storeInCache: boolean): Promise<CodeSymbolInformation[]>;

	abstract parseFileWithContent(filePath: string, fileContents: string): Promise<CodeSymbolInformation[]>;
}
