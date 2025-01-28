/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Codicon } from '../../../../../base/common/codicons.js';
import { KeyCode, KeyMod } from '../../../../../base/common/keyCodes.js';
import { EditorAction, registerEditorAction, ServicesAccessor } from '../../../../../editor/browser/editorExtensions.js';
import { EditorContextKeys } from '../../../../../editor/common/editorContextKeys.js';
import * as nls from '../../../../../nls.js';
import { Action2, MenuId, registerAction2 } from '../../../../../platform/actions/common/actions.js';
import { ContextKeyExpr, IContextKeyService } from '../../../../../platform/contextkey/common/contextkey.js';
import { KeybindingWeight } from '../../../../../platform/keybinding/common/keybindingsRegistry.js';
import { CONTEXT_AST_NAVIGATION_MODE, CONTEXT_CAN_AST_NAVIGATE } from '../../../../../workbench/contrib/astNavigation/common/astNavigationContextKeys.js';
import { IASTNavigationService } from '../../../../../workbench/contrib/astNavigation/common/astNavigationService.js';

const AST_NAVIGATION_CATEGORY = nls.localize2('astNavigation', "AST Navigation");

class ToggleASTNavigationMode extends Action2 {
	static readonly ID = 'astNavigation.toggleMode';

	constructor() {
		super({
			id: ToggleASTNavigationMode.ID,
			title: nls.localize2('toggleASTNavigation', "(Experimental) Toggle AST Navigation"),
			f1: true,
			category: AST_NAVIGATION_CATEGORY,
			toggled: ContextKeyExpr.equals(CONTEXT_AST_NAVIGATION_MODE.key, true),
			icon: Codicon.symbolKeyword,
			menu: {
				id: MenuId.EditorTitle,
				group: 'navigation',
				order: 0
			},
			keybinding: {
				weight: KeybindingWeight.WorkbenchContrib,
				primary: KeyMod.CtrlCmd | KeyCode.KeyE,
			}
		});
	}

	run(accessor: ServicesAccessor) {
		const astNavigationService = accessor.get(IASTNavigationService);
		astNavigationService.toggleASTNavigationMode();
	}
}

class DisableASTNavigationMode extends Action2 {
	static readonly ID = 'astNavigation.disableMode';

	constructor() {
		super({
			id: DisableASTNavigationMode.ID,
			title: nls.localize2('disableASTNavigation', "Disable AST Navigation"),
			precondition: ContextKeyExpr.and(EditorContextKeys.focus, CONTEXT_AST_NAVIGATION_MODE),
			keybinding: {
				weight: KeybindingWeight.WorkbenchContrib,
				primary: KeyCode.Escape,
			}
		});
	}

	run(accessor: ServicesAccessor) {
		const contextKeyService = accessor.get(IContextKeyService);
		const astNavigationService = accessor.get(IASTNavigationService);

		if (contextKeyService.getContextKeyValue(CONTEXT_AST_NAVIGATION_MODE.key)) {
			astNavigationService.toggleASTNavigationMode();
		}
	}
}

export class MoveUpAction extends EditorAction {
	static readonly ID = 'editor.action.astNavigationUp';
	constructor() {
		super({
			id: MoveUpAction.ID,
			label: nls.localize('moveUp', "Move Up"),
			alias: 'Move Up',
			precondition: CONTEXT_AST_NAVIGATION_MODE,
			kbOpts: {
				kbExpr: ContextKeyExpr.and(EditorContextKeys.focus, CONTEXT_CAN_AST_NAVIGATE),
				primary: KeyCode.UpArrow,
				weight: KeybindingWeight.WorkbenchContrib
			}
		});
	}

	public run(accessor: ServicesAccessor): void {
		const astNavigationService = accessor.get(IASTNavigationService);
		astNavigationService.moveUp();
	}
}

export class MoveDownAction extends EditorAction {
	static readonly ID = 'editor.action.astNavigationDown';
	constructor() {
		super({
			id: MoveDownAction.ID,
			label: nls.localize('moveDown', "Move Down"),
			alias: 'Move Down',
			precondition: CONTEXT_AST_NAVIGATION_MODE,
			kbOpts: {
				kbExpr: ContextKeyExpr.and(EditorContextKeys.focus, CONTEXT_CAN_AST_NAVIGATE),
				primary: KeyCode.DownArrow,
				weight: KeybindingWeight.WorkbenchContrib
			}
		});
	}

	public run(accessor: ServicesAccessor): void {
		const astNavigationService = accessor.get(IASTNavigationService);
		astNavigationService.moveDown();
	}
}

export class MoveIntoAction extends EditorAction {
	static readonly ID = 'editor.action.astNavigationInto';
	constructor() {
		super({
			id: MoveIntoAction.ID,
			label: nls.localize('moveInto', "Move Into"),
			alias: 'Move Into',
			precondition: CONTEXT_AST_NAVIGATION_MODE,
			kbOpts: {
				kbExpr: ContextKeyExpr.and(EditorContextKeys.focus, CONTEXT_CAN_AST_NAVIGATE),
				primary: KeyCode.RightArrow,
				weight: KeybindingWeight.WorkbenchContrib
			}
		});
	}

	public run(accessor: ServicesAccessor): void {
		const astNavigationService = accessor.get(IASTNavigationService);
		astNavigationService.moveInto();
	}
}

export class MoveOutAction extends EditorAction {
	static readonly ID = 'editor.action.astNavigationOut';
	constructor() {
		super({
			id: MoveOutAction.ID,
			label: nls.localize('moveOut', "Move Out"),
			alias: 'Move Out',
			precondition: CONTEXT_AST_NAVIGATION_MODE,
			kbOpts: {
				kbExpr: ContextKeyExpr.and(EditorContextKeys.focus, CONTEXT_CAN_AST_NAVIGATE),
				primary: KeyCode.LeftArrow,
				weight: KeybindingWeight.WorkbenchContrib
			}
		});
	}

	public run(accessor: ServicesAccessor): void {
		const astNavigationService = accessor.get(IASTNavigationService);
		astNavigationService.moveOut();
	}
}

export function registerASTNavigationActions() {
	registerAction2(ToggleASTNavigationMode);
	registerAction2(DisableASTNavigationMode);
	registerEditorAction(MoveUpAction);
	registerEditorAction(MoveDownAction);
	registerEditorAction(MoveIntoAction);
	registerEditorAction(MoveOutAction);
}
