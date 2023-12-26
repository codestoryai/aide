/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { raceCancellation } from 'vs/base/common/async';
import { CancellationToken } from 'vs/base/common/cancellation';
import { Disposable, MutableDisposable } from 'vs/base/common/lifecycle';
import { basenameOrAuthority, dirname } from 'vs/base/common/resources';
import { ICodeEditorService } from 'vs/editor/browser/services/codeEditorService';
import { Position } from 'vs/editor/common/core/position';
import { Range } from 'vs/editor/common/core/range';
import { IWordAtPosition, getWordAtText } from 'vs/editor/common/core/wordHelper';
import { IDecorationOptions } from 'vs/editor/common/editorCommon';
import { CompletionContext, CompletionItem, CompletionItemKind, CompletionList } from 'vs/editor/common/languages';
import { ITextModel } from 'vs/editor/common/model';
import { ILanguageFeaturesService } from 'vs/editor/common/services/languageFeatures';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { ILabelService } from 'vs/platform/label/common/label';
import { Registry } from 'vs/platform/registry/common/platform';
import { inputPlaceholderForeground } from 'vs/platform/theme/common/colorRegistry';
import { IThemeService } from 'vs/platform/theme/common/themeService';
import { IWorkspaceContextService } from 'vs/platform/workspace/common/workspace';
import { IWorkbenchContributionsRegistry, Extensions as WorkbenchExtensions } from 'vs/workbench/common/contributions';
import { ICSChatSlashCommandService } from 'vs/workbench/contrib/csChat/common/csChatSlashCommands';
import { SubmitAction } from 'vs/workbench/contrib/csChat/browser/actions/csChatExecuteActions';
import { SelectAndInsertCodeSymbolAction, SelectAndInsertFileAction, dynamicVariableDecorationType } from 'vs/workbench/contrib/csChat/browser/contrib/csChatDynamicVariables';
import { ICSChatWidgetService, IChatWidget } from 'vs/workbench/contrib/csChat/browser/csChat';
import { ChatInputPart } from 'vs/workbench/contrib/csChat/browser/csChatInputPart';
import { ChatWidget } from 'vs/workbench/contrib/csChat/browser/csChatWidget';
import { ICSChatAgentService, ICSChatAgentCommand, IChatAgentData } from 'vs/workbench/contrib/csChat/common/csChatAgents';
import { chatSlashCommandBackground, chatSlashCommandForeground } from 'vs/workbench/contrib/csChat/common/csChatColors';
import { ChatRequestAgentPart, ChatRequestAgentSubcommandPart, ChatRequestSlashCommandPart, ChatRequestTextPart, ChatRequestVariablePart, IParsedChatRequestPart, chatAgentLeader, chatFileVariableLeader, chatSubcommandLeader, chatSymbolVariableLeader, chatVariableLeader } from 'vs/workbench/contrib/csChat/common/csChatParserTypes';
import { ChatRequestParser } from 'vs/workbench/contrib/csChat/common/csChatRequestParser';
import { ICSChatService } from 'vs/workbench/contrib/csChat/common/csChatService';
import { ICSChatVariablesService } from 'vs/workbench/contrib/csChat/common/csChatVariables';
import { isResponseVM } from 'vs/workbench/contrib/csChat/common/csChatViewModel';
import { SymbolsQuickAccessProvider } from 'vs/workbench/contrib/search/browser/symbolsQuickAccess';
import { getOutOfWorkspaceEditorResources } from 'vs/workbench/contrib/search/common/search';
import { LifecyclePhase } from 'vs/workbench/services/lifecycle/common/lifecycle';
import { QueryBuilder } from 'vs/workbench/services/search/common/queryBuilder';
import { ISearchComplete, ISearchService } from 'vs/workbench/services/search/common/search';

const decorationDescription = 'chat';
const placeholderDecorationType = 'chat-session-detail';
const agentTextDecorationType = 'chat-agent-text';
const slashCommandTextDecorationType = 'chat-session-text';
const variableTextDecorationType = 'chat-variable-text';

