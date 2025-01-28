/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
// Contains the vscode apis and the related functions around it neatly wrapped
// up for using while working with the inline autocomplete
import * as vscode from 'vscode';
import * as path from 'path';
import { IdentifierNodeInformation, IdentifierNodeType } from '../../sidecar/types';
import { SideCarClient } from '../../sidecar/client';
import { shouldTrackFile } from '../../utilities/openTabs';

function windowsToPosix(windowsPath: string): string {
	let posixPath = windowsPath.split('\\').join('/');
	if (posixPath[1] === ':') {
		posixPath = posixPath.slice(2);
	}
	// posixPath = posixPath.replace(" ", "\\ ");
	return posixPath;
}
function isWindowsLocalButNotRemote(): boolean {
	return (
		vscode.env.remoteName !== undefined &&
		['wsl', 'ssh-remote', 'dev-container', 'attached-container'].includes(
			vscode.env.remoteName
		) &&
		process.platform === 'win32'
	);
}
export function getPathSep(): string {
	return isWindowsLocalButNotRemote() ? '/' : path.sep;
}
export function uriFromFilePath(filepath: string): vscode.Uri {
	if (vscode.env.remoteName) {
		if (isWindowsLocalButNotRemote()) {
			filepath = windowsToPosix(filepath);
		}
		return vscode.Uri.parse(
			`vscode-remote://${vscode.env.remoteName}${filepath}`
		);
	} else {
		return vscode.Uri.file(filepath);
	}
}
export function forkSignal(signal: AbortSignal): AbortController {
	const controller = new AbortController();
	if (signal.aborted) {
		controller.abort();
	}
	signal.addEventListener('abort', () => controller.abort());
	return controller;
}

export type TypeDefinitionProvider = {
	filepath: String;
	range: vscode.Range;
};

export type TypeDefinitionProviderWithNode = {
	node: IdentifierNodeInformation;
	typeDefinition: TypeDefinitionProvider[];
	type: String;
};

export type TypeDefinitionProviderWithNodeSidecar = {
	node: {
		identifier: String;
		range: {
			start: {
				line: number;
				character: number;
			};
			end: {
				line: number;
				character: number;
			};
		};
	};
	type_definitions: {
		file_path: String;
		range: {
			start: {
				line: number;
				character: number;
			};
			end: {
				line: number;
				character: number;
			};
		};
	}[];
	node_type: String;
};

export function sidecarTypeDefinitionsWithNode(typeDefinitionProviders: TypeDefinitionProviderWithNode[]): TypeDefinitionProviderWithNodeSidecar[] {
	return typeDefinitionProviders.map((typeIdentifier) => {
		return {
			node: {
				identifier: typeIdentifier.node.name,
				range: {
					start: {
						line: typeIdentifier.node.range.startPosition.line,
						character: typeIdentifier.node.range.startPosition.character,
					},
					end: {
						line: typeIdentifier.node.range.endPosition.line,
						character: typeIdentifier.node.range.endPosition.character,
					}
				}
			},
			type_definitions: typeIdentifier.typeDefinition.map((typeDefinition) => {
				return {
					file_path: typeDefinition.filepath,
					range: {
						start: {
							line: typeDefinition.range.start.line,
							character: typeDefinition.range.start.character,
						},
						end: {
							line: typeDefinition.range.end.line,
							character: typeDefinition.range.end.character,
						}
					}
				};
			}),
			node_type: typeIdentifier.type,
		};
	});
}

export async function typeDefinitionForIdentifierNodes(
	nodes: IdentifierNodeType,
	documentUri: vscode.Uri,
	sidecarClient: SideCarClient,
): Promise<TypeDefinitionProviderWithNode[]> {
	const identifierNodes = nodes.identifier_nodes.map((node) => {
		return {
			node,
			type: 'identifier',
		};
	});
	const functionNodes = nodes.function_parameters.map((node) => {
		return {
			node,
			type: 'function_parameter',
		};
	});
	const importNodes = nodes.import_nodes.map((node) => {
		return {
			node,
			type: 'import_node',
		};
	});
	const finalNodes = [...identifierNodes, ...functionNodes, ...importNodes];
	const response = await Promise.all(finalNodes.map(async (identifierNode) => {
		const typeDefinition = await typeDefinitionProvider(
			identifierNode.node,
			documentUri,
			new vscode.Position(identifierNode.node.range.startPosition.line, identifierNode.node.range.startPosition.character),
			sidecarClient,
		);
		return {
			node: identifierNode.node,
			type: identifierNode.type,
			typeDefinition,
		};
	}));
	return response;
}


export async function typeDefinitionProvider(
	identifierNode: IdentifierNodeInformation,
	filepath: vscode.Uri,
	position: vscode.Position,
	sidecarClient: SideCarClient,
): Promise<TypeDefinitionProvider[]> {
	// console.log('invoking goToDefinition');
	// console.log(position);
	try {
		const locations: vscode.LocationLink[] = await vscode.commands.executeCommand(
			'vscode.executeTypeDefinitionProvider',
			filepath,
			position
		);
		return Promise.all(locations.map(async (location) => {
			const uri = location.targetUri;
			const range = location.targetRange;
			// we have to always open the text document first, this ends up sending
			// it over to the sidecar as a side-effect but that is fine
			const textDocument = await vscode.workspace.openTextDocument(uri);

			// No need to await on this
			if (shouldTrackFile(uri)) {
				// console.log('we are tracking this uri');
				// console.log(uri);
				sidecarClient.documentOpen(textDocument.uri.fsPath, textDocument.getText(), textDocument.languageId);
			}

			// return the value as we would normally
			return {
				filepath: uri.fsPath,
				range,
				node: identifierNode,
			};
		}));
	} catch (exception) {
		// console.log(exception);
	}
	return [];
}
