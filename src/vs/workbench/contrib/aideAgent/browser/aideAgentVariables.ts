/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { coalesce } from '../../../../base/common/arrays.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { onUnexpectedExternalError } from '../../../../base/common/errors.js';
import { Iterable } from '../../../../base/common/iterator.js';
import { IDisposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { basename } from '../../../../base/common/path.js';
import { ThemeIcon } from '../../../../base/common/themables.js';
import { URI } from '../../../../base/common/uri.js';
import { isCodeEditor } from '../../../../editor/browser/editorBrowser.js';
import { IRange } from '../../../../editor/common/core/range.js';
import { Location } from '../../../../editor/common/languages.js';
import { IModelService } from '../../../../editor/common/services/model.js';
import { ITextModelService } from '../../../../editor/common/services/resolverService.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { IViewsService } from '../../../services/views/common/viewsService.js';
import { IPinnedContextService } from '../../pinnedContext/common/pinnedContext.js';
import { ChatAgentLocation } from '../common/aideAgentAgents.js';
import { AgentScope, IChatModel, IChatRequestVariableData, IChatRequestVariableEntry } from '../common/aideAgentModel.js';
import { ChatRequestDynamicVariablePart, ChatRequestToolPart, ChatRequestVariablePart, IParsedChatRequest } from '../common/aideAgentParserTypes.js';
import { IChatContentReference, IChatSendRequestOptions } from '../common/aideAgentService.js';
import { IAideAgentVariablesService, IChatRequestVariableValue, IChatVariableData, IChatVariableResolver, IChatVariableResolverProgress, IDynamicVariable } from '../common/aideAgentVariables.js';
import { IAideAgentLMToolsService } from '../common/languageModelToolsService.js';
import { IAideAgentWidgetService, showChatView } from './aideAgent.js';
import { ChatDynamicVariableModel } from './contrib/aideAgentDynamicVariables.js';

interface IChatData {
	data: IChatVariableData;
	resolver: IChatVariableResolver;
}

export class ChatVariablesService implements IAideAgentVariablesService {
	declare _serviceBrand: undefined;

	private _resolver = new Map<string, IChatData>();

	constructor(
		@IAideAgentLMToolsService private readonly toolsService: IAideAgentLMToolsService,
		@IAideAgentWidgetService private readonly chatWidgetService: IAideAgentWidgetService,
		@IEditorService private readonly editorService: IEditorService,
		@IModelService private readonly modelService: IModelService,
		@ITextModelService private readonly textModelService: ITextModelService,
		@IPinnedContextService private readonly pinnedContextService: IPinnedContextService,
		@IViewsService private readonly viewsService: IViewsService,
	) {
	}

	async resolveVariables(prompt: IParsedChatRequest, attachedContextVariables: IChatRequestVariableEntry[] | undefined, model: IChatModel, progress: (part: IChatVariableResolverProgress) => void, options: IChatSendRequestOptions | undefined, token: CancellationToken): Promise<IChatRequestVariableData> {
		let resolvedVariables: IChatRequestVariableEntry[] = [];
		const jobs: Promise<any>[] = [];

		prompt.parts
			.forEach((part, i) => {
				if (part instanceof ChatRequestVariablePart) {
					const data = this._resolver.get(part.variableName.toLowerCase());
					if (data) {
						const references: IChatContentReference[] = [];
						const variableProgressCallback = (item: IChatVariableResolverProgress) => {
							if (item.kind === 'reference') {
								references.push(item);
								return;
							}
							progress(item);
						};
						jobs.push(data.resolver(prompt.text, part.variableArg, model, variableProgressCallback, token).then(value => {
							if (value) {
								resolvedVariables[i] = { id: data.data.id, modelDescription: data.data.modelDescription, name: part.variableName, range: part.range, value, references, fullName: data.data.fullName, icon: data.data.icon };
							}
						}).catch(onUnexpectedExternalError));
					}
				} else if (part instanceof ChatRequestDynamicVariablePart) {
					resolvedVariables[i] = { id: part.id, name: part.referenceText, range: part.range, value: part.data, };
				} else if (part instanceof ChatRequestToolPart) {
					const tool = this.toolsService.getTool(part.toolId);
					if (tool) {
						resolvedVariables[i] = { id: part.toolId, name: part.toolName, range: part.range, value: undefined, isTool: true, icon: ThemeIcon.isThemeIcon(tool.icon) ? tool.icon : undefined, fullName: tool.displayName };
					}
				}
			});

		const resolvedAttachedContext: IChatRequestVariableEntry[] = [];
		attachedContextVariables
			?.forEach((attachment, i) => {
				const data = this._resolver.get(attachment.name?.toLowerCase());
				if (data) {
					const references: IChatContentReference[] = [];
					const variableProgressCallback = (item: IChatVariableResolverProgress) => {
						if (item.kind === 'reference') {
							references.push(item);
							return;
						}
						progress(item);
					};
					jobs.push(data.resolver(prompt.text, '', model, variableProgressCallback, token).then(value => {
						if (value) {
							resolvedAttachedContext[i] = { id: data.data.id, modelDescription: data.data.modelDescription, name: attachment.name, fullName: attachment.fullName, range: attachment.range, value, references, icon: attachment.icon };
						}
					}).catch(onUnexpectedExternalError));
				} else if (attachment.isDynamic || attachment.isTool) {
					resolvedAttachedContext[i] = { ...attachment };
				}
			});

		await Promise.allSettled(jobs);

		// Always attach the active editor
		const activeEditor = this.editorService.activeTextEditorControl;
		if (isCodeEditor(activeEditor)) {
			const model = activeEditor.getModel();
			if (model) {
				const selection = activeEditor.getSelection();
				let range: IRange;
				if (selection && !selection.isEmpty()) {
					range = {
						startLineNumber: selection.startLineNumber,
						startColumn: selection.startColumn,
						endLineNumber: selection.endLineNumber,
						endColumn: selection.endColumn,
					};
				} else {
					range = model.getFullModelRange();
				}

				resolvedAttachedContext.push({
					id: 'vscode.editor.selection',
					name: basename(model.uri.fsPath),
					value: { uri: model.uri, range },
				});
			}
		}

		// Always attach pinned context
		const pinnedContexts = this.pinnedContextService.getPinnedContexts();
		const pinnedContextPromises = pinnedContexts.map(async (context) => {
			let model = this.modelService.getModel(context);
			if (!model) {
				try {
					const modelReference = await this.textModelService.createModelReference(context);
					model = modelReference.object.textEditorModel;
					modelReference.dispose();
				} catch (e) {
					return null;
				}
			}

			const range = model.getFullModelRange();
			return {
				id: 'vscode.file.pinnedContext',
				name: basename(model.uri.fsPath),
				value: { uri: model.uri, range }
			};
		});

		const resolvedPinnedContexts = await Promise.all(pinnedContextPromises);
		resolvedAttachedContext.push(...resolvedPinnedContexts.filter(pc => pc !== null));

		if (options?.agentScope === AgentScope.Codebase) {
			const openEditors = this.editorService.editors;
			openEditors.forEach(editor => {
				const resource = editor.resource;
				if (resource) {
					const model = this.modelService.getModel(resource);
					if (model) {
						const range = model.getFullModelRange();
						resolvedAttachedContext.push({
							id: 'vscode.file',
							name: basename(model.uri.fsPath),
							value: { uri: model.uri, range }
						});
					}
				}
			});
		}

		// Make array not sparse
		resolvedVariables = coalesce<IChatRequestVariableEntry>(resolvedVariables);

		// "reverse", high index first so that replacement is simple
		resolvedVariables.sort((a, b) => b.range!.start - a.range!.start);

		// resolvedAttachedContext is a sparse array
		resolvedVariables.push(...coalesce(resolvedAttachedContext));


		return {
			variables: resolvedVariables,
		};
	}

	async resolveVariable(variableName: string, promptText: string, model: IChatModel, progress: (part: IChatVariableResolverProgress) => void, token: CancellationToken): Promise<IChatRequestVariableValue | undefined> {
		const data = this._resolver.get(variableName.toLowerCase());
		if (!data) {
			return undefined;
		}

		return (await data.resolver(promptText, undefined, model, progress, token));
	}

	hasVariable(name: string): boolean {
		return this._resolver.has(name.toLowerCase());
	}

	getVariable(name: string): IChatVariableData | undefined {
		return this._resolver.get(name.toLowerCase())?.data;
	}

	getVariables(location: ChatAgentLocation): Iterable<Readonly<IChatVariableData>> {
		const all = Iterable.map(this._resolver.values(), data => data.data);
		return Iterable.filter(all, data => {
			// TODO@jrieken this is improper and should be know from the variable registeration data
			return location !== ChatAgentLocation.Editor || !new Set(['selection', 'editor']).has(data.name);
		});
	}

	getDynamicVariables(sessionId: string): ReadonlyArray<IDynamicVariable> {
		// This is slightly wrong... the parser pulls dynamic references from the input widget, but there is no guarantee that message came from the input here.
		// Need to ...
		// - Parser takes list of dynamic references (annoying)
		// - Or the parser is known to implicitly act on the input widget, and we need to call it before calling the chat service (maybe incompatible with the future, but easy)
		const widget = this.chatWidgetService.getWidgetBySessionId(sessionId);
		if (!widget || !widget.viewModel || !widget.supportsFileReferences) {
			return [];
		}

		const model = widget.getContrib<ChatDynamicVariableModel>(ChatDynamicVariableModel.ID);
		if (!model) {
			return [];
		}

		return model.variables;
	}

	registerVariable(data: IChatVariableData, resolver: IChatVariableResolver): IDisposable {
		const key = data.name.toLowerCase();
		if (this._resolver.has(key)) {
			throw new Error(`A chat variable with the name '${data.name}' already exists.`);
		}
		this._resolver.set(key, { data, resolver });
		return toDisposable(() => {
			this._resolver.delete(key);
		});
	}

	async attachContext(name: string, value: string | URI | Location, location: ChatAgentLocation) {
		if (location !== ChatAgentLocation.Panel) {
			return;
		}

		const widget = this.chatWidgetService.lastFocusedWidget ?? await showChatView(this.viewsService);
		if (!widget || !widget.viewModel) {
			return;
		}

		const key = name.toLowerCase();
		if (key === 'file' && typeof value !== 'string') {
			const uri = URI.isUri(value) ? value : value.uri;
			const range = 'range' in value ? value.range : undefined;
			widget.attachmentModel.addFile(uri, range);
			return;
		}

		const resolved = this._resolver.get(key);
		if (!resolved) {
			return;
		}

		widget.attachmentModel.addContext({ ...resolved.data, value });
	}
}