function agentAndCommandToKey(agent: string, subcommand: string): string {
	return `${agent}__${subcommand}`;
}

class InputEditorDecorations extends Disposable {

	public readonly id = 'inputEditorDecorations';

	private readonly previouslyUsedAgents = new Set<string>();

	private readonly viewModelDisposables = this._register(new MutableDisposable());

	constructor(
		private readonly widget: IChatWidget,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@ICodeEditorService private readonly codeEditorService: ICodeEditorService,
		@IThemeService private readonly themeService: IThemeService,
		@ICSChatService private readonly chatService: ICSChatService,
	) {
		super();

		this.codeEditorService.registerDecorationType(decorationDescription, placeholderDecorationType, {});

		this._register(this.themeService.onDidColorThemeChange(() => this.updateRegisteredDecorationTypes()));
		this.updateRegisteredDecorationTypes();

		this.updateInputEditorDecorations();
		this._register(this.widget.inputEditor.onDidChangeModelContent(() => this.updateInputEditorDecorations()));
		this._register(this.widget.onDidChangeViewModel(() => {
			this.registerViewModelListeners();
			this.previouslyUsedAgents.clear();
			this.updateInputEditorDecorations();
		}));
		this._register(this.chatService.onDidSubmitAgent((e) => {
			if (e.sessionId === this.widget.viewModel?.sessionId) {
				this.previouslyUsedAgents.add(agentAndCommandToKey(e.agent.id, e.slashCommand.name));
			}
		}));

		this.registerViewModelListeners();
	}

	private registerViewModelListeners(): void {
		this.viewModelDisposables.value = this.widget.viewModel?.onDidChange(e => {
			if (e?.kind === 'changePlaceholder' || e?.kind === 'initialize') {
				this.updateInputEditorDecorations();
			}
		});
	}

	private updateRegisteredDecorationTypes() {
		this.codeEditorService.removeDecorationType(variableTextDecorationType);
		this.codeEditorService.removeDecorationType(dynamicVariableDecorationType);
		this.codeEditorService.removeDecorationType(slashCommandTextDecorationType);
		this.codeEditorService.removeDecorationType(agentTextDecorationType);

		const theme = this.themeService.getColorTheme();
		this.codeEditorService.registerDecorationType(decorationDescription, agentTextDecorationType, {
			opacity: '0',
		});
		this.codeEditorService.registerDecorationType(decorationDescription, slashCommandTextDecorationType, {
			color: theme.getColor(chatSlashCommandForeground)?.toString(),
			backgroundColor: theme.getColor(chatSlashCommandBackground)?.toString(),
			borderRadius: '3px'
		});
		this.codeEditorService.registerDecorationType(decorationDescription, variableTextDecorationType, {
			color: theme.getColor(chatSlashCommandForeground)?.toString(),
			backgroundColor: theme.getColor(chatSlashCommandBackground)?.toString(),
			borderRadius: '3px'
		});
		this.codeEditorService.registerDecorationType(decorationDescription, dynamicVariableDecorationType, {
			color: theme.getColor(chatSlashCommandForeground)?.toString(),
			backgroundColor: theme.getColor(chatSlashCommandBackground)?.toString(),
			borderRadius: '3px'
		});
		this.updateInputEditorDecorations();
	}

	private getPlaceholderColor(): string | undefined {
		const theme = this.themeService.getColorTheme();
		const transparentForeground = theme.getColor(inputPlaceholderForeground);
		return transparentForeground?.toString();
	}

