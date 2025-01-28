/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { BottomBarPartService } from '../../../browser/parts/bottombar/bottomBarPart.js';
import { IBottomBarPartService } from '../browser/bottomBarPartService.js';

registerSingleton(IBottomBarPartService, BottomBarPartService, InstantiationType.Eager);
