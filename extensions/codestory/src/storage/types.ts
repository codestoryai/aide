/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { getGitCurrentHash, getGitRemoteUrl, getGitRepoName } from '../git/helper';
import * as path from 'path';
import * as fs from 'fs';

export interface CodeStoryStorage {
	githubCurrentRepoHash: string;
	githubRepoName: string;
	githubRepoUrl: string;
	lastIndexedRepoHash: string | null;
	isIndexed: boolean;
}

async function ensureDirectoryExists(filePath: string): Promise<void> {
	const parentDir = path.dirname(filePath);

	if (fs.existsSync(parentDir)) {
		// The parent directory already exists, so we don't need to create it
		return;
	}

	// Recursively create the parent directory
	await ensureDirectoryExists(parentDir);

	// Create the directory
	fs.mkdirSync(parentDir);
}

// CodeStory storage path is
// extensionContext.globalStorageUri.fsPath + 'repo_name' + codestory.json
export const loadFromStorage = async (
	globalStorageUri: string,
	workingDirectory: string,
): Promise<CodeStoryStorage | null> => {
	const repoName = await getGitRepoName(
		workingDirectory,
	);
	const pathForStorage = path.join(globalStorageUri, repoName, 'codestory');
	ensureDirectoryExists(pathForStorage);
	try {
		const codeStoryStorage = fs.readFileSync(pathForStorage);
		return JSON.parse(codeStoryStorage.toString()) as CodeStoryStorage;
	} catch (e) {
		return null;
	}
};

export const saveCodeStoryStorageToStorage = async (
	globalStorageUri: string,
	workingDirectory: string,
): Promise<CodeStoryStorage> => {
	const repoName = await getGitRepoName(
		workingDirectory,
	);
	const pathForStorage = path.join(globalStorageUri, repoName, 'codestory');
	ensureDirectoryExists(pathForStorage);
	const codeStoryStorage = JSON.stringify({
		githubCurrentRepoHash: await getGitCurrentHash(
			workingDirectory,
		),
		githubRepoName: await getGitRepoName(
			workingDirectory,
		),
		githubRepoUrl: await getGitRemoteUrl(
			workingDirectory,
		),
		lastIndexedRepoHash: null,
		isIndexed: false,
	});
	fs.writeFileSync(pathForStorage, codeStoryStorage);
	return JSON.parse(codeStoryStorage) as CodeStoryStorage;
};

export const saveCodeStoryStorageObjectToStorage = async (
	globalStorageUri: string,
	codeStoryStorage: CodeStoryStorage,
	workingDirectory: string,
): Promise<CodeStoryStorage> => {
	const storagePath = globalStorageUri;
	const repoName = await getGitRepoName(
		workingDirectory,
	);
	const pathForStorage = path.join(storagePath, repoName, 'codestory');
	await ensureDirectoryExists(pathForStorage);
	const codeStoryStorageString = JSON.stringify(codeStoryStorage);
	fs.writeFileSync(pathForStorage, codeStoryStorageString);
	return JSON.parse(codeStoryStorageString) as CodeStoryStorage;
};

export const loadOrSaveToStorage = async (
	globalStorageUri: string,
	workingDirectory: string,
): Promise<CodeStoryStorage> => {
	const storage = await loadFromStorage(globalStorageUri, workingDirectory);
	if (storage) {
		return storage;
	}
	return saveCodeStoryStorageToStorage(globalStorageUri, workingDirectory);
};
