/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { registerASTNavigationActions } from '../../../../workbench/contrib/astNavigation/browser/actions/astNavigationActions.js';
import { ASTNavigationService } from '../../../../workbench/contrib/astNavigation/browser/astNavigationServiceImpl.js';
import { IASTNavigationService } from '../../../../workbench/contrib/astNavigation/common/astNavigationService.js';

registerASTNavigationActions();

registerSingleton(IASTNavigationService, ASTNavigationService, InstantiationType.Eager);
