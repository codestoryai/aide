/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Codicon } from 'vs/base/common/codicons';
import { ServicesAccessor } from 'vs/editor/browser/editorExtensions';
import { localize } from 'vs/nls';
import { Action2, MenuId, registerAction2 } from 'vs/platform/actions/common/actions';
import { CHAT_CATEGORY } from 'vs/workbench/contrib/csChat/browser/actions/csChatActions';
import { IChatWidget, ICSChatWidgetService } from 'vs/workbench/contrib/csChat/browser/csChat';
import { CONTEXT_CHAT_INPUT_HAS_TEXT, CONTEXT_CHAT_REQUEST_IN_PROGRESS } from 'vs/workbench/contrib/csChat/common/csChatContextKeys';
import { ICSChatService } from 'vs/workbench/contrib/csChat/common/csChatService';

export interface IChatExecuteActionContext {
	widget?: IChatWidget;
	inputValue?: string;
}

export class SubmitAction extends Action2 {
	static readonly ID = 'workbench.action.csChat.submit';

	constructor() {
		super({
			id: SubmitAction.ID,
			title: {
				value: localize('interactive.submit.label', "Submit"),
				original: 'Submit'
			},
			f1: false,
			category: CHAT_CATEGORY,
			icon: Codicon.send,
			precondition: CONTEXT_CHAT_INPUT_HAS_TEXT,
			menu: {
				id: MenuId.CSChatExecute,
				when: CONTEXT_CHAT_REQUEST_IN_PROGRESS.negate(),
				group: 'navigation',
			}
		});
	}

	run(accessor: ServicesAccessor, ...args: any[]) {
		const context: IChatExecuteActionContext | undefined = args[0];

		const widgetService = accessor.get(ICSChatWidgetService);
		const widget = context?.widget ?? widgetService.lastFocusedWidget;
		widget?.acceptInput(context?.inputValue);
	}
}

export function registerChatExecuteActions() {
	registerAction2(SubmitAction);
	registerAction2(class CancelAction extends Action2 {
		constructor() {
			super({
				id: 'workbench.action.csChat.cancel',
				title: {
					value: localize('interactive.cancel.label', "Cancel"),
					original: 'Cancel'
				},
				f1: false,
				category: CHAT_CATEGORY,
				icon: Codicon.debugStop,
				menu: {
					id: MenuId.CSChatExecute,
					when: CONTEXT_CHAT_REQUEST_IN_PROGRESS,
					group: 'navigation',
				}
			});
		}

		run(accessor: ServicesAccessor, ...args: any[]) {
			const context: IChatExecuteActionContext = args[0];
			if (!context.widget) {
				return;
			}

			const chatService = accessor.get(ICSChatService);
			if (context.widget.viewModel) {
				chatService.cancelCurrentRequestForSession(context.widget.viewModel.sessionId);
			}
		}
	});
}
