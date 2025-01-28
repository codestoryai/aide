/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IDisposable } from '../../../../base/common/lifecycle.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { BottomBarPart } from '../../../browser/parts/bottombar/bottomBarPart.js';

export const IBottomBarPartService = createDecorator<IBottomBarPartService>('bottomBarPartService');

export interface IBottomBarPartService {

	readonly _serviceBrand: undefined;
	readonly mainPart: BottomBarPart;
	getPart(container: HTMLElement): IDisposable;
	// createAuxiliaryBottomBarPart(container: HTMLElement, editorsContainer: HTMLElement): BottomBarPart;
}
