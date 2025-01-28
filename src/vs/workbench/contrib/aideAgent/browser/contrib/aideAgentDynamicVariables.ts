/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { coalesce } from '../../../../../base/common/arrays.js';
import { IMarkdownString, MarkdownString } from '../../../../../base/common/htmlContent.js';
import { Disposable } from '../../../../../base/common/lifecycle.js';
import { URI } from '../../../../../base/common/uri.js';
import { IRange, Range } from '../../../../../editor/common/core/range.js';
import { IDecorationOptions } from '../../../../../editor/common/editorCommon.js';
import { Command } from '../../../../../editor/common/languages.js';
import { Action2, registerAction2 } from '../../../../../platform/actions/common/actions.js';
import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import { ServicesAccessor } from '../../../../../platform/instantiation/common/instantiation.js';
import { ILabelService } from '../../../../../platform/label/common/label.js';
import { IChatRequestVariableValue, IDynamicVariable } from '../../common/aideAgentVariables.js';
import { IChatWidget } from '../aideAgent.js';
import { ChatWidget, IChatWidgetContrib } from '../aideAgentWidget.js';

export const dynamicVariableDecorationType = 'chat-dynamic-variable';

export const FileReferenceCompletionProviderName = 'chatInplaceFileReferenceCompletionProvider';
export const CodeSymbolCompletionProviderName = 'chatInplaceCodeCompletionProvider';

function changeIsBeforeVariable(changeRange: IRange, variableRange: IRange): boolean {
	return (
		changeRange.endLineNumber < variableRange.startLineNumber ||
		(changeRange.endLineNumber === variableRange.startLineNumber && changeRange.endColumn <= variableRange.startColumn)
	);
}

function changeIsAfterVariable(changeRange: IRange, variableRange: IRange): boolean {
	return (
		changeRange.startLineNumber > variableRange.endLineNumber ||
		(changeRange.startLineNumber === variableRange.endLineNumber && changeRange.startColumn >= variableRange.endColumn)
	);
}

export class ChatDynamicVariableModel extends Disposable implements IChatWidgetContrib {
	public static readonly ID = 'aideAgentDynamicVariableModel';

	private _variables: IDynamicVariable[] = [];
	get variables(): ReadonlyArray<IDynamicVariable> {
		return [...this._variables];
	}

	get id() {
		return ChatDynamicVariableModel.ID;
	}

