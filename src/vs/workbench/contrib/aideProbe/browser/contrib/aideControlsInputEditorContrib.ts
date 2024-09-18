/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { Disposable } from '../../../../../base/common/lifecycle.js';
import { basenameOrAuthority, dirname } from '../../../../../base/common/resources.js';
import { URI } from '../../../../../base/common/uri.js';
import { Position } from '../../../../../editor/common/core/position.js';
import { IRange } from '../../../../../editor/common/core/range.js';
import { getWordAtText } from '../../../../../editor/common/core/wordHelper.js';
import { CompletionContext, CompletionItem, CompletionItemKind } from '../../../../../editor/common/languages.js';
import { ITextModel } from '../../../../../editor/common/model.js';
import { ILanguageFeaturesService } from '../../../../../editor/common/services/languageFeatures.js';
import { IInstantiationService } from '../../../../../platform/instantiation/common/instantiation.js';
import { ILabelService } from '../../../../../platform/label/common/label.js';
import { Registry } from '../../../../../platform/registry/common/platform.js';
import { IWorkspaceContextService } from '../../../../../platform/workspace/common/workspace.js';
import { IWorkbenchContributionsRegistry, Extensions as WorkbenchExtensions } from '../../../../../workbench/common/contributions.js';
import { CodeSymbolCompletionProviderName, FileReferenceCompletionProviderName, FolderReferenceCompletionProviderName, IWidgetWithInputEditor, SelectAndInsertCodeAction, SelectAndInsertFileAction, SelectAndInsertFolderAction } from '../../../../../workbench/contrib/aideProbe/browser/contrib/aideControlsDynamicVariables.js';
import { chatVariableLeader } from '../../../../../workbench/contrib/aideProbe/common/aideProbeParserTypes.js';
import { SymbolsQuickAccessProvider } from '../../../../../workbench/contrib/search/browser/symbolsQuickAccess.js';
import { getOutOfWorkspaceEditorResources } from '../../../../../workbench/contrib/search/common/search.js';
import { LifecyclePhase } from '../../../../../workbench/services/lifecycle/common/lifecycle.js';
import { QueryBuilder } from '../../../../../workbench/services/search/common/queryBuilder.js';
import { ISearchComplete, ISearchService } from '../../../../../workbench/services/search/common/search.js';
import { AideControls, IAideControlsService } from '../../../../../workbench/contrib/aideProbe/browser/aideControls.js';


// class ChatTokenDeleter extends Disposable {
//
// 	public readonly id = 'chatTokenDeleter';
//
// 	constructor(
// 		private readonly widget: AideControls,
// 		@IInstantiationService private readonly instantiationService: IInstantiationService,
// 	) {
// 		super();
// 		const parser = this.instantiationService.createInstance(ChatRequestParser);
// 		const inputValue = this.widget.inputEditor.getValue();
// 		let previousInputValue: string | undefined;
//
// 		// A simple heuristic to delete the previous token when the user presses backspace.
// 		// The sophisticated way to do this would be to have a parse tree that can be updated incrementally.
// 		this._register(this.widget.inputEditor.onDidChangeModelContent(e => {
// 			if (!previousInputValue) {
// 				previousInputValue = inputValue;
//
// 			}
//
// 			// Don't try to handle multicursor edits right now
// 			const change = e.changes[0];
//
// 			// If this was a simple delete, try to find out whether it was inside a token
// 			if (!change.text && this.widget.viewModel) {
// 				const previousParsedValue = parser.parseChatRequest(previousInputValue);
//
// 				// For dynamic variables, this has to happen in ChatDynamicVariableModel with the other bookkeeping
// 				const deletableTokens = previousParsedValue.parts.filter(p => p instanceof ChatRequestVariablePart);
// 				deletableTokens.forEach(token => {
// 					const deletedRangeOfToken = Range.intersectRanges(token.editorRange, change.range);
// 					// Part of this token was deleted, or the space after it was deleted, and the deletion range doesn't go off the front of the token, for simpler math
// 					if (deletedRangeOfToken && Range.compareRangesUsingStarts(token.editorRange, change.range) < 0) {
// 						// Assume single line tokens
// 						const length = deletedRangeOfToken.endColumn - deletedRangeOfToken.startColumn;
// 						const rangeToDelete = new Range(token.editorRange.startLineNumber, token.editorRange.startColumn, token.editorRange.endLineNumber, token.editorRange.endColumn - length);
// 						this.widget.inputEditor.executeEdits(this.id, [{
// 							range: rangeToDelete,
// 							text: '',
// 						}]);
// 					}
// 				});
// 			}
//
// 			previousInputValue = this.widget.inputEditor.getValue();
// 		}));
// 	}
// }
// AideControls.INPUT_CONTRIBS.push(ChatTokenDeleter);

