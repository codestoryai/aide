/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Codicon } from '../../../../../base/common/codicons.js';
import { KeyCode, KeyMod } from '../../../../../base/common/keyCodes.js';
import { basename } from '../../../../../base/common/resources.js';
import { ServicesAccessor } from '../../../../../editor/browser/editorExtensions.js';
import { localize2 } from '../../../../../nls.js';
import { Action2, MenuId, MenuRegistry, registerAction2 } from '../../../../../platform/actions/common/actions.js';
import { AgentMode } from '../../../../../platform/aideAgent/common/model.js';
import { ContextKeyExpr } from '../../../../../platform/contextkey/common/contextkey.js';
import { IsDevelopmentContext } from '../../../../../platform/contextkey/common/contextkeys.js';
import { KeybindingWeight } from '../../../../../platform/keybinding/common/keybindingsRegistry.js';
import { IMarker } from '../../../../../platform/markers/common/markers.js';
import { IViewsService } from '../../../../services/views/common/viewsService.js';
import { ChatAgentLocation } from '../../common/aideAgentAgents.js';
import { CONTEXT_CHAT_ENABLED, CONTEXT_CHAT_IN_PASSTHROUGH_WIDGET, CONTEXT_CHAT_INPUT_HAS_FOCUS, CONTEXT_CHAT_INPUT_HAS_TEXT, CONTEXT_CHAT_MODE, CONTEXT_CHAT_REQUEST_IN_PROGRESS } from '../../common/aideAgentContextKeys.js';
import { AgentScope, IChatRequestVariableEntry } from '../../common/aideAgentModel.js';
import { IAideAgentService } from '../../common/aideAgentService.js';
import { DevtoolsStatus, IDevtoolsService } from '../../common/devtoolsService.js';
import { CONTEXT_DEVTOOLS_STATUS, CONTEXT_IS_INSPECTING_HOST } from '../../common/devtoolsServiceContextKeys.js';
import { IAideAgentWidgetService, IChatWidget, showChatView } from '../aideAgent.js';
import { CHAT_CATEGORY } from './aideAgentActions.js';

export interface IVoiceChatExecuteActionContext {
	readonly disableTimeout?: boolean;
}

export interface IChatExecuteActionContext {
	widget?: IChatWidget;
	inputValue?: string;
	voice?: IVoiceChatExecuteActionContext;
}

export interface IChatQuickFixActionContext {
	marker: IMarker;
}

export class ExecuteChatAction extends Action2 {
	static readonly ID = 'workbench.action.aideAgent.executeChat';

	constructor() {
		super({
			id: ExecuteChatAction.ID,
			title: localize2('interactive.executeChat.label', "Execute"),
			f1: false,
			category: CHAT_CATEGORY,
			icon: Codicon.send,
			precondition: ContextKeyExpr.and(CONTEXT_CHAT_INPUT_HAS_TEXT, CONTEXT_CHAT_REQUEST_IN_PROGRESS.negate()),
			keybinding: {
				when: CONTEXT_CHAT_INPUT_HAS_FOCUS,
				primary: KeyCode.Enter,
				weight: KeybindingWeight.EditorContrib
			},
			menu: [
				{
					id: MenuId.AideAgentExecuteSecondary,
					group: 'group_1',
					when: CONTEXT_CHAT_IN_PASSTHROUGH_WIDGET.negate(),
				},
				{
					id: MenuId.AideAgentExecute,
					order: 2,
					when: CONTEXT_CHAT_REQUEST_IN_PROGRESS.negate(),
					group: 'navigation',
				},
			]
		});
	}

	run(accessor: ServicesAccessor, ...args: any[]) {
		const context: IChatExecuteActionContext | undefined = args[0];

		const widgetService = accessor.get(IAideAgentWidgetService);
		const widget = context?.widget ?? widgetService.lastFocusedWidget;
		const input = widget?.getInput() ?? context?.inputValue;
		const mode = widget?.mode ?? AgentMode.Plan;

		widget?.acceptInput(mode, input);
	}
}

class TogglePlanningAction extends Action2 {
	static readonly ID = 'workbench.action.aideAgent.togglePlanning';

