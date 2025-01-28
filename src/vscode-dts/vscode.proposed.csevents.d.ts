/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

declare module 'vscode' {
	export enum SymbolNavigationActionType {
		GoToDefinition = 0,
		GoToDeclaration = 1,
		GoToTypeDefinition = 2,
		GoToImplementation = 3,
		GoToReferences = 4,
		GenericGoToLocation = 5
	}

	export interface SymbolNavigationEvent {
		position: Position;
		action: SymbolNavigationActionType;
		uri: Uri;
	}

	export interface CSEventHandler {
		handleSymbolNavigation(event: SymbolNavigationEvent): void;
		handleAgentCodeEdit(event: { accepted: boolean; added: number; removed: number }): Thenable<void>;
	}

	export namespace csevents {
		export function registerCSEventHandler(handler: CSEventHandler): Disposable;
	}
}