	private async updateInputEditorDecorations() {
		const inputValue = this.widget.inputEditor.getValue();

		const viewModel = this.widget.viewModel;
		if (!viewModel) {
			return;
		}

		if (!inputValue) {
			const viewModelPlaceholder = this.widget.viewModel?.inputPlaceholder;
			const placeholder = viewModelPlaceholder ?? '';
			const decoration: IDecorationOptions[] = [
				{
					range: {
						startLineNumber: 1,
						endLineNumber: 1,
						startColumn: 1,
						endColumn: 1000
					},
					renderOptions: {
						after: {
							contentText: placeholder,
							color: this.getPlaceholderColor()
						}
					}
				}
			];
			this.widget.inputEditor.setDecorationsByType(decorationDescription, placeholderDecorationType, decoration);
			return;
		}

		const parsedRequest = (await this.instantiationService.createInstance(ChatRequestParser).parseChatRequest(viewModel.sessionId, inputValue)).parts;

		let placeholderDecoration: IDecorationOptions[] | undefined;
		const agentPart = parsedRequest.find((p): p is ChatRequestAgentPart => p instanceof ChatRequestAgentPart);
		const agentSubcommandPart = parsedRequest.find((p): p is ChatRequestAgentSubcommandPart => p instanceof ChatRequestAgentSubcommandPart);
		const slashCommandPart = parsedRequest.find((p): p is ChatRequestSlashCommandPart => p instanceof ChatRequestSlashCommandPart);

		const exactlyOneSpaceAfterPart = (part: IParsedChatRequestPart): boolean => {
			const partIdx = parsedRequest.indexOf(part);
			if (parsedRequest.length > partIdx + 2) {
				return false;
			}

			const nextPart = parsedRequest[partIdx + 1];
			return nextPart && nextPart instanceof ChatRequestTextPart && nextPart.text === ' ';
		};

		const onlyAgentAndWhitespace = agentPart && parsedRequest.every(p => p instanceof ChatRequestTextPart && !p.text.trim().length || p instanceof ChatRequestAgentPart);
		if (onlyAgentAndWhitespace) {
			// Agent reference with no other text - show the placeholder
			if (agentPart.agent.metadata.description && exactlyOneSpaceAfterPart(agentPart)) {
				placeholderDecoration = [{
					range: {
						startLineNumber: agentPart.editorRange.startLineNumber,
						endLineNumber: agentPart.editorRange.endLineNumber,
						startColumn: agentPart.editorRange.endColumn + 1,
						endColumn: 1000
					},
					renderOptions: {
						after: {
							contentText: agentPart.agent.metadata.description,
							color: this.getPlaceholderColor(),
						}
					}
				}];
			}
		}

		const onlyAgentCommandAndWhitespace = agentPart && agentSubcommandPart && parsedRequest.every(p => p instanceof ChatRequestTextPart && !p.text.trim().length || p instanceof ChatRequestAgentPart || p instanceof ChatRequestAgentSubcommandPart);
		if (onlyAgentCommandAndWhitespace) {
			// Agent reference and subcommand with no other text - show the placeholder
			const isFollowupSlashCommand = this.previouslyUsedAgents.has(agentAndCommandToKey(agentPart.agent.id, agentSubcommandPart.command.name));
			const shouldRenderFollowupPlaceholder = isFollowupSlashCommand && agentSubcommandPart.command.followupPlaceholder;
			if (agentSubcommandPart?.command.description && exactlyOneSpaceAfterPart(agentSubcommandPart)) {
				placeholderDecoration = [{
					range: {
						startLineNumber: agentSubcommandPart.editorRange.startLineNumber,
						endLineNumber: agentSubcommandPart.editorRange.endLineNumber,
						startColumn: agentSubcommandPart.editorRange.endColumn + 1,
						endColumn: 1000
					},
					renderOptions: {
						after: {
							contentText: shouldRenderFollowupPlaceholder ? agentSubcommandPart.command.followupPlaceholder : agentSubcommandPart.command.description,
							color: this.getPlaceholderColor(),
						}
					}
				}];
			}
		}

		const onlySlashCommandAndWhitespace = slashCommandPart && parsedRequest.every(p => p instanceof ChatRequestTextPart && !p.text.trim().length || p instanceof ChatRequestSlashCommandPart);
		if (onlySlashCommandAndWhitespace) {
			// Command reference with no other text - show the placeholder
			if (slashCommandPart.slashCommand.detail && exactlyOneSpaceAfterPart(slashCommandPart)) {
				placeholderDecoration = [{
					range: {
						startLineNumber: slashCommandPart.editorRange.startLineNumber,
						endLineNumber: slashCommandPart.editorRange.endLineNumber,
						startColumn: slashCommandPart.editorRange.endColumn + 1,
						endColumn: 1000
					},
					renderOptions: {
						after: {
							contentText: slashCommandPart.slashCommand.detail,
							color: this.getPlaceholderColor(),
						}
					}
				}];
			}
		}

		this.widget.inputEditor.setDecorationsByType(decorationDescription, placeholderDecorationType, placeholderDecoration ?? []);

		const agentDecorations: IDecorationOptions[] = [];
		const slashDecorations: IDecorationOptions[] | undefined = [];
		if (agentPart) {
			agentDecorations.push({ range: agentPart.editorRange });
			if (agentSubcommandPart) {
				slashDecorations.push({ range: agentSubcommandPart.editorRange });
			}
		}

		if (slashCommandPart) {
			slashDecorations.push({ range: slashCommandPart.editorRange });
		}

		this.widget.inputEditor.setDecorationsByType(decorationDescription, agentTextDecorationType, agentDecorations);
		this.widget.inputEditor.setDecorationsByType(decorationDescription, slashCommandTextDecorationType, slashDecorations);

		const varDecorations: IDecorationOptions[] = [];
		const variableParts = parsedRequest.filter((p): p is ChatRequestVariablePart => p instanceof ChatRequestVariablePart);
		for (const variable of variableParts) {
			varDecorations.push({ range: variable.editorRange });
		}

		this.widget.inputEditor.setDecorationsByType(decorationDescription, variableTextDecorationType, varDecorations);
	}
}