	constructor() {
		super({
			id: TogglePlanningAction.ID,
			title: localize2('interactive.togglePlanning.label', "Toggle step-by-step reasoning"),
			f1: false,
			category: CHAT_CATEGORY,
			icon: Codicon.compass,
			keybinding: {
				when: CONTEXT_CHAT_INPUT_HAS_FOCUS,
				primary: KeyMod.CtrlCmd | KeyCode.KeyR,
				weight: IsDevelopmentContext ? KeybindingWeight.WorkbenchContrib + 51 : KeybindingWeight.WorkbenchContrib
			}
		});
	}

	run(accessor: ServicesAccessor, ...args: any[]) {
		const widgetService = accessor.get(IAideAgentWidgetService);
		const widget = widgetService.lastFocusedWidget;
		if (widget) {
			widget.togglePlanning();
		}
	}
}

function registerPlanningToggleMenu() {
	MenuRegistry.appendMenuItem(MenuId.AideAgentInput, {
		group: 'navigation',
		when: ContextKeyExpr.or(ContextKeyExpr.equals(CONTEXT_CHAT_MODE.key, 'Plan'), ContextKeyExpr.equals(CONTEXT_CHAT_MODE.key, 'Edit')),
		command: {
			id: TogglePlanningAction.ID,
			title: localize2('interactive.togglePlanning.label', "Toggle step-by-step reasoning"),
			icon: Codicon.compass,
			toggled: { condition: ContextKeyExpr.equals(CONTEXT_CHAT_MODE.key, 'Plan'), icon: Codicon.compassActive }
		},
	});
}

class ToggleInspectingHost extends Action2 {
	static readonly ID = 'workbench.action.aideAgent.toggleInspectingHost';

	constructor() {
		super({
			id: ToggleInspectingHost.ID,
			title: localize2('interactive.toggleInspectingHost.label', "Toggle inspecting with devtools"),
			f1: false,
			category: CHAT_CATEGORY,
			icon: Codicon.inspect,
			keybinding: {
				when: ContextKeyExpr.and(ContextKeyExpr.equals(CONTEXT_CHAT_MODE.key, 'Agentic'), ContextKeyExpr.equals(CONTEXT_DEVTOOLS_STATUS.key, DevtoolsStatus.DevtoolsConnected)),
				primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KeyC,
				weight: IsDevelopmentContext ? KeybindingWeight.WorkbenchContrib + 51 : KeybindingWeight.WorkbenchContrib
			}
		});
	}

	run(accessor: ServicesAccessor, ...args: any[]) {
		const devtoolsService = accessor.get(IDevtoolsService);
		devtoolsService.toggleInspectingHost();
	}
}

function registerToggleInspectingHost() {
	MenuRegistry.appendMenuItem(MenuId.AideAgentInput, {
		group: 'navigation',
		order: 2,
		when: ContextKeyExpr.and(ContextKeyExpr.equals(CONTEXT_CHAT_MODE.key, 'Agentic'), ContextKeyExpr.equals(CONTEXT_DEVTOOLS_STATUS.key, DevtoolsStatus.DevtoolsConnected)),
		command: {
			id: ToggleInspectingHost.ID,
			title: localize2('interactive.startInspectingHost.label', "Provide context with React inspector"),
			icon: Codicon.inspect,
			toggled: {
				condition: ContextKeyExpr.equals(CONTEXT_IS_INSPECTING_HOST.key, true),
				icon: Codicon.close,
				title: localize2('interactive.stopInspectingHost.label', "Stop React inspector").value,
			}
		},
	});
}

export class ToggleEditModeAction extends Action2 {
	static readonly ID = 'workbench.action.aideAgent.toggleEditMode';

	constructor() {
		super({
			id: ToggleEditModeAction.ID,
			title: localize2('interactive.toggleEditMode.label', "Toggle edit mode"),
			f1: false,
			category: CHAT_CATEGORY,
			precondition: ContextKeyExpr.and(CONTEXT_CHAT_INPUT_HAS_FOCUS, CONTEXT_CHAT_IN_PASSTHROUGH_WIDGET.negate()),
			keybinding: {
				when: CONTEXT_CHAT_INPUT_HAS_FOCUS,
				primary: KeyMod.CtrlCmd | KeyCode.Period,
				weight: KeybindingWeight.WorkbenchContrib
			}
		});
	}

