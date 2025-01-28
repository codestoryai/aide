/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { TextDocument, TextEditor } from 'vscode';


export class ActiveFilesTracker {
	private _activeFiles: string[] = [];

	constructor() {
		this._activeFiles = [];
	}

	getActiveFiles(): string[] {
		return this._activeFiles;
	}

	openTextDocument(document: TextDocument) {
		if (document.uri.scheme !== 'file') {
			return;
		}
		// Check if the document is already in our list (for example, if it's a re-open)
		const index = this._activeFiles.findIndex(filePath => filePath === document.uri.fsPath);

		if (index === -1) {
			// Append the document to the end of our list if it's a new open
			this._activeFiles.push(document.uri.fsPath);
		}
	}

	onCloseTextDocument(document: TextDocument) {
		if (document.uri.scheme !== 'file') {
			return;
		}
		// Remove the document from our list
		const index = this._activeFiles.findIndex(filePath => filePath === document.uri.fsPath);

		if (index !== -1) {
			this._activeFiles.splice(index, 1);
		}
	}

	onDidChangeActiveTextEditor(editor: TextEditor | undefined) {
		if (editor && editor.document) {
			if (editor.document.uri.scheme !== 'file') {
				return;
			}
			const index = this._activeFiles.findIndex(filePath => filePath === editor.document.uri.fsPath);

			// Move the document to the end of the list if it's already there
			if (index !== -1) {
				const [doc] = this._activeFiles.splice(index, 1);
				this._activeFiles.push(doc);
			} else {
				// If not in the list, add it (just as a precaution)
				this._activeFiles.push(editor.document.uri.fsPath);
			}
		}
	}
}
