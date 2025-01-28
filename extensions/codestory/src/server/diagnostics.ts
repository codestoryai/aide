/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { SidecarDiagnosticsResponse, SidecarParameterHints, SidecarRequestPosition } from './types';
import { quickFixList } from './quickFix';

export function getFileDiagnosticsFromEditor(
	filePath: string
): SidecarDiagnosticsResponse[] {
	const fileUri = vscode.Uri.file(filePath);
	const diagnostics = vscode.languages.getDiagnostics(fileUri).map((diagnostic) => {
		return {
			message: diagnostic.message, // message is full_message if exists
			range: {
				startPosition: {
					line: diagnostic.range.start.line,
					character: diagnostic.range.start.character,
					byteOffset: 0,
				},
				endPosition: {
					line: diagnostic.range.end.line,
					character: diagnostic.range.end.character,
					byteOffset: 0,
				},
			},
			fs_file_path: filePath,
		};
	});
	return diagnostics;
}

export async function getHoverInformation(filePath: string, position: SidecarRequestPosition): Promise<SidecarDiagnosticsResponse[]> {
	const fileUri = vscode.Uri.file(filePath);
	const editorPosition = new vscode.Position(position.line, position.character);
	const locations: vscode.Hover[] = await vscode.commands.executeCommand(
		'vscode.executeHoverProvider',
		fileUri,
		editorPosition,
	);
	return locations.filter((location) => {
		return location.range !== undefined;
	}).map((location) => {
		const messages = location.contents;
		const range = location.range as vscode.Range;
		return messages.map((message) => {
			let userMessage = '';
			if (message instanceof vscode.MarkdownString) {
				userMessage = message.value;
			}
			return {
				message: userMessage,
				range: {
					startPosition: {
						line: range.start.line,
						character: range.start.character,
						byteOffset: 0,
					},
					endPosition: {
						line: range.end.line,
						character: range.end.character,
						byteOffset: 0,
					}
				},
				fs_file_path: filePath,
			};
		});
	}).flat();
}

export async function getFullWorkspaceDiagnostics(): Promise<SidecarDiagnosticsResponse[]> {
	const enrichedDiagnostics: SidecarDiagnosticsResponse[] = [];
	const diagnostics = vscode.languages.getDiagnostics();
	for (const [uri, uriDiagnostics] of diagnostics) {
		for (const diagnostic of uriDiagnostics) {
			if (diagnostic.severity !== vscode.DiagnosticSeverity.Error) {
				continue;
			}
			const fullMessage = await getFullDiagnosticMessage(diagnostic);

			const range = {
				startPosition: {
					line: diagnostic.range.start.line,
					character: diagnostic.range.start.character,
					byteOffset: 0,
				},
				endPosition: {
					line: diagnostic.range.end.line,
					character: diagnostic.range.end.character,
					byteOffset: 0,
				},
			};

			// Enrich 2: quick fix options
			const quick_fix_labels = await quickFixList({
				fs_file_path: uri.fsPath,
				editor_url: 'editor url',
				range,
				request_id: 'request_id',
			}).then((res) => res.options.map((o) => o.label));

			// Enrich 3: trigger parameter hints
			const parameter_hints = await getParameterHints(
				uri,
				diagnostic.range.end
			).then((res) => res.signature_labels);

			enrichedDiagnostics.push({
				message: fullMessage ?? diagnostic.message,
				range,
				quick_fix_labels,
				parameter_hints,
				fs_file_path: uri.fsPath,
			});
		}
	}
	return enrichedDiagnostics;
}

