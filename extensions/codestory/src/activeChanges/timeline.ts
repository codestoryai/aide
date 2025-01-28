/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { createPatch } from 'diff';
import { ExtensionContext, workspace } from 'vscode';
import { CodeSymbolChangeType } from './trackCodeSymbolChanges';
import { stateManager } from '../utilities/stateManager';

// The data we need to send over to the webview for rendering the timeline
export interface CodeSymbolChangeWebView {
	name: string;
	startLine: number;
	endLine: number;
	changeType: CodeSymbolChangeType;
	filePath: string;
	workingDirectory: string;
	changeTime: Date;
	relativePath: string;
	componentIdentifier: string;
	commitIdentifier: string;
	displayName: string;
	diffPatch: string;
}

export const onDidOpenTextDocument = (context: ExtensionContext) => {
	workspace.onDidOpenTextDocument((doc) => {
		stateManager(context).updateDocuments(doc.uri.fsPath, doc.getText());
	});
};

export const onTextDocumentChange = (context: ExtensionContext) => {
	const state = stateManager(context);
	return workspace.onDidSaveTextDocument(async (doc) => {
		const documents = state.getDocuments();
		// console.log('something');
		if (doc.uri.fsPath in documents) {
			const checkpoint = new Date();
			const oldText = documents[doc.uri.fsPath] || '';
			const newText = doc.getText();
			// console.log('something');

			const diff =
				`${checkpoint.toLocaleString('en-US')}\n` +
				createPatch(doc.uri.fsPath, oldText, newText) +
				'\n';

			state.setCheckpoint(checkpoint);
			state.appendChanges(diff);
			state.updateDocuments(doc.uri.fsPath, newText);
		}
	});
};
