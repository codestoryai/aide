/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { KeyCode, KeyMod } from '../../../../../base/common/keyCodes.js';
import { localize2 } from '../../../../../nls.js';
import { Action2, registerAction2 } from '../../../../../platform/actions/common/actions.js';
import { ServicesAccessor } from '../../../../../platform/instantiation/common/instantiation.js';
import { KeybindingWeight } from '../../../../../platform/keybinding/common/keybindingsRegistry.js';
import { CONTEXT_CHAT_FLOATING_WIDGET_FOCUSED } from '../../common/aideAgentContextKeys.js';
import { IAideAgentFloatingWidgetService } from '../aideAgentFloatingWidgetService.js';

export function registerAideAgentFloatingWidgetActions() {
	registerAction2(class ShowChatFloatingWidget extends Action2 {
		constructor() {
			super({
				id: 'workbench.action.aideAgent.showChatFloatingWidget',
				title: localize2('interactiveSessions.showChatFloatingWidget', "Show Chat Floating Widget"),
				f1: true,
				keybinding: {
					primary: KeyMod.CtrlCmd | KeyCode.KeyK,
					weight: KeybindingWeight.WorkbenchContrib + 1
				}
			});
		}
		run(accessor: ServicesAccessor, ...args: any[]) {
			const floatingWidgetService = accessor.get(IAideAgentFloatingWidgetService);
			floatingWidgetService.showFloatingWidget();
		}
	});

	registerAction2(class HideChatFloatingWidget extends Action2 {
		constructor() {
			super({
				id: 'workbench.action.aideAgent.hideChatFloatingWidget',
				title: localize2('interactiveSessions.hideChatFloatingWidget', "Hide Chat Floating Widget"),
				f1: true,
				precondition: CONTEXT_CHAT_FLOATING_WIDGET_FOCUSED,
				keybinding: {
					primary: KeyCode.Escape,
					weight: KeybindingWeight.WorkbenchContrib,
				}
			});
		}
		run(accessor: ServicesAccessor, ...args: any[]) {
			const floatingWidgetService = accessor.get(IAideAgentFloatingWidgetService);
			floatingWidgetService.hideFloatingWidget();
		}
	});
}
