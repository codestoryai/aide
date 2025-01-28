/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as dom from '../../../../base/browser/dom.js';
import { ITreeContextMenuEvent, ITreeElement } from '../../../../base/browser/ui/tree/tree.js';
import { disposableTimeout, timeout } from '../../../../base/common/async.js';
import { toErrorMessage } from '../../../../base/common/errorMessage.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { MarkdownString } from '../../../../base/common/htmlContent.js';
import { Disposable, DisposableStore, IDisposable, MutableDisposable, combinedDisposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { Schemas } from '../../../../base/common/network.js';
import { extUri, isEqual } from '../../../../base/common/resources.js';
import { isDefined } from '../../../../base/common/types.js';
import { URI } from '../../../../base/common/uri.js';
import { ICodeEditor } from '../../../../editor/browser/editorBrowser.js';
import { ICodeEditorService } from '../../../../editor/browser/services/codeEditorService.js';
import { localize } from '../../../../nls.js';
import { MenuId } from '../../../../platform/actions/common/actions.js';
import { AgentMode } from '../../../../platform/aideAgent/common/model.js';
import { IAIModelSelectionService } from '../../../../platform/aiModel/common/aiModels.js';
import { IContextKey, IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { IContextMenuService } from '../../../../platform/contextview/browser/contextView.js';
import { ITextResourceEditorInput } from '../../../../platform/editor/common/editor.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { ServiceCollection } from '../../../../platform/instantiation/common/serviceCollection.js';
import { WorkbenchObjectTree } from '../../../../platform/list/browser/listService.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { IViewsService } from '../../../services/views/common/viewsService.js';
import { ChatAgentLocation, IAideAgentAgentService, IChatAgentCommand, IChatAgentData, IChatWelcomeMessageContent } from '../common/aideAgentAgents.js';
import { IAideAgentCodeEditingService } from '../common/aideAgentCodeEditingService.js';
import { CONTEXT_CHAT_INPUT_HAS_AGENT, CONTEXT_CHAT_IN_PASSTHROUGH_WIDGET, CONTEXT_CHAT_LAST_ITEM_ID, CONTEXT_CHAT_LOCATION, CONTEXT_CHAT_REQUEST_IN_PROGRESS, CONTEXT_CHAT_SESSION_WITH_EDITS, CONTEXT_IN_CHAT_SESSION, CONTEXT_PARTICIPANT_SUPPORTS_MODEL_PICKER, CONTEXT_RESPONSE_FILTERED } from '../common/aideAgentContextKeys.js';
import { AgentScope, IChatModel, IChatProgressResponseContent, IChatRequestVariableEntry, IChatResponseModel } from '../common/aideAgentModel.js';
import { ChatRequestAgentPart, IParsedChatRequest, formatChatQuestion } from '../common/aideAgentParserTypes.js';
import { ChatRequestParser } from '../common/aideAgentRequestParser.js';
import { IAideAgentService, IChatLocationData } from '../common/aideAgentService.js';
import { ChatViewModel, IChatResponseViewModel, isRequestVM, isResponseVM } from '../common/aideAgentViewModel.js';
import { CodeBlockModelCollection } from '../common/codeBlockModelCollection.js';
import { ChatTreeItem, IAideAgentAccessibilityService, IAideAgentWidgetService, IChatCodeBlockInfo, IChatFileTreeInfo, IChatListItemRendererOptions, IChatWidget, IChatWidgetViewContext, IChatWidgetViewOptions, showChatView } from './aideAgent.js';
import { ChatAccessibilityProvider } from './aideAgentAccessibilityProvider.js';
import { AideAgentAttachmentModel } from './aideAgentAttachmentModel.js';
import { AideAgentEditPreviewWidget } from './aideAgentEditPreviewWidget.js';
import { ChatInputPart } from './aideAgentInputPart.js';
import { ChatListDelegate, ChatListItemRenderer, IChatRendererDelegate } from './aideAgentListRenderer.js';
import { ChatEditorOptions } from './aideAgentOptions.js';
import { invokePlanView } from './aideAgentPlan.js';
import './media/aideAgent.css';
import './media/aideAgentViewWelcome.css';
import { ChatViewWelcomePart } from './viewsWelcome/chatViewWelcomeController.js';

const $ = dom.$;

export type IChatInputState = Record<string, any>;
export interface IChatViewState {
	inputValue?: string;
	inputState?: IChatInputState;
}

export interface IChatWidgetStyles {
	listForeground: string;
	listBackground: string;
	overlayBackground: string;
	inputEditorBackground: string;
	resultEditorBackground: string;
}

export interface IChatWidgetContrib extends IDisposable {
	readonly id: string;

	/**
	 * A piece of state which is related to the input editor of the chat widget
	 */
	getInputState?(): any;

	/**
	 * Called with the result of getInputState when navigating input history.
	 */
	setInputState?(s: any): void;
}

export interface IChatWidgetLocationOptions {
	location: ChatAgentLocation;
	resolveData?(): IChatLocationData | undefined;
}

export type IChatWidgetCompletionContext = 'default' | 'files' | 'code';

export class ChatWidget extends Disposable implements IChatWidget {
	public static readonly CONTRIBS: { new(...args: [IChatWidget, ...any]): IChatWidgetContrib }[] = [];

	private readonly _onDidSubmitAgent = this._register(new Emitter<{ agent: IChatAgentData; slashCommand?: IChatAgentCommand }>());
	public readonly onDidSubmitAgent = this._onDidSubmitAgent.event;

	private _onDidChangeAgent = this._register(new Emitter<{ agent: IChatAgentData; slashCommand?: IChatAgentCommand }>());
	readonly onDidChangeAgent = this._onDidChangeAgent.event;

	private _onDidFocus = this._register(new Emitter<void>());
	readonly onDidFocus = this._onDidFocus.event;

	private _onDidChangeViewModel = this._register(new Emitter<void>());
	readonly onDidChangeViewModel = this._onDidChangeViewModel.event;

	private _onDidScroll = this._register(new Emitter<void>());
	readonly onDidScroll = this._onDidScroll.event;

	private _onDidClear = this._register(new Emitter<void>());
	readonly onDidClear = this._onDidClear.event;

	private _onDidAcceptInput = this._register(new Emitter<void>());
	readonly onDidAcceptInput = this._onDidAcceptInput.event;

	private _onDidChangeContext = this._register(new Emitter<{ removed?: IChatRequestVariableEntry[]; added?: IChatRequestVariableEntry[] }>());
	readonly onDidChangeContext = this._onDidChangeContext.event;

	private _onDidHide = this._register(new Emitter<void>());
	readonly onDidHide = this._onDidHide.event;

	private _onDidChangeParsedInput = this._register(new Emitter<void>());
	readonly onDidChangeParsedInput = this._onDidChangeParsedInput.event;

	private readonly _onWillMaybeChangeHeight = new Emitter<void>();
	readonly onWillMaybeChangeHeight: Event<void> = this._onWillMaybeChangeHeight.event;

	private _onDidChangeHeight = this._register(new Emitter<number>());
	readonly onDidChangeHeight = this._onDidChangeHeight.event;

	private readonly _onDidChangeContentHeight = new Emitter<void>();
	readonly onDidChangeContentHeight: Event<void> = this._onDidChangeContentHeight.event;

	private contribs: ReadonlyArray<IChatWidgetContrib> = [];

	private tree!: WorkbenchObjectTree<ChatTreeItem>;
	private renderer!: ChatListItemRenderer;
	private readonly _codeBlockModelCollection: CodeBlockModelCollection;
	private lastItem: ChatTreeItem | undefined;

	private inputPart!: ChatInputPart;
	private editorOptions!: ChatEditorOptions;

	private listContainer!: HTMLElement;
	private container!: HTMLElement;
	private welcomeMessageContainer!: HTMLElement;
	private persistedWelcomeMessage: IChatWelcomeMessageContent | undefined;

	private editPreviewContainer!: HTMLElement;
	private editPreviewWidget: AideAgentEditPreviewWidget | undefined;

	private bodyDimension: dom.Dimension | undefined;
	private visibleChangeCount = 0;
	private requestInProgress: IContextKey<boolean>;
	private agentInInput: IContextKey<boolean>;
	private agentSupportsModelPicker: IContextKey<boolean>;
	private sessionHasEdits: IContextKey<boolean>;

	private _visible = false;
	public get visible() {
		return this._visible;
	}

	private previousTreeScrollHeight: number = 0;

	private readonly viewModelDisposables = this._register(new DisposableStore());
	private _viewModel: ChatViewModel | undefined;
	private set viewModel(viewModel: ChatViewModel | undefined) {
		if (this._viewModel === viewModel) {
			return;
		}

		this.viewModelDisposables.clear();

		this._viewModel = viewModel;
		if (viewModel) {
			this.viewModelDisposables.add(viewModel);
		}

		this._onDidChangeViewModel.fire();
	}

	get viewModel() {
		return this._viewModel;
	}

	private parsedChatRequest: IParsedChatRequest | undefined;
	get parsedInput() {
		if (this.parsedChatRequest === undefined) {
			this.parsedChatRequest = this.instantiationService.createInstance(ChatRequestParser).parseChatRequest(this.viewModel!.sessionId, this.getInput(), this.location, { selectedAgent: this._lastSelectedAgent });
		}

		return this.parsedChatRequest;
	}

	get scopedContextKeyService(): IContextKeyService {
		return this.contextKeyService;
	}

	private readonly _location: IChatWidgetLocationOptions;

	get location() {
		return this._location.location;
	}

	readonly viewContext: IChatWidgetViewContext;

	constructor(
		location: ChatAgentLocation | IChatWidgetLocationOptions,
		_viewContext: IChatWidgetViewContext | undefined,
		private readonly viewOptions: IChatWidgetViewOptions,
		private readonly styles: IChatWidgetStyles,
		@ICodeEditorService codeEditorService: ICodeEditorService,
		@IContextKeyService private readonly contextKeyService: IContextKeyService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IAideAgentService private readonly chatService: IAideAgentService,
		@IAideAgentAgentService private readonly chatAgentService: IAideAgentAgentService,
		@IAideAgentWidgetService chatWidgetService: IAideAgentWidgetService,
		@IAideAgentCodeEditingService private readonly codeEditingService: IAideAgentCodeEditingService,
		@IContextMenuService private readonly contextMenuService: IContextMenuService,
		@IAideAgentAccessibilityService private readonly chatAccessibilityService: IAideAgentAccessibilityService,
		@ILogService private readonly logService: ILogService,
		@IThemeService private readonly themeService: IThemeService,
		@IViewsService private readonly viewsService: IViewsService,
		@IAIModelSelectionService private readonly modelSelectionService: IAIModelSelectionService,
		@INotificationService private readonly notificationService: INotificationService,
	) {
		super();

		this.viewContext = _viewContext ?? {};

		if (typeof location === 'object') {
			this._location = location;
		} else {
			this._location = { location };
		}

		CONTEXT_CHAT_IN_PASSTHROUGH_WIDGET.bindTo(contextKeyService).set('isPassthrough' in this.viewContext && this.viewContext.isPassthrough);
		CONTEXT_IN_CHAT_SESSION.bindTo(contextKeyService).set(true);
		CONTEXT_CHAT_LOCATION.bindTo(contextKeyService).set(this._location.location);
		this.agentInInput = CONTEXT_CHAT_INPUT_HAS_AGENT.bindTo(contextKeyService);
		this.agentSupportsModelPicker = CONTEXT_PARTICIPANT_SUPPORTS_MODEL_PICKER.bindTo(contextKeyService);
		this.requestInProgress = CONTEXT_CHAT_REQUEST_IN_PROGRESS.bindTo(contextKeyService);
		this.sessionHasEdits = CONTEXT_CHAT_SESSION_WITH_EDITS.bindTo(contextKeyService);

		this._register((chatWidgetService as ChatWidgetService).register(this));

		this._codeBlockModelCollection = this._register(instantiationService.createInstance(CodeBlockModelCollection));

		this._register(codeEditorService.registerCodeEditorOpenHandler(async (input: ITextResourceEditorInput, _source: ICodeEditor | null, _sideBySide?: boolean): Promise<ICodeEditor | null> => {
			const resource = input.resource;
			if (resource.scheme !== Schemas.vscodeAideAgentCodeBlock) {
				return null;
			}

			const responseId = resource.path.split('/').at(1);
			if (!responseId) {
				return null;
			}

			const item = this.viewModel?.getItems().find(item => item.id === responseId);
			if (!item) {
				return null;
			}

			// TODO: needs to reveal the chat view

			this.reveal(item);

			await timeout(0); // wait for list to actually render

			for (const codeBlockPart of this.renderer.editorsInUse()) {
				if (extUri.isEqual(codeBlockPart.uri, resource, true)) {
					const editor = codeBlockPart.editor;

					let relativeTop = 0;
					const editorDomNode = editor.getDomNode();
					if (editorDomNode) {
						const row = dom.findParentWithClass(editorDomNode, 'monaco-list-row');
						if (row) {
							relativeTop = dom.getTopLeftOffset(editorDomNode).top - dom.getTopLeftOffset(row).top;
						}
					}

					if (input.options?.selection) {
						const editorSelectionTopOffset = editor.getTopForPosition(input.options.selection.startLineNumber, input.options.selection.startColumn);
						relativeTop += editorSelectionTopOffset;

						editor.focus();
						editor.setSelection({
							startLineNumber: input.options.selection.startLineNumber,
							startColumn: input.options.selection.startColumn,
							endLineNumber: input.options.selection.endLineNumber ?? input.options.selection.startLineNumber,
							endColumn: input.options.selection.endColumn ?? input.options.selection.startColumn
						});
					}

					this.reveal(item, relativeTop);

					return editor;
				}
			}
			return null;
		}));

		this._register(this.chatService.onDidDisposeSession(() => {
			this.hideEditPreviewWidget();
		}));

		this._register(this.codeEditingService.onDidComplete(() => {
			this.hideEditPreviewWidget();
			this.inputPart.inputEditor.focus();
		}));
	}

	private hideEditPreviewWidget() {
		if (this.editPreviewWidget) {
			this.editPreviewWidget.clear();
			this.editPreviewWidget.visible = false;
		}
	}

	private _lastSelectedAgent: IChatAgentData | undefined;
	set lastSelectedAgent(agent: IChatAgentData | undefined) {
		this.parsedChatRequest = undefined;
		this._lastSelectedAgent = agent;
		this._onDidChangeParsedInput.fire();
	}

	get lastSelectedAgent(): IChatAgentData | undefined {
		return this._lastSelectedAgent;
	}

	get supportsFileReferences(): boolean {
		return !!this.viewOptions.supportsFileReferences;
	}

	get input(): ChatInputPart {
		return this.inputPart;
	}

	get inputEditor(): ICodeEditor {
		return this.inputPart.inputEditor;
	}

	get inputUri(): URI {
		return this.inputPart.inputUri;
	}

	get contentHeight(): number {
		return this.inputPart.contentHeight + this.tree.contentHeight;
	}

	get attachmentModel(): AideAgentAttachmentModel {
		return this.inputPart.attachmentModel;
	}

	get mode(): AgentMode {
		return this.inputPart.mode;
	}

	render(parent: HTMLElement): void {
		const viewId = 'viewId' in this.viewContext ? this.viewContext.viewId : undefined;
		this.editorOptions = this._register(this.instantiationService.createInstance(ChatEditorOptions, viewId, this.styles.listForeground, this.styles.inputEditorBackground, this.styles.resultEditorBackground));
		const renderInputOnTop = this.viewOptions.renderInputOnTop ?? false;
		const renderFollowups = this.viewOptions.renderFollowups ?? !renderInputOnTop;
		const renderStyle = this.viewOptions.renderStyle;

		this.container = dom.append(parent, $('.interactive-session'));
		this.welcomeMessageContainer = dom.append(this.container, $('.chat-welcome-view-container', { style: 'display: none' }));
		this.renderWelcomeViewContentIfNeeded();
		if (renderInputOnTop) {
			this.createInput(this.container, { renderFollowups, renderStyle });
			this.listContainer = dom.append(this.container, $(`.interactive-list`));
			this.editPreviewContainer = dom.append(this.container, $(`.edit-preview`));
		} else {
			this.listContainer = dom.append(this.container, $(`.interactive-list`));
			this.editPreviewContainer = dom.append(this.container, $(`.edit-preview`));
			this.createInput(this.container, { renderFollowups, renderStyle });
		}

		this.createList(this.listContainer, { ...this.viewOptions.rendererOptions, renderStyle });
		if (!('isPassthrough' in this.viewContext) || !this.viewContext.isPassthrough) {
			this.createEditPreviewWidget(this.editPreviewContainer);
		}

		this._register(this.editorOptions.onDidChange(() => this.onDidStyleChange()));
		this.onDidStyleChange();

		// Do initial render
		if (this.viewModel) {
			this.onDidChangeItems();
			this.scrollToEnd();
		}

		this.contribs = ChatWidget.CONTRIBS.map(contrib => {
			try {
				return this._register(this.instantiationService.createInstance(contrib, this));
			} catch (err) {
				this.logService.error('Failed to instantiate chat widget contrib', toErrorMessage(err));
				return undefined;
			}
		}).filter(isDefined);
	}

	private scrollToEnd() {
		if (this.lastItem) {
			const offset = Math.max(this.lastItem.currentRenderedHeight ?? 0, 1e6);
			this.tree.reveal(this.lastItem, offset);
		}
	}

	getContrib<T extends IChatWidgetContrib>(id: string): T | undefined {
		return this.contribs.find(c => c.id === id) as T;
	}

	focusInput(): void {
		this.inputPart.focus();
	}

	hasInputFocus(): boolean {
		return this.inputPart.hasFocus();
	}

	getSibling(item: ChatTreeItem, type: 'next' | 'previous'): ChatTreeItem | undefined {
		if (!isResponseVM(item)) {
			return;
		}
		const items = this.viewModel?.getItems();
		if (!items) {
			return;
		}
		const responseItems = items.filter(i => isResponseVM(i));
		const targetIndex = responseItems.indexOf(item);
		if (targetIndex === undefined) {
			return;
		}
		const indexToFocus = type === 'next' ? targetIndex + 1 : targetIndex - 1;
		if (indexToFocus < 0 || indexToFocus > responseItems.length - 1) {
			return;
		}
		return responseItems[indexToFocus];
	}

	clear(): void {
		if (this._dynamicMessageLayoutData) {
			this._dynamicMessageLayoutData.enabled = true;
		}
		this._onDidClear.fire();
	}

	private onDidChangeItems(skipDynamicLayout?: boolean) {
		const vmItems = this.viewModel?.getItems() ?? [];
		if (this.tree && this._visible) {
			const treeItems = vmItems
				.map((item): ITreeElement<ChatTreeItem> => {
					return {
						element: item,
						collapsed: false,
						collapsible: false
					};
				});

			this.renderWelcomeViewContentIfNeeded();

			this._onWillMaybeChangeHeight.fire();

			this.lastItem = treeItems.at(-1)?.element;
			CONTEXT_CHAT_LAST_ITEM_ID.bindTo(this.contextKeyService).set(this.lastItem ? [this.lastItem.id] : []);
			this.tree.setChildren(null, treeItems, {
				diffIdentityProvider: {
					getId: (element) => {
						return element.dataId +
							// Ensure re-rendering an element once slash commands are loaded, so the colorization can be applied.
							`${(isRequestVM(element)) /* && !!this.lastSlashCommands ? '_scLoaded' : '' */}` +
							`${(isResponseVM(element)) && element.isLast ? `_last` : ''}` +
							// If a response is in the process of progressive rendering, we need to ensure that it will
							// be re-rendered so progressive rendering is restarted, even if the model wasn't updated.
							`${isResponseVM(element) && element.renderData ? `_${this.visibleChangeCount}` : ''}` +
							// Re-render once content references are loaded
							(isResponseVM(element) ? `_${element.contentReferences.length}` : '') +
							// Rerender request if we got new content references in the response
							// since this may change how we render the corresponding attachments in the request
							(isRequestVM(element) && element.contentReferences ? `_${element.contentReferences?.length}` : '');
					},
				}
			});

			if (!skipDynamicLayout && this._dynamicMessageLayoutData) {
				this.layoutDynamicChatTreeItemMode();
			}
		}

		if (this.editPreviewWidget) {
			const progressStages = vmItems
				.filter(i => isResponseVM(i))
				.flatMap(i => i.response.value.map(progress => ({ progress, exchangeId: i.id })))
				.filter(i => i.progress.kind === 'stage');
			const lastProgressStage = progressStages.pop();
			if (lastProgressStage && lastProgressStage.exchangeId === this.chatService.lastExchangeId) {
				const entry = lastProgressStage?.progress as IChatProgressResponseContent & { kind: 'stage' };
				this.editPreviewWidget.updateProgress(entry.message);
			}
		}
	}

	private renderWelcomeViewContentIfNeeded() {
		const welcomeContent = this.viewModel?.model.welcomeMessage ?? this.persistedWelcomeMessage;
		if (welcomeContent && this.welcomeMessageContainer.children.length === 0 && !this.viewOptions.renderStyle) {
			const tips = new MarkdownString(localize('chatWidget.tips.withoutParticipants', "{0} or type {1} to attach context", '$(attach)', '@'), { supportThemeIcons: true });
			const welcomePart = this._register(this.instantiationService.createInstance(
				ChatViewWelcomePart,
				{ ...welcomeContent, tips, },
				{ location: this.location }
			));
			dom.append(this.welcomeMessageContainer, welcomePart.element);
		}

		if (!this.viewOptions.renderStyle && this.viewModel) {
			const treeItems = this.viewModel.getItems();
			dom.setVisibility(treeItems.length === 0, this.welcomeMessageContainer);
			dom.setVisibility(treeItems.length !== 0, this.listContainer);
		}
	}

	/* TODO(@ghostwriternr): Remove this when we get rid of followups
	private async renderFollowups(items: IChatFollowup[] | undefined, response?: IChatResponseViewModel): Promise<void> {
		this.inputPart.renderFollowups(items, response);

		if (this.bodyDimension) {
			this.layout(this.bodyDimension.height, this.bodyDimension.width);
		}
	}
	*/

	setVisible(visible: boolean): void {
		const wasVisible = this._visible;
		this._visible = visible;
		this.visibleChangeCount++;
		this.renderer.setVisible(visible);
		this.input.setVisible(visible);

		if (visible) {
			this._register(disposableTimeout(() => {
				// Progressive rendering paused while hidden, so start it up again.
				// Do it after a timeout because the container is not visible yet (it should be but offsetHeight returns 0 here)
				if (this._visible) {
					this.onDidChangeItems(true);
				}
			}, 0));
		} else if (wasVisible) {
			this._onDidHide.fire();
		}
	}

	private createList(listContainer: HTMLElement, options: IChatListItemRendererOptions): void {
		const scopedInstantiationService = this._register(this._register(this.instantiationService.createChild(new ServiceCollection([IContextKeyService, this.contextKeyService]))));
		const delegate = scopedInstantiationService.createInstance(ChatListDelegate, this.viewOptions.defaultElementHeight ?? 200);
		const rendererDelegate: IChatRendererDelegate = {
			getListLength: () => this.tree.getNode(null).visibleChildrenCount,
			onDidScroll: this.onDidScroll,
		};

		// Create a dom element to hold UI from editor widgets embedded in chat messages
		const overflowWidgetsContainer = document.createElement('div');
		overflowWidgetsContainer.classList.add('chat-overflow-widget-container', 'monaco-editor');
		listContainer.append(overflowWidgetsContainer);

		this.renderer = this._register(scopedInstantiationService.createInstance(
			ChatListItemRenderer,
			this.editorOptions,
			options,
			rendererDelegate,
			this._codeBlockModelCollection,
			overflowWidgetsContainer,
		));
		/* TODO(@ghostwriternr): This was used for followups, but not sure if it's needed anymore.
		this._register(this.renderer.onDidClickFollowup(item => {
			this.acceptInput(item.message);
		}));
		*/
		this._register(this.renderer.onDidClickRerunWithAgentOrCommandDetection(item => {
			/* TODO(@ghostwriternr): Commenting this out definitely breaks rerunning requests. Fix this.
			const request = this.chatService.getSession(item.sessionId)?.getExchanges().find(candidate => candidate.id === item.requestId);
			if (request) {
				this.chatService.resendRequest(request, { noCommandDetection: true, attempt: request.attempt + 1, location: this.location }).catch(e => this.logService.error('FAILED to rerun request', e));
			}
			*/
		}));

		this.tree = this._register(<WorkbenchObjectTree<ChatTreeItem>>scopedInstantiationService.createInstance(
			WorkbenchObjectTree,
			'Chat',
			listContainer,
			delegate,
			[this.renderer],
			{
				identityProvider: { getId: (e: ChatTreeItem) => e.id },
				horizontalScrolling: false,
				alwaysConsumeMouseWheel: false,
				supportDynamicHeights: true,
				hideTwistiesOfChildlessElements: true,
				accessibilityProvider: this.instantiationService.createInstance(ChatAccessibilityProvider),
				keyboardNavigationLabelProvider: { getKeyboardNavigationLabel: (e: ChatTreeItem) => isRequestVM(e) ? e.message : isResponseVM(e) ? e.response.value : '' }, // TODO
				setRowLineHeight: false,
				filter: this.viewOptions.filter ? { filter: this.viewOptions.filter.bind(this.viewOptions), } : undefined,
				overrideStyles: {
					listFocusBackground: this.styles.listBackground,
					listInactiveFocusBackground: this.styles.listBackground,
					listActiveSelectionBackground: this.styles.listBackground,
					listFocusAndSelectionBackground: this.styles.listBackground,
					listInactiveSelectionBackground: this.styles.listBackground,
					listHoverBackground: this.styles.listBackground,
					listBackground: this.styles.listBackground,
					listFocusForeground: this.styles.listForeground,
					listHoverForeground: this.styles.listForeground,
					listInactiveFocusForeground: this.styles.listForeground,
					listInactiveSelectionForeground: this.styles.listForeground,
					listActiveSelectionForeground: this.styles.listForeground,
					listFocusAndSelectionForeground: this.styles.listForeground,
					listActiveSelectionIconForeground: undefined,
					listInactiveSelectionIconForeground: undefined,
				}
			}));
		this._register(this.tree.onContextMenu(e => this.onContextMenu(e)));

		this._register(this.tree.onDidChangeContentHeight(() => {
			this.onDidChangeTreeContentHeight();
		}));
		this._register(this.renderer.onDidChangeItemHeight(e => {
			this.tree.updateElementHeight(e.element, e.height);
		}));
		this._register(this.tree.onDidFocus(() => {
			this._onDidFocus.fire();
		}));
		this._register(this.tree.onDidScroll(() => {
			this._onDidScroll.fire();
		}));
	}

	private createEditPreviewWidget(container: HTMLElement): void {
		this.editPreviewWidget = this._register(this.instantiationService.createInstance(AideAgentEditPreviewWidget, container));
		this._register(this.editPreviewWidget.onDidChangeHeight(() => {
			if (this.bodyDimension) {
				this.layout(this.bodyDimension.height, this.bodyDimension.width);
			}
		}));
	}

	private onContextMenu(e: ITreeContextMenuEvent<ChatTreeItem | null>): void {
		e.browserEvent.preventDefault();
		e.browserEvent.stopPropagation();

		const selected = e.element;
		const scopedContextKeyService = this.contextKeyService.createOverlay([
			[CONTEXT_RESPONSE_FILTERED.key, isResponseVM(selected) && !!selected.errorDetails?.responseIsFiltered]
		]);
		this.contextMenuService.showContextMenu({
			menuId: MenuId.AideAgentContext,
			menuActionOptions: { shouldForwardArgs: true },
			contextKeyService: scopedContextKeyService,
			getAnchor: () => e.anchor,
			getActionsContext: () => selected,
		});
	}

	private onDidChangeTreeContentHeight(): void {
		if (this.tree.scrollHeight !== this.previousTreeScrollHeight) {
			// Due to rounding, the scrollTop + renderHeight will not exactly match the scrollHeight.
			// Consider the tree to be scrolled all the way down if it is within 2px of the bottom.
			const lastElementWasVisible = this.tree.scrollTop + this.tree.renderHeight >= this.previousTreeScrollHeight - 2;
			if (lastElementWasVisible) {
				dom.scheduleAtNextAnimationFrame(dom.getWindow(this.listContainer), () => {
					// Can't set scrollTop during this event listener, the list might overwrite the change
					this.scrollToEnd();
				}, 0);
			}
		}

		this.previousTreeScrollHeight = this.tree.scrollHeight;
		this._onDidChangeContentHeight.fire();
	}

	private createInput(container: HTMLElement, options?: { renderFollowups: boolean; renderStyle?: 'default' | 'compact' | 'minimal' }): void {
		this.inputPart = this._register(this.instantiationService.createInstance(ChatInputPart,
			this.location,
			{
				renderFollowups: options?.renderFollowups ?? true,
				renderStyle: options?.renderStyle === 'minimal' ? 'compact' : options?.renderStyle,
				menus: { executeToolbar: MenuId.AideAgentExecute, ...this.viewOptions.menus },
				editorOverflowWidgetsDomNode: this.viewOptions.editorOverflowWidgetsDomNode,
				preventChatEditToggle: 'isPassthrough' in this.viewContext && this.viewContext.isPassthrough
			},
			() => this.collectInputState()
		));
		this.inputPart.render(container, '', this);

		this._register(this.inputPart.onDidLoadInputState(state => {
			this.contribs.forEach(c => {
				if (c.setInputState) {
					const contribState = (typeof state === 'object' && state?.[c.id]) ?? {};
					c.setInputState(contribState);
				}
			});
		}));
		this._register(this.inputPart.onDidFocus(() => this._onDidFocus.fire()));
		this._register(this.inputPart.onDidChangeContext((e) => this._onDidChangeContext.fire(e)));
		/* TODO(@ghostwriternr): This was used for followups, but not sure if it's needed anymore.
		this._register(this.inputPart.onDidAcceptFollowup(e => {
			if (!this.viewModel) {
				return;
			}

			let msg = '';
			if (e.followup.agentId && e.followup.agentId !== this.chatAgentService.getDefaultAgent(this.location)?.id) {
				const agent = this.chatAgentService.getAgent(e.followup.agentId);
				if (!agent) {
					return;
				}

				this.lastSelectedAgent = agent;
				msg = `${chatAgentLeader}${agent.name} `;
				if (e.followup.subCommand) {
					msg += `${chatSubcommandLeader}${e.followup.subCommand} `;
				}
			} else if (!e.followup.agentId && e.followup.subCommand && this.chatSlashCommandService.hasCommand(e.followup.subCommand)) {
				msg = `${chatSubcommandLeader}${e.followup.subCommand} `;
			}

			msg += e.followup.message;
			this.acceptInput(msg);

			if (!e.response) {
				// Followups can be shown by the welcome message, then there is no response associated.
				// At some point we probably want telemetry for these too.
				return;
			}

			this.chatService.notifyUserAction({
				sessionId: this.viewModel.sessionId,
				// requestId: e.response.requestId,
				// TODO(@ghostwriternr): This is obviously wrong, but not super critical. Come back to fix this.
				requestId: e.response.id,
				agentId: e.response.agent?.id,
				command: e.response.slashCommand?.name,
				result: e.response.result,
				action: {
					kind: 'followUp',
					followup: e.followup
				},
			});
		}));
		*/
		this._register(this.inputPart.onDidChangeHeight(() => {
			if (this.bodyDimension) {
				this.layout(this.bodyDimension.height, this.bodyDimension.width);
			}
			this._onDidChangeContentHeight.fire();
		}));
		this._register(this.inputEditor.onDidChangeModelContent(() => {
			this.parsedChatRequest = undefined;
			this.updateChatInputContext();
		}));
		this._register(this.chatAgentService.onDidChangeAgents(() => this.parsedChatRequest = undefined));
	}

	private onDidStyleChange(): void {
		this.container.style.setProperty('--vscode-interactive-result-editor-background-color', this.editorOptions.configuration.resultEditor.backgroundColor?.toString() ?? '');
		this.container.style.setProperty('--vscode-interactive-session-foreground', this.editorOptions.configuration.foreground?.toString() ?? '');
		this.container.style.setProperty('--vscode-chat-list-background', this.themeService.getColorTheme().getColor(this.styles.listBackground)?.toString() ?? '');
	}

	setModel(model: IChatModel, viewState: IChatViewState): void {
		if (!this.container) {
			throw new Error('Call render() before setModel()');
		}

		if (model.sessionId === this.viewModel?.sessionId) {
			return;
		}

		this._codeBlockModelCollection.clear();

		this.container.setAttribute('data-session-id', model.sessionId);
		this.viewModel = this.instantiationService.createInstance(ChatViewModel, model, this._codeBlockModelCollection);
		this.viewModelDisposables.add(Event.accumulate(this.viewModel.onDidChange, 0)(events => {
			if (!this.viewModel) {
				return;
			}

			const isRequestInProgress = this.viewModel.requestInProgress;
			this.requestInProgress.set(isRequestInProgress);

			this.onDidChangeItems();
			if (events.some(e => e?.kind === 'addRequest') && this.visible) {
				this.scrollToEnd();
				this.focusInput();
			}

			const activeCodeEditingSession = this.codeEditingService.getExistingCodeEditingSession(model.sessionId);
			if (this.editPreviewWidget && activeCodeEditingSession) {
				const edits = activeCodeEditingSession.codeEdits;
				this.editPreviewWidget?.setCodeEdits(edits);

				this.sessionHasEdits.set(edits.size > 0);
			} else {
				this.sessionHasEdits.set(false);
			}
		}));
		this.viewModelDisposables.add(this.viewModel.onDidDisposeModel(() => {
			// Ensure that view state is saved here, because we will load it again when a new model is assigned
			this.inputPart.saveState();

			// Disposes the viewmodel and listeners
			this.viewModel = undefined;
			this.onDidChangeItems();
		}));
		this.inputPart.initForNewChatModel(viewState.inputValue, viewState.inputState ?? this.collectInputState());
		this.contribs.forEach(c => {
			if (c.setInputState && viewState.inputState?.[c.id]) {
				c.setInputState(viewState.inputState?.[c.id]);
			}
		});
		this.viewModelDisposables.add(model.onDidChange(async (e) => {
			if (e.kind === 'setAgent') {
				this._onDidChangeAgent.fire({ agent: e.agent, slashCommand: e.command });
			} else if (e.kind === 'startPlan') {
				const planWidget = await invokePlanView(this.viewsService);
				if (planWidget) {
					planWidget.setModel(e.plan);
					planWidget.setVisible(true);
				}
			}
		}));

		if (this.tree) {
			this.onDidChangeItems();
			this.scrollToEnd();
		}
		this.updateChatInputContext();
	}

	getFocus(): ChatTreeItem | undefined {
		return this.tree.getFocus()[0] ?? undefined;
	}

	reveal(item: ChatTreeItem, relativeTop?: number): void {
		this.tree.reveal(item, relativeTop);
	}

	focus(item: ChatTreeItem): void {
		const items = this.tree.getNode(null).children;
		const node = items.find(i => i.element?.id === item.id);
		if (!node) {
			return;
		}

		this.tree.setFocus([node.element]);
		this.tree.domFocus();
	}

	refilter() {
		this.tree.refilter();
	}

	setInputPlaceholder(placeholder: string): void {
		this.viewModel?.setInputPlaceholder(placeholder);
	}

	resetInputPlaceholder(): void {
		this.viewModel?.resetInputPlaceholder();
	}

	setInput(value = ''): void {
		this.inputPart.setValue(value, false);
	}

	getInput(): string {
		return this.inputPart.inputEditor.getValue();
	}

	logInputHistory(): void {
		this.inputPart.logInputHistory();
	}

	async acceptInput(mode: AgentMode, query?: string): Promise<IChatResponseModel | undefined> {
		return this._acceptInput(query && mode ? { query, mode } : undefined);
	}

	private collectInputState(): IChatInputState {
		const inputState: IChatInputState = {};
		this.contribs.forEach(c => {
			if (c.getInputState) {
				inputState[c.id] = c.getInputState();
			}
		});
		return inputState;
	}

	private async _acceptInput(opts: { query: string; mode: AgentMode } | undefined): Promise<IChatResponseModel | undefined> {
		if (this.viewModel) {
			this.editPreviewWidget?.updateProgress('Thinking...');
			const editorValue = this.getInput();
			if ('isPassthrough' in this.viewContext && this.viewContext.isPassthrough) {
				const widget = await showChatView(this.viewsService);
				if (!widget?.viewModel || !this.viewModel) {
					return;
				}

				const mode = this.inputPart.mode;
				widget.transferQueryState(mode, this.inputPart.currentAgentScope);
				widget.acceptInput(mode, editorValue);
				widget.focusInput();
				this._onDidAcceptInput.fire();
				return;
			}

			this._onDidAcceptInput.fire();
			const requestId = this.chatAccessibilityService.acceptRequest();
			const input = !opts ? editorValue :
				'query' in opts ? opts.query :
					editorValue;
			const isUserQuery = true; // we don't support non-user queries at the moment
			let agentMode = AgentMode.Chat;
			if (opts && 'mode' in opts) {
				agentMode = opts.mode;
			}

			// This is also tied to just the edit and to nothing else right now
			// which kind of feels weird ngl
			let agentScope = this.inputPart.currentAgentScope;
			// If we are inPassthrough which implies a floating widget then
			// our scope is always Selection
			if ('isPassthrough' in this.viewContext && this.viewContext.isPassthrough) {
				agentScope = AgentScope.Selection;
			}

			this.requestInProgress.set(true);

			const configValidation = await this.modelSelectionService.validateCurrentModelSelection();
			if (!configValidation.valid) {
				this.requestInProgress.set(false);
				const errorMessage = localize('editModelConfiguration.modelConfigError', "There is an issue with your \`modelSelection.json\`: \"{0}\"", configValidation.error || 'Invalid configuration');
				this.notificationService.warn(errorMessage);
			} else {
				const result = await this.chatService.sendRequest(this.viewModel.sessionId, input, {
					agentMode,
					agentScope,
					userSelectedModelId: this.inputPart.currentLanguageModel,
					location: this.location,
					locationData: this._location.resolveData?.(),
					parserContext: { selectedAgent: this._lastSelectedAgent },
					attachedContext: [...this.inputPart.attachmentModel.attachments]
				});

				if (result) {
					this.inputPart.acceptInput(isUserQuery);
					this._onDidSubmitAgent.fire({ agent: result.agent, slashCommand: result.slashCommand });
					result.responseCompletePromise.then(() => {
						const responses = this.viewModel?.getItems().filter(isResponseVM);
						const lastResponse = responses?.[responses.length - 1];
						this.chatAccessibilityService.acceptResponse(lastResponse, requestId);
						if (lastResponse?.result?.nextQuestion) {
							const { prompt, participant, command } = lastResponse.result.nextQuestion;
							const question = formatChatQuestion(this.chatAgentService, this.location, prompt, participant, command);
							if (question) {
								this.input.setValue(question, false);
							}
						}
					}).catch(() => {
						this.requestInProgress.set(false);
					});
					return result.responseCreatedPromise;
				} else {
					this.requestInProgress.set(false);
				}
			}
		}
		return undefined;
	}

	transferQueryState(mode: AgentMode, scope: AgentScope): void {
		this.inputPart.setMode(mode);
		this.inputPart.currentAgentScope = scope;
	}

	togglePlanning(): void {
		switch (this.inputPart.mode) {
			case AgentMode.Plan:
				this.inputPart.setMode(AgentMode.Edit, true);
				break;
			case AgentMode.Edit:
				this.inputPart.setMode(AgentMode.Plan, true);
				break;
		}
	}

	toggleEditMode(): void {
		switch (this.inputPart.mode) {
			case AgentMode.Edit:
			case AgentMode.Plan:
				this.inputPart.setMode(AgentMode.Agentic);
				break;
			case AgentMode.Agentic:
				this.inputPart.setMode(AgentMode.Chat);
				break;
			case AgentMode.Chat:
				this.inputPart.setMode(AgentMode.Edit);
				break;
		}
	}

	getCodeBlockInfosForResponse(response: IChatResponseViewModel): IChatCodeBlockInfo[] {
		return this.renderer.getCodeBlockInfosForResponse(response);
	}

	getCodeBlockInfoForEditor(uri: URI): IChatCodeBlockInfo | undefined {
		return this.renderer.getCodeBlockInfoForEditor(uri);
	}

	getFileTreeInfosForResponse(response: IChatResponseViewModel): IChatFileTreeInfo[] {
		return this.renderer.getFileTreeInfosForResponse(response);
	}

	getLastFocusedFileTreeForResponse(response: IChatResponseViewModel): IChatFileTreeInfo | undefined {
		return this.renderer.getLastFocusedFileTreeForResponse(response);
	}

	focusLastMessage(): void {
		if (!this.viewModel) {
			return;
		}

		const items = this.tree.getNode(null).children;
		const lastItem = items[items.length - 1];
		if (!lastItem) {
			return;
		}

		this.tree.setFocus([lastItem.element]);
		this.tree.domFocus();
	}

	layout(height: number, width: number): void {
		width = Math.min(width, 850);
		this.bodyDimension = new dom.Dimension(width, height);

		this.inputPart.layout(height, width);
		const inputPartHeight = this.inputPart.inputPartHeight;
		const lastElementVisible = this.tree.scrollTop + this.tree.renderHeight >= this.tree.scrollHeight - 2;
		const editPreviewWidgetHeight = this.editPreviewContainer.offsetHeight;

		const listHeight = Math.max(0, height - inputPartHeight - editPreviewWidgetHeight);

		this.tree.layout(listHeight, width);
		this.tree.getHTMLElement().style.height = `${listHeight}px`;

		// Push the welcome message down so it doesn't change position when followups appear
		this.welcomeMessageContainer.style.height = `${listHeight}px`;
		this.renderer.layout(width);

		const lastItem = this.viewModel?.getItems().at(-1);
		const lastResponseIsRendering = isResponseVM(lastItem) && lastItem.renderData;
		if (lastElementVisible && (!lastResponseIsRendering)) {
			this.scrollToEnd();
		}

		this.listContainer.style.height = `${listHeight}px`;

		this._onDidChangeHeight.fire(height);
	}

	private _dynamicMessageLayoutData?: { numOfMessages: number; maxHeight: number; enabled: boolean };

	// An alternative to layout, this allows you to specify the number of ChatTreeItems
	// you want to show, and the max height of the container. It will then layout the
	// tree to show that many items.
	// TODO@TylerLeonhardt: This could use some refactoring to make it clear which layout strategy is being used
	setDynamicChatTreeItemLayout(numOfChatTreeItems: number, maxHeight: number) {
		this._dynamicMessageLayoutData = { numOfMessages: numOfChatTreeItems, maxHeight, enabled: true };
		this._register(this.renderer.onDidChangeItemHeight(() => this.layoutDynamicChatTreeItemMode()));

		const mutableDisposable = this._register(new MutableDisposable());
		this._register(this.tree.onDidScroll((e) => {
			// TODO@TylerLeonhardt this should probably just be disposed when this is disabled
			// and then set up again when it is enabled again
			if (!this._dynamicMessageLayoutData?.enabled) {
				return;
			}
			mutableDisposable.value = dom.scheduleAtNextAnimationFrame(dom.getWindow(this.listContainer), () => {
				if (!e.scrollTopChanged || e.heightChanged || e.scrollHeightChanged) {
					return;
				}
				const renderHeight = e.height;
				const diff = e.scrollHeight - renderHeight - e.scrollTop;
				if (diff === 0) {
					return;
				}

				const possibleMaxHeight = (this._dynamicMessageLayoutData?.maxHeight ?? maxHeight);
				const width = this.bodyDimension?.width ?? this.container.offsetWidth;
				this.inputPart.layout(possibleMaxHeight, width);
				const inputPartHeight = this.inputPart.inputPartHeight;
				const newHeight = Math.min(renderHeight + diff, possibleMaxHeight - inputPartHeight);
				this.layout(newHeight + inputPartHeight, width);
			});
		}));
	}

	updateDynamicChatTreeItemLayout(numOfChatTreeItems: number, maxHeight: number) {
		this._dynamicMessageLayoutData = { numOfMessages: numOfChatTreeItems, maxHeight, enabled: true };
		let hasChanged = false;
		let height = this.bodyDimension!.height;
		let width = this.bodyDimension!.width;
		if (maxHeight < this.bodyDimension!.height) {
			height = maxHeight;
			hasChanged = true;
		}
		const containerWidth = this.container.offsetWidth;
		if (this.bodyDimension?.width !== containerWidth) {
			width = containerWidth;
			hasChanged = true;
		}
		if (hasChanged) {
			this.layout(height, width);
		}
	}

	get isDynamicChatTreeItemLayoutEnabled(): boolean {
		return this._dynamicMessageLayoutData?.enabled ?? false;
	}

	set isDynamicChatTreeItemLayoutEnabled(value: boolean) {
		if (!this._dynamicMessageLayoutData) {
			return;
		}
		this._dynamicMessageLayoutData.enabled = value;
	}

	layoutDynamicChatTreeItemMode(): void {
		if (!this.viewModel || !this._dynamicMessageLayoutData?.enabled) {
			return;
		}

		const width = this.bodyDimension?.width ?? this.container.offsetWidth;
		this.inputPart.layout(this._dynamicMessageLayoutData.maxHeight, width);
		const inputHeight = this.inputPart.inputPartHeight;

		const totalMessages = this.viewModel.getItems();
		// grab the last N messages
		const messages = totalMessages.slice(-this._dynamicMessageLayoutData.numOfMessages);

		const needsRerender = messages.some(m => m.currentRenderedHeight === undefined);
		const listHeight = needsRerender
			? this._dynamicMessageLayoutData.maxHeight
			: messages.reduce((acc, message) => acc + message.currentRenderedHeight!, 0);

		this.layout(
			Math.min(
				// we add an additional 18px in order to show that there is scrollable content
				inputHeight + listHeight + (totalMessages.length > 2 ? 18 : 0),
				this._dynamicMessageLayoutData.maxHeight
			),
			width
		);

		if (needsRerender || !listHeight) {
			// TODO: figure out a better place to reveal the last element
			this.scrollToEnd();
		}
	}

	saveState(): void {
		this.inputPart.saveState();
	}

	getViewState(): IChatViewState {
		return { inputValue: this.getInput(), inputState: this.collectInputState() };
	}

	private updateChatInputContext() {
		const currentAgent = this.parsedInput.parts.find(part => part instanceof ChatRequestAgentPart);
		this.agentInInput.set(!!currentAgent);
		this.agentSupportsModelPicker.set(!currentAgent || !!currentAgent.agent.supportsModelPicker);
	}
}

export class ChatWidgetService implements IAideAgentWidgetService {

	declare readonly _serviceBrand: undefined;

	private _widgets: ChatWidget[] = [];
	private _lastFocusedWidget: ChatWidget | undefined = undefined;

	get lastFocusedWidget(): ChatWidget | undefined {
		return this._lastFocusedWidget;
	}

	constructor() { }

	getWidgetByInputUri(uri: URI): ChatWidget | undefined {
		return this._widgets.find(w => isEqual(w.inputUri, uri));
	}

	getWidgetBySessionId(sessionId: string): ChatWidget | undefined {
		return this._widgets.find(w => w.viewModel?.sessionId === sessionId);
	}

	private setLastFocusedWidget(widget: ChatWidget | undefined): void {
		if (widget === this._lastFocusedWidget) {
			return;
		}

		this._lastFocusedWidget = widget;
	}

	register(newWidget: ChatWidget): IDisposable {
		if (this._widgets.some(widget => widget === newWidget)) {
			throw new Error('Cannot register the same widget multiple times');
		}

		this._widgets.push(newWidget);

		return combinedDisposable(
			newWidget.onDidFocus(() => this.setLastFocusedWidget(newWidget)),
			toDisposable(() => this._widgets.splice(this._widgets.indexOf(newWidget), 1))
		);
	}
}
