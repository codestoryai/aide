/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

declare module 'vscode' {
	export interface CSChatEditorRequest {
		variables: Record<string, CSChatVariableValue[]>;
	}

	interface CSChatDynamicVariableValue {
		uri: Uri;
		range: {
			startLineNumber: number;
			startColumn: number;
			endLineNumber: number;
			endColumn: number;
		};
	}

	export interface CSChatVariableValue {
		level: ChatVariableLevel;
		/**
		 * An optional type tag for extensions to communicate the kind of the variable. An extension might use it to interpret the shape of `value`.
		 */
		kind?: string;
		value: string | Uri | any | CSChatDynamicVariableValue;
		description?: string;
	}

	export interface CSChatVariableContext {
		message: string;
	}

	export interface CSChatVariableResolver {
		resolve(name: string, context: CSChatVariableContext, token: CancellationToken): ProviderResult<CSChatVariableValue[]>;
	}
}
