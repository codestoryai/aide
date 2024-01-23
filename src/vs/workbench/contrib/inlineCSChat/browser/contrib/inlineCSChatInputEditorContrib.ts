/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from 'vs/base/common/cancellation';
import { Disposable } from 'vs/base/common/lifecycle';
import { basenameOrAuthority, dirname } from 'vs/base/common/resources';
import { ICodeEditorService } from 'vs/editor/browser/services/codeEditorService';
import { Position } from 'vs/editor/common/core/position';
import { Range } from 'vs/editor/common/core/range';
import { getWordAtText } from 'vs/editor/common/core/wordHelper';
import { CompletionContext, CompletionItem, CompletionItemKind, CompletionList, Location } from 'vs/editor/common/languages';
import { ITextModel } from 'vs/editor/common/model';
import { ILanguageFeaturesService } from 'vs/editor/common/services/languageFeatures';
import { CompletionPreviewController } from 'vs/editor/contrib/completionPreview/browser/completionPreviewWidget';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { ILabelService } from 'vs/platform/label/common/label';
import { Registry } from 'vs/platform/registry/common/platform';
import { IWorkspaceContextService } from 'vs/platform/workspace/common/workspace';
import { IWorkbenchContributionsRegistry, Extensions as WorkbenchExtensions } from 'vs/workbench/common/contributions';
import { chatFileVariableLeader, chatSymbolVariableLeader } from 'vs/workbench/contrib/csChat/common/csChatParserTypes';
import { SelectAndInsertCodeSymbolAction, SelectAndInsertFileAction, isInsertFileVariableContext, isInsertSymbolVariableContext } from 'vs/workbench/contrib/inlineCSChat/browser/contrib/inlineCSChatDynamicVariables';
import { InlineChatController } from 'vs/workbench/contrib/inlineCSChat/browser/inlineCSChatController';
import { InlineChatWidget } from 'vs/workbench/contrib/inlineCSChat/browser/inlineCSChatWidget';
import { SymbolsQuickAccessProvider } from 'vs/workbench/contrib/search/browser/symbolsQuickAccess';
import { getOutOfWorkspaceEditorResources } from 'vs/workbench/contrib/search/common/search';
import { LifecyclePhase } from 'vs/workbench/services/lifecycle/common/lifecycle';
import { QueryBuilder } from 'vs/workbench/services/search/common/queryBuilder';
import { ISearchComplete, ISearchService } from 'vs/workbench/services/search/common/search';

class BuiltinDynamicCompletions extends Disposable {
	private static readonly VariableNameDef = new RegExp(`${chatFileVariableLeader}\\w*`, 'g'); // MUST be using `g`-flag

	private readonly fileQueryBuilder = this.instantiationService.createInstance(QueryBuilder);

	constructor(
		@ISearchService private readonly searchService: ISearchService,
		@IWorkspaceContextService private readonly contextService: IWorkspaceContextService,
		@ILanguageFeaturesService private readonly languageFeaturesService: ILanguageFeaturesService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@ICodeEditorService private readonly codeEditorService: ICodeEditorService,
		@ILabelService private readonly labelService: ILabelService,
	) {
		super();

		this._register(this.languageFeaturesService.completionProvider.register({ scheme: InlineChatWidget.INPUT_SCHEME, hasAccessToAllModels: true }, {
			_debugDisplayName: 'inlineChatDynamicCompletions',
			triggerCharacters: [chatFileVariableLeader],
			provideCompletionItems: async (model: ITextModel, position: Position, _context: CompletionContext, _token: CancellationToken) => {
				const codeEditor = this.codeEditorService.getActiveCodeEditor();
				const codeEditorModel = codeEditor && codeEditor.getModel();
				if (!codeEditorModel) {
					return null;
				}

				const widget = InlineChatController.get(codeEditor)?.getWidget();
				if (!widget) {
					return null;
				}

				const varWord = getWordAtText(position.column, BuiltinDynamicCompletions.VariableNameDef, model.getLineContent(position.lineNumber), 0);
				if (!varWord && model.getWordUntilPosition(position).word) {
					// inside a "normal" word
					return null;
				}

				const files = await this.doGetFileSearchResults(_token);
				const insertAndReplaceRange = new Range(position.lineNumber, position.column, position.lineNumber, position.column);
				const range = new Range(position.lineNumber, position.column - (varWord ? varWord.word.length : 0), position.lineNumber, position.column);

				// Map the file list to completion items
				const completionURIs = files.results.map(result => result.resource);
				const completionItems = completionURIs.map(uri => {
					const detail = this.labelService.getUriLabel(dirname(uri), { relative: true });
					return <CompletionItem>{
						label: basenameOrAuthority(uri),
						insertText: '',
						detail,
						range: { insert: insertAndReplaceRange, replace: insertAndReplaceRange },
						kind: CompletionItemKind.File,
						command: { id: SelectAndInsertFileAction.ID, title: SelectAndInsertFileAction.ID, arguments: [{ range, uri, widget }] },
					};
				});


				return <CompletionList>{
					suggestions: completionItems
				};
			},

			onFocusCompletionItem: async (item) => {
				const command = item.command;
				if (!command) {
					return;
				}

				const args = command.arguments;
				const context = args?.[0];
				if (!isInsertFileVariableContext(context)) {
					return;
				}

				const resource = context.uri;
				if (!resource) {
					return;
				}

				const activeEditor = this.codeEditorService.getActiveCodeEditor();
				if (!activeEditor) {
					return;
				}

				const widgetController = InlineChatController.get(activeEditor);
				if (!widgetController) {
					return;
				}

				const widgetPosition = widgetController.getWidgetPosition();
				if (!widgetPosition) {
					return;
				}

				const controller = CompletionPreviewController.get(activeEditor);
				if (!controller) {
					return;
				}

				controller.show(widgetPosition);
				controller.revealPreview(<Location>{
					range: new Range(1, 1, 1, 1),
					uri: resource,
				});
			},

			onDidBlur: async () => {
				const activeEditor = this.codeEditorService.getActiveCodeEditor();
				if (!activeEditor) {
					return;
				}

				const controller = CompletionPreviewController.get(activeEditor);
				if (!controller) {
					return;
				}

				controller.dispose();
			}
		}));
	}