	constructor(
		private readonly widget: IChatWidget,
		@ILabelService private readonly labelService: ILabelService,
	) {
		super();
		this._register(widget.inputEditor.onDidChangeModelContent(e => {
			e.changes.forEach(c => {
				// Don't mutate entries in _variables, since they will be returned from the getter
				this._variables = coalesce(this._variables.map(ref => {
					const intersection = Range.intersectRanges(ref.range, c.range);
					if (intersection && !intersection.isEmpty()) {
						// The reference text was changed, it's broken.
						// But if the whole reference range was deleted (eg history navigation) then don't try to change the editor.
						if (!Range.containsRange(c.range, ref.range)) {
							const rangeToDelete = new Range(ref.range.startLineNumber, ref.range.startColumn, ref.range.endLineNumber, ref.range.endColumn - 1);
							this.widget.inputEditor.executeEdits(this.id, [{
								range: rangeToDelete,
								text: '',
							}]);
						}
						return null;
					} else if (Range.compareRangesUsingStarts(ref.range, c.range) > 0) {
						// Determine if the change is before, after, or overlaps with the variable's range.
						if (changeIsBeforeVariable(c.range, ref.range)) {
							// Change is before the variable; adjust the variable's range.

							// Calculate line delta
							const linesInserted = c.text.split('\n').length - 1;
							const linesRemoved = c.range.endLineNumber - c.range.startLineNumber;
							const lineDelta = linesInserted - linesRemoved;

							// Initialize column delta
							let columnDelta = 0;

							// Check if change is on the same line as the variable's start
							if (c.range.endLineNumber === ref.range.startLineNumber) {
								// Change is on the same line
								if (c.range.endColumn <= ref.range.startColumn) {
									// Change occurs before the variable's start column
									if (linesInserted === 0) {
										// Single-line change
										const charsInserted = c.text.length;
										const charsRemoved = c.rangeLength;
										columnDelta = charsInserted - charsRemoved;
									} else {
										// Multi-line change (e.g., newline inserted)
										// Adjust columns accordingly
										columnDelta = - (c.range.endColumn - 1);
										// The variable's column should be adjusted to account for the reset after newline
									}
								} else {
									// Change occurs after the variable's start column
									// Variable is unaffected
									columnDelta = 0;
								}
							} else if (c.range.endLineNumber < ref.range.startLineNumber) {
								// Change is on lines before the variable's line
								columnDelta = 0;
							}

							return {
								...ref,
								range: {
									startLineNumber: ref.range.startLineNumber + lineDelta,
									startColumn: ref.range.startColumn + columnDelta,
									endLineNumber: ref.range.endLineNumber + lineDelta,
									endColumn: ref.range.endColumn + columnDelta
								}
							};
						} else if (changeIsAfterVariable(c.range, ref.range)) {
							// Change is after the variable; no adjustment needed.
							return ref;
						} else {
							// Change overlaps with the variable; the variable is broken.
							return null;
						}
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
			s = [];
		}

		this._variables = s;
		this.updateDecorations();
	}

	addReference(ref: IDynamicVariable): void {
		this._variables.push(ref);
		this.updateDecorations();
	}

	private updateDecorations(): void {
		this.widget.inputEditor.setDecorationsByType('chat', dynamicVariableDecorationType, this._variables.map((r): IDecorationOptions => ({
			range: r.range,
			hoverMessage: this.getHoverForReference(r)
		})));
	}

	private getHoverForReference(ref: IDynamicVariable): IMarkdownString | undefined {
		const value = ref.data;
		if (URI.isUri(value)) {
			return new MarkdownString(this.labelService.getUriLabel(value, { relative: true }));
		} else {
			return undefined;
		}
	}
}

ChatWidget.CONTRIBS.push(ChatDynamicVariableModel);

export interface IAddDynamicVariableContext {
	id: string;
	widget: IChatWidget;
	range: IRange;
	variableData: IChatRequestVariableValue;
	command?: Command;
}

function isAddDynamicVariableContext(context: any): context is IAddDynamicVariableContext {
	return 'widget' in context &&
		'range' in context &&
		'variableData' in context;
}

export class AddDynamicVariableAction extends Action2 {
	static readonly ID = 'workbench.action.aideAgent.addDynamicVariable';

	constructor() {
		super({
			id: AddDynamicVariableAction.ID,
			title: '' // not displayed
		});
	}

	async run(accessor: ServicesAccessor, ...args: any[]) {
		const context = args[0];
		if (!isAddDynamicVariableContext(context)) {
			return;
		}

		let range = context.range;
		const variableData = context.variableData;

		const doCleanup = () => {
			// Failed, remove the dangling variable prefix
			context.widget.inputEditor.executeEdits('chatInsertDynamicVariableWithArguments', [{ range: context.range, text: `` }]);
		};

		// If this completion item has no command, return it directly
		if (context.command) {
			// Invoke the command on this completion item along with its args and return the result
			const commandService = accessor.get(ICommandService);
			const selection: string | undefined = await commandService.executeCommand(context.command.id, ...(context.command.arguments ?? []));
			if (!selection) {
				doCleanup();
				return;
			}

			// Compute new range and variableData
			const insertText = ':' + selection;
			const insertRange = new Range(range.startLineNumber, range.endColumn, range.endLineNumber, range.endColumn + insertText.length);
			range = new Range(range.startLineNumber, range.startColumn, range.endLineNumber, range.endColumn + insertText.length);
			const editor = context.widget.inputEditor;
			const success = editor.executeEdits('chatInsertDynamicVariableWithArguments', [{ range: insertRange, text: insertText + ' ' }]);
			if (!success) {
				doCleanup();
				return;
			}
		}

		context.widget.getContrib<ChatDynamicVariableModel>(ChatDynamicVariableModel.ID)?.addReference({
			id: context.id,
			range: range,
			data: variableData
		});
	}
}
registerAction2(AddDynamicVariableAction);