class InputEditorSlashCommandMode extends Disposable {
	public readonly id = 'InputEditorSlashCommandMode';

	constructor(
		private readonly widget: IChatWidget,
		@ICSChatService private readonly chatService: ICSChatService
	) {
		super();
		this._register(this.chatService.onDidSubmitAgent(e => {
			if (this.widget.viewModel?.sessionId !== e.sessionId) {
				return;
			}

			this.repopulateAgentCommand(e.agent, e.slashCommand);
		}));
	}

	private async repopulateAgentCommand(agent: IChatAgentData, slashCommand: ICSChatAgentCommand) {
		if (slashCommand.shouldRepopulate) {
			const value = `${chatAgentLeader}${agent.id} ${chatSubcommandLeader}${slashCommand.name} `;
			this.widget.inputEditor.setValue(value);
			this.widget.inputEditor.setPosition({ lineNumber: 1, column: value.length + 1 });
		}
	}
}

ChatWidget.CONTRIBS.push(InputEditorDecorations, InputEditorSlashCommandMode);

class SlashCommandCompletions extends Disposable {
	constructor(
		@ILanguageFeaturesService private readonly languageFeaturesService: ILanguageFeaturesService,
		@ICSChatWidgetService private readonly chatWidgetService: ICSChatWidgetService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@ICSChatSlashCommandService private readonly chatSlashCommandService: ICSChatSlashCommandService
	) {
		super();

		this._register(this.languageFeaturesService.completionProvider.register({ scheme: ChatInputPart.INPUT_SCHEME, hasAccessToAllModels: true }, {
			_debugDisplayName: 'globalSlashCommands',
			triggerCharacters: ['/'],
			provideCompletionItems: async (model: ITextModel, position: Position, _context: CompletionContext, _token: CancellationToken) => {
				const widget = this.chatWidgetService.getWidgetByInputUri(model.uri);
				if (!widget || !widget.viewModel) {
					return null;
				}

				const range = computeCompletionRanges(model, position, /\/\w*/g);
				if (!range) {
					return null;
				}

				const parsedRequest = (await this.instantiationService.createInstance(ChatRequestParser).parseChatRequest(widget.viewModel.sessionId, model.getValue())).parts;
				const usedAgent = parsedRequest.find(p => p instanceof ChatRequestAgentPart);
				if (usedAgent) {
					// No (classic) global slash commands when an agent is used
					return;
				}

				const slashCommands = this.chatSlashCommandService.getCommands();
				if (!slashCommands) {
					return null;
				}

				return <CompletionList>{
					suggestions: slashCommands.map((c, i) => {
						const withSlash = `/${c.command}`;
						return <CompletionItem>{
							label: withSlash,
							insertText: c.executeImmediately ? '' : `${withSlash} `,
							detail: c.detail,
							range: new Range(1, 1, 1, 1),
							sortText: c.sortText ?? 'a'.repeat(i + 1),
							kind: CompletionItemKind.Text, // The icons are disabled here anyway,
							command: c.executeImmediately ? { id: SubmitAction.ID, title: withSlash, arguments: [{ widget, inputValue: `${withSlash} ` }] } : undefined,
						};
					})
				};
			}
		}));
	}
}

