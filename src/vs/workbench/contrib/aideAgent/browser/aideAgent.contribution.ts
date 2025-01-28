/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { MarkdownString, isMarkdownString } from '../../../../base/common/htmlContent.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { Schemas } from '../../../../base/common/network.js';
import { isMacintosh } from '../../../../base/common/platform.js';
import { registerEditorFeature } from '../../../../editor/common/editorFeatures.js';
import * as nls from '../../../../nls.js';
import { AccessibleViewRegistry } from '../../../../platform/accessibility/browser/accessibleViewRegistry.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { Extensions as ConfigurationExtensions, IConfigurationRegistry } from '../../../../platform/configuration/common/configurationRegistry.js';
import { SyncDescriptor } from '../../../../platform/instantiation/common/descriptors.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { EditorPaneDescriptor, IEditorPaneRegistry } from '../../../browser/editor.js';
import { IWorkbenchContributionsRegistry, Extensions as WorkbenchExtensions, WorkbenchPhase, registerWorkbenchContribution2 } from '../../../common/contributions.js';
import { EditorExtensions, IEditorFactoryRegistry } from '../../../common/editor.js';
import { IEditorResolverService, RegisteredEditorPriority } from '../../../services/editor/common/editorResolverService.js';
import { LifecyclePhase } from '../../../services/lifecycle/common/lifecycle.js';
import { ChatAgentLocation, ChatAgentNameService, ChatAgentService, IAideAgentAgentNameService, IAideAgentAgentService } from '../common/aideAgentAgents.js';
import { IAideAgentCodeEditingService } from '../common/aideAgentCodeEditingService.js';
import { CodeMapperService, IAideAgentCodeMapperService } from '../common/aideAgentCodeMapperService.js';
import '../common/aideAgentColors.js';
import { chatVariableLeader } from '../common/aideAgentParserTypes.js';
import { IAideAgentService } from '../common/aideAgentService.js';
import { ChatService } from '../common/aideAgentServiceImpl.js';
import { ChatSlashCommandService, IAideAgentSlashCommandService } from '../common/aideAgentSlashCommands.js';
import { IAideAgentVariablesService } from '../common/aideAgentVariables.js';
import { ChatWidgetHistoryService, IAideAgentWidgetHistoryService } from '../common/aideAgentWidgetHistoryService.js';
import { IAideAgentLMService, LanguageModelsService } from '../common/languageModels.js';
import { IAideAgentLMStatsService, LanguageModelStatsService } from '../common/languageModelStats.js';
import { IAideAgentLMToolsService, LanguageModelToolsService } from '../common/languageModelToolsService.js';
import { ISidecarService, SidecarService } from '../common/sidecarService.js';
import { LanguageModelToolsExtensionPointHandler } from '../common/tools/languageModelToolsContribution.js';
import { PanelChatAccessibilityHelp } from './actions/aideAgentAccessibilityHelp.js';
import { registerChatActions } from './actions/aideAgentActions.js';
import { ACTION_ID_NEW_CHAT, registerNewChatActions } from './actions/aideAgentClearActions.js';
import { registerChatCodeBlockActions, registerChatCodeCompareBlockActions } from './actions/aideAgentCodeblockActions.js';
import { registerCodeEditActions } from './actions/aideAgentCodeEditActions.js';
import { registerChatContextActions } from './actions/aideAgentContextActions.js';
import { registerChatCopyActions } from './actions/aideAgentCopyActions.js';
import { registerChatDeveloperActions } from './actions/aideAgentDeveloperActions.js';
import { ExecuteChatAction, registerChatExecuteActions } from './actions/aideAgentExecuteActions.js';
import { registerChatFileTreeActions } from './actions/aideAgentFileTreeActions.js';
import { registerAideAgentFloatingWidgetActions } from './actions/aideAgentFloatingWidgetActions.js';
import { ChatGettingStartedContribution } from './actions/aideAgentGettingStarted.js';
import { registerChatTitleActions } from './actions/aideAgentTitleActions.js';
import { IAideAgentAccessibilityService, IAideAgentCodeBlockContextProviderService, IAideAgentWidgetService } from './aideAgent.js';
import { AideAgentAccessibilityService } from './aideAgentAccessibilityService.js';
import { AideAgentCodeEditingService } from './aideAgentCodeEditingService.js';
import { ChatEditor, IChatEditorOptions } from './aideAgentEditor.js';
import { ChatEditorInput, ChatEditorInputSerializer } from './aideAgentEditorInput.js';
import { AideAgentFloatingWidgetService, IAideAgentFloatingWidgetService } from './aideAgentFloatingWidgetService.js';
import { agentSlashCommandToMarkdown, agentToMarkdown } from './aideAgentMarkdownDecorationsRenderer.js';
import { ChatCompatibilityNotifier, ChatExtensionPointHandler } from './aideAgentParticipantContributions.js';
import { ChatPasteProvidersFeature } from './aideAgentPasteProviders.js';
import { ChatResponseAccessibleView } from './aideAgentResponseAccessibleView.js';
import { ChatVariablesService } from './aideAgentVariables.js';
import { ChatWidgetService } from './aideAgentWidget.js';
import { AideAgentCodeBlockContextProviderService } from './codeBlockContextProviderService.js';
import './contrib/aideAgentInputCompletions.js';
import './contrib/aideAgentInputEditorContrib.js';
import { IDevtoolsService } from '../common/devtoolsService.js';
import { DevtoolsService } from './devtoolsServiceImpl.js';
import { IAideAgentTerminalService } from '../common/aideAgentTerminalService.js';
import { AideAgentTerminalService } from './aideAgentTerminalServiceImpl.js';
import { registerDevtoolsActions } from './actions/devtoolsActions.js';

