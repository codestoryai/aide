/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createTwoFilesPatch } from 'diff';
import * as vscode from 'vscode';
import { SidecarRecentEditsFilePreviousContent, SidecarRecentEditsRetrieverRequest, SidecarRecentEditsRetrieverResponse } from './types';
/**
 * We can grab the last edited files orderd by the timestamp over here
 */

interface AutocompleteContextSnippet {
	uri: vscode.Uri;
	content: string;
}

interface TrackedDocument {
	content: string;
	languageId: string;
	uri: vscode.Uri;
	changes: { timestamp: number; change: vscode.TextDocumentContentChangeEvent }[];
}

export function createGitDiff(filename: string, oldContent: string, newContent: string): string {
	const patch = createTwoFilesPatch(`a/${filename}`, `b/${filename}`, oldContent, newContent);
	return patch.split('\n').slice(1).join('\n');
}

interface DiffAcrossDocuments {
	diff: string;
	uri: vscode.Uri;
	languageId: string;
	latestChangeTimestamp: number;
	current_content: string;
}

export class RecentEditsRetriever implements vscode.Disposable {
	// We use a map from the document URI to the set of tracked completions inside that document to
	// improve performance of the `onDidChangeTextDocument` event handler.
	private trackedDocuments: Map<string, TrackedDocument> = new Map();
	private disposables: vscode.Disposable[] = [];

	constructor(
		private readonly maxAgeMs: number,
		readonly workspace: Pick<
			typeof vscode.workspace,
			'onDidChangeTextDocument' | 'onDidRenameFiles' | 'onDidDeleteFiles' | 'onDidCreateFiles'
		> = vscode.workspace
	) {
		this.disposables.push(workspace.onDidChangeTextDocument(this.onDidChangeTextDocument.bind(this)));
		this.disposables.push(workspace.onDidRenameFiles(this.onDidRenameFiles.bind(this)));
		this.disposables.push(workspace.onDidDeleteFiles(this.onDidDeleteFiles.bind(this)));
		this.disposables.push(workspace.onDidCreateFiles(this.onDidCreateFiles.bind(this)));
	}

	public async retrieveSidecar(request: SidecarRecentEditsRetrieverRequest): Promise<SidecarRecentEditsRetrieverResponse> {
		const rawDiffs = await this.getDiffAcrossDocuments(request.diff_file_content);
		const diffs = this.filterCandidateDiffs(rawDiffs);
		// Heuristics ordering by timestamp, taking the most recent diffs first.
		diffs.sort((a, b) => b.latestChangeTimestamp - a.latestChangeTimestamp);

		const autocompleteContextSnippets = [];
		for (const diff of diffs) {
			const content = diff.diff.toString();
			const autocompleteSnippet = {
				fs_file_path: diff.uri.fsPath,
				diff: content,
				updated_timestamp_ms: diff.latestChangeTimestamp,
				current_content: diff.current_content,
			};
			autocompleteContextSnippets.push(autocompleteSnippet);
		}
		return {
			changed_files: autocompleteContextSnippets
		};
	}

	public async retrieve(): Promise<AutocompleteContextSnippet[]> {
		const rawDiffs = await this.getDiffAcrossDocuments([]);
		const diffs = this.filterCandidateDiffs(rawDiffs);
		// Heuristics ordering by timestamp, taking the most recent diffs first.
		diffs.sort((a, b) => b.latestChangeTimestamp - a.latestChangeTimestamp);

		const autocompleteContextSnippets = [];
		for (const diff of diffs) {
			const content = diff.diff.toString();
			const autocompleteSnippet = {
				uri: diff.uri,
				content,
			};
			autocompleteContextSnippets.push(autocompleteSnippet);
		}
		// @ts-ignore
		return autocompleteContextSnippets;
	}

	public async getDiffAcrossDocuments(diffFileContent: SidecarRecentEditsFilePreviousContent[]): Promise<DiffAcrossDocuments[]> {
		const diffs: DiffAcrossDocuments[] = [];
		const diffPromises = Array.from(this.trackedDocuments.entries()).map(
			async ([uri, trackedDocument]) => {
				const currentContentIfAny = diffFileContent.find((previousContent) => previousContent.fs_file_path === uri)?.file_content_latest;
				const updatedContentIfAny = diffFileContent.find((previousContent) => previousContent.fs_file_path === uri)?.file_content_updated;
				const diff = await this.getDiff(vscode.Uri.parse(uri), currentContentIfAny, updatedContentIfAny);
				let lastUpdatedTimestampMs = 0;
				if (trackedDocument.changes.length !== 0) {
					lastUpdatedTimestampMs = Math.max(
						...trackedDocument.changes.map(c => c.timestamp)
					);
				}
				if (diff) {
					return {
						diff: diff.diff,
						uri: trackedDocument.uri,
						languageId: trackedDocument.languageId,
						latestChangeTimestamp: lastUpdatedTimestampMs,
						current_content: diff.currentContent,
					};
				}
				return null;
			}
		);
		const results = await Promise.all(diffPromises);
		diffs.push(...results.filter((result): result is DiffAcrossDocuments => result !== null));
		return diffs;
	}

