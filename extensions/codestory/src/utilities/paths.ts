/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'path';
import * as fs from 'fs';
import os from 'os';

function toPosixPath(p: string) {
	// Extended-Length Paths in Windows start with '\\?\' to allow longer paths and bypass usual parsing. If detected, we return the path unmodified to maintain functionality, as altering these paths could break their special syntax.
	const isExtendedLengthPath = p.startsWith('\\\\?\\');

	if (isExtendedLengthPath) {
		return p;
	}

	return p.replace(/\\/g, '/');
}

// Declaration merging allows us to add a new method to the String type
// You must import this file in your entry point (extension.ts) to have access at runtime
declare global {
	interface String {
		toPosix(): string;
	}
}

String.prototype.toPosix = function (this: string): string {
	return toPosixPath(this);
};

export function checkIsValidFullPath(pathToCheck: string) {
	try {
		fs.accessSync(pathToCheck);
		return true;
	} catch (err) {
		return false;
	}
}

export function checkIsValidURL(string: string) {
	try {
		new URL(string);
		return true;
	} catch (err) {
		return false;
	}
}


// Safe path comparison that works across different platforms
export function arePathsEqual(path1?: string, path2?: string): boolean {
	if (!path1 && !path2) {
		return true;
	}
	if (!path1 || !path2) {
		return false;
	}

	path1 = normalizePath(path1);
	path2 = normalizePath(path2);

	if (process.platform === 'win32') {
		return path1.toLowerCase() === path2.toLowerCase();
	}
	return path1 === path2;
}

function normalizePath(p: string): string {
	// normalize resolve ./.. segments, removes duplicate slashes, and standardizes path separators
	let normalized = path.normalize(p);
	// however it doesn't remove trailing slashes
	// remove trailing slash, except for root paths
	if (normalized.length > 1 && (normalized.endsWith('/') || normalized.endsWith('\\'))) {
		normalized = normalized.slice(0, -1);
	}
	return normalized;
}

export function getReadablePath(cwd: string, relPath?: string): string {
	relPath = relPath || '';
	// path.resolve is flexible in that it will resolve relative paths like '../../' to the cwd and even ignore the cwd if the relPath is actually an absolute path
	const absolutePath = path.resolve(cwd, relPath);
	if (arePathsEqual(cwd, path.join(os.homedir(), 'Desktop'))) {
		// User opened vscode without a workspace, so cwd is the Desktop. Show the full absolute path to keep the user aware of where files are being created
		return absolutePath.toPosix();
	}
	if (arePathsEqual(path.normalize(absolutePath), path.normalize(cwd))) {
		return path.basename(absolutePath).toPosix();
	} else {
		// show the relative path to the cwd
		const normalizedRelPath = path.relative(cwd, absolutePath);
		if (absolutePath.includes(cwd)) {
			return normalizedRelPath.toPosix();
		} else {
			// we are outside the cwd, so show the absolute path (useful for when cline passes in '../../' for example)
			return absolutePath.toPosix();
		}
	}
}
