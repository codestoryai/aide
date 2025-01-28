/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as path from 'path';
import ignore, { Ignore } from 'ignore';
import { SidecarListFilesEndpoint, SidecarListFilesOutput } from './types';

/**
 * Reads the content of .gitignore in the given directory (if it exists),
 * parses it, and returns an Ignore instance with those rules applied.
 */
async function loadGitIgnore(dirUri: vscode.Uri): Promise<Ignore> {
	const ig = ignore();
	try {
		const gitIgnoreUri = vscode.Uri.joinPath(dirUri, '.gitignore');
		// readFile returns a Uint8Array
		const content = await vscode.workspace.fs.readFile(gitIgnoreUri);
		// Convert to string and add to ignore rules
		ig.add(content.toString());
	} catch (error) {
		// If .gitignore doesn't exist or some error occurs, we just skip
		// (You might want to handle it or log it)
	}
	return ig;
}

/**
 * Checks whether a given directory is the root of the file system or the user's home.
 * In a VS Code extension, typically you are dealing with workspace folders rather
 * than raw OS directories. This check might be simpler or might not apply at all,
 * but here's a placeholder for demonstration.
 */
function isRootOrHome(uri: vscode.Uri): boolean {
	// Because we don't necessarily have direct OS-level path checks in the same
	// sense as the Rust example, you might implement your own logic or skip this
	// step entirely. For demonstration, we'll just do a naive check:

	const fsPath = uri.fsPath;
	const home = process.env.HOME || process.env.USERPROFILE; // Not always reliable in all OS setups

	// e.g. root on Unix is '/' and on Windows might be 'C:\\'
	const isRoot = fsPath === '/' || /^[A-Za-z]:\\?$/.test(fsPath);
	const isHome = home ? fsPath === home : false;

	return isRoot || isHome;
}

/**
 * Recursively list files from a given folder Uri, respecting:
 *   1) A maximum limit
 *   2) BFS strategy
 *   3) .gitignore rules (via 'ignore' library)
 *   4) Additional ignored directories (like 'node_modules', 'dist', etc.)
 *
 * @param dirUri The URI of the directory to walk
 * @param recursive Whether to recurse into subdirectories
 * @param limit Maximum number of file entries to return
 * @returns A tuple of (fileUris, limitReached)
 */
export async function listFiles(
	dirUri: vscode.Uri,
	recursive: boolean,
	limit: number
): Promise<[vscode.Uri[], boolean]> {
	// Check if dirUri is root or home
	if (isRootOrHome(dirUri)) {
		return [[dirUri], false];
	}

	const results: vscode.Uri[] = [];
	let limitReached = false;

	// For BFS, we use a queue
	const queue: vscode.Uri[] = [dirUri];
	// Keep track of visited to avoid loops
	const visited = new Set<string>();

	// Additional ignore list
	const alwaysIgnoreNames = new Set<string>([
		'node_modules',
		'__pycache__',
		'env',
		'venv',
		'target',
		'.target',
		'build',
		'dist',
		'out',
		'bundle',
		'vendor',
		'tmp',
		'temp',
		'deps',
		'pkg',
	]);

	// Load .gitignore rules from the root directory where you started
	// (You may want to do something more advanced if you support nested .gitignore files)
	const rootGitIgnore = await loadGitIgnore(dirUri);

	// For demonstration, let's apply BFS:
	while (queue.length > 0) {
		const currentDir = queue.shift()!;

		// Check if we've visited this directory
		if (visited.has(currentDir.fsPath)) {
			continue;
		}
		visited.add(currentDir.fsPath);

		// Read the directory
		let dirEntries: [string, vscode.FileType][] = [];
		try {
			dirEntries = await vscode.workspace.fs.readDirectory(currentDir);
		} catch (err) {
			// Might occur if we don't have permissions or if it's not a folder
			// In the Rust code, you'd skip or log the error
			console.error(`Error reading directory: ${currentDir.fsPath}`, err);
			continue;
		}

		for (const [name, fileType] of dirEntries) {
			const childUri = vscode.Uri.joinPath(currentDir, name);

			// We can check if we should ignore this file/folder:
			// 1) Check additional ignore set
			if (alwaysIgnoreNames.has(name)) {
				continue;
			}

			// 2) Check .gitignore rules
			//    Note: .gitignore rules typically are relative to the root project path,
			//    so usage can vary. Another approach is to load a .gitignore in each subfolder.
			//    But for simplicity, we use the root .gitignore here.
			const relativePath = path.relative(dirUri.fsPath, childUri.fsPath);
			if (rootGitIgnore.ignores(relativePath)) {
				continue;
			}

			// If we have a hidden file or directory (leading '.'), decide if you want to skip:
			// if (name.startsWith('.')) { ... }

			// If it's a directory
			if (fileType === vscode.FileType.Directory) {
				if (recursive) {
					queue.push(childUri);
				}
				// We won't add directory URIs to results if we only want "files".
				// But if you want directories in the final results, you can push it here.
				continue;
			}

			// It's a file (or symbolic link that we can treat as a file)
			results.push(childUri);

			if (results.length >= limit) {
				limitReached = true;
				break;
			}
		}

		if (limitReached) {
			break;
		}
	}

	return [results, limitReached];
}

/**
 * Returns the list of files for sidecar
 */
export async function listFilesEndpoint(
	input: SidecarListFilesEndpoint,
): Promise<SidecarListFilesOutput> {
	const results = await listFiles(
		vscode.Uri.file(input.directory_path),
		input.recursive,
		250,
	);
	return {
		files: results[0].map((result) => {
			return result.fsPath;
		}),
		limit_reached: results[1],
	};
}
