/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { h } from '../../../base/browser/dom.js';
import { ActionViewItem } from '../../../base/browser/ui/actionbar/actionViewItems.js';
import { KeybindingLabel, unthemedKeybindingLabelOptions } from '../../../base/browser/ui/keybindingLabel/keybindingLabel.js';
import { OS } from '../../../base/common/platform.js';
import { MenuItemAction } from '../../actions/common/actions.js';
import { IContextKeyService } from '../../contextkey/common/contextkey.js';
import { IKeybindingService } from '../../keybinding/common/keybinding.js';
import './actionViewItemKb.css';

export class ActionViewItemKb extends ActionViewItem {

	constructor(
		action: MenuItemAction,
		@IKeybindingService private readonly _keybindingService: IKeybindingService,
		@IContextKeyService private readonly _contextKeyService: IContextKeyService
	) {
		super(undefined, action, { keybinding: action.menuKeybinding?.label });
	}

	protected override updateLabel() {
		const kb = this._keybindingService.lookupKeybinding(this._action.id, this._contextKeyService);
		if (!kb) {
			return super.updateLabel();
		}
		if (this.label) {
			const div = h('div.action-kb').root;

			const k = this._register(new KeybindingLabel(div, OS, { disableTitle: true, ...unthemedKeybindingLabelOptions }));
			k.set(kb);

			this.label.classList.add('sr-only');

			this.label.textContent = this._action.label;
			this.label.appendChild(div);
			this.element?.appendChild(div);

		}
	}
}