// Register configuration
const configurationRegistry = Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration);
configurationRegistry.registerConfiguration({
	id: 'chatSidebar',
	title: nls.localize('interactiveSessionConfigurationTitle', "Chat"),
	type: 'object',
	properties: {
		'chat.editor.fontSize': {
			type: 'number',
			description: nls.localize('interactiveSession.editor.fontSize', "Controls the font size in pixels in chat codeblocks."),
			default: isMacintosh ? 14 : 14,
		},
		'chat.editor.fontFamily': {
			type: 'string',
			description: nls.localize('interactiveSession.editor.fontFamily', "Controls the font family in chat codeblocks."),
			default: 'default'
		},
		'chat.editor.fontWeight': {
			type: 'string',
			description: nls.localize('interactiveSession.editor.fontWeight', "Controls the font weight in chat codeblocks."),
			default: 'default'
		},
		'chat.editor.wordWrap': {
			type: 'string',
			description: nls.localize('interactiveSession.editor.wordWrap', "Controls whether lines should wrap in chat codeblocks."),
			default: 'off',
			enum: ['on', 'off']
		},
		'chat.editor.lineHeight': {
			type: 'number',
			description: nls.localize('interactiveSession.editor.lineHeight', "Controls the line height in pixels in chat codeblocks. Use 0 to compute the line height from the font size."),
			default: 0
		},
		'chat.experimental.implicitContext': {
			type: 'boolean',
			description: nls.localize('chat.experimental.implicitContext', "Controls whether a checkbox is shown to allow the user to determine which implicit context is included with a chat participant's prompt."),
			deprecated: true,
			default: false
		},
		'chat.experimental.variables.editor': {
			type: 'boolean',
			description: nls.localize('chat.experimental.variables.editor', "Enables variables for editor chat."),
			default: true
		},
		'chat.experimental.variables.notebook': {
			type: 'boolean',
			description: nls.localize('chat.experimental.variables.notebook', "Enables variables for notebook chat."),
			default: false
		},
		'chat.experimental.variables.terminal': {
			type: 'boolean',
			description: nls.localize('chat.experimental.variables.terminal', "Enables variables for terminal chat."),
			default: false
		},
		'chat.experimental.detectParticipant.enabled': {
			type: 'boolean',
			description: nls.localize('chat.experimental.detectParticipant.enabled', "Enables chat participant autodetection for panel chat."),
			default: null
		},
	}
});
Registry.as<IEditorPaneRegistry>(EditorExtensions.EditorPane).registerEditorPane(
	EditorPaneDescriptor.create(
		ChatEditor,
		ChatEditorInput.EditorID,
		nls.localize('chat', "Chat")
	),
	[
		new SyncDescriptor(ChatEditorInput)
	]
);

class ChatResolverContribution extends Disposable {

	static readonly ID = 'workbench.contrib.aideAgentResolver';

