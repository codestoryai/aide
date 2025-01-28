/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/


const lStripMax = (
	str: string,
	chars: string[],
	maxCount: number,
): string => {
	let count = 0;
	for (let index = 0; index < str.length; index++) {
		const char = str[index];
		if (chars.includes(char) && count < maxCount) {
			count++;
		} else {
			break;
		}
	}
	return str.slice(count);
};


const getSnippetWithPadding = (
	originalLines: string[],
	index: number,
	searchLines: string[],
): {
	snippet: string[];
	spaces: string;
	strip: boolean;
} => {
	const snippet = originalLines.slice(index, index + searchLines.length);
	let spaces = '';
	let strip = false;
	if (searchLines[0].length - searchLines[0].trimLeft().length === 0) {
		const spacesNeeded = originalLines[index].length - originalLines[index].trimLeft().length;
		for (let index = 0; index < spacesNeeded; index++) {
			spaces += ' ';
		}
		strip = false;
	} else {
		let minimumWhitespace = 0;
		for (let index = 0; index < searchLines.length; index++) {
			const line = searchLines[index];
			const whitespace = line.length - line.trimLeft().length;
			if (index === 0) {
				minimumWhitespace = whitespace;
			} else {
				minimumWhitespace = Math.min(minimumWhitespace, whitespace);
			}
		}
		strip = true;
	}
	return {
		snippet: snippet,
		spaces,
		strip,
	};
};


const matchString = (
	originalFileLines: string[],
	oldChunkLines: string[],
	startIndex: number | null,
	exactMatch: boolean,
): {
	index: number;
	maxSimilarity: number;
	currentHits: number;
} => {
	let maxSimilarity = 0;
	let index = -1;
	let currentHits = 0;
	// sliding window comparison from original to search
	// TODO(codestory): 2 pointer approach and use rapidfuzz to compute string
	// similarity
	for (let i = startIndex ?? 0; i < originalFileLines.length; i++) {
		let matchCount = 0;
		for (let j = 0; j < oldChunkLines.length; j++) {
			if (i + j >= originalFileLines.length) {
				continue;
			}
			let isMatch = false;
			if (exactMatch) {
				if (oldChunkLines[j] === originalFileLines[i + j]) {
					isMatch = true;
				}
			} else {
				isMatch = oldChunkLines[j].trim() === originalFileLines[i + j].trim();
			}
			if (isMatch) {
				matchCount++;

				if (startIndex !== null && oldChunkLines[j] === originalFileLines[i + j]) {
					matchCount = matchCount + 0.001;
				}
			}
		}

		if (matchCount > maxSimilarity) {
			maxSimilarity = matchCount;
			index = i;
			currentHits = 1;
		} else if (matchCount === maxSimilarity) {
			currentHits++;
		}
	}
	return {
		index,
		maxSimilarity,
		currentHits,
	};
};