Registry.as<IWorkbenchContributionsRegistry>(WorkbenchExtensions.Workbench).registerWorkbenchContribution(SlashCommandCompletions, LifecyclePhase.Eventually);

class AgentCompletions extends Disposable {
	constructor(
		@ILanguageFeaturesService private readonly languageFeaturesService: ILanguageFeaturesService,
		@ICSChatWidgetService private readonly chatWidgetService: ICSChatWidgetService,
		@ICSChatAgentService private readonly chatAgentService: ICSChatAgentService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
	) {
		super();

		this._register(this.languageFeaturesService.completionProvider.register({ scheme: ChatInputPart.INPUT_SCHEME, hasAccessToAllModels: true }, {
			_debugDisplayName: 'chatAgent',
			triggerCharacters: [chatAgentLeader],
			provideCompletionItems: async (model: ITextModel, position: Position, _context: CompletionContext, _token: CancellationToken) => {
				const widget = this.chatWidgetService.getWidgetByInputUri(model.uri);
				if (!widget || !widget.viewModel) {
					return null;
				}

				const parsedRequest = (await this.instantiationService.createInstance(ChatRequestParser).parseChatRequest(widget.viewModel.sessionId, model.getValue())).parts;
				const usedAgent = parsedRequest.find(p => p instanceof ChatRequestAgentPart);
				if (usedAgent && !Range.containsPosition(usedAgent.editorRange, position)) {
					// Only one agent allowed
					return;
				}

				const range = computeCompletionRanges(model, position, /@\w*/g);
				if (!range) {
					return null;
				}

				const agents = this.chatAgentService.getAgents()
					.filter(a => !a.metadata.isDefault);
				return <CompletionList>{
					suggestions: agents.map((c, i) => {
						const withAt = `${chatAgentLeader}${c.id}`;
						return <CompletionItem>{
							label: withAt,
							insertText: `${withAt} `,
							detail: c.metadata.description,
							range,
							kind: CompletionItemKind.Text, // The icons are disabled here anyway
						};
					})
				};
			}
		}));

		this._register(this.languageFeaturesService.completionProvider.register({ scheme: ChatInputPart.INPUT_SCHEME, hasAccessToAllModels: true }, {
			_debugDisplayName: 'chatAgentSubcommand',
			triggerCharacters: ['/'],
			provideCompletionItems: async (model: ITextModel, position: Position, _context: CompletionContext, token: CancellationToken) => {
				const widget = this.chatWidgetService.getWidgetByInputUri(model.uri);
				if (!widget || !widget.viewModel) {
					return;
				}

				const range = computeCompletionRanges(model, position, /\/\w*/g);
				if (!range) {
					return null;
				}

				const parsedRequest = (await this.instantiationService.createInstance(ChatRequestParser).parseChatRequest(widget.viewModel.sessionId, model.getValue())).parts;
				const usedAgentIdx = parsedRequest.findIndex((p): p is ChatRequestAgentPart => p instanceof ChatRequestAgentPart);
				if (usedAgentIdx < 0) {
					return;
				}

				const usedSubcommand = parsedRequest.find(p => p instanceof ChatRequestAgentSubcommandPart);
				if (usedSubcommand) {
					// Only one allowed
					return;
				}

				for (const partAfterAgent of parsedRequest.slice(usedAgentIdx + 1)) {
					// Could allow text after 'position'
					if (!(partAfterAgent instanceof ChatRequestTextPart) || !partAfterAgent.text.trim().match(/^(\/\w*)?$/)) {
						// No text allowed between agent and subcommand
						return;
					}
				}

				const usedAgent = parsedRequest[usedAgentIdx] as ChatRequestAgentPart;
				const commands = await usedAgent.agent.provideSlashCommands(token);

				return <CompletionList>{
					suggestions: commands.map((c, i) => {
						const withSlash = `/${c.name}`;
						return <CompletionItem>{
							label: withSlash,
							insertText: `${withSlash} `,
							detail: c.description,
							range,
							kind: CompletionItemKind.Text, // The icons are disabled here anyway
						};
					})
				};
			}
		}));

		// list subcommands when the query is empty, insert agent+subcommand
		this._register(this.languageFeaturesService.completionProvider.register({ scheme: ChatInputPart.INPUT_SCHEME, hasAccessToAllModels: true }, {
			_debugDisplayName: 'chatAgentAndSubcommand',
			triggerCharacters: ['/'],
			provideCompletionItems: async (model: ITextModel, position: Position, _context: CompletionContext, token: CancellationToken) => {
				const widget = this.chatWidgetService.getWidgetByInputUri(model.uri);
				if (!widget) {
					return;
				}

				const range = computeCompletionRanges(model, position, /\/\w*/g);
				if (!range) {
					return null;
				}

				const agents = this.chatAgentService.getAgents();
				const all = agents.map(agent => agent.provideSlashCommands(token));
				const commands = await raceCancellation(Promise.all(all), token);

				if (!commands) {
					return;
				}

				const justAgents: CompletionItem[] = agents
					.filter(a => !a.metadata.isDefault)
					.map(agent => {
						const agentLabel = `${chatAgentLeader}${agent.id}`;
						return {
							label: { label: agentLabel, description: agent.metadata.description },
							filterText: `${chatSubcommandLeader}${agent.id}`,
							insertText: `${agentLabel} `,
							range: new Range(1, 1, 1, 1),
							kind: CompletionItemKind.Text,
							sortText: `${chatSubcommandLeader}${agent.id}`,
						};
					});

				return {
					suggestions: justAgents.concat(
						agents.flatMap((agent, i) => commands[i].map((c, i) => {
							const agentLabel = `${chatAgentLeader}${agent.id}`;
							const withSlash = `${chatSubcommandLeader}${c.name}`;
							return {
								label: { label: withSlash, description: agentLabel },
								filterText: `${chatSubcommandLeader}${agent.id}${c.name}`,
								commitCharacters: [' '],
								insertText: `${agentLabel} ${withSlash} `,
								detail: `(${agentLabel}) ${c.description}`,
								range: new Range(1, 1, 1, 1),
								kind: CompletionItemKind.Text, // The icons are disabled here anyway
								sortText: `${chatSubcommandLeader}${agent.id}${c.name}`,
							} satisfies CompletionItem;
						})))
				};
			}
		}));
	}
}
Registry.as<IWorkbenchContributionsRegistry>(WorkbenchExtensions.Workbench).registerWorkbenchContribution(AgentCompletions, LifecyclePhase.Eventually);

