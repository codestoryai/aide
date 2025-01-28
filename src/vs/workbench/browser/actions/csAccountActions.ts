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

/**
 * Action class that handles the toggling of the CodeStory account card in the UI.
 * This action is registered in the menu system and can be triggered from the AIDE menu.
 */
export class ToggleCodestoryAccountCardAction extends Action2 {
	/** Unique identifier for the action */
	static readonly ID = 'workbench.action.toggleCodestoryAccountCard';
	/** Localized label for the action */
	static readonly LABEL = localize('aide', "AIDE");

	/**
	 * Initializes the action with its ID, title, category, and menu location.
	 * The action is toggled based on the csAccountCardVisible context key.
	 */
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

	/**
	 * Executes the action by toggling the account card visibility.
	 * @param accessor - Service accessor to get required services
	 */
	run(accessor: ServicesAccessor): void {
		const csAccountService = accessor.get(ICSAccountService);
		csAccountService.toggle();
	}
}

// Register the action in the workbench
registerAction2(ToggleCodestoryAccountCardAction);