const slidingWindowReplacement = (
	oldFileLines: string[],
	oldChunkLines: string[],
	newChunkLines: string[],
	searchContextBefore: string[] | null,
	exactMatch: boolean = false,
): {
	original: string[];
	indexToStart: number;
} => {
	// The model might be writing "..." in its response to suggest that we
	// don't have to make changes, so we need to check for that
	let canDoDotCheck = false;
	oldFileLines.forEach((chunk) => {
		const trimmedChunk = chunk.trim();
		if (trimmedChunk.includes('...')) {
			canDoDotCheck = true;
		}
	});

	// So we have ... in the output, lets fix that
	if (canDoDotCheck) {
		// Find the index for ... in the oldChunkLines
		let firstLineIndexOldChunk = -1;
		for (let index = 0; index < oldFileLines.length; index++) {
			const line = oldFileLines[index];
			if (line.trim().includes('...')) {
				firstLineIndexOldChunk = index;
				break;
			}
		}

		// Find the index for ... in the newChunkLines
		let firstLineIndexNewChunk = -1;
		for (let index = 0; index < newChunkLines.length; index++) {
			const line = newChunkLines[index];
			if (line.trim().includes('...')) {
				firstLineIndexNewChunk = index;
				break;
			}
		}

		// now we might have multiple cases here, lets handle them one by one
		if (firstLineIndexOldChunk === 0 && firstLineIndexNewChunk === 0) {
			oldChunkLines = oldChunkLines.slice(1);
			newChunkLines = newChunkLines.slice(1);
		} else if (firstLineIndexOldChunk === oldFileLines.length - 1 && firstLineIndexNewChunk === newChunkLines.length - 1) {
			oldChunkLines = oldChunkLines.slice(0, oldChunkLines.length - 1);
			newChunkLines = newChunkLines.slice(0, newChunkLines.length - 1);
		} else if (firstLineIndexOldChunk !== -1 && firstLineIndexNewChunk !== -1) {
			const searchContextBefore = oldChunkLines.slice(0, firstLineIndexOldChunk);
			const fixedLinesFromBefore = slidingWindowReplacement(
				oldFileLines,
				oldChunkLines.slice(firstLineIndexOldChunk + 1, oldChunkLines.length),
				newChunkLines.slice(firstLineIndexNewChunk + 1, newChunkLines.length),
				searchContextBefore,
			);
			oldFileLines = fixedLinesFromBefore.original;
			oldChunkLines = oldChunkLines.slice(0, firstLineIndexOldChunk);
			newChunkLines = newChunkLines.slice(0, firstLineIndexNewChunk);
		}
	}

	const matchingIndex = matchString(
		oldFileLines,
		oldChunkLines,
		null,
		exactMatch,
	);

	if (matchingIndex.maxSimilarity === 0) {
		return {
			original: oldFileLines,
			indexToStart: -1,
		};
	}

	if (matchingIndex.currentHits > 1) {
		// We have multiple hits which match, so we need to greedily match with
		// the one which is on top of the file
		let success = false;
		if (searchContextBefore) {
			const matchingIndex = matchString(
				oldFileLines,
				searchContextBefore,
				null,
				exactMatch,
			);
			const value = getSnippetWithPadding(
				oldFileLines,
				matchingIndex.index,
				searchContextBefore,
			);
			if (matchingIndex.currentHits === 1) {
				const matchingIndexWithSpaces = matchString(
					oldFileLines,
					oldChunkLines.map((line) => value.spaces + line),
					matchingIndex.index + 1,
					true,
				);
				console.log('matchingIndexWithSpaces', matchingIndexWithSpaces);
				matchingIndex.currentHits = 1;
				success = true;
			}
		}

		if (!success) {
			if (!exactMatch) {
				return slidingWindowReplacement(
					oldFileLines,
					oldChunkLines,
					newChunkLines,
					null,
					true,
				);
			}
			return {
				original: oldFileLines,
				indexToStart: -1,
			};
		}
	}

	if (matchingIndex.index === -1) {
		return {
			original: oldFileLines,
			indexToStart: -1,
		};
	}

	// Now we will try to get the snippet with padding
	// here we have to check for both tabs and spaces
	const snippetPadding = getSnippetWithPadding(
		oldFileLines,
		matchingIndex.index,
		oldChunkLines,
	);
	let finalModifiedLines: string[] = [];
	if (snippetPadding.strip) {
		// Get the spaces on the first line
		let spacesNeeded = 0;
		for (let index = 0; index < oldFileLines.length; index++) {
			spacesNeeded = Math.min(spacesNeeded, oldFileLines[index].length - oldFileLines[index].trimLeft().length);
		}
		// Now we get the modified lines
		const spaces = oldFileLines[matchingIndex.index].length - oldFileLines[matchingIndex.index].trimLeft().length;
		finalModifiedLines = newChunkLines.map((line) => {
			return snippetPadding.spaces + lStripMax(line, [' '], spaces);
		});
	} else {
		finalModifiedLines = newChunkLines.map((line) => {
			return snippetPadding.spaces + line;
		});
	}

	// Now we get the final original lines with our modification
	const originalLinesWithModification = [
		...oldFileLines.slice(0, matchingIndex.index),
		...finalModifiedLines,
		...oldFileLines.slice(matchingIndex.index + oldChunkLines.length),
	];
	return {
		original: originalLinesWithModification,
		indexToStart: matchingIndex.index + finalModifiedLines.length,
	};
};

