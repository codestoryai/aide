/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ServicesAccessor } from 'vs/editor/browser/editorExtensions';
import { localize } from 'vs/nls';
import { Action2, MenuId, registerAction2 } from 'vs/platform/actions/common/actions';
import { IClipboardService } from 'vs/platform/clipboard/common/clipboardService';
import { CHAT_CATEGORY } from 'vs/workbench/contrib/csChat/browser/actions/csChatActions';
import { ICSChatWidgetService } from 'vs/workbench/contrib/csChat/browser/csChat';
import { IChatRequestViewModel, IChatResponseViewModel, isRequestVM, isResponseVM } from 'vs/workbench/contrib/csChat/common/csChatViewModel';

export function registerChatCopyActions() {
	registerAction2(class CopyAllAction extends Action2 {
		constructor() {
			super({
				id: 'workbench.action.csChat.copyAll',
				title: {
					value: localize('interactive.copyAll.label', "Copy All"),
					original: 'Copy All'
				},
				f1: false,
				category: CHAT_CATEGORY,
				menu: {
					id: MenuId.CSChatContext
				}
			});
		}

		run(accessor: ServicesAccessor, ...args: any[]) {
			const clipboardService = accessor.get(IClipboardService);
			const chatWidgetService = accessor.get(ICSChatWidgetService);
			const widget = chatWidgetService.lastFocusedWidget;
			if (widget) {
				const viewModel = widget.viewModel;
				const sessionAsText = viewModel?.getItems()
					.filter((item): item is (IChatRequestViewModel | IChatResponseViewModel) => isRequestVM(item) || isResponseVM(item))
					.map(stringifyItem)
					.join('\n\n');
				if (sessionAsText) {
					clipboardService.writeText(sessionAsText);
				}
			}
		}
	});

	registerAction2(class CopyItemAction extends Action2 {
		constructor() {
			super({
				id: 'workbench.action.csChat.copyItem',
				title: {
					value: localize('interactive.copyItem.label', "Copy"),
					original: 'Copy'
				},
				f1: false,
				category: CHAT_CATEGORY,
				menu: {
					id: MenuId.CSChatContext
				}
			});
		}

		run(accessor: ServicesAccessor, ...args: any[]) {
			const item = args[0];
			if (!isRequestVM(item) && !isResponseVM(item)) {
				return;
			}

			const clipboardService = accessor.get(IClipboardService);
			const text = stringifyItem(item);
			clipboardService.writeText(text);
		}
	});
}

function stringifyItem(item: IChatRequestViewModel | IChatResponseViewModel): string {
	return isRequestVM(item) ?
		`${item.username}: ${item.messageText}` : `${item.username}: ${item.response.asString()}`;
}