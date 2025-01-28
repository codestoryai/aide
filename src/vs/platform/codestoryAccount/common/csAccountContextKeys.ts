/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../nls.js';
import { RawContextKey } from '../../contextkey/common/contextkey.js';

export const CS_ACCOUNT_CARD_VISIBLE = new RawContextKey<boolean>('csAccountCardVisible', false, { type: 'boolean', description: localize('csAccountCardVisible', "Whether the CodeStory account card is visible") });
