/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as dom from '../../../../../base/browser/dom.js';
import { Codicon } from '../../../../../base/common/codicons.js';
import { Schemas } from '../../../../../base/common/network.js';
import { ThemeIcon } from '../../../../../base/common/themables.js';
import { URI } from '../../../../../base/common/uri.js';
import { ServicesAccessor } from '../../../../../editor/browser/editorExtensions.js';
import { Position } from '../../../../../editor/common/core/position.js';
import { EditorType } from '../../../../../editor/common/editorCommon.js';
import { Command } from '../../../../../editor/common/languages.js';
import { IGotoSymbolQuickPickItem } from '../../../../../editor/contrib/quickAccess/browser/gotoSymbolQuickAccess.js';
import { SuggestController } from '../../../../../editor/contrib/suggest/browser/suggestController.js';
import { localize2 } from '../../../../../nls.js';
import { Action2, MenuId, registerAction2 } from '../../../../../platform/actions/common/actions.js';
import { IQuickPickItem } from '../../../../../platform/quickinput/common/quickInput.js';
import { IEditorService } from '../../../../services/editor/common/editorService.js';
import { ISymbolQuickPickItem } from '../../../search/browser/symbolsQuickAccess.js';
import { ChatAgentLocation } from '../../common/aideAgentAgents.js';
import { IChatRequestVariableEntry } from '../../common/aideAgentModel.js';
import { IAideAgentVariablesService } from '../../common/aideAgentVariables.js';
import { IAideAgentWidgetService, IChatWidget } from '../aideAgent.js';
import { imageToHash } from '../aideAgentPasteProviders.js';
import { CHAT_CATEGORY } from './aideAgentActions.js';

export function registerChatContextActions() {
	registerAction2(AttachFileAction);
	registerAction2(AttachSelectionAction);
	registerAction2(TriggerContextProvider);
	registerAction2(TriggerImageContextProvider);
}

export type IChatContextQuickPickItem = IFileQuickPickItem | IDynamicVariableQuickPickItem | IStaticVariableQuickPickItem | IGotoSymbolQuickPickItem | ISymbolQuickPickItem | IQuickAccessQuickPickItem | IToolQuickPickItem;

export interface IFileQuickPickItem extends IQuickPickItem {
	kind: 'file';
	id: string;
	name: string;
	value: URI;
	isDynamic: true;

	resource: URI;
}

export interface IDynamicVariableQuickPickItem extends IQuickPickItem {
	kind: 'dynamic';
	id: string;
	name?: string;
	value: unknown;
	isDynamic: true;

	icon?: ThemeIcon;
	command?: Command;
}

export interface IToolQuickPickItem extends IQuickPickItem {
	kind: 'tool';
	id: string;
	name?: string;
	icon?: ThemeIcon;
}

export interface IStaticVariableQuickPickItem extends IQuickPickItem {
	kind: 'static';
	id: string;
	name: string;
	value: unknown;
	isDynamic?: false;

	icon?: ThemeIcon;
}

export interface IQuickAccessQuickPickItem extends IQuickPickItem {
	kind: 'quickaccess';
	id: string;
	name: string;
	value: string;

	prefix: string;
}

class AttachFileAction extends Action2 {

	static readonly ID = 'workbench.action.aideAgent.attachFile';

	constructor() {
		super({
			id: AttachFileAction.ID,
			title: localize2('workbench.action.aideAgent.attachFile.label', "Attach File"),
			category: CHAT_CATEGORY,
			f1: false
		});
	}

	override async run(accessor: ServicesAccessor, ...args: any[]): Promise<void> {
		const variablesService = accessor.get(IAideAgentVariablesService);
		const textEditorService = accessor.get(IEditorService);

		const activeUri = textEditorService.activeEditor?.resource;
		if (textEditorService.activeTextEditorControl?.getEditorType() === EditorType.ICodeEditor && activeUri && [Schemas.file, Schemas.vscodeRemote, Schemas.untitled].includes(activeUri.scheme)) {
			variablesService.attachContext('file', activeUri, ChatAgentLocation.Panel);
		}
	}
}

class AttachSelectionAction extends Action2 {

	static readonly ID = 'workbench.action.aideAgent.attachSelection';