export async function getEnrichedDiagnostics(filePath: string): Promise<SidecarDiagnosticsResponse[]> {
	const fileUri = vscode.Uri.file(filePath);
	const diagnostics = vscode.languages.getDiagnostics(fileUri);
	const enrichedDiagnostics: SidecarDiagnosticsResponse[] = [];

	for (const diagnostic of diagnostics) {
		// Enrich 1: full message (involves attempting to access the error file stub)
		const fullMessage = await getFullDiagnosticMessage(diagnostic);

		const range = {
			startPosition: {
				line: diagnostic.range.start.line,
				character: diagnostic.range.start.character,
				byteOffset: 0,
			},
			endPosition: {
				line: diagnostic.range.end.line,
				character: diagnostic.range.end.character,
				byteOffset: 0,
			},
		};

		// Enrich 2: quick fix options
		const quick_fix_labels = await quickFixList({
			fs_file_path: fileUri.fsPath,
			editor_url: 'editor url',
			range,
			request_id: 'request_id',
		}).then((res) => res.options.map((o) => o.label));

		// Enrich 3: trigger parameter hints
		const parameter_hints = await getParameterHints(
			fileUri,
			diagnostic.range.end
		).then((res) => res.signature_labels);

		enrichedDiagnostics.push({
			message: fullMessage ?? diagnostic.message,
			range,
			quick_fix_labels,
			parameter_hints,
			fs_file_path: filePath,
		});
	}

	return enrichedDiagnostics;
}

// Helper function to get parameter hints
async function getParameterHints(
	fileUri: vscode.Uri,
	position: vscode.Position
): Promise<SidecarParameterHints> {
	try {
		const signatureHelp = await vscode.commands.executeCommand<
			vscode.SignatureHelp
		>('vscode.executeSignatureHelpProvider', fileUri, position);

		return signatureHelp?.signatures.length ? {
			signature_labels: signatureHelp.signatures.map((signature) => signature.label)
		} : {
			signature_labels: []
		};
	} catch (error) {
		console.error('Error fetching signature help:', error);
		return {
			signature_labels: []
		};
	}
}

// Helper function to get suggestions
// async function getSuggestions(
// 	fileUri: vscode.Uri,
// 	range: vscode.Range
// ): Promise<vscode.CompletionItem[]> {
// 	try {
// 		const suggestions = await vscode.commands.executeCommand<vscode.CompletionList>(
// 			"vscode.executeCompletionItemProvider",
// 			fileUri,
// 			range.start
// 		);
// 		return suggestions?.items ?? [];
// 	} catch (error) {
// 		console.error("Error fetching suggestions:", error);
// 		return [];
// 	}
// }

export async function getDiagnosticsFromEditor(filePath: string, interestedRange: vscode.Range): Promise<SidecarDiagnosticsResponse[]> {
	const fileUri = vscode.Uri.file(filePath);
	const diagnostics = vscode.languages.getDiagnostics(fileUri);

	const sidecarDiagnostics = await Promise.all(
		diagnostics
			.filter((diagnostic) => interestedRange.contains(diagnostic.range))
			.filter((diagnostic) =>
				diagnostic.severity === vscode.DiagnosticSeverity.Error ||
				diagnostic.severity === vscode.DiagnosticSeverity.Warning
			)
			.map(async (diagnostic) => {
				const full_message = await getFullDiagnosticMessage(diagnostic);
				return {
					message: full_message ?? diagnostic.message, // message is full_message if exists
					range: {
						startPosition: {
							line: diagnostic.range.start.line,
							character: diagnostic.range.start.character,
							byteOffset: 0,
						},
						endPosition: {
							line: diagnostic.range.end.line,
							character: diagnostic.range.end.character,
							byteOffset: 0,
						},
					},
					fs_file_path: filePath,
				};
			})
	);
	return sidecarDiagnostics;
}


async function getFullDiagnosticMessage(diagnostic: vscode.Diagnostic): Promise<string | null> {
	const code = diagnostic.code;
	if (typeof code === 'object' && code !== null) {
		const targetUri = code.target;
		if (targetUri) {
			try {
				const document = await vscode.workspace.openTextDocument(targetUri);
				console.log('Diagnostic document found. Happy.')
				const document_text = document.getText();
				return document_text;
			} catch (error) {
				console.log(`Error opening document: ${error}`);
				return null;
			}
		} else {
			console.log('No target URI found in diagnostic code.');
			return null;
		}
	} else {
		console.log('Diagnostic code is not an object with a target URI.');
		return null;
	}
}