	run(accessor: ServicesAccessor, ...args: any[]) {
		const widgetService = accessor.get(IAideAgentWidgetService);
		const widget = widgetService.lastFocusedWidget;
		if (widget) {
			widget.toggleEditMode();
		}
	}
}

export const AgentScopePickerActionId = 'workbench.action.aideAgent.setScope';
/*
MenuRegistry.appendMenuItem(MenuId.AideAgentInput, {
	command: {
		id: AgentScopePickerActionId,
		title: localize2('aideAgent.setScope.label', "Set Scope"),
	},
	order: 2,
	group: 'navigation',
	when: ContextKeyExpr.equals(CONTEXT_CHAT_LOCATION.key, 'panel'),
});
*/

export class CancelAction extends Action2 {
	static readonly ID = 'workbench.action.aideAgent.cancel';
	constructor() {
		super({
			id: CancelAction.ID,
			title: localize2('interactive.cancel.label', "Cancel"),
			f1: false,
			category: CHAT_CATEGORY,
			icon: Codicon.debugStop,
			menu: {
				id: MenuId.AideAgentExecute,
				when: CONTEXT_CHAT_REQUEST_IN_PROGRESS,
				order: 2,
				group: 'navigation',
			},
			keybinding: {
				when: CONTEXT_CHAT_INPUT_HAS_FOCUS,
				weight: KeybindingWeight.WorkbenchContrib,
				primary: KeyMod.CtrlCmd | KeyCode.Escape,
				win: { primary: KeyMod.Alt | KeyCode.Backspace },
			}
		});
	}

	run(accessor: ServicesAccessor, ...args: any[]) {
		const context: IChatExecuteActionContext | undefined = args[0];

		const widgetService = accessor.get(IAideAgentWidgetService);
		const widget = context?.widget ?? widgetService.lastFocusedWidget;
		if (!widget) {
			return;
		}

		const chatService = accessor.get(IAideAgentService);
		if (widget.viewModel) {
			chatService.cancelAllExchangesForSession();
		}
	}
}

export class AideQuickFixAction extends Action2 {
	static readonly ID = 'workbench.action.aideAgent.quickfix';

	constructor() {
		super({
			id: AideQuickFixAction.ID,
			title: localize2('interactive.executeQuickfix.label', "Quick fix with assistant"),
			f1: false,
			category: CHAT_CATEGORY,
			icon: Codicon.send,
			precondition: CONTEXT_CHAT_ENABLED,
		});
	}

	async run(accessor: ServicesAccessor, ...args: any[]) {
		const chatService = accessor.get(IAideAgentService);
		const viewsService = accessor.get(IViewsService);

		const context: IChatQuickFixActionContext | undefined = args[0];
		const marker = context?.marker;
		if (!marker) {
			return;
		}

		const widget = await showChatView(viewsService);
		const vm = widget?.viewModel;
		if (!widget || !vm) {
			return;
		}

		const { resource, message, startLineNumber, startColumn, endLineNumber, endColumn } = marker;
		const ctx: IChatRequestVariableEntry = {
			id: 'vscode.code',
			name: basename(resource),
			value: {
				uri: resource,
				range: { startLineNumber, startColumn, endLineNumber, endColumn }
			}
		};

		await chatService.sendRequest(
			vm.sessionId,
			`Explain what this problem is and help me fix it: ${message}`,
			{
				agentMode: AgentMode.Edit,
				agentScope: AgentScope.Selection,
				userSelectedModelId: widget.input.currentLanguageModel,
				location: ChatAgentLocation.Panel,
				attachedContext: [ctx]
			}
		);
	}
}

export function registerChatExecuteActions() {
	registerAction2(ExecuteChatAction);
	registerAction2(CancelAction);
	registerAction2(TogglePlanningAction);
	registerAction2(ToggleEditModeAction);
	registerAction2(ToggleInspectingHost);
	registerAction2(AideQuickFixAction);
	registerPlanningToggleMenu();
	registerToggleInspectingHost();
}
