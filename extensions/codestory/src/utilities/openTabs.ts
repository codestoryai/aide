/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import { SideCarClient } from '../sidecar/client';

export function baseLanguageId(languageId: string): string {
	switch (languageId) {
		case 'typescript':
		case 'typescriptreact':
			return 'typescript';
		case 'javascript':
		case 'javascriptreact':
			return 'javascript';
		default:
			return languageId;
	}
}

export interface FileContents {
	uri: vscode.Uri;
	language: string;
	contents: string;
}

export function shouldTrackFile(uri: vscode.Uri): boolean {
	if (uri === undefined) {
		return false;
	}
	if (uri.scheme === undefined) {
		return false;
	}

	if (!['file'].includes(uri.scheme)) {
		return false;
	}
	if (uri.scheme === 'untitled') {
		return false;
	}
	// If we have rustup in the file name then we should not be tracking it
	if (uri.fsPath.indexOf('.rustup') !== -1) {
		return false;
	}
	return true;
}

export async function getRelevantFiles(): Promise<FileContents[]> {
	const files: FileContents[] = [];

	function addDocument(document: vscode.TextDocument): void {
		// Only add files to the uri schema.
		if (!['file'].includes(document.uri.scheme)) {
			return;
		}

		// if (baseLanguageId(document.languageId) !== baseLanguageId(curLang)) {
		// 	return
		// }

		// TODO(philipp-spiess): Find out if we have a better approach to truncate very large files.
		const endLine = Math.min(document.lineCount, 10_000);
		const range = new vscode.Range(0, 0, endLine, 0);

		files.push({
			uri: document.uri,
			language: document.languageId,
			contents: document.getText(range),
		});
	}

	const visibleUris = vscode.window.visibleTextEditors.flatMap(e =>
		e.document.uri.scheme === 'file' ? [e.document.uri] : []
	);

	// Use tabs API to get current docs instead of `vscode.workspace.textDocuments`.
	// See related discussion: https://github.com/microsoft/vscode/issues/15178
	// See more info about the API: https://code.visualstudio.com/api/references/vscode-api#Tab
	const allUris: vscode.Uri[] = vscode.window.tabGroups.all
		.flatMap(({ tabs }) => tabs.map(tab => (tab.input as any)?.uri))
		.filter(Boolean);

	// To define an upper-bound for the number of files to take into consideration, we consider all
	// active editor tabs and the 5 tabs (7 when there are no split views) that are open around it
	// (so we include 2 or 3 tabs to the left to the right).
	//
	// Consider files that are in the same directory or called similarly to be
	// more relevant.
	const uris: Map<string, vscode.Uri> = new Map();
	const surroundingTabs = visibleUris.length <= 1 ? 3 : 2;
	for (const visibleUri of visibleUris) {
		uris.set(visibleUri.toString(), visibleUri);
		const index = allUris.findIndex(uri => uri.toString() === visibleUri.toString());

		if (index === -1) {
			continue;
		}

		const start = Math.max(index - surroundingTabs, 0);
		const end = Math.min(index + surroundingTabs, allUris.length - 1);

		for (let j = start; j <= end; j++) {
			uris.set(allUris[j].toString(), allUris[j]);
		}
	}

	const docs = (
		await Promise.all(
			[...uris.values()].map(async uri => {
				if (!uri) {
					return [];
				}

				try {
					return [await vscode.workspace.openTextDocument(uri)];
				} catch (error) {
					console.error(error);
					return [];
				}
			})
		)
	).flat();

	for (const document of docs) {
		if (document.fileName.endsWith('.git')) {
			// The VS Code API returns fils with the .git suffix for every open file
			continue;
		}
		addDocument(document);
	}

	// await Promise.all(
	// 	history.lastN(10, curLang, [currentDocument.uri, ...files.map(f => f.uri)]).map(async item => {
	// 		try {
	// 			const document = await vscode.workspace.openTextDocument(item.document.uri)
	// 			addDocument(document)
	// 		} catch (error) {
	// 			console.error(error)
	// 		}
	// 	})
	// )
	return files;
}

export async function changedActiveDocument(document: vscode.TextEditor | undefined, sidecarClient: SideCarClient) {
	if (document === undefined) {
		return;
	}
	if (document.document.uri.scheme === 'codegen') {
		return;
	}
	if (shouldTrackFile(document.document.uri)) {
		await sidecarClient.documentOpen(
			document.document.uri.fsPath,
			document.document.getText(),
			document.document.languageId,
		);
	}
}
