/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Codicon } from '../../../base/common/codicons.js';
import { ServicesAccessor } from '../../../editor/browser/editorExtensions.js';
import { localize } from '../../../nls.js';
import { Categories } from '../../../platform/action/common/actionCommonCategories.js';
import { Action2, MenuId, registerAction2 } from '../../../platform/actions/common/actions.js';
import { IRageShakeService } from '../../services/rageShake/common/rageShake.js';
import { RAGESHAKE_CARD_VISIBLE } from '../../services/rageShake/common/rageShakeContextKeys.js';

export class ToggleRageshakeCardAction extends Action2 {
	static readonly ID = 'workbench.action.toggleRageShakeCard';
	static readonly LABEL = localize('rageShakeActionLabel', "Give feedback");

	constructor() {
		super({
			id: ToggleRageshakeCardAction.ID,
			title: ToggleRageshakeCardAction.LABEL,
			icon: Codicon.warning,
			category: Categories.View,
			toggled: RAGESHAKE_CARD_VISIBLE,
			menu: [{
				id: MenuId.RageShakeMenu,
				group: 'navigation',
			}]
		});
	}

	run(accessor: ServicesAccessor) {
		const rageShakeService = accessor.get(IRageShakeService);
		rageShakeService.toggle();
	}
}

registerAction2(ToggleRageshakeCardAction);
