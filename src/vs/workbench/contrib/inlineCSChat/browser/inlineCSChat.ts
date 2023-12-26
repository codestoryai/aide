/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Dimension } from 'vs/base/browser/dom';
import { Event } from 'vs/base/common/event';
import { ICodeEditor } from 'vs/editor/browser/editorBrowser';
import { ISingleEditOperation } from 'vs/editor/common/core/editOperation';
import { ITextModel } from 'vs/editor/common/model';
import { IInlineChatWidgetContrib } from 'vs/workbench/contrib/inlineCSChat/browser/inlineCSChatWidget';
import { IInlineCSChatSlashCommand } from 'vs/workbench/contrib/inlineCSChat/common/inlineCSChat';
import { IUntitledTextEditorModel } from 'vs/workbench/services/untitled/common/untitledTextEditorModel';

export interface IInlineChatWidget {
	readonly onDidChangeInput: Event<this>;
	readonly inputEditor: ICodeEditor;

	getContrib<T extends IInlineChatWidgetContrib>(id: string): T | undefined;
	dispose(): void;
	focus(): void;
	getHeight(): number;
	hasFocus(): boolean;
	hideCreatePreview(): void;
	hideEditsPreview(): void;
	layout(dim: Dimension): void;
	readPlaceholder(): void;
	reset(): void;
	selectAll(includeSlashCommand?: boolean): void;
	showCreatePreview(model: IUntitledTextEditorModel): Promise<void>;
	showEditsPreview(textModel0: ITextModel, textModelN: ITextModel, allEdits: ISingleEditOperation[][]): Promise<void>;
	showsAnyPreview(): boolean;
	updateInfo(message: string): void;
	updateProgress(show: boolean): void;
	getSlashCommands(): IInlineCSChatSlashCommand[];
	updateSlashCommands(commands: IInlineCSChatSlashCommand[]): void;
	updateSlashCommandUsed(command: string): void;
	updateStatus(message: string, ops?: { classes?: string[]; resetAfter?: number; keepMessage?: boolean }): void;
	updateToolbar(show: boolean): void;
}