async function getWidget(
	model: ITextModel,
	aideControlsService: IAideControlsService,
): Promise<IWidgetWithInputEditor | undefined | null> {
	let widget: IWidgetWithInputEditor | undefined | null;
	const scheme = model.uri.scheme;
	if (scheme === AideControls.INPUT_SCHEME) {
		widget = aideControlsService.controls;
	}

	return widget;
}

export class FileReferenceCompletionsProvider extends Disposable {
	private readonly fileQueryBuilder = this.instantiationService.createInstance(QueryBuilder);

	constructor(
		@IWorkspaceContextService private readonly contextService: IWorkspaceContextService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IAideControlsService private readonly aideControlsService: IAideControlsService,
		@ISearchService private readonly searchService: ISearchService,
		@ILabelService private readonly labelService: ILabelService,
	) {
		super();
	}

	async provideCompletionItems(model: ITextModel, position: Position, _context: CompletionContext, _token: CancellationToken) {
		const widget = await getWidget(model, this.aideControlsService);
		if (!widget) {
			return null;
		}

		const varWord = getWordAtText(position.column, FileReferenceCompletions.VariableNameDef, model.getLineContent(position.lineNumber), 0);
		if (!varWord && model.getWordUntilPosition(position).word) {
			return null;
		}

		const range: IRange = {
			startLineNumber: position.lineNumber,
			startColumn: varWord ? varWord.endColumn : position.column,
			endLineNumber: position.lineNumber,
			endColumn: varWord ? varWord.endColumn : position.column
		};

		const files = await this.doGetFileSearchResults(_token);
		const completionURIs = files.results.map(result => result.resource);

		const editRange: IRange = {
			startLineNumber: position.lineNumber,
			startColumn: varWord ? varWord.startColumn : position.column,
			endLineNumber: position.lineNumber,
			endColumn: varWord ? varWord.endColumn : position.column
		};

		const completionItems = completionURIs.map(uri => {
			const detail = this.labelService.getUriLabel(dirname(uri), { relative: true });
			return <CompletionItem>{
				label: basenameOrAuthority(uri),
				insertText: '',
				detail,
				kind: CompletionItemKind.File,
				range,
				command: { id: SelectAndInsertFileAction.ID, title: SelectAndInsertFileAction.ID, arguments: [{ widget, range: editRange, uri }] },
				sortText: 'z'
			};
		});

		return {
			suggestions: completionItems
		};
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

class FileReferenceCompletions extends Disposable {
	static readonly VariableNameDef = new RegExp(`${chatVariableLeader}file:\\w*`, 'g'); // MUST be using `g`-flag

	constructor(
		@ILanguageFeaturesService private readonly languageFeaturesService: ILanguageFeaturesService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
	) {
		super();

		this._register(this.languageFeaturesService.completionProvider.register({ scheme: AideControls.INPUT_SCHEME, hasAccessToAllModels: true }, {
			_debugDisplayName: FileReferenceCompletionProviderName,
			provideCompletionItems: async (model: ITextModel, position: Position, _context: CompletionContext, _token: CancellationToken) => {
				const fileReferenceCompletionsProvider = this._register(this.instantiationService.createInstance(FileReferenceCompletionsProvider));
				return fileReferenceCompletionsProvider.provideCompletionItems(model, position, _context, _token);
			}
		}));
	}
}
Registry.as<IWorkbenchContributionsRegistry>(WorkbenchExtensions.Workbench).registerWorkbenchContribution(FileReferenceCompletions, LifecyclePhase.Eventually);

export class CodeSymbolCompletionProvider extends Disposable {
	private readonly workspaceSymbolsQuickAccess = this.instantiationService.createInstance(SymbolsQuickAccessProvider);

	constructor(
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IAideControlsService private readonly aideControlsService: IAideControlsService,
	) {
		super();
	}

	async provideCompletionItems(model: ITextModel, position: Position, _context: CompletionContext, _token: CancellationToken) {
		const widget = await getWidget(model, this.aideControlsService);
		if (!widget) {
			return null;
		}

		const varWord = getWordAtText(position.column, CodeSymbolCompletions.VariableNameDef, model.getLineContent(position.lineNumber), 0);
		if (!varWord && model.getWordUntilPosition(position).word) {
			return null;
		}

		const range: IRange = {
			startLineNumber: position.lineNumber,
			startColumn: varWord ? varWord.endColumn : position.column,
			endLineNumber: position.lineNumber,
			endColumn: varWord ? varWord.endColumn : position.column
		};

		const prefixWord = `${chatVariableLeader}code:`;
		const query = varWord ? varWord.word.substring(prefixWord.length) : '';
		const editorSymbolPicks = await this.workspaceSymbolsQuickAccess.getSymbolPicks(query, undefined, CancellationToken.None);
		if (!editorSymbolPicks.length) {
			return null;
		}

		const editRange: IRange = {
			startLineNumber: position.lineNumber,
			startColumn: varWord ? varWord.startColumn : position.column,
			endLineNumber: position.lineNumber,
			endColumn: varWord ? varWord.endColumn : position.column
		};
		return {
			incomplete: true,
			suggestions: editorSymbolPicks.map(pick => ({
				label: pick.label,
				insertText: '',
				detail: pick.resource ? basenameOrAuthority(pick.resource) : '',
				kind: CompletionItemKind.Text,
				range,
				command: { id: SelectAndInsertCodeAction.ID, title: SelectAndInsertCodeAction.ID, arguments: [{ widget, range: editRange, pick }] },
				sortText: 'z'
			} satisfies CompletionItem)),
		};
	}
}

class CodeSymbolCompletions extends Disposable {
	static readonly VariableNameDef = new RegExp(`${chatVariableLeader}code:\\w*`, 'g'); // MUST be using `g`-flag

	constructor(
		@ILanguageFeaturesService private readonly languageFeaturesService: ILanguageFeaturesService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
	) {
		super();

		this._register(this.languageFeaturesService.completionProvider.register({ scheme: AideControls.INPUT_SCHEME, hasAccessToAllModels: true }, {
			_debugDisplayName: CodeSymbolCompletionProviderName,
			provideCompletionItems: async (model: ITextModel, position: Position, _context: CompletionContext, _token: CancellationToken) => {
				const codeSymbolCompletionsProvider = this._register(this.instantiationService.createInstance(CodeSymbolCompletionProvider));
				return codeSymbolCompletionsProvider.provideCompletionItems(model, position, _context, _token);
			}
		}));
	}
}
Registry.as<IWorkbenchContributionsRegistry>(WorkbenchExtensions.Workbench).registerWorkbenchContribution(CodeSymbolCompletions, LifecyclePhase.Eventually);


class FolderReferenceCompletions extends Disposable {
	private static readonly VariableNameDef = new RegExp(`${chatVariableLeader}folder:\\w*`, 'g'); // MUST be using `g`-flag
	private readonly fileQueryBuilder = this.instantiationService.createInstance(QueryBuilder);

	constructor(
		@IWorkspaceContextService private readonly contextService: IWorkspaceContextService,
		@ILanguageFeaturesService private readonly languageFeaturesService: ILanguageFeaturesService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IAideControlsService private readonly aideControlsService: IAideControlsService,
		@ISearchService private readonly searchService: ISearchService,
		@ILabelService private readonly labelService: ILabelService,
	) {
		super();

		this._register(this.languageFeaturesService.completionProvider.register({ scheme: AideControls.INPUT_SCHEME, hasAccessToAllModels: true }, {
			_debugDisplayName: FolderReferenceCompletionProviderName,
			provideCompletionItems: async (model: ITextModel, position: Position, _context: CompletionContext, _token: CancellationToken) => {
				const widget = this.aideControlsService.controls;
				if (!widget) {
					return null;
				}

				const varWord = getWordAtText(position.column, FolderReferenceCompletions.VariableNameDef, model.getLineContent(position.lineNumber), 0);
				if (!varWord && model.getWordUntilPosition(position).word) {
					return null;
				}

				const range: IRange = {
					startLineNumber: position.lineNumber,
					startColumn: varWord ? varWord.endColumn : position.column,
					endLineNumber: position.lineNumber,
					endColumn: varWord ? varWord.endColumn : position.column
				};

				const completionURIs = await this.doGetFolderSearchResults(_token);

				const editRange: IRange = {
					startLineNumber: position.lineNumber,
					startColumn: varWord ? varWord.startColumn : position.column,
					endLineNumber: position.lineNumber,
					endColumn: varWord ? varWord.endColumn : position.column
				};

				const completionItems = completionURIs.map(uri => {
					return <CompletionItem>{
						label: this.labelService.getUriLabel(uri, { relative: true }),
						insertText: '',
						kind: CompletionItemKind.Folder,
						range,
						command: { id: SelectAndInsertFolderAction.ID, title: SelectAndInsertFolderAction.ID, arguments: [{ widget, range: editRange, uri }] },
						sortText: 'z'
					};
				});

				return {
					suggestions: completionItems
				};
			}
		}));
	}

	private async doGetFolderSearchResults(token: CancellationToken): Promise<URI[]> {
		const response = await this.searchService.fileSearch(
			this.fileQueryBuilder.file(
				this.contextService.getWorkspace().folders,
				{
					extraFileResources: this.instantiationService.invokeFunction(getOutOfWorkspaceEditorResources),
					sortByScore: true,
				}
			), token);

		const dirUris = new Map<string, URI>();
		response.results.forEach(result => {
			const dirUri = dirname(result.resource);
			dirUris.set(dirUri.toString(), dirUri);
		});
		return Array.from(dirUris.values());
	}
}
Registry.as<IWorkbenchContributionsRegistry>(WorkbenchExtensions.Workbench).registerWorkbenchContribution(FolderReferenceCompletions, LifecyclePhase.Eventually);
