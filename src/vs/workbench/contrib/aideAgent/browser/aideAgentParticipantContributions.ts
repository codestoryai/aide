/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { coalesce, isNonEmptyArray } from '../../../../base/common/arrays.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { toErrorMessage } from '../../../../base/common/errorMessage.js';
import { DisposableMap, DisposableStore, IDisposable, toDisposable } from '../../../../base/common/lifecycle.js';
import * as strings from '../../../../base/common/strings.js';
import { localize, localize2 } from '../../../../nls.js';
import { ContextKeyExpr, IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { ExtensionIdentifier } from '../../../../platform/extensions/common/extensions.js';
import { SyncDescriptor } from '../../../../platform/instantiation/common/descriptors.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { Severity } from '../../../../platform/notification/common/notification.js';
import { IProductService } from '../../../../platform/product/common/productService.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { ViewPaneContainer } from '../../../browser/parts/views/viewPaneContainer.js';
import { IWorkbenchContribution } from '../../../common/contributions.js';
import { IViewContainersRegistry, IViewDescriptor, IViewsRegistry, ViewContainer, ViewContainerLocation, Extensions as ViewExtensions } from '../../../common/views.js';
import { isProposedApiEnabled } from '../../../services/extensions/common/extensions.js';
import * as extensionsRegistry from '../../../services/extensions/common/extensionsRegistry.js';
import { showExtensionsWithIdsCommandId } from '../../extensions/browser/extensionsActions.js';
import { IExtensionsWorkbenchService } from '../../extensions/common/extensions.js';
import { ChatAgentLocation, IAideAgentAgentService, IChatAgentData } from '../common/aideAgentAgents.js';
import { CONTEXT_CHAT_EXTENSION_INVALID, CONTEXT_CHAT_IS_PLAN_VISIBLE, CONTEXT_CHAT_PANEL_PARTICIPANT_REGISTERED } from '../common/aideAgentContextKeys.js';
import { IRawChatParticipantContribution } from '../common/aideAgentParticipantContribTypes.js';
import { ChatViewId } from './aideAgent.js';
import { AIDE_AGENT_PLAN_VIEW_PANE_ID } from './aideAgentPlan.js';
import { AideAgentPlanViewPane } from './aideAgentPlanViewPane.js';
import { CHAT_SIDEBAR_PANEL_ID, ChatViewPane } from './aideAgentViewPane.js';

const chatParticipantExtensionPoint = extensionsRegistry.ExtensionsRegistry.registerExtensionPoint<IRawChatParticipantContribution[]>({
	extensionPoint: 'aideAgents',
	jsonSchema: {
		description: localize('vscode.extension.contributes.chatParticipant', 'Contributes a chat participant'),
		type: 'array',
		items: {
			additionalProperties: false,
			type: 'object',
			defaultSnippets: [{ body: { name: '', description: '' } }],
			required: ['name', 'id'],
			properties: {
				id: {
					description: localize('chatParticipantId', "A unique id for this chat participant."),
					type: 'string'
				},
				name: {
					description: localize('chatParticipantName', "User-facing name for this chat participant. The user will use '#' with this name to invoke the participant. Name must not contain whitespace."),
					type: 'string',
					pattern: '^[\\w-]+$'
				},
				fullName: {
					markdownDescription: localize('chatParticipantFullName', "The full name of this chat participant, which is shown as the label for responses coming from this participant. If not provided, {0} is used.", '`name`'),
					type: 'string'
				},
				description: {
					description: localize('chatParticipantDescription', "A description of this chat participant, shown in the UI."),
					type: 'string'
				},
				isSticky: {
					description: localize('chatCommandSticky', "Whether invoking the command puts the chat into a persistent mode, where the command is automatically added to the chat input for the next message."),
					type: 'boolean'
				},
				sampleRequest: {
					description: localize('chatSampleRequest', "When the user clicks this participant in `/help`, this text will be submitted to the participant."),
					type: 'string'
				},
				when: {
					description: localize('chatParticipantWhen', "A condition which must be true to enable this participant."),
					type: 'string'
				},
				disambiguation: {
					description: localize('chatParticipantDisambiguation', "Metadata to help with automatically routing user questions to this chat participant."),
					type: 'array',
					items: {
						additionalProperties: false,
						type: 'object',
						defaultSnippets: [{ body: { category: '', description: '', examples: [] } }],
						required: ['category', 'description', 'examples'],
						properties: {
							category: {
								markdownDescription: localize('chatParticipantDisambiguationCategory', "A detailed name for this category, e.g. `workspace_questions` or `web_questions`."),
								type: 'string'
							},
							description: {
								description: localize('chatParticipantDisambiguationDescription', "A detailed description of the kinds of questions that are suitable for this chat participant."),
								type: 'string'
							},
							examples: {
								description: localize('chatParticipantDisambiguationExamples', "A list of representative example questions that are suitable for this chat participant."),
								type: 'array'
							},
						}
					}
				},
				commands: {
					markdownDescription: localize('chatCommandsDescription', "Commands available for this chat participant, which the user can invoke with a `/`."),
					type: 'array',
					items: {
						additionalProperties: false,
						type: 'object',
						defaultSnippets: [{ body: { name: '', description: '' } }],
						required: ['name'],
						properties: {
							name: {
								description: localize('chatCommand', "A short name by which this command is referred to in the UI, e.g. `fix` or * `explain` for commands that fix an issue or explain code. The name should be unique among the commands provided by this participant."),
								type: 'string'
							},
							description: {
								description: localize('chatCommandDescription', "A description of this command."),
								type: 'string'
							},
							when: {
								description: localize('chatCommandWhen', "A condition which must be true to enable this command."),
								type: 'string'
							},
							sampleRequest: {
								description: localize('chatCommandSampleRequest', "When the user clicks this command in `/help`, this text will be submitted to the participant."),
								type: 'string'
							},
							isSticky: {
								description: localize('chatCommandSticky', "Whether invoking the command puts the chat into a persistent mode, where the command is automatically added to the chat input for the next message."),
								type: 'boolean'
							},
							disambiguation: {
								description: localize('chatCommandDisambiguation', "Metadata to help with automatically routing user questions to this chat command."),
								type: 'array',
								items: {
									additionalProperties: false,
									type: 'object',
									defaultSnippets: [{ body: { category: '', description: '', examples: [] } }],
									required: ['category', 'description', 'examples'],
									properties: {
										category: {
											markdownDescription: localize('chatCommandDisambiguationCategory', "A detailed name for this category, e.g. `workspace_questions` or `web_questions`."),
											type: 'string'
										},
										description: {
											description: localize('chatCommandDisambiguationDescription', "A detailed description of the kinds of questions that are suitable for this chat command."),
											type: 'string'
										},
										examples: {
											description: localize('chatCommandDisambiguationExamples', "A list of representative example questions that are suitable for this chat command."),
											type: 'array'
										},
									}
								}
							}
						}
					}
				},
				supportsToolReferences: {
					description: localize('chatParticipantSupportsToolReferences', "Whether this participant supports {0}.", 'ChatRequest#toolReferences'),
					type: 'boolean'
				}
			}
		}
	},
	activationEventsGenerator: (contributions: IRawChatParticipantContribution[], result: { push(item: string): void }) => {
		for (const contrib of contributions) {
			result.push(`onAideAgent:${contrib.id}`);
		}
	},
});

const viewContainerId = CHAT_SIDEBAR_PANEL_ID;
const viewContainer: ViewContainer = Registry.as<IViewContainersRegistry>(ViewExtensions.ViewContainersRegistry).registerViewContainer({
	id: viewContainerId,
	title: localize2('chat.viewContainer.label', "Assistant"),
	icon: Codicon.commentDiscussion,
	ctorDescriptor: new SyncDescriptor(ViewPaneContainer, [viewContainerId, { mergeViewWithContainerWhenSingleView: true }]),
	storageId: viewContainerId,
	hideIfEmpty: false,
	order: 0,
}, ViewContainerLocation.AuxiliaryBar, { isDefault: true });

const planViewContainerId = AIDE_AGENT_PLAN_VIEW_PANE_ID;
const planViewContainer: ViewContainer = Registry.as<IViewContainersRegistry>(ViewExtensions.ViewContainersRegistry).registerViewContainer({
	id: planViewContainerId,
	title: localize2('aideAgent.planViewContainer.label', "Step-wise plan"),
	icon: Codicon.mapVertical,
	ctorDescriptor: new SyncDescriptor(ViewPaneContainer, [planViewContainerId, { mergeViewWithContainerWhenSingleView: true }]),
	storageId: planViewContainerId,
	hideIfEmpty: true,
	order: 5,
}, ViewContainerLocation.Sidebar);

export class ChatExtensionPointHandler implements IWorkbenchContribution {

	static readonly ID = 'workbench.contrib.aideAgentExtensionPointHandler';

	private _viewContainer: ViewContainer;
	private _participantRegistrationDisposables = new DisposableMap<string>();

	constructor(
		@IAideAgentAgentService private readonly _chatAgentService: IAideAgentAgentService,
		@ILogService private readonly logService: ILogService
	) {
		this._viewContainer = viewContainer;
		this.registerDefaultParticipantView();
		this.registerDefaultPlanView();
		this.handleAndRegisterChatExtensions();
	}

	private handleAndRegisterChatExtensions(): void {
		chatParticipantExtensionPoint.setHandler((extensions, delta) => {
			for (const extension of delta.added) {
				for (const providerDescriptor of extension.value) {
					if (!providerDescriptor.name?.match(/^[\w-]+$/)) {
						this.logService.error(`Extension '${extension.description.identifier.value}' CANNOT register participant with invalid name: ${providerDescriptor.name}. Name must match /^[\\w-]+$/.`);
						continue;
					}

					if (providerDescriptor.fullName && strings.AmbiguousCharacters.getInstance(new Set()).containsAmbiguousCharacter(providerDescriptor.fullName)) {
						this.logService.error(`Extension '${extension.description.identifier.value}' CANNOT register participant with fullName that contains ambiguous characters: ${providerDescriptor.fullName}.`);
						continue;
					}

					// Spaces are allowed but considered "invisible"
					if (providerDescriptor.fullName && strings.InvisibleCharacters.containsInvisibleCharacter(providerDescriptor.fullName.replace(/ /g, ''))) {
						this.logService.error(`Extension '${extension.description.identifier.value}' CANNOT register participant with fullName that contains invisible characters: ${providerDescriptor.fullName}.`);
						continue;
					}

					if (providerDescriptor.isDefault && !isProposedApiEnabled(extension.description, 'defaultChatParticipant')) {
						this.logService.error(`Extension '${extension.description.identifier.value}' CANNOT use API proposal: defaultChatParticipant.`);
						continue;
					}

					if (providerDescriptor.locations && !isProposedApiEnabled(extension.description, 'chatParticipantAdditions')) {
						this.logService.error(`Extension '${extension.description.identifier.value}' CANNOT use API proposal: chatParticipantAdditions.`);
						continue;
					}

					if (!providerDescriptor.id || !providerDescriptor.name) {
						this.logService.error(`Extension '${extension.description.identifier.value}' CANNOT register participant without both id and name.`);
						continue;
					}

					const participantsDisambiguation: {
						category: string;
						description: string;
						examples: string[];
					}[] = [];

					if (providerDescriptor.disambiguation?.length) {
						participantsDisambiguation.push(...providerDescriptor.disambiguation.map((d) => ({
							...d, category: d.category ?? d.categoryName
						})));
					}

					try {
						const store = new DisposableStore();
						store.add(this._chatAgentService.registerAgent(
							providerDescriptor.id,
							{
								extensionId: extension.description.identifier,
								publisherDisplayName: extension.description.publisherDisplayName ?? extension.description.publisher, // May not be present in OSS
								extensionPublisherId: extension.description.publisher,
								extensionDisplayName: extension.description.displayName ?? extension.description.name,
								id: providerDescriptor.id,
								description: providerDescriptor.description,
								when: providerDescriptor.when,
								metadata: {
									isSticky: providerDescriptor.isSticky,
									sampleRequest: providerDescriptor.sampleRequest,
								},
								name: providerDescriptor.name,
								fullName: providerDescriptor.fullName,
								isDefault: providerDescriptor.isDefault,
								locations: isNonEmptyArray(providerDescriptor.locations) ?
									providerDescriptor.locations.map(ChatAgentLocation.fromRaw) :
									[ChatAgentLocation.Panel],
								slashCommands: providerDescriptor.commands ?? [],
								disambiguation: coalesce(participantsDisambiguation.flat()),
							} satisfies IChatAgentData));

						this._participantRegistrationDisposables.set(
							getParticipantKey(extension.description.identifier, providerDescriptor.id),
							store
						);
					} catch (e) {
						this.logService.error(`Failed to register participant ${providerDescriptor.id}: ${toErrorMessage(e, true)}`);
					}
				}
			}

			for (const extension of delta.removed) {
				for (const providerDescriptor of extension.value) {
					this._participantRegistrationDisposables.deleteAndDispose(getParticipantKey(extension.description.identifier, providerDescriptor.id));
				}
			}
		});
	}

	private registerDefaultParticipantView(): IDisposable {
		// Register View. Name must be hardcoded because we want to show it even when the extension fails to load due to an API version incompatibility.
		const name = 'Assistant';
		const viewDescriptor: IViewDescriptor[] = [{
			id: ChatViewId,
			containerIcon: this._viewContainer.icon,
			containerTitle: this._viewContainer.title.value,
			singleViewPaneContainerTitle: this._viewContainer.title.value,
			name: { value: name, original: name },
			canToggleVisibility: false,
			canMoveView: false,
			ctorDescriptor: new SyncDescriptor(ChatViewPane),
			when: ContextKeyExpr.or(CONTEXT_CHAT_PANEL_PARTICIPANT_REGISTERED, CONTEXT_CHAT_EXTENSION_INVALID)
		}];
		Registry.as<IViewsRegistry>(ViewExtensions.ViewsRegistry).registerViews(viewDescriptor, this._viewContainer);

		return toDisposable(() => {
			Registry.as<IViewsRegistry>(ViewExtensions.ViewsRegistry).deregisterViews(viewDescriptor, this._viewContainer);
		});
	}

	private registerDefaultPlanView(): IDisposable {
		const name = 'Step-wise plan';
		const viewDescriptor: IViewDescriptor[] = [{
			id: AIDE_AGENT_PLAN_VIEW_PANE_ID,
			containerIcon: planViewContainer.icon,
			containerTitle: planViewContainer.title.value,
			singleViewPaneContainerTitle: planViewContainer.title.value,
			name: { value: name, original: name },
			canMoveView: false,
			canToggleVisibility: true,
			when: CONTEXT_CHAT_IS_PLAN_VISIBLE,
			ctorDescriptor: new SyncDescriptor(AideAgentPlanViewPane),
		}];
		Registry.as<IViewsRegistry>(ViewExtensions.ViewsRegistry).registerViews(viewDescriptor, planViewContainer);

		return toDisposable(() => {
			Registry.as<IViewsRegistry>(ViewExtensions.ViewsRegistry).deregisterViews(viewDescriptor, planViewContainer);
		});
	}
}

function getParticipantKey(extensionId: ExtensionIdentifier, participantName: string): string {
	return `${extensionId.value}_${participantName}`;
}

export class ChatCompatibilityNotifier implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.aideAgentCompatNotifier';

	constructor(
		@IExtensionsWorkbenchService extensionsWorkbenchService: IExtensionsWorkbenchService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IAideAgentAgentService chatAgentService: IAideAgentAgentService,
		@IProductService productService: IProductService,
	) {
		// It may be better to have some generic UI for this, for any extension that is incompatible,
		// but this is only enabled for Copilot Chat now and it needs to be obvious.
		const isInvalid = CONTEXT_CHAT_EXTENSION_INVALID.bindTo(contextKeyService);
		extensionsWorkbenchService.queryLocal().then(exts => {
			const chat = exts.find(ext => ext.identifier.id === 'github.copilot-chat');
			if (chat?.local?.validations.some(v => v[0] === Severity.Error)) {
				const showExtensionLabel = localize('showExtension', "Show Extension");
				const mainMessage = localize('chatFailErrorMessage', "Chat failed to load because the installed version of the {0} extension is not compatible with this version of {1}. Please ensure that the GitHub Copilot Chat extension is up to date.", 'GitHub Copilot Chat', productService.nameLong);
				const commandButton = `[${showExtensionLabel}](command:${showExtensionsWithIdsCommandId}?${encodeURIComponent(JSON.stringify([['GitHub.copilot-chat']]))})`;
				const versionMessage = `GitHub Copilot Chat version: ${chat.version}`;
				const viewsRegistry = Registry.as<IViewsRegistry>(ViewExtensions.ViewsRegistry);
				viewsRegistry.registerViewWelcomeContent(ChatViewId, {
					content: [mainMessage, commandButton, versionMessage].join('\n\n'),
					when: CONTEXT_CHAT_EXTENSION_INVALID,
				});

				// This catches vscode starting up with the invalid extension, but the extension may still get updated by vscode after this.
				isInvalid.set(true);
			}
		});

		const listener = chatAgentService.onDidChangeAgents(() => {
			if (chatAgentService.getDefaultAgent(ChatAgentLocation.Panel)) {
				isInvalid.set(false);
				listener.dispose();
			}
		});
	}
}