class BuiltinDynamicCompletions extends Disposable {
	private static readonly VariableNameDef = new RegExp(`${chatFileVariableLeader}\\w*`, 'g'); // MUST be using `g`-flag

	private readonly fileQueryBuilder = this.instantiationService.createInstance(QueryBuilder);

	constructor(
		@IWorkspaceContextService private readonly contextService: IWorkspaceContextService,
		@ILanguageFeaturesService private readonly languageFeaturesService: ILanguageFeaturesService,
		@ICSChatWidgetService private readonly chatWidgetService: ICSChatWidgetService,
		@ISearchService private readonly searchService: ISearchService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@ILabelService private readonly labelService: ILabelService,
	) {
		super();

		this._register(this.languageFeaturesService.completionProvider.register({ scheme: ChatInputPart.INPUT_SCHEME, hasAccessToAllModels: true }, {
			_debugDisplayName: 'chatDynamicCompletions',
			triggerCharacters: [chatFileVariableLeader],
			provideCompletionItems: async (model: ITextModel, position: Position, _context: CompletionContext, _token: CancellationToken) => {
				const widget = this.chatWidgetService.getWidgetByInputUri(model.uri);
				if (!widget || !widget.supportsFileReferences) {
					return null;
				}

				const range = computeCompletionRanges(model, position, BuiltinDynamicCompletions.VariableNameDef);
				if (!range) {
					return null;
				}

				const files = await this.doGetFileSearchResults(_token);
				// const insertAndReplaceRange = new Range(position.lineNumber, position.column, position.lineNumber, position.column);
				const afterRange = new Range(position.lineNumber, range.replace.startColumn, position.lineNumber, range.replace.endColumn + 'file:'.length);

				// Map the file list to completion items
				const completionURIs = files.results.map(result => result.resource);
				const completionItems = completionURIs.map(uri => {
					const detail = this.labelService.getUriLabel(dirname(uri), { relative: true });
					return <CompletionItem>{
						label: basenameOrAuthority(uri),
						insertText: '',
						detail,
						range,
						kind: CompletionItemKind.File,
						command: { id: SelectAndInsertFileAction.ID, title: SelectAndInsertFileAction.ID, arguments: [{ widget, range: afterRange, uri }] },
						sortText: 'z'
					};
				});


				return <CompletionList>{
					suggestions: completionItems
				};
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
		@ICSChatWidgetService private readonly chatWidgetService: ICSChatWidgetService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
	) {
		super();

		this._register(this.languageFeaturesService.completionProvider.register({ scheme: ChatInputPart.INPUT_SCHEME, hasAccessToAllModels: true }, {
			_debugDisplayName: 'chatSymbolCompletions',
			triggerCharacters: [chatSymbolVariableLeader],
			provideCompletionItems: async (model: ITextModel, position: Position, _context: CompletionContext, _token: CancellationToken) => {
				const widget = this.chatWidgetService.getWidgetByInputUri(model.uri);
				if (!widget || !widget.supportsFileReferences) {
					return null;
				}

				const varWord = getWordAtText(position.column, BuiltinSymbolCompletions.VariableNameDef, model.getLineContent(position.lineNumber), 0);
				if (!varWord && model.getWordUntilPosition(position).word) {
					// inside a "normal" word
					return null;
				}

				const editorSymbolPicks = await this.workspaceSymbolsQuickAccess.getSymbolPicks('', undefined, _token);

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
					suggestions: completionItems
				};
			}
		}));
	}
}

Registry.as<IWorkbenchContributionsRegistry>(WorkbenchExtensions.Workbench).registerWorkbenchContribution(BuiltinSymbolCompletions, LifecyclePhase.Eventually);

function computeCompletionRanges(model: ITextModel, position: Position, reg: RegExp): { insert: Range; replace: Range; varWord: IWordAtPosition | null } | undefined {
	const varWord = getWordAtText(position.column, reg, model.getLineContent(position.lineNumber), 0);
	if (!varWord && model.getWordUntilPosition(position).word) {
		// inside a "normal" word
		return;
	}

	let insert: Range;
	let replace: Range;
	if (!varWord) {
		insert = replace = Range.fromPositions(position);
	} else {
		insert = new Range(position.lineNumber, varWord.startColumn, position.lineNumber, position.column);
		replace = new Range(position.lineNumber, varWord.startColumn, position.lineNumber, varWord.endColumn);
	}

	return { insert, replace, varWord };
}

class VariableCompletions extends Disposable {

	private static readonly VariableNameDef = new RegExp(`${chatFileVariableLeader}\\w*`, 'g'); // MUST be using `g`-flag

	constructor(
		@ILanguageFeaturesService private readonly languageFeaturesService: ILanguageFeaturesService,
		@ICSChatWidgetService private readonly chatWidgetService: ICSChatWidgetService,
		@ICSChatVariablesService private readonly chatVariablesService: ICSChatVariablesService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
	) {
		super();

		this._register(this.languageFeaturesService.completionProvider.register({ scheme: ChatInputPart.INPUT_SCHEME, hasAccessToAllModels: true }, {
			_debugDisplayName: 'chatVariables',
			triggerCharacters: [chatVariableLeader],
			provideCompletionItems: async (model: ITextModel, position: Position, _context: CompletionContext, _token: CancellationToken) => {
				const widget = this.chatWidgetService.getWidgetByInputUri(model.uri);
				if (!widget) {
					return null;
				}

				const range = computeCompletionRanges(model, position, VariableCompletions.VariableNameDef);
				if (!range) {
					return null;
				}

				const history = widget.viewModel!.getItems()
					.filter(isResponseVM);

				// TODO@roblourens work out a real API for this- maybe it can be part of the two-step flow that @file will probably use
				const historyVariablesEnabled = this.configurationService.getValue('chat.experimental.historyVariables');
				const historyItems = historyVariablesEnabled ? history.map((h, i): CompletionItem => ({
					label: `${chatVariableLeader}response:${i + 1}`,
					detail: h.response.asString(),
					insertText: `${chatVariableLeader}response:${String(i + 1).padStart(String(history.length).length, '0')} `,
					kind: CompletionItemKind.Text,
					range,
				})) : [];

				const variableItems = Array.from(this.chatVariablesService.getVariables()).map(v => {
					const withLeader = `${chatVariableLeader}${v.name}`;
					return <CompletionItem>{
						label: withLeader,
						range,
						insertText: withLeader + ' ',
						detail: v.description,
						kind: CompletionItemKind.Text, // The icons are disabled here anyway
						sortText: 'z'
					};
				});

				return <CompletionList>{
					suggestions: [...variableItems, ...historyItems]
				};
			}
		}));
	}
}

Registry.as<IWorkbenchContributionsRegistry>(WorkbenchExtensions.Workbench).registerWorkbenchContribution(VariableCompletions, LifecyclePhase.Eventually);

class ChatTokenDeleter extends Disposable {

	public readonly id = 'chatTokenDeleter';

	constructor(
		private readonly widget: IChatWidget,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
	) {
		super();
		const parser = this.instantiationService.createInstance(ChatRequestParser);
		const inputValue = this.widget.inputEditor.getValue();
		let previousInputValue: string | undefined;

		// A simple heuristic to delete the previous token when the user presses backspace.
		// The sophisticated way to do this would be to have a parse tree that can be updated incrementally.
		this.widget.inputEditor.onDidChangeModelContent(e => {
			if (!previousInputValue) {
				previousInputValue = inputValue;
			}

			// Don't try to handle multicursor edits right now
			const change = e.changes[0];

			// If this was a simple delete, try to find out whether it was inside a token
			if (!change.text) {
				parser.parseChatRequest(this.widget.viewModel!.sessionId, previousInputValue).then(previousParsedValue => {
					const deletableTokens = previousParsedValue.parts.filter(p => p instanceof ChatRequestAgentPart || p instanceof ChatRequestAgentSubcommandPart || p instanceof ChatRequestSlashCommandPart);
					deletableTokens.forEach(token => {
						const deletedRangeOfToken = Range.intersectRanges(token.editorRange, change.range);
						// Part of this token was deleted, and the deletion range doesn't go off the front of the token, for simpler math
						if ((deletedRangeOfToken && !deletedRangeOfToken.isEmpty()) && Range.compareRangesUsingStarts(token.editorRange, change.range) < 0) {
							// Assume single line tokens
							const length = deletedRangeOfToken.endColumn - deletedRangeOfToken.startColumn;
							const rangeToDelete = new Range(token.editorRange.startLineNumber, token.editorRange.startColumn, token.editorRange.endLineNumber, token.editorRange.endColumn - length);
							this.widget.inputEditor.executeEdits(this.id, [{
								range: rangeToDelete,
								text: '',
							}]);
						}
					});
				});
			}

			previousInputValue = this.widget.inputEditor.getValue();
		});
	}
}
ChatWidget.CONTRIBS.push(ChatTokenDeleter);
