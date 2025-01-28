/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';
import { RawContextKey } from '../../../../platform/contextkey/common/contextkey.js';
import { RageShakeViewType, RageShakeView } from './rageShake.js';

export const RAGESHAKE_CARD_VISIBLE = new RawContextKey<boolean>('rageShakeCardVisible', false, { type: 'boolean', description: localize('rageShakeCardVisible', "Whether the rage shake card is visible") });
export const RAGESHAKE_VIEW = new RawContextKey<RageShakeViewType>('rageShakeView', RageShakeView.Start, { type: 'string', description: localize('rageShakeView', "Which rage shake view is visible") });