	public filterCandidateDiffs(
		allDiffs: DiffAcrossDocuments[],
	): DiffAcrossDocuments[] {
		const filterCandidateDiffs: DiffAcrossDocuments[] = [];
		for (const diff of allDiffs) {
			filterCandidateDiffs.push(diff);
		}
		return filterCandidateDiffs;
	}

	public isSupportedForLanguageId(): boolean {
		return true;
	}

	public async getDiff(uri: vscode.Uri, previousFileContentIfAny: string | undefined | null, updatedFileContentIfAny: string | undefined | null): Promise<{
		diff: string | null;
		currentContent: string | null;
	} | null> {
		const trackedDocument = this.trackedDocuments.get(uri.toString());
		if (!trackedDocument) {
			return null;
		}

		const oldContent = previousFileContentIfAny ? previousFileContentIfAny : trackedDocument.content;

		// first we assign newContent a value, which will get overriden in the if/else branch
		let newContent = applyChanges(oldContent, trackedDocument.changes.map((c) => c.change));

		// if the sidecar already sends this information, then generate the git diff for it
		if (updatedFileContentIfAny !== undefined && updatedFileContentIfAny !== null) {
			newContent = updatedFileContentIfAny;
		} else {
			console.log('recent_edits_retriever::read_fresh_from_editor');
			// read from the editor and set it over here
			try {
				const currentTextDocument = await vscode.workspace.openTextDocument(uri);
				newContent = currentTextDocument.getText();
			} catch (exception) {
				console.error(exception);
			}
		}
		console.log('newContent');
		console.log(newContent);

		const diff = createGitDiff(uri.fsPath, oldContent, newContent);
		return {
			diff,
			currentContent: newContent,
		};
	}

	/**
	 * Only track files which are of the scheme === 'file', there are many kinds
	 * which can change, we do not want to confuse our systems
	 */
	private shouldTrackFile(fileUri: vscode.Uri): boolean {
		if (fileUri.scheme === 'file') {
			return true;
		} else {
			return false;
		}
	}

	private onDidChangeTextDocument(event: vscode.TextDocumentChangeEvent): void {
		// console.log('onDidChangeTextDocument');
		// console.log({ event });
		const shouldTrack = this.shouldTrackFile(event.document.uri);
		if (!shouldTrack) {
			return;
		}
		let trackedDocument = this.trackedDocuments.get(event.document.uri.toString());
		if (!trackedDocument) {
			trackedDocument = this.trackDocument(event.document);
		}

		const now = Date.now();
		for (const change of event.contentChanges) {
			trackedDocument.changes.push({
				timestamp: now,
				change,
			});
		}

		this.reconcileOutdatedChanges();
	}

	private onDidRenameFiles(event: vscode.FileRenameEvent): void {
		for (const file of event.files) {
			const shouldTrack = this.shouldTrackFile(file.oldUri);
			if (!shouldTrack) {
				continue;
			}
			const trackedDocument = this.trackedDocuments.get(file.oldUri.toString());
			if (trackedDocument) {
				this.trackedDocuments.set(file.newUri.toString(), trackedDocument);
				this.trackedDocuments.delete(file.oldUri.toString());
			}
		}
	}

	/**
	 * This is exposed to the agentProvider as well since the fs.write does not
	 * expose this properly
	 */
	onDidCreateFiles(event: vscode.FileCreateEvent): void {
		for (const uri of event.files) {
			const shouldTrack = this.shouldTrackFile(uri);
			if (!shouldTrack) {
				continue;
			}
			const trackedDocument: TrackedDocument = {
				content: '',
				languageId: '',
				uri,
				changes: [],
			};
			this.trackedDocuments.set(uri.toString(), trackedDocument);
		}
	}

	private onDidDeleteFiles(event: vscode.FileDeleteEvent): void {
		for (const uri of event.files) {
			const shouldTrack = this.shouldTrackFile(uri);
			if (!shouldTrack) {
				continue;
			}
			this.trackedDocuments.delete(uri.toString());
		}
	}

	public dispose(): void {
		this.trackedDocuments.clear();
		for (const disposable of this.disposables) {
			disposable.dispose();
		}
	}

	private trackDocument(document: vscode.TextDocument): TrackedDocument {
		const trackedDocument: TrackedDocument = {
			content: document.getText(),
			languageId: document.languageId,
			uri: document.uri,
			changes: [],
		};
		this.trackedDocuments.set(document.uri.toString(), trackedDocument);
		return trackedDocument;
	}

	private reconcileOutdatedChanges(): void {
		const now = Date.now();
		for (const [, trackedDocument] of this.trackedDocuments) {
			const firstNonOutdatedChangeIndex = trackedDocument.changes.findIndex(
				c => now - c.timestamp < this.maxAgeMs
			);

			const outdatedChanges = trackedDocument.changes.slice(0, firstNonOutdatedChangeIndex);
			trackedDocument.content = applyChanges(
				trackedDocument.content,
				outdatedChanges.map(c => c.change)
			);
			trackedDocument.changes = trackedDocument.changes.slice(firstNonOutdatedChangeIndex);
		}
	}
}

function applyChanges(content: string, changes: vscode.TextDocumentContentChangeEvent[]): string {
	for (const change of changes) {
		content =
			content.slice(0, change.rangeOffset) +
			change.text +
			content.slice(change.rangeOffset + change.rangeLength);
	}
	return content;
}
