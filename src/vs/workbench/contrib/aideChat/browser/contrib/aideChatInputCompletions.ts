/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { Disposable } from '../../../../../base/common/lifecycle.js';
import { Position } from '../../../../../editor/common/core/position.js';
import { Range } from '../../../../../editor/common/core/range.js';
import { IWordAtPosition, getWordAtText } from '../../../../../editor/common/core/wordHelper.js';
import { CompletionContext, CompletionItem, CompletionItemKind, CompletionList } from '../../../../../editor/common/languages.js';
import { ITextModel } from '../../../../../editor/common/model.js';
import { ILanguageFeaturesService } from '../../../../../editor/common/services/languageFeatures.js';
import { localize } from '../../../../../nls.js';
import { Action2, registerAction2 } from '../../../../../platform/actions/common/actions.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { ServicesAccessor } from '../../../../../platform/instantiation/common/instantiation.js';
import { Registry } from '../../../../../platform/registry/common/platform.js';
import { IWorkbenchContributionsRegistry, Extensions as WorkbenchExtensions } from '../../../../../workbench/common/contributions.js';
import { SubmitAction } from '../../../../../workbench/contrib/aideChat/browser/actions/aideChatExecuteActions.js';
import { IChatWidget, IAideChatWidgetService } from '../../../../../workbench/contrib/aideChat/browser/aideChat.js';
import { ChatInputPart } from '../../../../../workbench/contrib/aideChat/browser/aideChatInputPart.js';
import { MultiLevelCodeTriggerAction } from '../../../../../workbench/contrib/aideChat/browser/contrib/aideChatDynamicVariables.js';
import { AideChatAgentLocation, getFullyQualifiedId, IChatAgentData, IAideChatAgentNameService, IAideChatAgentService } from '../../../../../workbench/contrib/aideChat/common/aideChatAgents.js';
import { ChatRequestAgentPart, ChatRequestAgentSubcommandPart, ChatRequestTextPart, ChatRequestVariablePart, chatAgentLeader, chatSubcommandLeader, chatVariableLeader } from '../../../../../workbench/contrib/aideChat/common/aideChatParserTypes.js';
import { IAideChatSlashCommandService } from '../../../../../workbench/contrib/aideChat/common/aideChatSlashCommands.js';
import { IAideChatVariablesService } from '../../../../../workbench/contrib/aideChat/common/aideChatVariables.js';
import { LifecyclePhase } from '../../../../../workbench/services/lifecycle/common/lifecycle.js';