export const generateNewFileFromPatch = (
	modifyFileResponse: string,
	oldFileContents: string,
	_chunkOffset: number = 0,
): string | null => {
	let oldFileLines = oldFileContents.split('\n');

	const matches = modifyFileResponse.match(/<<<<.*?\n([\s\S]*?)\n====[^\n=]*\n([\s\S]*?)\n?>>>>/gs);
	interface OldAndNewChunk {
		oldChunk: string;
		newChunk: string;
	}
	const oldAndNewChunks: OldAndNewChunk[] = [];
	if (matches) {
		for (const match of matches) {
			const parts = match.split(/====[^\n=]*\n/);
			const leftContent = parts[0].replace(/<<<<.*?\n/, '');
			const rightContent = parts[1].replace(/>>>>\n?/, '');
			// We get trailing \n at the end of these strings, so we need to
			// replace them with '' instead, so we don't mess things up later on
			oldAndNewChunks.push({
				oldChunk: leftContent.replace(/\n$/, ''),
				newChunk: rightContent.replace(/\n$/, ''),
			});
		}
	}

	if (oldFileContents.trim() === '') {
		// If file is empty then return the first match
		if (oldAndNewChunks.length > 0) {
			return oldAndNewChunks[0].newChunk;
		} else {
			return null;
		}
	}

	for (let index = 0; index < oldAndNewChunks.length; index++) {
		let oldChunk = oldAndNewChunks[index].oldChunk;
		let newChunk = oldAndNewChunks[index].newChunk;
		// We strip the <old_file>{code}</old_file> if its showing up in the response
		if (oldChunk.trimLeft().startsWith('<old_file>') && newChunk.trimLeft().startsWith('<old_file>')) {
			oldChunk = oldChunk.replace(/<old_file>/, '');
			newChunk = newChunk.replace(/<old_file>/, '');
		}
		if (oldChunk.trimEnd().endsWith('</old_file>') && newChunk.trimEnd().endsWith('</old_file>')) {
			oldChunk = oldChunk.replace(/<\/old_file>/, '');
			newChunk = newChunk.replace(/<\/old_file>/, '');
		}
		const oldFileLinesModified = slidingWindowReplacement(
			oldFileLines,
			oldChunk.split('\n'),
			newChunk.split('\n'),
			null,
			false,
		);
		oldFileLines = oldFileLinesModified.original;
	}

	return oldFileLines.join('\n');
};


// void (async () => {
// 	const originalFile = `
// import { Project } from "ts-morph";
// import * as fs from "fs";
// import * as path from "path";

// import {
// 	CodeStoryStorage,
// 	saveCodeStoryStorageObjectToStorage,
// 	saveCodeStoryStorageToStorage,
// } from "./types";
// import { CodeSymbolInformation, CodeSymbolInformationEmbeddings } from "../utilities/types";
// import { TSMorphProjectManagement, parseFileUsingTsMorph } from "../utilities/parseTypescript";
// import { generateEmbedding } from "../llm/embeddings/openai";
// import { ExtensionContext } from "vscode";
// import { getGitCurrentHash, getGitRepoName } from "../git/helper";
// import logger from "../logger";
// // import logger from "../logger";

// async function ensureDirectoryExists(filePath: string): Promise<void> {
// 	const parentDir = path.dirname(filePath);

// 	if (fs.existsSync(parentDir)) {
// 		// The parent directory already exists, so we don't need to create it
// 		return;
// 	}

// 	// Recursively create the parent directory
// 	await ensureDirectoryExists(parentDir);

// 	// Create the directory
// 	fs.mkdirSync(parentDir);
// }

// const generateContextForEmbedding = (
// 	codeSnippet: string,
// 	filePath: string,
// 	scopePart: string | null
// ): string => {
// 	return \`
// 		Code snippet:
// 		\${codeSnippet}

// 		File path it belongs to:
// 		\${filePath}

// 		Scope part:
// 		\${scopePart}
// 	\`;
// };

// export async function storeCodeSymbolDescriptionToLocalStorage(
// 	codeSymbolName: string,
// 	remoteSession: string,
// 	globalStorageUri: string,
// 	data: CodeSymbolInformationEmbeddings
// ) {
// 	const filePath = path.join(
// 		globalStorageUri,
// 		remoteSession,
// 		"code_symbol",
// 		"descriptions",
// 		codeSymbolName
// 	);
// 	await ensureDirectoryExists(filePath);
// 	console.log("Writing to file: " + filePath);
// 	// Now we have ensured the directory exists we can safely write to it
// 	await fs.promises
// 		.writeFile(filePath, JSON.stringify(data))
// 		.then(() => {
// 			console.log("Successfully wrote file: " + filePath);
// 		})
// 		.catch((err) => {
// 			console.error("Error writing file: " + err.toString());
// 		});
// }