	private doGetFileSearchResults(token: CancellationToken): Promise<ISearchComplete> {
		return this.searchService.fileSearch(
			this.fileQueryBuilder.file(
				this.contextService.getWorkspace().folders,
				{
					extraFileResources: this.instantiationService.invokeFunction(getOutOfWorkspaceEditorResources),
					sortByScore: true,
				}
			), token);
	}
}

Registry.as<IWorkbenchContributionsRegistry>(WorkbenchExtensions.Workbench).registerWorkbenchContribution(BuiltinDynamicCompletions, LifecyclePhase.Eventually);

class BuiltinSymbolCompletions extends Disposable {
	private static readonly VariableNameDef = new RegExp(`${chatSymbolVariableLeader}\\w*`, 'g'); // MUST be using `g`-flag

	private readonly workspaceSymbolsQuickAccess = this.instantiationService.createInstance(SymbolsQuickAccessProvider);

	constructor(
		@ILanguageFeaturesService private readonly languageFeaturesService: ILanguageFeaturesService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@ICodeEditorService private readonly codeEditorService: ICodeEditorService,
	) {
		super();

		this._register(this.languageFeaturesService.completionProvider.register({ scheme: InlineChatWidget.INPUT_SCHEME, hasAccessToAllModels: true }, {
			_debugDisplayName: 'chatSymbolCompletions',
			triggerCharacters: [chatSymbolVariableLeader],
			provideCompletionItems: async (model: ITextModel, position: Position, _context: CompletionContext, _token: CancellationToken) => {
				const codeEditor = this.codeEditorService.getActiveCodeEditor();
				const codeEditorModel = codeEditor && codeEditor.getModel();
				if (!codeEditorModel) {
					return null;
				}

				const widget = InlineChatController.get(codeEditor)?.getWidget();
				if (!widget) {
					return null;
				}

				const varWord = getWordAtText(position.column, BuiltinSymbolCompletions.VariableNameDef, model.getLineContent(position.lineNumber), 0);
				if (!varWord && model.getWordUntilPosition(position).word) {
					// inside a "normal" word
					return null;
				}

				const query = varWord ? varWord.word.substring(1) : '';
				const editorSymbolPicks = await this.workspaceSymbolsQuickAccess.getSymbolPicks(query, undefined, _token);

				const insertAndReplaceRange = new Range(position.lineNumber, position.column, position.lineNumber, position.column);
				const range = new Range(position.lineNumber, position.column - (varWord ? varWord.word.length : 0), position.lineNumber, position.column);

				// Map the symbol list to completion items
				const completionItems = editorSymbolPicks.map(pick => {
					return <CompletionItem>{
						label: pick.label,
						insertText: '',
						detail: pick.resource ? basenameOrAuthority(pick.resource) : '',
						range: { insert: insertAndReplaceRange, replace: insertAndReplaceRange },
						kind: CompletionItemKind.Text,
						command: { id: SelectAndInsertCodeSymbolAction.ID, title: SelectAndInsertCodeSymbolAction.ID, arguments: [{ widget, range, pick }] },
					};
				});

				return <CompletionList>{
					incomplete: true,
					suggestions: completionItems
				};
			},

			onFocusCompletionItem: async (item) => {
				const command = item.command;
				if (!command) {
					return;
				}

				const args = command.arguments;
				const context = args?.[0];
				if (!isInsertSymbolVariableContext(context)) {
					return;
				}

				const previewLocation = context.pick.symbol?.location;
				if (!previewLocation) {
					return;
				}

				const activeEditor = this.codeEditorService.getActiveCodeEditor();
				if (!activeEditor) {
					return;
				}

				const widgetController = InlineChatController.get(activeEditor);
				if (!widgetController) {
					return;
				}

				const widgetPosition = widgetController.getWidgetPosition();
				if (!widgetPosition) {
					return;
				}

				const controller = CompletionPreviewController.get(activeEditor);
				if (!controller) {
					return;
				}

				controller.show(widgetPosition);
				controller.revealPreview(previewLocation);
			},

			onDidBlur: async () => {
				const activeEditor = this.codeEditorService.getActiveCodeEditor();
				if (!activeEditor) {
					return;
				}

				const controller = CompletionPreviewController.get(activeEditor);
				if (!controller) {
					return;
				}

				controller.dispose();
			}
		}));
	}
}

Registry.as<IWorkbenchContributionsRegistry>(WorkbenchExtensions.Workbench).registerWorkbenchContribution(BuiltinSymbolCompletions, LifecyclePhase.Eventually);
