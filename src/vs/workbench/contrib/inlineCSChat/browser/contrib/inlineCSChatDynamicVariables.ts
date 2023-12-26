/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { coalesce } from 'vs/base/common/arrays';
import { MarkdownString } from 'vs/base/common/htmlContent';
import { Disposable } from 'vs/base/common/lifecycle';
import { basename } from 'vs/base/common/resources';
import { URI } from 'vs/base/common/uri';
import { IRange, Range } from 'vs/editor/common/core/range';
import { IDecorationOptions } from 'vs/editor/common/editorCommon';
import { ITextModelService } from 'vs/editor/common/services/resolverService';
import { Action2, registerAction2 } from 'vs/platform/actions/common/actions';
import { ServicesAccessor } from 'vs/platform/instantiation/common/instantiation';
import { ILabelService } from 'vs/platform/label/common/label';
import { ILogService } from 'vs/platform/log/common/log';
import { parseVariableInfo } from 'vs/workbench/contrib/csChat/browser/contrib/csChatDynamicVariables';
import { chatFileVariableLeader, chatSymbolVariableLeader } from 'vs/workbench/contrib/csChat/common/csChatParserTypes';
import { IDynamicVariable } from 'vs/workbench/contrib/csChat/common/csChatVariables';
import { IInlineChatWidget } from 'vs/workbench/contrib/inlineCSChat/browser/inlineCSChat';
import { IInlineChatWidgetContrib, InlineChatWidget } from 'vs/workbench/contrib/inlineCSChat/browser/inlineCSChatWidget';
import { ISymbolQuickPickItem } from 'vs/workbench/contrib/search/browser/symbolsQuickAccess';

const dynamicVariableDecorationType = 'chat-dynamic-variable';

export class ChatDynamicVariableModel extends Disposable implements IInlineChatWidgetContrib {
	public static readonly ID = 'inlineCSChatDynamicVariableModel';

	private _variables: IDynamicVariable[] = [];
	get variables(): ReadonlyArray<IDynamicVariable> {
		return [...this._variables];
	}

	get id() {
		return ChatDynamicVariableModel.ID;
	}

	constructor(
		private readonly widget: IInlineChatWidget,
		@ILabelService private readonly labelService: ILabelService,
		@ILogService private readonly logService: ILogService,
	) {
		super();
		this._register(widget.inputEditor.onDidChangeModelContent(e => {
			e.changes.forEach(c => {
				// Don't mutate entries in _variables, since they will be returned from the getter
				this._variables = coalesce(this._variables.map((ref) => {
					if (Range.areIntersecting(ref.range, c.range)) {
						// The reference text was changed, it's broken
						widget.inputEditor.executeEdits('referenceEditCallback', [{ range: ref.range, text: `` }]);
						return null;
					} else if (Range.compareRangesUsingStarts(ref.range, c.range) > 0) {
						const delta = c.text.length - c.rangeLength;
						return {
							...ref,
							range: {
								startLineNumber: ref.range.startLineNumber,
								startColumn: ref.range.startColumn + delta,
								endLineNumber: ref.range.endLineNumber,
								endColumn: ref.range.endColumn + delta
							}
						};
					}

					return ref;
				}));
			});

			this.updateDecorations();
		}));
	}

	getInputState(): any {
		return this.variables;
	}

	setInputState(s: any): void {
		if (!Array.isArray(s)) {
			// Something went wrong
			this.logService.warn('InlineCSChatDynamicVariableModel.setInputState called with invalid state: ' + JSON.stringify(s));
			return;
		}

		this._variables = s;
		this.updateDecorations();
	}

	addReference(ref: IDynamicVariable): void {
		this._variables.push(ref);
		this.updateDecorations();
	}

	private updateDecorations(): void {
		this.widget.inputEditor.setDecorationsByType('chat', dynamicVariableDecorationType, this._variables.map(r => (<IDecorationOptions>{
			range: r.range,
			hoverMessage: this.getHoverForReference(r)
		})));
	}

	private getHoverForReference(ref: IDynamicVariable): string | MarkdownString {
		const value = ref.data[0];
		if (URI.isUri(value.value)) {
			return new MarkdownString(this.labelService.getUriLabel(value.value, { relative: true }));
		} else {
			return value.value.toString();
		}
	}
}

InlineChatWidget.CONTRIBS.push(ChatDynamicVariableModel);