class SlashCommandCompletions extends Disposable {
	constructor(
		@ILanguageFeaturesService private readonly languageFeaturesService: ILanguageFeaturesService,
		@IAideChatWidgetService private readonly chatWidgetService: IAideChatWidgetService,
		@IAideChatSlashCommandService private readonly chatSlashCommandService: IAideChatSlashCommandService
	) {
		super();

		this._register(this.languageFeaturesService.completionProvider.register({ scheme: ChatInputPart.INPUT_SCHEME, hasAccessToAllModels: true }, {
			_debugDisplayName: 'globalSlashCommands',
			triggerCharacters: ['/'],
			provideCompletionItems: async (model: ITextModel, position: Position, _context: CompletionContext, _token: CancellationToken) => {
				const widget = this.chatWidgetService.getWidgetByInputUri(model.uri);
				if (!widget || !widget.viewModel || (widget.location !== AideChatAgentLocation.Panel && widget.location !== AideChatAgentLocation.Notebook) /* TODO@jrieken - enable when agents are adopted*/) {
					return null;
				}

				const range = computeCompletionRanges(model, position, /\/\w*/g);
				if (!range) {
					return null;
				}

				const parsedRequest = widget.parsedInput.parts;
				const usedAgent = parsedRequest.find(p => p instanceof ChatRequestAgentPart);
				if (usedAgent) {
					// No (classic) global slash commands when an agent is used
					return;
				}

				const slashCommands = this.chatSlashCommandService.getCommands();
				if (!slashCommands) {
					return null;
				}

				return {
					suggestions: slashCommands.map((c, i): CompletionItem => {
						const withSlash = `/${c.command}`;
						return {
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
		@IAideChatWidgetService private readonly chatWidgetService: IAideChatWidgetService,
		@IAideChatAgentService private readonly chatAgentService: IAideChatAgentService,
		@IAideChatAgentNameService private readonly chatAgentNameService: IAideChatAgentNameService,
	) {
		super();

		this._register(this.languageFeaturesService.completionProvider.register({ scheme: ChatInputPart.INPUT_SCHEME, hasAccessToAllModels: true }, {
			_debugDisplayName: 'chatAgent',
			triggerCharacters: ['@'],
			provideCompletionItems: async (model: ITextModel, position: Position, _context: CompletionContext, _token: CancellationToken) => {
				const widget = this.chatWidgetService.getWidgetByInputUri(model.uri);
				if (!widget || !widget.viewModel || (widget.location !== AideChatAgentLocation.Panel && widget.location !== AideChatAgentLocation.Notebook) /* TODO@jrieken - enable when agents are adopted*/) {
					return null;
				}

				const parsedRequest = widget.parsedInput.parts;
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
					.filter(a => !a.isDefault)
					.filter(a => a.locations.includes(widget.location));

				return {
					suggestions: agents.map((agent, i): CompletionItem => {
						const { label: agentLabel, isDupe } = this.getAgentCompletionDetails(agent);
						return {
							// Leading space is important because detail has no space at the start by design
							label: isDupe ?
								{ label: agentLabel, description: agent.description, detail: ` (${agent.publisherDisplayName})` } :
								agentLabel,
							insertText: `${agentLabel} `,
							detail: agent.description,
							range: new Range(1, 1, 1, 1),
							command: { id: AssignSelectedAgentAction.ID, title: AssignSelectedAgentAction.ID, arguments: [{ agent: agent, widget } satisfies AssignSelectedAgentActionArgs] },
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
				if (!widget || !widget.viewModel || widget.location !== AideChatAgentLocation.Panel /* TODO@jrieken - enable when agents are adopted*/) {
					return;
				}

				const range = computeCompletionRanges(model, position, /\/\w*/g);
				if (!range) {
					return null;
				}

				const parsedRequest = widget.parsedInput.parts;
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
				return {
					suggestions: usedAgent.agent.slashCommands.map((c, i): CompletionItem => {
						const withSlash = `/${c.name}`;
						return {
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
				const viewModel = widget?.viewModel;
				if (!widget || !viewModel || widget.location !== AideChatAgentLocation.Panel /* TODO@jrieken - enable when agents are adopted*/) {
					return;
				}

				const range = computeCompletionRanges(model, position, /\/\w*/g);
				if (!range) {
					return null;
				}

				const agents = this.chatAgentService.getAgents()
					.filter(a => a.locations.includes(widget.location));

				// When the input is only `/`, items are sorted by sortText.
				// When typing, filterText is used to score and sort.
				// The same list is refiltered/ranked while typing.
				const getFilterText = (agent: IChatAgentData, command: string) => {
					// This is hacking the filter algorithm to make @terminal /explain match worse than @workspace /explain by making its match index later in the string.
					// When I type `/exp`, the workspace one should be sorted over the terminal one.
					const dummyPrefix = agent.id === 'github.copilot.terminalPanel' ? `0000` : ``;
					return `${chatSubcommandLeader}${dummyPrefix}${agent.name}.${command}`;
				};

				const justAgents: CompletionItem[] = agents
					.filter(a => !a.isDefault)
					.map(agent => {
						const { label: agentLabel, isDupe } = this.getAgentCompletionDetails(agent);
						const detail = agent.description;

						return {
							label: isDupe ?
								{ label: agentLabel, description: agent.description, detail: ` (${agent.publisherDisplayName})` } :
								agentLabel,
							detail,
							filterText: `${chatSubcommandLeader}${agent.name}`,
							insertText: `${agentLabel} `,
							range: new Range(1, 1, 1, 1),
							kind: CompletionItemKind.Text,
							sortText: `${chatSubcommandLeader}${agent.name}`,
							command: { id: AssignSelectedAgentAction.ID, title: AssignSelectedAgentAction.ID, arguments: [{ agent, widget } satisfies AssignSelectedAgentActionArgs] },
						};
					});

				return {
					suggestions: justAgents.concat(
						agents.flatMap(agent => agent.slashCommands.map((c, i) => {
							const { label: agentLabel, isDupe } = this.getAgentCompletionDetails(agent);
							const withSlash = `${chatSubcommandLeader}${c.name}`;
							return {
								label: { label: withSlash, description: agentLabel, detail: isDupe ? ` (${agent.publisherDisplayName})` : undefined },
								filterText: getFilterText(agent, c.name),
								commitCharacters: [' '],
								insertText: `${agentLabel} ${withSlash} `,
								detail: `(${agentLabel}) ${c.description ?? ''}`,
								range: new Range(1, 1, 1, 1),
								kind: CompletionItemKind.Text, // The icons are disabled here anyway
								sortText: `${chatSubcommandLeader}${agent.name}${c.name}`,
								command: { id: AssignSelectedAgentAction.ID, title: AssignSelectedAgentAction.ID, arguments: [{ agent, widget } satisfies AssignSelectedAgentActionArgs] },
							} satisfies CompletionItem;
						})))
				};
			}
		}));
	}

	private getAgentCompletionDetails(agent: IChatAgentData): { label: string; isDupe: boolean } {
		const isAllowed = this.chatAgentNameService.getAgentNameRestriction(agent);
		const agentLabel = `${chatAgentLeader}${isAllowed ? agent.name : getFullyQualifiedId(agent)}`;
		const isDupe = isAllowed && this.chatAgentService.agentHasDupeName(agent.id);
		return { label: agentLabel, isDupe };
	}
}
Registry.as<IWorkbenchContributionsRegistry>(WorkbenchExtensions.Workbench).registerWorkbenchContribution(AgentCompletions, LifecyclePhase.Eventually);

interface AssignSelectedAgentActionArgs {
	agent: IChatAgentData;
	widget: IChatWidget;
}

class AssignSelectedAgentAction extends Action2 {
	static readonly ID = 'workbench.action.aideChat.assignSelectedAgent';

	constructor() {
		super({
			id: AssignSelectedAgentAction.ID,
			title: '' // not displayed
		});
	}

	async run(accessor: ServicesAccessor, ...args: any[]) {
		const arg: AssignSelectedAgentActionArgs = args[0];
		if (!arg || !arg.widget || !arg.agent) {
			return;
		}

		arg.widget.lastSelectedAgent = arg.agent;
	}
}
registerAction2(AssignSelectedAgentAction);

class BuiltinDynamicCompletions extends Disposable {
	private static readonly VariableNameDef = new RegExp(`${chatVariableLeader}\\w*`, 'g'); // MUST be using `g`-flag

	constructor(
		@ILanguageFeaturesService private readonly languageFeaturesService: ILanguageFeaturesService,
		@IAideChatWidgetService private readonly chatWidgetService: IAideChatWidgetService,
	) {
		super();

		this._register(this.languageFeaturesService.completionProvider.register({ scheme: ChatInputPart.INPUT_SCHEME, hasAccessToAllModels: true }, {
			_debugDisplayName: 'chatDynamicCompletions',
			triggerCharacters: [chatVariableLeader],
			provideCompletionItems: async (model: ITextModel, position: Position, _context: CompletionContext, _token: CancellationToken) => {
				const widget = this.chatWidgetService.getWidgetByInputUri(model.uri);
				if (!widget || !widget.supportsFileReferences || widget.location !== AideChatAgentLocation.Panel /* TODO@jrieken - enable when agents are adopted*/) {
					return null;
				}

				const range = computeCompletionRanges(model, position, BuiltinDynamicCompletions.VariableNameDef);
				if (!range) {
					return null;
				}

				const afterRange = new Range(position.lineNumber, range.replace.startColumn, position.lineNumber, range.replace.startColumn + '#file:'.length);
				return <CompletionList>{
					suggestions: [
						<CompletionItem>{
							label: `${chatVariableLeader}file`,
							insertText: `${chatVariableLeader}file:`,
							detail: localize('pickFileReferenceLabel', "Pick a file"),
							range,
							kind: CompletionItemKind.Text,
							command: { id: MultiLevelCodeTriggerAction.ID, title: MultiLevelCodeTriggerAction.ID, arguments: [{ inputEditor: widget.inputEditor, range: afterRange, pick: 'file' }] },
							sortText: 'z'
						},
						<CompletionItem>{
							label: `${chatVariableLeader}code`,
							insertText: `${chatVariableLeader}code:`,
							detail: localize('pickCodeSymbolLabel', "Pick a code symbol"),
							range,
							kind: CompletionItemKind.Text,
							command: { id: MultiLevelCodeTriggerAction.ID, title: MultiLevelCodeTriggerAction.ID, arguments: [{ inputEditor: widget.inputEditor, range: afterRange, pick: 'code' }] },
							sortText: 'z'
						},
						<CompletionItem>{
							label: `${chatVariableLeader}folder`,
							insertText: `${chatVariableLeader}folder:`,
							detail: localize('pickFolderReferenceLabel', "Pick a folder"),
							range,
							kind: CompletionItemKind.Text,
							command: { id: MultiLevelCodeTriggerAction.ID, title: MultiLevelCodeTriggerAction.ID, arguments: [{ inputEditor: widget.inputEditor, range: afterRange, pick: 'folder' }] },
							sortText: 'z'
						}
					]
				};
			}
		}));
	}
}

Registry.as<IWorkbenchContributionsRegistry>(WorkbenchExtensions.Workbench).registerWorkbenchContribution(BuiltinDynamicCompletions, LifecyclePhase.Eventually);

export function computeCompletionRanges(model: ITextModel, position: Position, reg: RegExp): { insert: Range; replace: Range; varWord: IWordAtPosition | null } | undefined {
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

	private static readonly VariableNameDef = new RegExp(`${chatVariableLeader}\\w*`, 'g'); // MUST be using `g`-flag

	constructor(
		@ILanguageFeaturesService private readonly languageFeaturesService: ILanguageFeaturesService,
		@IAideChatWidgetService private readonly chatWidgetService: IAideChatWidgetService,
		@IAideChatVariablesService private readonly chatVariablesService: IAideChatVariablesService,
		@IConfigurationService configService: IConfigurationService,
	) {
		super();

		this._register(this.languageFeaturesService.completionProvider.register({ scheme: ChatInputPart.INPUT_SCHEME, hasAccessToAllModels: true }, {
			_debugDisplayName: 'chatVariables',
			triggerCharacters: [chatVariableLeader],
			provideCompletionItems: async (model: ITextModel, position: Position, _context: CompletionContext, _token: CancellationToken) => {

				const locations = new Set<AideChatAgentLocation>();
				locations.add(AideChatAgentLocation.Panel);

				for (const value of Object.values(AideChatAgentLocation)) {
					if (typeof value === 'string' && configService.getValue<boolean>(`aideChat.experimental.variables.${value}`)) {
						locations.add(value);
					}
				}

				const widget = this.chatWidgetService.getWidgetByInputUri(model.uri);
				if (!widget || !locations.has(widget.location)) {
					return null;
				}

				const range = computeCompletionRanges(model, position, VariableCompletions.VariableNameDef);
				if (!range) {
					return null;
				}

				const usedAgent = widget.parsedInput.parts.find(p => p instanceof ChatRequestAgentPart);
				const slowSupported = usedAgent ? usedAgent.agent.metadata.supportsSlowVariables : true;

				const usedVariables = widget.parsedInput.parts.filter((p): p is ChatRequestVariablePart => p instanceof ChatRequestVariablePart);
				const variableItems = Array.from(this.chatVariablesService.getVariables())
					// This doesn't look at dynamic variables like `file`, where multiple makes sense.
					.filter(v => !usedVariables.some(usedVar => usedVar.variableName === v.name))
					.filter(v => !v.isSlow || slowSupported)
					.map((v): CompletionItem => {
						const withLeader = `${chatVariableLeader}${v.name}`;
						return {
							label: withLeader,
							range,
							insertText: withLeader + ' ',
							detail: v.description,
							kind: CompletionItemKind.Text, // The icons are disabled here anyway
							sortText: 'z'
						};
					});

				return {
					suggestions: variableItems
				};
			}
		}));
	}
}

Registry.as<IWorkbenchContributionsRegistry>(WorkbenchExtensions.Workbench).registerWorkbenchContribution(VariableCompletions, LifecyclePhase.Eventually);