	constructor(
		@IEditorResolverService editorResolverService: IEditorResolverService,
		@IInstantiationService instantiationService: IInstantiationService,
	) {
		super();

		this._register(editorResolverService.registerEditor(
			`${Schemas.vscodeAideAgentSesssion}:**/**`,
			{
				id: ChatEditorInput.EditorID,
				label: nls.localize('chat', "Chat"),
				priority: RegisteredEditorPriority.builtin
			},
			{
				singlePerResource: true,
				canSupportResource: resource => resource.scheme === Schemas.vscodeAideAgentSesssion
			},
			{
				createEditorInput: ({ resource, options }) => {
					return { editor: instantiationService.createInstance(ChatEditorInput, resource, options as IChatEditorOptions), options };
				}
			}
		));
	}
}

AccessibleViewRegistry.register(new ChatResponseAccessibleView());
AccessibleViewRegistry.register(new PanelChatAccessibilityHelp());

class ChatSlashStaticSlashCommandsContribution extends Disposable {

	constructor(
		@IAideAgentSlashCommandService slashCommandService: IAideAgentSlashCommandService,
		@ICommandService commandService: ICommandService,
		@IAideAgentAgentService chatAgentService: IAideAgentAgentService,
		@IAideAgentVariablesService chatVariablesService: IAideAgentVariablesService,
		@IInstantiationService instantiationService: IInstantiationService,
	) {
		super();
		this._store.add(slashCommandService.registerSlashCommand({
			command: 'clear',
			detail: nls.localize('clear', "Start a new session"),
			sortText: 'z2_clear',
			executeImmediately: true,
			locations: [ChatAgentLocation.Panel]
		}, async () => {
			commandService.executeCommand(ACTION_ID_NEW_CHAT);
		}));
		this._store.add(slashCommandService.registerSlashCommand({
			command: 'help',
			detail: '',
			sortText: 'z1_help',
			executeImmediately: true,
			locations: [ChatAgentLocation.Panel]
		}, async (prompt, progress) => {
			const defaultAgent = chatAgentService.getDefaultAgent(ChatAgentLocation.Panel);
			const agents = chatAgentService.getAgents();

			// Report prefix
			if (defaultAgent?.metadata.helpTextPrefix) {
				if (isMarkdownString(defaultAgent.metadata.helpTextPrefix)) {
					progress.report({ content: defaultAgent.metadata.helpTextPrefix, kind: 'markdownContent' });
				} else {
					progress.report({ content: new MarkdownString(defaultAgent.metadata.helpTextPrefix), kind: 'markdownContent' });
				}
				progress.report({ content: new MarkdownString('\n\n'), kind: 'markdownContent' });
			}

			// Report agent list
			const agentText = (await Promise.all(agents
				.filter(a => a.id !== defaultAgent?.id)
				.filter(a => a.locations.includes(ChatAgentLocation.Panel))
				.map(async a => {
					const description = a.description ? `- ${a.description}` : '';
					const agentMarkdown = instantiationService.invokeFunction(accessor => agentToMarkdown(a, true, accessor));
					const agentLine = `- ${agentMarkdown} ${description}`;
					const commandText = a.slashCommands.map(c => {
						const description = c.description ? `- ${c.description}` : '';
						return `\t* ${agentSlashCommandToMarkdown(a, c)} ${description}`;
					}).join('\n');

					return (agentLine + '\n' + commandText).trim();
				}))).join('\n');
			progress.report({ content: new MarkdownString(agentText, { isTrusted: { enabledCommands: [ExecuteChatAction.ID] } }), kind: 'markdownContent' });

			// Report variables
			if (defaultAgent?.metadata.helpTextVariablesPrefix) {
				progress.report({ content: new MarkdownString('\n\n'), kind: 'markdownContent' });
				if (isMarkdownString(defaultAgent.metadata.helpTextVariablesPrefix)) {
					progress.report({ content: defaultAgent.metadata.helpTextVariablesPrefix, kind: 'markdownContent' });
				} else {
					progress.report({ content: new MarkdownString(defaultAgent.metadata.helpTextVariablesPrefix), kind: 'markdownContent' });
				}

				const variables = [
					...chatVariablesService.getVariables(ChatAgentLocation.Panel),
					{ name: 'file', description: nls.localize('file', "Choose a file in the workspace") }
				];
				const variableText = variables
					.map(v => `* \`${chatVariableLeader}${v.name}\` - ${v.description}`)
					.join('\n');
				progress.report({ content: new MarkdownString('\n' + variableText), kind: 'markdownContent' });
			}

			// Report help text ending
			if (defaultAgent?.metadata.helpTextPostfix) {
				progress.report({ content: new MarkdownString('\n\n'), kind: 'markdownContent' });
				if (isMarkdownString(defaultAgent.metadata.helpTextPostfix)) {
					progress.report({ content: defaultAgent.metadata.helpTextPostfix, kind: 'markdownContent' });
				} else {
					progress.report({ content: new MarkdownString(defaultAgent.metadata.helpTextPostfix), kind: 'markdownContent' });
				}
			}
		}));
	}
}

