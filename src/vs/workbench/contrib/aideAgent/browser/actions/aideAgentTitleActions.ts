/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export const MarkUnhelpfulActionId = 'workbench.action.aideAgent.markUnhelpful';

export function registerChatTitleActions() {
	/* TODO(@ghostwriternr): Completely get rid of this if removing a request no longer makes sense. But I can think of use-cases for now, so leaving it be.
	registerAction2(class RemoveAction extends Action2 {
		constructor() {
			super({
				id: 'workbench.action.aideAgent.remove',
				title: localize2('chat.remove.label', "Remove Request and Response"),
				f1: false,
				category: CHAT_CATEGORY,
				icon: Codicon.x,
				keybinding: {
					primary: KeyCode.Delete,
					mac: {
						primary: KeyMod.CtrlCmd | KeyCode.Backspace,
					},
					when: ContextKeyExpr.and(CONTEXT_IN_CHAT_SESSION, CONTEXT_IN_CHAT_INPUT.negate()),
					weight: KeybindingWeight.WorkbenchContrib,
				},
				menu: {
					id: MenuId.AideAgentMessageTitle,
					group: 'navigation',
					order: 2,
					when: CONTEXT_REQUEST
				}
			});
		}

		run(accessor: ServicesAccessor, ...args: any[]) {
			let item = args[0];
			if (!isRequestVM(item)) {
				const chatWidgetService = accessor.get(IAideAgentWidgetService);
				const widget = chatWidgetService.lastFocusedWidget;
				item = widget?.getFocus();
			}

			const requestId = isRequestVM(item) ? item.id :
				isResponseVM(item) ? item.requestId : undefined;

			if (requestId) {
				const chatService = accessor.get(IAideAgentService);
				chatService.removeRequest(item.sessionId, requestId);
			}
		}
	});
	*/

	/* TODO(@ghostwriternr): This is actually useful, but because the response part re-renders entirely when streaming, the button is impossible
	to click in the midst of it - which is when it's actually needed. Add this back when we fix the re-render logic for good (which is... not easy).
	registerAction2(class StopAction extends Action2 {
		constructor() {
			super({
				id: 'workbench.action.aideAgent.stop',
				title: localize2('aideAgent.stop.label', "Stop"),
				f1: false,
				category: CHAT_CATEGORY,
				icon: Codicon.debugStop,
				menu: {
					id: MenuId.AideAgentMessageTitle,
					group: 'navigation',
					order: 1,
					when: ContextKeyExpr.and(CONTEXT_RESPONSE, CONTEXT_RESPONSE_FILTERED.negate())
				}
			});
		}

		run(accessor: ServicesAccessor, ...args: any[]) {
			const item = args[0];
			const chatService = accessor.get(IAideAgentService);
			chatService.cancelExchange(item.id);
		}
	});
	*/
}