	constructor() {
		super({
			id: AttachSelectionAction.ID,
			title: localize2('workbench.action.aideAgent.attachSelection.label', "Add Selection to Chat"),
			category: CHAT_CATEGORY,
			f1: false
		});
	}

	override async run(accessor: ServicesAccessor, ...args: any[]): Promise<void> {
		const variablesService = accessor.get(IAideAgentVariablesService);
		const textEditorService = accessor.get(IEditorService);

		const activeEditor = textEditorService.activeTextEditorControl;
		const activeUri = textEditorService.activeEditor?.resource;
		if (textEditorService.activeTextEditorControl?.getEditorType() === EditorType.ICodeEditor && activeUri && [Schemas.file, Schemas.vscodeRemote, Schemas.untitled].includes(activeUri.scheme)) {
			const selection = activeEditor?.getSelection();
			if (selection) {
				variablesService.attachContext('file', { uri: activeUri, range: selection }, ChatAgentLocation.Panel);
			}
		}
	}
}

class TriggerContextProvider extends Action2 {
	static readonly ID = 'workbench.action.aideAgent.triggerContextProvider';

	constructor() {
		super({
			id: TriggerContextProvider.ID,
			title: localize2('workbench.action.aideAgent.triggerContextProvider.label', "Add context"),
			f1: false,
			category: CHAT_CATEGORY,
			icon: Codicon.attach,
			menu: [
				{
					id: MenuId.AideAgentInput,
					group: 'navigation',
				}
			]
		});
	}

	override async run(accessor: ServicesAccessor, ...args: any[]): Promise<void> {
		const widgetService = accessor.get(IAideAgentWidgetService);
		const context: { widget?: IChatWidget } | undefined = args[0];
		const widget = context?.widget ?? widgetService.lastFocusedWidget;
		if (!widget) {
			return;
		}

		const suggestCtrl = SuggestController.get(widget.inputEditor);
		if (suggestCtrl) {
			const curText = widget.inputEditor.getValue();
			const newValue = curText ? `@ ${curText}` : '@';
			if (!curText.startsWith('@')) {
				widget.inputEditor.setValue(newValue);
			}

			widget.inputEditor.setPosition(new Position(1, 2));
			suggestCtrl.triggerSuggest(undefined, true);
		}
	}
}

class TriggerImageContextProvider extends Action2 {
	static readonly ID = 'workbench.action.aideAgent.triggerImageContextProvider';

	constructor() {
		super({
			id: TriggerImageContextProvider.ID,
			title: localize2('workbench.action.aideAgent.triggerImageContextProvider.label', "Attach image"),
			f1: false,
			category: CHAT_CATEGORY,
			icon: Codicon.deviceCamera,
			menu: [
				{
					id: MenuId.AideAgentInput,
					group: 'navigation',
				}
			]
		});
	}

	override async run(accessor: ServicesAccessor, ...args: any[]): Promise<void> {
		const widgetService = accessor.get(IAideAgentWidgetService);
		const context: { widget?: IChatWidget } | undefined = args[0];
		const widget = context?.widget ?? widgetService.lastFocusedWidget;
		if (!widget) {
			return;
		}

		// Create a hidden file input element
		const fileInput = dom.$('input') as HTMLInputElement;
		fileInput.type = 'file';
		fileInput.accept = 'image/jpeg,image/png,image/gif';
		fileInput.style.display = 'none';
		dom.getActiveWindow().document.body.appendChild(fileInput);

		// Handle file selection
		fileInput.onchange = async () => {
			const file = fileInput.files?.[0];
			if (file) {
				const validTypes = ['image/jpeg', 'image/png', 'image/gif'];
				if (validTypes.includes(file.type)) {
					// Read file as ArrayBuffer
					const arrayBuffer = await file.arrayBuffer();
					const data = new Uint8Array(arrayBuffer);
					const imageHash = await imageToHash(data);

					// Create image context
					const imageContext: IChatRequestVariableEntry = {
						value: data,
						id: imageHash,
						name: file.name,
						isImage: true,
						icon: Codicon.fileMedia,
						isDynamic: true,
						mimeType: file.type
					};
					widget.input.attachmentModel.addContext(imageContext);
				}
			}
			dom.getActiveWindow().document.body.removeChild(fileInput);
		};

		fileInput.click();
	}
}
