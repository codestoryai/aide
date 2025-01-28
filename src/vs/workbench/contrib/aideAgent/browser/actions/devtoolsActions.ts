/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Codicon } from '../../../../../base/common/codicons.js';
import { KeyCode, KeyMod } from '../../../../../base/common/keyCodes.js';
import { ServicesAccessor } from '../../../../../editor/browser/editorExtensions.js';
import { localize, localize2 } from '../../../../../nls.js';
import { Categories } from '../../../../../platform/action/common/actionCommonCategories.js';
import { Action2, registerAction2, MenuRegistry, MenuId } from '../../../../../platform/actions/common/actions.js';
import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import { ContextKeyExpr } from '../../../../../platform/contextkey/common/contextkey.js';
import { KeybindingWeight } from '../../../../../platform/keybinding/common/keybindingsRegistry.js';
import { PreviewVisibleContext } from '../../../../common/contextkeys.js';
import { IWorkbenchLayoutService, OverlayedParts, Position } from '../../../../services/layout/browser/layoutService.js';
import { DevtoolsStatus, IDevtoolsService } from '../../common/devtoolsService.js';
import { CONTEXT_IS_DEVTOOLS_FEATURE_ENABLED } from '../../common/devtoolsServiceContextKeys.js';

export class ShowPreviewAction extends Action2 {

	static readonly ID = 'workbench.action.showPreview';
	static readonly LABEL = localize('togglePreview', "Toggle web app preview");

	static getLabel(layoutService: IWorkbenchLayoutService): string {
		return layoutService.getSideBarPosition() === Position.LEFT ? localize('moveSidebarRight', "Move Primary Side Bar Right") : localize('moveSidebarLeft', "Move Primary Side Bar Left");
	}

	constructor() {
		super({
			id: ShowPreviewAction.ID,
			title: localize2('showPreview', "Show web app preview"),
			category: Categories.View,
			icon: Codicon.browser,
			keybinding: {
				weight: KeybindingWeight.WorkbenchContrib,
				primary: KeyMod.CtrlCmd | KeyMod.Alt | KeyCode.KeyB
			},
		});
	}

	run(accessor: ServicesAccessor): void {
		const layoutService = accessor.get(IWorkbenchLayoutService);
		const isPreviewVisible = layoutService.isVisible(OverlayedParts.PREVIEW_PART);
		if (!isPreviewVisible) {
			layoutService.setPartHidden(false, OverlayedParts.PREVIEW_PART);
		}
	}
}

export class TogglePreviewAction extends Action2 {

	static readonly ID = 'workbench.action.togglePreview';
	static readonly LABEL = localize('togglePreview', "Toggle web app preview");

	static getLabel(layoutService: IWorkbenchLayoutService): string {
		return layoutService.getSideBarPosition() === Position.LEFT ? localize('moveSidebarRight', "Move Primary Side Bar Right") : localize('moveSidebarLeft', "Move Primary Side Bar Left");
	}

	constructor() {
		super({
			id: TogglePreviewAction.ID,
			title: localize2('togglePreview', "Toggle web app preview"),
			category: Categories.View,
			icon: Codicon.browser,
			keybinding: {
				weight: KeybindingWeight.WorkbenchContrib,
				primary: KeyMod.CtrlCmd | KeyMod.Alt | KeyCode.KeyB
			},
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const layoutService = accessor.get(IWorkbenchLayoutService);
		const commandsService = accessor.get(ICommandService);
		const devtoolsService = accessor.get(IDevtoolsService);

		let hasSomethingToOpen = true;
		if (devtoolsService.status === DevtoolsStatus.Idle) {
			hasSomethingToOpen = await commandsService.executeCommand('codestory.show-simple-browser') as boolean;
		}

		const isPreviewVisible = layoutService.isVisible(OverlayedParts.PREVIEW_PART);
		if (!isPreviewVisible && hasSomethingToOpen) {
			layoutService.setPartHidden(false, OverlayedParts.PREVIEW_PART);
		} else {
			layoutService.setPartHidden(true, OverlayedParts.PREVIEW_PART);
		}
	}
}

export function registerDevtoolsActions() {
	registerAction2(ShowPreviewAction);
	registerAction2(TogglePreviewAction);

	MenuRegistry.appendMenuItem(MenuId.PreviewMenu, {
		group: 'navigation',
		when: CONTEXT_IS_DEVTOOLS_FEATURE_ENABLED,
		command: {
			id: TogglePreviewAction.ID,
			title: localize2('togglePreview.show', "Show web app preview"),
			icon: Codicon.code,
			toggled: { condition: ContextKeyExpr.equals(PreviewVisibleContext.key, true), icon: Codicon.browser, title: localize2('togglePreview.show', "Show web app preview").value }
		},
	});
}
