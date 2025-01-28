/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { SymbolNavigationActionType } from 'vscode';

export function getSymbolNavigationActionTypeLabel(actionType: SymbolNavigationActionType): string {
	switch (actionType) {
		case SymbolNavigationActionType.GoToDefinition:
			return 'GoToDefinition';
		case SymbolNavigationActionType.GoToDeclaration:
			return 'GoToDeclaration';
		case SymbolNavigationActionType.GoToTypeDefinition:
			return 'GoToTypeDefinition';
		case SymbolNavigationActionType.GoToImplementation:
			return 'GoToImplementation';
		case SymbolNavigationActionType.GoToReferences:
			return 'GoToReferences';
		case SymbolNavigationActionType.GenericGoToLocation:
			return 'GenericGoToLocation';
		default:
			return 'NotTracked';
	}
}
