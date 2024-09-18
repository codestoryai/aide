/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Codicon } from '../../../../../base/common/codicons.js';
import { KeyCode, KeyMod } from '../../../../../base/common/keyCodes.js';
import { ServicesAccessor } from '../../../../../editor/browser/editorExtensions.js';
import { localize2 } from '../../../../../nls.js';
import { Action2, MenuId, registerAction2 } from '../../../../../platform/actions/common/actions.js';
import { ContextKeyExpr } from '../../../../../platform/contextkey/common/contextkey.js';
import { KeybindingWeight } from '../../../../../platform/keybinding/common/keybindingsRegistry.js';
import { CHAT_CATEGORY } from '../../../../../workbench/contrib/aideChat/browser/actions/aideChatActions.js';
import { IChatWidget, IAideChatWidgetService } from '../../../../../workbench/contrib/aideChat/browser/aideChat.js';
import { IAideChatAgentService } from '../../../../../workbench/contrib/aideChat/common/aideChatAgents.js';
import { CONTEXT_CHAT_INPUT_HAS_AGENT, CONTEXT_CHAT_INPUT_HAS_TEXT, CONTEXT_CHAT_REQUEST_IN_PROGRESS, CONTEXT_IN_CHAT_INPUT } from '../../../../../workbench/contrib/aideChat/common/aideChatContextKeys.js';
import { chatAgentLeader, extractAgentAndCommand } from '../../../../../workbench/contrib/aideChat/common/aideChatParserTypes.js';
import { IAideChatService } from '../../../../../workbench/contrib/aideChat/common/aideChatService.js';

export interface IVoiceChatExecuteActionContext {
	readonly disableTimeout?: boolean;
}

export interface IChatExecuteActionContext {
	widget?: IChatWidget;
	inputValue?: string;
	voice?: IVoiceChatExecuteActionContext;
}

export class SubmitAction extends Action2 {
	static readonly ID = 'workbench.action.aideChat.submit';

	constructor() {
		super({
			id: SubmitAction.ID,
			title: localize2('aideChat.submit.label', "Send"),
			f1: false,
			category: CHAT_CATEGORY,
			icon: Codicon.send,
			precondition: ContextKeyExpr.and(CONTEXT_CHAT_INPUT_HAS_TEXT, CONTEXT_CHAT_REQUEST_IN_PROGRESS.negate()),
			keybinding: {
				when: CONTEXT_IN_CHAT_INPUT,
				primary: KeyCode.Enter,
				weight: KeybindingWeight.EditorContrib
			},
			menu: [
				{
					id: MenuId.AideChatExecuteSecondary,
					group: 'group_1',
				},
				{
					id: MenuId.AideChatExecute,
					when: CONTEXT_CHAT_REQUEST_IN_PROGRESS.negate(),
					group: 'navigation',
				},
			]
		});
	}

	run(accessor: ServicesAccessor, ...args: any[]) {
		const context: IChatExecuteActionContext | undefined = args[0];

		const widgetService = accessor.get(IAideChatWidgetService);
		const widget = context?.widget ?? widgetService.lastFocusedWidget;
		widget?.acceptInput(context?.inputValue);
	}
}


export class ChatSubmitSecondaryAgentAction extends Action2 {
	static readonly ID = 'workbench.action.aideChat.submitSecondaryAgent';

	constructor() {
		super({
			id: ChatSubmitSecondaryAgentAction.ID,
			title: localize2({ key: 'actions.chat.submitSecondaryAgent', comment: ['Send input from the chat input box to the secondary agent'] }, "Submit to Secondary Agent"),
			precondition: ContextKeyExpr.and(CONTEXT_CHAT_INPUT_HAS_TEXT, CONTEXT_CHAT_INPUT_HAS_AGENT.negate(), CONTEXT_CHAT_REQUEST_IN_PROGRESS.negate()),
			keybinding: {
				when: CONTEXT_IN_CHAT_INPUT,
				primary: KeyMod.CtrlCmd | KeyCode.Enter,
				weight: KeybindingWeight.EditorContrib
			},
			menu: {
				id: MenuId.AideChatExecuteSecondary,
				group: 'group_1'
			}
		});
	}

	run(accessor: ServicesAccessor, ...args: any[]) {
		const context: IChatExecuteActionContext | undefined = args[0];
		const agentService = accessor.get(IAideChatAgentService);
		const secondaryAgent = agentService.getSecondaryAgent();
		if (!secondaryAgent) {
			return;
		}

		const widgetService = accessor.get(IAideChatWidgetService);
		const widget = context?.widget ?? widgetService.lastFocusedWidget;
		if (!widget) {
			return;
		}

		if (extractAgentAndCommand(widget.parsedInput).agentPart) {
			widget.acceptInput();
		} else {
			widget.lastSelectedAgent = secondaryAgent;
			widget.acceptInputWithPrefix(`${chatAgentLeader}${secondaryAgent.name}`);
		}
	}
}

class SendToNewChatAction extends Action2 {
	constructor() {
		super({
			id: 'workbench.action.aideChat.sendToNewChat',
			title: localize2('aideChat.newChat.label', "Send to New Chat"),
			precondition: ContextKeyExpr.and(CONTEXT_CHAT_REQUEST_IN_PROGRESS.negate(), CONTEXT_CHAT_INPUT_HAS_TEXT),
			category: CHAT_CATEGORY,
			f1: false,
			menu: {
				id: MenuId.AideChatExecuteSecondary,
				group: 'group_2'
			},
			keybinding: {
				weight: KeybindingWeight.WorkbenchContrib,
				primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.Enter,
				when: CONTEXT_IN_CHAT_INPUT,
			}
		});
	}

	async run(accessor: ServicesAccessor, ...args: any[]) {
		const context: IChatExecuteActionContext | undefined = args[0];

		const widgetService = accessor.get(IAideChatWidgetService);
		const widget = context?.widget ?? widgetService.lastFocusedWidget;
		if (!widget) {
			return;
		}

		widget.clear();
		widget.acceptInput(context?.inputValue);
	}
}

export class CancelAction extends Action2 {
	static readonly ID = 'workbench.action.aideChat.cancel';
	constructor() {
		super({
			id: CancelAction.ID,
			title: localize2('aideChat.cancel.label', "Cancel"),
			f1: false,
			category: CHAT_CATEGORY,
			icon: Codicon.debugStop,
			menu: {
				id: MenuId.AideChatExecute,
				when: CONTEXT_CHAT_REQUEST_IN_PROGRESS,
				group: 'navigation',
			},
			keybinding: {
				weight: KeybindingWeight.WorkbenchContrib,
				primary: KeyMod.CtrlCmd | KeyCode.Escape,
			}
		});
	}

	run(accessor: ServicesAccessor, ...args: any[]) {
		const context: IChatExecuteActionContext | undefined = args[0];

		const widgetService = accessor.get(IAideChatWidgetService);
		const widget = context?.widget ?? widgetService.lastFocusedWidget;
		if (!widget) {
			return;
		}

		const chatService = accessor.get(IAideChatService);
		if (widget.viewModel) {
			chatService.cancelCurrentRequestForSession(widget.viewModel.sessionId);
		}
	}
}

export function registerChatExecuteActions() {
	registerAction2(SubmitAction);
	registerAction2(CancelAction);
	registerAction2(SendToNewChatAction);
	registerAction2(ChatSubmitSecondaryAgentAction);
}
