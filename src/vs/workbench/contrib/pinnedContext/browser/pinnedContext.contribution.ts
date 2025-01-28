/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { IPinnedContextService } from '../common/pinnedContext.js';
import { registerPinnedContextActions } from './actions/pinnedContextActions.js';
import { PinnedContextService } from './pinnedContextService.js';

// Register actions
registerPinnedContextActions();

// Register services
registerSingleton(IPinnedContextService, PinnedContextService, InstantiationType.Delayed);