const workbenchContributionsRegistry = Registry.as<IWorkbenchContributionsRegistry>(WorkbenchExtensions.Workbench);
registerWorkbenchContribution2(ChatResolverContribution.ID, ChatResolverContribution, WorkbenchPhase.BlockStartup);
workbenchContributionsRegistry.registerWorkbenchContribution(ChatSlashStaticSlashCommandsContribution, LifecyclePhase.Eventually);
Registry.as<IEditorFactoryRegistry>(EditorExtensions.EditorFactory).registerEditorSerializer(ChatEditorInput.TypeID, ChatEditorInputSerializer);
registerWorkbenchContribution2(ChatExtensionPointHandler.ID, ChatExtensionPointHandler, WorkbenchPhase.BlockStartup);
registerWorkbenchContribution2(LanguageModelToolsExtensionPointHandler.ID, LanguageModelToolsExtensionPointHandler, WorkbenchPhase.BlockRestore);
registerWorkbenchContribution2(ChatCompatibilityNotifier.ID, ChatCompatibilityNotifier, WorkbenchPhase.Eventually);
registerWorkbenchContribution2(ChatGettingStartedContribution.ID, ChatGettingStartedContribution, WorkbenchPhase.Eventually);

registerChatActions();
registerChatCopyActions();
registerChatCodeBlockActions();
registerChatCodeCompareBlockActions();
registerChatFileTreeActions();
registerChatTitleActions();
registerChatExecuteActions();
registerNewChatActions();
registerChatContextActions();
registerChatDeveloperActions();
registerAideAgentFloatingWidgetActions();
registerCodeEditActions();

registerDevtoolsActions();

registerEditorFeature(ChatPasteProvidersFeature);

registerSingleton(IAideAgentService, ChatService, InstantiationType.Delayed);
registerSingleton(IAideAgentWidgetService, ChatWidgetService, InstantiationType.Delayed);
registerSingleton(IAideAgentAccessibilityService, AideAgentAccessibilityService, InstantiationType.Delayed);
registerSingleton(IAideAgentWidgetHistoryService, ChatWidgetHistoryService, InstantiationType.Delayed);
registerSingleton(IAideAgentLMService, LanguageModelsService, InstantiationType.Delayed);
registerSingleton(IAideAgentLMStatsService, LanguageModelStatsService, InstantiationType.Delayed);
registerSingleton(IAideAgentSlashCommandService, ChatSlashCommandService, InstantiationType.Delayed);
registerSingleton(IAideAgentAgentService, ChatAgentService, InstantiationType.Delayed);
registerSingleton(IAideAgentAgentNameService, ChatAgentNameService, InstantiationType.Delayed);
registerSingleton(IAideAgentVariablesService, ChatVariablesService, InstantiationType.Delayed);
registerSingleton(IAideAgentLMToolsService, LanguageModelToolsService, InstantiationType.Delayed);
registerSingleton(IAideAgentCodeBlockContextProviderService, AideAgentCodeBlockContextProviderService, InstantiationType.Delayed);
registerSingleton(IAideAgentCodeMapperService, CodeMapperService, InstantiationType.Delayed);
registerSingleton(IAideAgentFloatingWidgetService, AideAgentFloatingWidgetService, InstantiationType.Delayed);
registerSingleton(IAideAgentCodeEditingService, AideAgentCodeEditingService, InstantiationType.Delayed);
registerSingleton(ISidecarService, SidecarService, InstantiationType.Delayed);
registerSingleton(IDevtoolsService, DevtoolsService, InstantiationType.Delayed);
registerSingleton(IAideAgentTerminalService, AideAgentTerminalService, InstantiationType.Delayed);
