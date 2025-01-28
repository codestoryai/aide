/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

declare module 'vscode' {
	/**
	 * Enumeration of different symbol navigation actions that can be performed
	 */
	export enum SymbolNavigationActionType {
		/** Navigate to symbol definition */
		GoToDefinition = 0,
		/** Navigate to symbol declaration */
		GoToDeclaration = 1,
		/** Navigate to type definition */
		GoToTypeDefinition = 2,
		/** Navigate to implementation */
		GoToImplementation = 3,
		/** Navigate to symbol references */
		GoToReferences = 4,
		/** Generic location navigation */
		GenericGoToLocation = 5
	}

	/**
	 * Event data for symbol navigation actions
	 */
	export interface SymbolNavigationEvent {
		/** Position in the document where the navigation was triggered */
		position: Position;
		/** Type of navigation action performed */
		action: SymbolNavigationActionType;
		/** URI of the document where the navigation occurred */
		uri: Uri;
	}

	/**
	 * Handler interface for CodeStory events
	 * Processes symbol navigation and code edit events
	 */
	export interface CSEventHandler {
		/**
		 * Handles symbol navigation events
		 * @param event The symbol navigation event data
		 */
		handleSymbolNavigation(event: SymbolNavigationEvent): void;

		/**
		 * Handles code edit events from the AI agent
		 * @param event Object containing edit statistics
		 * @param event.accepted Whether the edit was accepted
		 * @param event.added Number of lines added
		 * @param event.removed Number of lines removed
		 * @returns Promise that resolves when the handling is complete
		 */
		handleAgentCodeEdit(event: { accepted: boolean; added: number; removed: number }): Thenable<void>;
	}

	/**
	 * Namespace for CodeStory event handling functionality
	 */
	export namespace csevents {
		/**
		 * Registers a handler for CodeStory events
		 * @param handler The event handler implementation
		 * @returns A disposable that unregisters the handler when disposed
		 */
		export function registerCSEventHandler(handler: CSEventHandler): Disposable;
	}
}