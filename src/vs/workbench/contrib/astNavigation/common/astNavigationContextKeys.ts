/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { RawContextKey } from '../../../../platform/contextkey/common/contextkey.js';

export const CONTEXT_AST_NAVIGATION_MODE = new RawContextKey<boolean>('astNavigationMode', false, { type: 'boolean', description: 'AST Navigation Mode' });
export const CONTEXT_CAN_AST_NAVIGATE = new RawContextKey<boolean>('canAstNavigate', false, { type: 'boolean', description: 'Can AST Navigate' });
