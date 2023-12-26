/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from 'vs/base/common/cancellation';
import { onUnexpectedExternalError } from 'vs/base/common/errors';
import { Iterable } from 'vs/base/common/iterator';
import { IDisposable, toDisposable } from 'vs/base/common/lifecycle';
import { ICodeEditorService } from 'vs/editor/browser/services/codeEditorService';
import { IParsedChatRequest, ChatRequestVariablePart, ChatRequestDynamicVariablePart } from 'vs/workbench/contrib/csChat/common/csChatParserTypes';
import { ICSChatRequestVariableValue, ICSChatVariableData, IChatVariableResolveResult, IDynamicVariable, IInlineChatVariableResolver, IInlineCSChatVariablesService } from 'vs/workbench/contrib/csChat/common/csChatVariables';
import { ChatDynamicVariableModel } from 'vs/workbench/contrib/inlineCSChat/browser/contrib/inlineCSChatDynamicVariables';
import { InlineChatController } from 'vs/workbench/contrib/inlineCSChat/browser/inlineCSChatController';

interface IChatData {
	data: ICSChatVariableData;
	resolver: IInlineChatVariableResolver;
}

export class InlineCSChatVariablesService implements IInlineCSChatVariablesService {
	declare _serviceBrand: undefined;

	private _resolver = new Map<string, IChatData>();

	constructor(
		@ICodeEditorService private readonly codeEditorService: ICodeEditorService
	) {
	}

	async resolveVariables(prompt: IParsedChatRequest, token: CancellationToken): Promise<IChatVariableResolveResult> {
		const resolvedVariables: Record<string, ICSChatRequestVariableValue[]> = {};
		const jobs: Promise<any>[] = [];

		const parsedPrompt: string[] = [];
		prompt.parts
			.forEach((part, i) => {
				if (part instanceof ChatRequestVariablePart) {
					const data = this._resolver.get(part.variableName.toLowerCase());
					if (data) {
						jobs.push(data.resolver(prompt.text, part.variableArg, token).then(value => {
							if (value) {
								resolvedVariables[part.variableName] = value;
								parsedPrompt[i] = `[${part.text}](values:${part.variableName})`;
							} else {
								parsedPrompt[i] = part.promptText;
							}
						}).catch(onUnexpectedExternalError));
					}
				} else if (part instanceof ChatRequestDynamicVariablePart) {
					const referenceName = this.getUniqueReferenceName(part.referenceText, resolvedVariables);
					resolvedVariables[referenceName] = part.data;
					const safeText = part.text.replace(/[\[\]]/g, '_');
					const safeTarget = referenceName.replace(/[\(\)]/g, '_');
					parsedPrompt[i] = `[${safeText}](values:${safeTarget})`;
				} else {
					parsedPrompt[i] = part.promptText;
				}
			});

		await Promise.allSettled(jobs);

		return {
			variables: resolvedVariables,
			prompt: parsedPrompt.join('').trim()
		};
	}

	private getUniqueReferenceName(name: string, vars: Record<string, any>): string {
		let i = 1;
		while (vars[name]) {
			name = `${name}_${i++}`;
		}
		return name;
	}

	hasVariable(name: string): boolean {
		return this._resolver.has(name.toLowerCase());
	}

	getVariables(): Iterable<Readonly<ICSChatVariableData>> {
		const all = Iterable.map(this._resolver.values(), data => data.data);
		return Iterable.filter(all, data => !data.hidden);
	}

	getDynamicVariables(): ReadonlyArray<IDynamicVariable> {
		const codeEditor = this.codeEditorService.getActiveCodeEditor();
		if (!codeEditor) {
			return [];
		}

		const widget = InlineChatController.get(codeEditor)?.getWidget();
		if (!widget) {
			return [];
		}

		const model = widget.getContrib<ChatDynamicVariableModel>(ChatDynamicVariableModel.ID);
		if (!model) {
			return [];
		}

		return model.variables;
	}

	registerVariable(data: ICSChatVariableData, resolver: IInlineChatVariableResolver): IDisposable {
		const key = data.name.toLowerCase();
		if (this._resolver.has(key)) {
			throw new Error(`A chat variable with the name '${data.name}' already exists.`);
		}
		this._resolver.set(key, { data, resolver });
		return toDisposable(() => {
			this._resolver.delete(key);
		});
	}
}