// export async function loadCodeSymbolDescriptionFromLocalStorage(
// 	globalStorageUri: string,
// 	remoteSession: string,
// ): Promise<CodeSymbolInformationEmbeddings[]> {
// 	const directoryPath = path.join(
// 		globalStorageUri,
// 		remoteSession,
// 		"code_symbol",
// 		"descriptions",
// 	);
// 	const files = await fs.promises.readdir(directoryPath);
// 	logger.info("[indexing_start] loading from files");
// 	logger.info(files.length);
// 	const codeSymbolInformationEmbeddingsList: CodeSymbolInformationEmbeddings[] = [];
// 	for (let index = 0; index < files.length; index++) {
// 		const file = files[index];
// 		logger.info(index);
// 		logger.info(file);
// 		const filePath = path.join(directoryPath, file);
// 		logger.info(filePath);
// 		const fileContent = fs.readFileSync(filePath);
// 		logger.info("[indexing_start] loaded from file");
// 		try {
// 			const codeSymbolInformationEmbeddings = JSON.parse(fileContent.toString()) as CodeSymbolInformationEmbeddings;
// 			logger.info("[indexing_start] parsed from json");
// 			codeSymbolInformationEmbeddingsList.push(codeSymbolInformationEmbeddings);
// 		} catch (error) {
// 			logger.info("[indexing_start] error");
// 			logger.info(error);
// 		}
// 	}
// 	logger.info("[indexing_start] loaded from files");
// 	return codeSymbolInformationEmbeddingsList;
// }

// export const getCodeSymbolList = async (
// 	project: Project,
// 	workingDirectory: string
// ): Promise<CodeSymbolInformation[]> => {
// 	const sourceFiles = project.getSourceFiles();
// 	const codeSymbolInformationList: CodeSymbolInformation[] = [];
// 	for (let index = 0; index < sourceFiles.length; index++) {
// 		const sourceFile = sourceFiles[index];
// 		const sourceFilePath = sourceFile.getFilePath();
// 		const codeSymbolInformation = parseFileUsingTsMorph(
// 			sourceFilePath,
// 			project,
// 			workingDirectory,
// 			sourceFilePath
// 		);
// 		codeSymbolInformationList.push(...codeSymbolInformation);
// 	}
// 	return codeSymbolInformationList;
// };

// const generateAndStoreEmbeddings = async (
// 	codeSymbolInformationList: CodeSymbolInformation[],
// 	workingDirectory: string,
// 	globalStorageUri: string
// ): Promise<CodeSymbolInformationEmbeddings[]> => {
// 	const codeSymbolWithEmbeddings: CodeSymbolInformationEmbeddings[] = [];
// 	for (let index = 0; index < codeSymbolInformationList.length; index++) {
// 		const codeSymbol = codeSymbolInformationList[index];
// 		const codeContent = codeSymbol.codeSnippet.code;
// 		const filePath = codeSymbol.fsFilePath;
// 		const scopePart = codeSymbol.globalScope;
// 		const relativePath = filePath.replace(workingDirectory, "");
// 		const contextForEmbedding = generateContextForEmbedding(codeContent, relativePath, scopePart);
// 		// We generate the embeddings here
// 		const embeddings = await generateEmbedding(contextForEmbedding);
// 		codeSymbolWithEmbeddings.push({
// 			codeSymbolInformation: codeSymbol,
// 			codeSymbolEmbedding: embeddings,
// 		});
// 		// We store it locally to our local storage
// 		await storeCodeSymbolDescriptionToLocalStorage(
// 			codeSymbol.symbolName,
// 			await getGitRepoName(workingDirectory),
// 			globalStorageUri,
// 			{
// 				codeSymbolInformation: codeSymbol,
// 				codeSymbolEmbedding: embeddings,
// 			}
// 		);
// 	}
// 	return codeSymbolWithEmbeddings;
// };