interface InsertFileVariableContext {
	widget: IInlineChatWidget;
	range: IRange;
	uri: URI;
}

export function isInsertFileVariableContext(context: any): context is InsertFileVariableContext {
	return 'widget' in context && 'range' in context && 'uri' in context;
}

interface InsertSymbolVariableContext {
	widget: IInlineChatWidget;
	range: IRange;
	pick: ISymbolQuickPickItem;
}

export function isInsertSymbolVariableContext(context: any): context is InsertSymbolVariableContext {
	return 'widget' in context && 'range' in context && 'pick' in context;
}

export class SelectAndInsertFileAction extends Action2 {
	static readonly ID = 'workbench.action.inlineCSChat.selectAndInsertFile';

	constructor() {
		super({
			id: SelectAndInsertFileAction.ID,
			title: '' // not displayed
		});
	}

	async run(accessor: ServicesAccessor, ...args: any[]) {
		const textModelService = accessor.get(ITextModelService);
		const logService = accessor.get(ILogService);

		const context = args[0];
		if (!isInsertFileVariableContext(context)) {
			return;
		}

		const doCleanup = () => {
			// Failed, remove the dangling `file`
			context.widget.inputEditor.executeEdits('chatInsertFile', [{ range: context.range, text: `` }]);
		};

		const resource = context.uri;
		if (!resource) {
			logService.trace('SelectAndInsertFileAction: no resource selected');
			doCleanup();
			return;
		}

		const model = await textModelService.createModelReference(resource);
		// const fileRange = model.object.textEditorModel.getFullModelRange();
		model.dispose();

		const fileName = basename(resource);
		const editor = context.widget.inputEditor;
		const text = `${chatFileVariableLeader}file:${fileName} `;
		const range = context.range;
		const success = editor.executeEdits('chatInsertFile', [{ range, text: text + '' }]);
		if (!success) {
			logService.trace(`SelectAndInsertFileAction: failed to insert "${text}"`);
			doCleanup();
			return;
		}

		context.widget.getContrib<ChatDynamicVariableModel>(ChatDynamicVariableModel.ID)?.addReference({
			range: { startLineNumber: range.startLineNumber, startColumn: range.startColumn, endLineNumber: range.endLineNumber, endColumn: range.startColumn + text.length },
			data: [{ level: 'full', value: resource }]
		});
	}
}
registerAction2(SelectAndInsertFileAction);

export class SelectAndInsertCodeSymbolAction extends Action2 {
	static readonly ID = 'workbench.action.inlineCSChat.selectAndInsertCodeSymbol';

	constructor() {
		super({
			id: SelectAndInsertCodeSymbolAction.ID,
			title: '' // not displayed
		});
	}

	async run(accessor: ServicesAccessor, ...args: any[]) {
		const logService = accessor.get(ILogService);

		const context = args[0];
		if (!isInsertSymbolVariableContext(context)) {
			return;
		}

		const doCleanup = () => {
			// Failed, remove the dangling `file`
			context.widget.inputEditor.executeEdits('chatInsertCode', [{ range: context.range, text: `` }]);
		};

		const pick = context.pick;
		if (!pick || !pick.resource) {
			logService.trace('SelectAndInsertCodeSymbolAction: no resource selected');
			doCleanup();
			return;
		}

		// const selectionRange = (pick as unknown as { range: Range }).range;
		const result = parseVariableInfo(pick.label);
		if (!result) {
			logService.trace('SelectAndInsertCodeSymbolAction: failed to parse code symbol');
			doCleanup();
			return;
		}

		const [symbolName, symbolType] = result;
		const editor = context.widget.inputEditor;
		const text = `${chatSymbolVariableLeader}${symbolType}:${symbolName} `;
		const range = context.range;
		const success = editor.executeEdits('chatInsertCode', [{ range, text: text + ' ' }]);
		if (!success) {
			logService.trace(`SelectAndInsertSymbolAction: failed to insert "${text}"`);
			doCleanup();
			return;
		}

		context.widget.getContrib<ChatDynamicVariableModel>(ChatDynamicVariableModel.ID)?.addReference({
			range: { startLineNumber: range.startLineNumber, startColumn: range.startColumn, endLineNumber: range.endLineNumber, endColumn: range.startColumn + text.length },
			data: [{ level: 'full', value: pick.resource }]
		});
	}
}
registerAction2(SelectAndInsertCodeSymbolAction);
