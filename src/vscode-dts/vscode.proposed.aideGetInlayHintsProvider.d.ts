/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

declare module 'vscode' {
	export namespace languages {
		export function getInlayHintsProvider(document: DocumentSelector): ProviderResult<InlayHintsProvider>;
	}
}
