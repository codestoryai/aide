/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ServicesAccessor } from '../../../editor/browser/editorExtensions.js';
import { localize } from '../../../nls.js';
import { Categories } from '../../../platform/action/common/actionCommonCategories.js';
import { Action2, MenuId, registerAction2 } from '../../../platform/actions/common/actions.js';
import { ICSAccountService } from '../../../platform/codestoryAccount/common/csAccount.js';
import { CS_ACCOUNT_CARD_VISIBLE } from '../../../platform/codestoryAccount/common/csAccountContextKeys.js';

export class ToggleCodestoryAccountCardAction extends Action2 {
	static readonly ID = 'workbench.action.toggleCodestoryAccountCard';
	static readonly LABEL = localize('aide', "AIDE");

	constructor() {
		super({
			id: ToggleCodestoryAccountCardAction.ID,
			title: ToggleCodestoryAccountCardAction.LABEL,
			category: Categories.View,
			toggled: CS_ACCOUNT_CARD_VISIBLE,
			menu: [{
				id: MenuId.CodestoryAccountMenu,
				group: 'navigation'
			}]
		});
	}

	run(accessor: ServicesAccessor): void {
		const csAccountService = accessor.get(ICSAccountService);
		csAccountService.toggle();
	}
}

registerAction2(ToggleCodestoryAccountCardAction);
