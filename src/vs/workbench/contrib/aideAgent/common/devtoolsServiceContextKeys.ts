/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';
import { RawContextKey } from '../../../../platform/contextkey/common/contextkey.js';
import { DevtoolsStatus } from './devtoolsService.js';

export const CONTEXT_IS_DEVTOOLS_FEATURE_ENABLED = new RawContextKey<boolean>('devtools.isFeatureEnabled', false, { type: 'boolean', description: localize('devtools.isFeatureEnabled', "True when the opt-in devtools feature is enabled, false otherwise") });
export const CONTEXT_IS_INSPECTING_HOST = new RawContextKey<boolean>('devtools.isInspectingHost', false, { type: 'boolean', description: localize('devtools.isInspectingHost', "True when the devtools are inspecting the host, false otherwise") });
export const CONTEXT_DEVTOOLS_STATUS = new RawContextKey<DevtoolsStatus>('devtools.status', DevtoolsStatus.Idle, { type: 'string', description: localize('devtools.status', "The status of the devtools") });
export const CONTEXT_SHOULD_SHOW_ADD_PLUGIN = new RawContextKey<boolean>('devtools.shouldShowAddPlugin', false, { type: 'string', description: localize('devtools.shouldShowAddPlugin', "Wether we are currently looking at a Vite config in a React project that hasn't installed the devtools, yet.") });
