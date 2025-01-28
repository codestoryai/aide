/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';

export const IASTNavigationService = createDecorator<IASTNavigationService>('astNavigationService');

export interface IASTNavigationService {
	_serviceBrand: undefined;
	readonly toggleASTNavigationMode: () => void;

	moveUp: () => void;
	moveDown: () => void;
	moveInto: () => void;
	moveOut: () => void;
}