// export const indexRepository = async (
// 	storage: CodeStoryStorage,
// 	projectManagement: TSMorphProjectManagement,
// 	globalStorageUri: string,
// 	workingDirectory: string
// ): Promise<CodeSymbolInformationEmbeddings[]> => {
// 	// One way to do this would be that we walk along the whole repo and index
// 	// it
// 	// After which is the repo is already indexed, then we should figure out
// 	// how to take care of deletions and moved files, these are the most important
// 	// ones
// 	// TODO(codestory): We need to only look at the changes later and index them
// 	// for now this is fine.
// 	let codeSymbolWithEmbeddings: CodeSymbolInformationEmbeddings[] = [];
// 	logger.info("[indexing_start] Starting indexing", storage.isIndexed);
// 	if (!storage.isIndexed) {
// 		// logger.info("[indexing_start] Starting indexing");
// 		// Start re-indexing right now.
// 		projectManagement.directoryToProjectMapping.forEach(async (project, workingDirectory) => {
// 			const codeSymbolInformationList = await getCodeSymbolList(project, workingDirectory);
// 			const codeSymbolWithEmbeddingsForProject = await generateAndStoreEmbeddings(
// 				codeSymbolInformationList,
// 				workingDirectory,
// 				globalStorageUri
// 			);
// 			codeSymbolWithEmbeddings.push(...codeSymbolWithEmbeddingsForProject);
// 		});
// 		storage.lastIndexedRepoHash = await getGitCurrentHash(workingDirectory);
// 		storage.isIndexed = true;
// 		saveCodeStoryStorageObjectToStorage(globalStorageUri, storage, workingDirectory);
// 	} else {
// 		// TODO(codestory): Only look at the delta and re-index these files which have changed.
// 		const currentHash = await getGitCurrentHash(workingDirectory);
// 		logger.info("[indexing_start] hash for current checkout");
// 		logger.info(currentHash);
// 		logger.info(storage.lastIndexedRepoHash);
// 		if (currentHash !== storage.lastIndexedRepoHash) {
// 			// We need to re-index the repo
// 			// TODO(codestory): Repeated code here, we need to clean it up
// 			projectManagement.directoryToProjectMapping.forEach(async (project, workingDirectory) => {
// 				const codeSymbolInformationList = await getCodeSymbolList(project, workingDirectory);
// 				logger.info("[indexing_start] Starting indexing for project");
// 				const codeSymbolWithEmbeddingsForProject = await generateAndStoreEmbeddings(
// 					codeSymbolInformationList,
// 					workingDirectory,
// 					globalStorageUri
// 				);
// 				codeSymbolWithEmbeddings.push(...codeSymbolWithEmbeddingsForProject);
// 			});
// 			storage.lastIndexedRepoHash = await getGitCurrentHash(workingDirectory);
// 			storage.isIndexed = true;
// 			saveCodeStoryStorageObjectToStorage(globalStorageUri, storage, workingDirectory);
// 		} else {
// 			// We should load all the code symbols with embeddings from the local storage
// 			// and return it
// 			const repoName = await getGitRepoName(workingDirectory);
// 			logger.info("[indexing_start] Loading from local storage");
// 			codeSymbolWithEmbeddings = await loadCodeSymbolDescriptionFromLocalStorage(
// 				globalStorageUri,
// 				repoName,
// 			);
// 			logger.info("[indexing_start] Loaded from local storage");
// 		}
// 	}
// 	return codeSymbolWithEmbeddings;
// };
// 	`;
// 	const modifyFileResponse = `
// \`\`\`
// <<<< ORIGINAL
//         const filePath = path.join(directoryPath, file);
//         logger.info(filePath);
//         const fileContent = fs.readFileSync(filePath);
//         logger.info("[indexing_start] loaded from file");
// ====
//         const filePath = path.join(directoryPath, file);
//         logger.info("[indexing_start] Loading from file path: " + filePath);
//         const fileContent = fs.readFileSync(filePath);
//         logger.info("[indexing_start] Successfully loaded from: " + filePath);
// >>>> UPDATED
// \`\`\`
// 	`;

// 	const newFile = generateNewFileFromPatch(modifyFileResponse, originalFile);
// 	console.log(newFile);
// })();
