/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as dom from '../../../../base/browser/dom.js';
import { DEFAULT_FONT_FAMILY } from '../../../../base/browser/fonts.js';
import { IHistoryNavigationWidget } from '../../../../base/browser/history.js';
import { StandardKeyboardEvent } from '../../../../base/browser/keyboardEvent.js';
import * as aria from '../../../../base/browser/ui/aria/aria.js';
import { Button } from '../../../../base/browser/ui/button/button.js';
import { IManagedHover } from '../../../../base/browser/ui/hover/hover.js';
import { IHoverDelegate } from '../../../../base/browser/ui/hover/hoverDelegate.js';
import { getBaseLayerHoverDelegate } from '../../../../base/browser/ui/hover/hoverDelegate2.js';
import { createInstantHoverDelegate, getDefaultHoverDelegate } from '../../../../base/browser/ui/hover/hoverDelegateFactory.js';
import { renderLabelWithIcons } from '../../../../base/browser/ui/iconLabel/iconLabels.js';
import { Switch } from '../../../../base/browser/ui/switch/switch.js';
import { IAction } from '../../../../base/common/actions.js';
import { Promises } from '../../../../base/common/async.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { HistoryNavigator2 } from '../../../../base/common/history.js';
import { KeyCode } from '../../../../base/common/keyCodes.js';
import { Disposable, DisposableStore, MutableDisposable } from '../../../../base/common/lifecycle.js';
import { isMacintosh } from '../../../../base/common/platform.js';
import { ThemeIcon } from '../../../../base/common/themables.js';
import { URI } from '../../../../base/common/uri.js';
import { IEditorConstructionOptions } from '../../../../editor/browser/config/editorConfiguration.js';
import { EditorExtensionsRegistry } from '../../../../editor/browser/editorExtensions.js';
import { CodeEditorWidget } from '../../../../editor/browser/widget/codeEditor/codeEditorWidget.js';
import { EditorOptions } from '../../../../editor/common/config/editorOptions.js';
import { IDimension } from '../../../../editor/common/core/dimension.js';
import { IPosition } from '../../../../editor/common/core/position.js';
import { IRange, Range } from '../../../../editor/common/core/range.js';
import { ITextModel } from '../../../../editor/common/model.js';
import { IModelService } from '../../../../editor/common/services/model.js';
import { CopyPasteController } from '../../../../editor/contrib/dropOrPasteInto/browser/copyPasteController.js';
import { ContentHoverController } from '../../../../editor/contrib/hover/browser/contentHoverController.js';
import { GlyphHoverController } from '../../../../editor/contrib/hover/browser/glyphHoverController.js';
import { SuggestController } from '../../../../editor/contrib/suggest/browser/suggestController.js';
import { localize } from '../../../../nls.js';
import { IAccessibilityService } from '../../../../platform/accessibility/common/accessibility.js';
import { ActionViewItemWithKb } from '../../../../platform/actionbarWithKeybindings/browser/actionViewItemWithKb.js';
import { MenuEntryActionViewItem } from '../../../../platform/actions/browser/menuEntryActionViewItem.js';
import { HiddenItemStrategy, MenuWorkbenchToolBar } from '../../../../platform/actions/browser/toolbar.js';
import { MenuId, MenuItemAction } from '../../../../platform/actions/common/actions.js';
import { IAIModelSelectionService } from '../../../../platform/aiModel/common/aiModels.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IContextKey, IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { IContextMenuService } from '../../../../platform/contextview/browser/contextView.js';
import { ITextEditorOptions } from '../../../../platform/editor/common/editor.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { registerAndCreateHistoryNavigationContext } from '../../../../platform/history/browser/contextScopedHistoryWidget.js';
import { IHoverService } from '../../../../platform/hover/browser/hover.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { ServiceCollection } from '../../../../platform/instantiation/common/serviceCollection.js';
import { IKeybindingService } from '../../../../platform/keybinding/common/keybinding.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { IOpenerService, OpenInternalOptions } from '../../../../platform/opener/common/opener.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { ResourceLabels } from '../../../browser/labels.js';
import { AgentMode } from '../../../../platform/aideAgent/common/model.js';
import { AccessibilityVerbositySettingId } from '../../accessibility/browser/accessibilityConfiguration.js';
import { AccessibilityCommandId } from '../../accessibility/common/accessibilityCommands.js';
import { getSimpleCodeEditorWidgetOptions, getSimpleEditorOptions, setupSimpleEditorSelectionStyling } from '../../codeEditor/browser/simpleEditorOptions.js';
import { revealInSideBarCommand } from '../../files/browser/fileActions.contribution.js';
import { ModelSelectionIndicator } from '../../preferences/browser/modelSelectionIndicator.js';
import { ChatAgentLocation } from '../common/aideAgentAgents.js';
import { CONTEXT_CHAT_HAS_FILE_ATTACHMENTS, CONTEXT_CHAT_INPUT_CURSOR_AT_TOP, CONTEXT_CHAT_INPUT_HAS_FOCUS, CONTEXT_CHAT_INPUT_HAS_TEXT, CONTEXT_CHAT_MODE, CONTEXT_IN_CHAT_INPUT } from '../common/aideAgentContextKeys.js';
import { AgentScope, IChatRequestVariableEntry } from '../common/aideAgentModel.js';
import { IChatFollowup } from '../common/aideAgentService.js';
import { IChatResponseViewModel } from '../common/aideAgentViewModel.js';
import { IAideAgentWidgetHistoryService, IChatHistoryEntry } from '../common/aideAgentWidgetHistoryService.js';
import { IAideAgentLMService } from '../common/languageModels.js';
import { ISidecarService, SidecarDownloadStatus, SidecarRunningStatus } from '../common/sidecarService.js';
import { AgentScopePickerActionId, CancelAction, ExecuteChatAction, IChatExecuteActionContext, ToggleEditModeAction } from './actions/aideAgentExecuteActions.js';
import { IChatWidget } from './aideAgent.js';
import { AideAgentAttachmentModel } from './aideAgentAttachmentModel.js';
import { ChatFollowups } from './aideAgentFollowups.js';

const $ = dom.$;

const INPUT_EDITOR_MAX_HEIGHT = 250;

interface IChatInputPartOptions {
	renderFollowups: boolean;
	renderStyle?: 'default' | 'compact';
	menus: {
		executeToolbar: MenuId;
		inputSideToolbar?: MenuId;
		telemetrySource?: string;
	};
	editorOverflowWidgetsDomNode?: HTMLElement;
	preventChatEditToggle?: boolean;
}

export class ChatInputPart extends Disposable implements IHistoryNavigationWidget {
	static readonly INPUT_SCHEME = 'aideAgentSessionInput';
	private static _counter = 0;

	private _onDidLoadInputState = this._register(new Emitter<any>());
	readonly onDidLoadInputState = this._onDidLoadInputState.event;

	private _onDidChangeHeight = this._register(new Emitter<void>());
	readonly onDidChangeHeight = this._onDidChangeHeight.event;

	private _onDidFocus = this._register(new Emitter<void>());
	readonly onDidFocus = this._onDidFocus.event;

	private _onDidBlur = this._register(new Emitter<void>());
	readonly onDidBlur = this._onDidBlur.event;

	private _onDidChangeContext = this._register(new Emitter<{ removed?: IChatRequestVariableEntry[]; added?: IChatRequestVariableEntry[] }>());
	readonly onDidChangeContext = this._onDidChangeContext.event;

	private _onDidAcceptFollowup = this._register(new Emitter<{ followup: IChatFollowup; response: IChatResponseViewModel | undefined }>());
	readonly onDidAcceptFollowup = this._onDidAcceptFollowup.event;

	private readonly _attachmentModel: AideAgentAttachmentModel;
	public get attachmentModel(): AideAgentAttachmentModel {
		return this._attachmentModel;
	}

	private _indexOfLastAttachedContextDeletedWithKeyboard: number = -1;

	private _hasFileAttachmentContextKey: IContextKey<boolean>;

	private readonly _onDidChangeVisibility = this._register(new Emitter<boolean>());
	private readonly _contextResourceLabels = this.instantiationService.createInstance(ResourceLabels, { onDidChangeVisibility: this._onDidChangeVisibility.event });

	private readonly inputEditorMaxHeight: number;
	private inputEditorHeight = 0;
	private container!: HTMLElement;

	private inputSideToolbarContainer?: HTMLElement;

	private followupsContainer!: HTMLElement;
	private readonly followupsDisposables = this._register(new DisposableStore());

	private attachedContextContainer!: HTMLElement;
	private readonly attachedContextDisposables = this._register(new MutableDisposable<DisposableStore>());

	private statusClickable = false;
	private statusMessageContainer!: HTMLElement;

	private _inputPartHeight: number = 0;
	get inputPartHeight() {
		return this._inputPartHeight;
	}

	private _inputEditor!: CodeEditorWidget;
	private _inputEditorElement!: HTMLElement;

	private executeToolbar!: MenuWorkbenchToolBar;
	private modeSwitch!: Switch;
	private inputActionsToolbar!: MenuWorkbenchToolBar;

	get inputEditor() {
		return this._inputEditor;
	}

	private history: HistoryNavigator2<IChatHistoryEntry>;
	private historyNavigationBackwardsEnablement!: IContextKey<boolean>;
	private historyNavigationForewardsEnablement!: IContextKey<boolean>;
	private inHistoryNavigation = false;
	private inputModel: ITextModel | undefined;
	private inputEditorHasText: IContextKey<boolean>;
	private chatCursorAtTop: IContextKey<boolean>;
	private inputEditorHasFocus: IContextKey<boolean>;

	private _currentLanguageModel: string | undefined;
	get currentLanguageModel() {
		// Map the internal id to the metadata id
		const metadataId = this._currentLanguageModel ? this.languageModelsService.lookupLanguageModel(this._currentLanguageModel)?.id : undefined;
		return metadataId;
	}

	private _agentMode: IContextKey<string>;
	private _lastPlanningEnabled: boolean;
	get mode() {
		return AgentMode[this._agentMode.get() as keyof typeof AgentMode] ?? AgentMode.Plan;
	}

	setMode(mode: AgentMode, planningToggle: boolean = false) {
		switch (mode) {
			case AgentMode.Plan:
				this._agentMode.set(AgentMode.Plan);
				this._lastPlanningEnabled = true;
				break;
			case AgentMode.Edit:
				if (planningToggle) {
					this._agentMode.set(AgentMode.Edit);
					this._lastPlanningEnabled = false;
				} else {
					this._agentMode.set(this._lastPlanningEnabled ? AgentMode.Plan : AgentMode.Edit);
				}
				this.modeSwitch.value = AgentMode.Edit;
				break;
			case AgentMode.Agentic:
				this._agentMode.set(AgentMode.Agentic);
				this.modeSwitch.value = AgentMode.Agentic;
				break;
			case AgentMode.Chat:
				this._agentMode.set(AgentMode.Chat);
				this.modeSwitch.value = AgentMode.Chat;
				break;
		}
	}

	private _onDidChangeCurrentAgentScope = this._register(new Emitter<string>());
	private _currentAgentScope: AgentScope = AgentScope.Selection;
	get currentAgentScope() {
		return this._currentAgentScope;
	}

	set currentAgentScope(scope: AgentScope) {
		this._currentAgentScope = scope;
		this._onDidChangeCurrentAgentScope.fire(scope);
	}

	private cachedDimensions: dom.Dimension | undefined;
	private cachedExecuteToolbarWidth: number | undefined;
	private cachedInputToolbarWidth: number | undefined;

	readonly inputUri = URI.parse(`${ChatInputPart.INPUT_SCHEME}:input-${ChatInputPart._counter++}`);

	constructor(
		// private readonly editorOptions: ChatEditorOptions, // TODO this should be used
		private readonly location: ChatAgentLocation,
		private readonly options: IChatInputPartOptions,
		private readonly getInputState: () => any,
		@IAccessibilityService private readonly accessibilityService: IAccessibilityService,
		@IAideAgentLMService private readonly languageModelsService: IAideAgentLMService,
		@IAideAgentWidgetHistoryService private readonly historyService: IAideAgentWidgetHistoryService,
		@IAIModelSelectionService private readonly aiModelSelectionService: IAIModelSelectionService,
		@ICommandService private readonly commandService: ICommandService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IContextKeyService private readonly contextKeyService: IContextKeyService,
		@IFileService private readonly fileService: IFileService,
		@IHoverService private readonly hoverService: IHoverService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IKeybindingService private readonly keybindingService: IKeybindingService,
		@ILogService private readonly logService: ILogService,
		@IModelService private readonly modelService: IModelService,
		@IOpenerService private readonly openerService: IOpenerService,
		@ISidecarService private readonly sidecarService: ISidecarService,
		@IThemeService private readonly themeService: IThemeService,
	) {
		super();

		this._attachmentModel = this._register(this.instantiationService.createInstance(AideAgentAttachmentModel));
		this.inputEditorMaxHeight = this.options.renderStyle === 'compact' ? INPUT_EDITOR_MAX_HEIGHT / 3 : INPUT_EDITOR_MAX_HEIGHT;

		this.inputEditorHasText = CONTEXT_CHAT_INPUT_HAS_TEXT.bindTo(contextKeyService);
		this.chatCursorAtTop = CONTEXT_CHAT_INPUT_CURSOR_AT_TOP.bindTo(contextKeyService);
		this.inputEditorHasFocus = CONTEXT_CHAT_INPUT_HAS_FOCUS.bindTo(contextKeyService);
		this._agentMode = CONTEXT_CHAT_MODE.bindTo(contextKeyService);
		this._lastPlanningEnabled = this.mode === AgentMode.Plan;

		this.history = this.loadHistory();
		this._register(this.historyService.onDidClearHistory(() => this.history = new HistoryNavigator2([{ text: '' }], 50, historyKeyFn)));

		this._register(this.configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration(AccessibilityVerbositySettingId.Chat)) {
				this.inputEditor.updateOptions({ ariaLabel: this._getAriaLabel() });
			}
		}));

		this._hasFileAttachmentContextKey = CONTEXT_CHAT_HAS_FILE_ATTACHMENTS.bindTo(contextKeyService);
	}

	private resetCurrentLanguageModel() {
		const defaultLanguageModel = this.languageModelsService.getLanguageModelIds().find(id => this.languageModelsService.lookupLanguageModel(id)?.isDefault);
		const hasUserSelectableLanguageModels = this.languageModelsService.getLanguageModelIds().find(id => {
			const model = this.languageModelsService.lookupLanguageModel(id);
			return model?.isUserSelectable && !model.isDefault;
		});
		this._currentLanguageModel = hasUserSelectableLanguageModels ? defaultLanguageModel : undefined;
	}

	private loadHistory(): HistoryNavigator2<IChatHistoryEntry> {
		const history = this.historyService.getHistory(this.location);
		if (history.length === 0) {
			history.push({ text: '' });
		}

		return new HistoryNavigator2(history, 50, historyKeyFn);
	}

	private _getAriaLabel(): string {
		const verbose = this.configurationService.getValue<boolean>(AccessibilityVerbositySettingId.Chat);
		if (verbose) {
			const kbLabel = this.keybindingService.lookupKeybinding(AccessibilityCommandId.OpenAccessibilityHelp)?.getLabel();
			return kbLabel ? localize('actions.chat.accessibiltyHelp', "Chat Input,  Type to ask questions or type / for topics, press enter to send out the request. Use {0} for Chat Accessibility Help.", kbLabel) : localize('chatInput.accessibilityHelpNoKb', "Chat Input,  Type code here and press Enter to run. Use the Chat Accessibility Help command for more information.");
		}
		return localize('chatInput', "Chat Input");
	}

	updateState(inputState: Object): void {
		if (this.inHistoryNavigation) {
			return;
		}

		const newEntry = { text: this._inputEditor.getValue(), state: inputState };

		if (this.history.isAtEnd()) {
			// The last history entry should always be the current input value
			this.history.replaceLast(newEntry);
		} else {
			// Added a reference while in the middle of history navigation, it's a new entry
			this.history.replaceLast(newEntry);
			this.history.resetCursor();
		}
	}

	initForNewChatModel(inputValue: string | undefined, inputState: Object): void {
		this.history = this.loadHistory();
		this.history.add({ text: inputValue ?? this.history.current().text, state: inputState });

		if (inputValue) {
			this.setValue(inputValue, false);
		}
	}

	logInputHistory(): void {
		const historyStr = [...this.history].map(entry => JSON.stringify(entry)).join('\n');
		this.logService.info(`[${this.location}] Chat input history:`, historyStr);
	}

	setVisible(visible: boolean): void {
		this._onDidChangeVisibility.fire(visible);
	}

	get element(): HTMLElement {
		return this.container;
	}

	showPreviousValue(): void {
		const inputState = this.getInputState();
		if (this.history.isAtEnd()) {
			this.saveCurrentValue(inputState);
		} else {
			if (!this.history.has({ text: this._inputEditor.getValue(), state: inputState })) {
				this.saveCurrentValue(inputState);
				this.history.resetCursor();
			}
		}

		this.navigateHistory(true);
	}

	showNextValue(): void {
		const inputState = this.getInputState();
		if (this.history.isAtEnd()) {
			return;
		} else {
			if (!this.history.has({ text: this._inputEditor.getValue(), state: inputState })) {
				this.saveCurrentValue(inputState);
				this.history.resetCursor();
			}
		}

		this.navigateHistory(false);
	}

	private navigateHistory(previous: boolean): void {
		const historyEntry = previous ?
			this.history.previous() : this.history.next();

		aria.status(historyEntry.text);

		this.inHistoryNavigation = true;
		this.setValue(historyEntry.text, true);
		this.inHistoryNavigation = false;

		this._onDidLoadInputState.fire(historyEntry.state);
		if (previous) {
			this._inputEditor.setPosition({ lineNumber: 1, column: 1 });
		} else {
			const model = this._inputEditor.getModel();
			if (!model) {
				return;
			}

			this._inputEditor.setPosition(getLastPosition(model));
		}
	}

	setValue(value: string, transient: boolean): void {
		this.inputEditor.setValue(value);
		// always leave cursor at the end
		this.inputEditor.setPosition({ lineNumber: 1, column: value.length + 1 });

		if (!transient) {
			this.saveCurrentValue(this.getInputState());
		}
	}

	private saveCurrentValue(inputState: any): void {
		const newEntry = { text: this._inputEditor.getValue(), state: inputState };
		this.history.replaceLast(newEntry);
	}

	focus() {
		this._inputEditor.focus();
	}

	hasFocus(): boolean {
		return this._inputEditor.hasWidgetFocus();
	}

	/**
	 * Reset the input and update history.
	 * @param userQuery If provided, this will be added to the history. Followups and programmatic queries should not be passed.
	 */
	async acceptInput(isUserQuery?: boolean): Promise<void> {
		if (isUserQuery) {
			const userQuery = this._inputEditor.getValue();
			const entry: IChatHistoryEntry = { text: userQuery, state: this.getInputState() };
			this.history.replaceLast(entry);
			this.history.add({ text: '' });
			this.resetCurrentLanguageModel();
		}

		// Clear attached context, fire event to clear input state, and clear the input editor
		this._attachmentModel.clear();
		this._onDidLoadInputState.fire({});
		if (this.accessibilityService.isScreenReaderOptimized() && isMacintosh) {
			this._acceptInputForVoiceover();
		} else {
			this._inputEditor.focus();
			this._inputEditor.setValue('');
		}
	}

	private _acceptInputForVoiceover(): void {
		const domNode = this._inputEditor.getDomNode();
		if (!domNode) {
			return;
		}
		// Remove the input editor from the DOM temporarily to prevent VoiceOver
		// from reading the cleared text (the request) to the user.
		domNode.remove();
		this._inputEditor.setValue('');
		this._inputEditorElement.appendChild(domNode);
		this._inputEditor.focus();
	}

	private _handleAttachedContextChange() {
		this._hasFileAttachmentContextKey.set(Boolean(this._attachmentModel.attachments.find(a => a.isFile)));
		this.renderAttachedContext();
	}

	render(container: HTMLElement, initialValue: string, widget: IChatWidget) {
		let elements;
		if (this.options.renderStyle === 'compact') {
			elements = dom.h('.interactive-input-part', [
				dom.h('.interactive-input-and-side-toolbar@inputAndSideToolbar', [
					dom.h('.chat-input-container@inputContainer', [
						dom.h('.chat-editor-container@editorContainer'),
						dom.h('.aideagent-input-toolbars@inputToolbars'),
					]),
				]),
				dom.h('.aideagent-attached-context@attachedContextContainer'),
				dom.h('.interactive-input-followups@followupsContainer'),
				dom.h('.interactive-input-status-message@statusMessageContainer', [
					dom.h('.model-config@modelConfig'),
					dom.h('.model-support@modelSupport'),
					dom.h('.status-message@statusMessage'),
				])
			]);
		} else {
			elements = dom.h('.interactive-input-part', [
				dom.h('.interactive-input-followups@followupsContainer'),
				dom.h('.interactive-input-and-side-toolbar@inputAndSideToolbar', [
					dom.h('.chat-input-container@inputContainer', [
						dom.h('.aideagent-attached-context@attachedContextContainer'),
						dom.h('.chat-editor-container@editorContainer'),
						dom.h('.aideagent-input-toolbars@inputToolbars'),
					]),
				]),
				dom.h('.interactive-input-status-message@statusMessageContainer', [
					dom.h('.model-config@modelConfig'),
					dom.h('.model-support@modelSupport'),
					dom.h('.status-message@statusMessage'),
				])
			]);
		}
		this.container = elements.root;
		container.append(this.container);
		this.container.classList.toggle('compact', this.options.renderStyle === 'compact');
		this.followupsContainer = elements.followupsContainer;
		const inputAndSideToolbar = elements.inputAndSideToolbar; // The chat input and toolbar to the right
		const inputContainer = elements.inputContainer; // The chat editor, attachments, and toolbars
		const editorContainer = elements.editorContainer;
		this.attachedContextContainer = elements.attachedContextContainer;
		const toolbarsContainer = elements.inputToolbars;
		this.renderAttachedContext();
		this._register(this._attachmentModel.onDidChangeContext(() => this._handleAttachedContextChange()));

		this.statusMessageContainer = elements.statusMessageContainer;
		const modelConfig = elements.modelConfig;
		const modelConfigButton = this.instantiationService.createInstance(Button, modelConfig, {
			buttonBackground: 'transparent',
			buttonForeground: 'inherit',
			buttonBorder: 'none',
			supportIcons: true,
		});

		const inputScopedContextKeyService = this._register(this.contextKeyService.createScoped(inputContainer));
		CONTEXT_IN_CHAT_INPUT.bindTo(inputScopedContextKeyService).set(true);
		const scopedInstantiationService = this._register(this.instantiationService.createChild(new ServiceCollection([IContextKeyService, inputScopedContextKeyService])));

		const { historyNavigationBackwardsEnablement, historyNavigationForwardsEnablement } = this._register(registerAndCreateHistoryNavigationContext(inputScopedContextKeyService, this));
		this.historyNavigationBackwardsEnablement = historyNavigationBackwardsEnablement;
		this.historyNavigationForewardsEnablement = historyNavigationForwardsEnablement;

		const options: IEditorConstructionOptions = getSimpleEditorOptions(this.configurationService);
		options.overflowWidgetsDomNode = this.options.editorOverflowWidgetsDomNode;
		options.pasteAs = EditorOptions.pasteAs.defaultValue;
		options.readOnly = false;
		options.ariaLabel = this._getAriaLabel();
		options.fontFamily = DEFAULT_FONT_FAMILY;
		options.fontSize = 13;
		options.lineHeight = 20;
		options.padding = this.options.renderStyle === 'compact' ? { top: 2, bottom: 2 } : { top: 8, bottom: 8 };
		options.cursorWidth = 1;
		options.wrappingStrategy = 'advanced';
		options.bracketPairColorization = { enabled: false };
		options.suggest = {
			showIcons: false,
			showSnippets: false,
			showWords: true,
			showStatusBar: false,
			insertMode: 'replace',
		};
		options.scrollbar = { ...(options.scrollbar ?? {}), vertical: 'hidden' };
		options.stickyScroll = { enabled: false };
		options.acceptSuggestionOnEnter = 'on';
		// TODO(@ghostwriternr): This condition is a hack, to avoid going through the pain of adding a new aide agent location.
		// But this condition is necessary because we currently use the compact style for the floating widget.
		// And the floating widget has fixed position relative to the window, so it helps to have the suggest controller
		// be absolutely positioned relative to the input, rather than the whole window since the calculation goes haywire.
		const isFloatingWidget = this.options.renderStyle === 'compact';
		options.fixedOverflowWidgets = !isFloatingWidget;

		this._inputEditorElement = dom.append(editorContainer!, $(chatInputEditorContainerSelector));
		const editorOptions = getSimpleCodeEditorWidgetOptions();
		editorOptions.contributions?.push(...EditorExtensionsRegistry.getSomeEditorContributions([ContentHoverController.ID, GlyphHoverController.ID, CopyPasteController.ID]));
		this._inputEditor = this._register(scopedInstantiationService.createInstance(CodeEditorWidget, this._inputEditorElement, options, editorOptions));

		if (!isFloatingWidget) {
			const suggestController = SuggestController.get(this._inputEditor);
			suggestController?.forceRenderingAbove();
		}

		this._register(this._inputEditor.onDidChangeModelContent(() => {
			const currentHeight = Math.min(this._inputEditor.getContentHeight(), this.inputEditorMaxHeight);
			if (currentHeight !== this.inputEditorHeight) {
				this.inputEditorHeight = currentHeight;
				this._onDidChangeHeight.fire();
			}

			const model = this._inputEditor.getModel();
			const inputHasText = !!model && model.getValue().trim().length > 0;
			this.inputEditorHasText.set(inputHasText);
		}));
		this._register(this._inputEditor.onDidFocusEditorText(() => {
			this.inputEditorHasFocus.set(true);
			this._onDidFocus.fire();
			inputContainer.classList.toggle('focused', true);
		}));
		this._register(this._inputEditor.onDidBlurEditorText(() => {
			this.inputEditorHasFocus.set(false);
			inputContainer.classList.toggle('focused', false);

			this._onDidBlur.fire();
		}));
		this._register(this._inputEditor.onDidBlurEditorWidget(() => {
			CopyPasteController.get(this._inputEditor)?.clearWidgets();
		}));

		this._register(dom.addStandardDisposableListener(toolbarsContainer, dom.EventType.CLICK, e => this.inputEditor.focus()));
		this.inputActionsToolbar = this._register(this.instantiationService.createInstance(MenuWorkbenchToolBar, toolbarsContainer, MenuId.AideAgentInput, {
			telemetrySource: this.options.menus.telemetrySource,
			menuOptions: { shouldForwardArgs: true },
			hiddenItemStrategy: HiddenItemStrategy.Ignore,
			actionViewItemProvider: (action, options) => {
				if (action.id === AgentScopePickerActionId && action instanceof MenuItemAction) {
					const scopeDelegate: AgentScopeSetterDelegate = {
						onDidChangeScope: this._onDidChangeCurrentAgentScope.event,
						setScope: (scopeId: AgentScope) => {
							this._currentAgentScope = scopeId;
						}
					};
					return this.instantiationService.createInstance(AgentScopeActionViewItem, action, this._currentAgentScope, scopeDelegate);
				}

				if (action instanceof MenuItemAction) {
					return this.instantiationService.createInstance(MenuEntryActionViewItem, action, undefined);
				}

				return undefined;
			}
		}));
		this.inputActionsToolbar.context = { widget } satisfies IChatExecuteActionContext;
		this._register(this.inputActionsToolbar.onDidChangeMenuItems(() => {
			if (this.cachedDimensions && typeof this.cachedInputToolbarWidth === 'number' && this.cachedInputToolbarWidth !== this.inputActionsToolbar.getItemsWidth()) {
				this.layout(this.cachedDimensions.height, this.cachedDimensions.width);
			}
		}));

		const keybinding = this.keybindingService.lookupKeybinding(ToggleEditModeAction.ID);
		this.modeSwitch = this._register(this.instantiationService.createInstance(Switch, {
			description: `Use Chat or Edit modes for quick tasks and Agentic mode for open-ended ones${keybinding ? ` (${keybinding.getLabel()})` : ''}`,
			options: ['Chat', 'Edit', 'Agentic'],
			value: 'Edit',
		}));
		dom.append(toolbarsContainer, this.modeSwitch.domNode);
		if (this.options.preventChatEditToggle) {
			this.modeSwitch.disable();
			this.modeSwitch.domNode.style.display = 'none';
		}
		this._register(this.modeSwitch.onDidChange((mode) => {
			this._agentMode.set(mode);
		}));

		this.executeToolbar = this._register(this.instantiationService.createInstance(MenuWorkbenchToolBar, toolbarsContainer, this.options.menus.executeToolbar, {
			telemetrySource: this.options.menus.telemetrySource,
			menuOptions: {
				shouldForwardArgs: true
			},
			hiddenItemStrategy: HiddenItemStrategy.Ignore, // keep it lean when hiding items and avoid a "..." overflow menu
			actionViewItemProvider: (action, options) => {
				if ((action.id === ExecuteChatAction.ID || action.id === CancelAction.ID) && action instanceof MenuItemAction) {
					return this.instantiationService.createInstance(ActionViewItemWithKb, action);
				}

				return undefined;
			}
		}));
		this.executeToolbar.context = { widget } satisfies IChatExecuteActionContext;
		this._register(this.executeToolbar.onDidChangeMenuItems(() => {
			if (this.cachedDimensions && typeof this.cachedExecuteToolbarWidth === 'number' && this.cachedExecuteToolbarWidth !== this.executeToolbar.getItemsWidth()) {
				this.layout(this.cachedDimensions.height, this.cachedDimensions.width);
			}
		}));
		if (this.options.menus.inputSideToolbar) {
			const toolbarSide = this._register(this.instantiationService.createInstance(MenuWorkbenchToolBar, inputAndSideToolbar, this.options.menus.inputSideToolbar, {
				telemetrySource: this.options.menus.telemetrySource,
				menuOptions: {
					shouldForwardArgs: true
				}
			}));
			this.inputSideToolbarContainer = toolbarSide.getElement();
			toolbarSide.getElement().classList.add('chat-side-toolbar');
			toolbarSide.context = { widget } satisfies IChatExecuteActionContext;
		}

		if (this.options.preventChatEditToggle) {
			this.statusMessageContainer.style.display = 'none';
		}

		// Model selection
		this.aiModelSelectionService.getValidatedModelSelectionSettings().then(settings => {
			const model = settings.slowModel;
			modelConfigButton.label = `$(${Codicon.chevronDown.id}) ${settings.models[model].name}`;
		});
		this._register(this.aiModelSelectionService.onDidChangeModelSelection((settings) => {
			const model = settings.slowModel;
			modelConfigButton.label = `$(${Codicon.chevronDown.id}) ${settings.models[model].name}`;
		}));
		modelConfigButton.onDidClick(() => {
			this.commandService.executeCommand(ModelSelectionIndicator.SWITCH_MODEL_COMMAND_ID);
		});

		this.addSidecarIndicator(elements.statusMessage);

		this.addAgenticSupportIndicator(elements.modelSupport);

		let inputModel = this.modelService.getModel(this.inputUri);
		if (!inputModel) {
			inputModel = this.modelService.createModel('', null, this.inputUri, true);
			this._register(inputModel);
		}

		this.inputModel = inputModel;
		this.inputModel.updateOptions({ bracketColorizationOptions: { enabled: false, independentColorPoolPerBracketType: false } });
		this._inputEditor.setModel(this.inputModel);
		if (initialValue) {
			this.inputModel.setValue(initialValue);
			const lineNumber = this.inputModel.getLineCount();
			this._inputEditor.setPosition({ lineNumber, column: this.inputModel.getLineMaxColumn(lineNumber) });
		}

		const onDidChangeCursorPosition = () => {
			const model = this._inputEditor.getModel();
			if (!model) {
				return;
			}

			const position = this._inputEditor.getPosition();
			if (!position) {
				return;
			}

			const atTop = position.column === 1 && position.lineNumber === 1;
			this.chatCursorAtTop.set(atTop);

			this.historyNavigationBackwardsEnablement.set(atTop);
			this.historyNavigationForewardsEnablement.set(position.equals(getLastPosition(model)));
		};
		this._register(this._inputEditor.onDidChangeCursorPosition(e => onDidChangeCursorPosition()));
		onDidChangeCursorPosition();

		this._register(this.themeService.onDidFileIconThemeChange(() => {
			this.renderAttachedContext();
		}));
	}

	private addSidecarIndicator(element: HTMLElement) {
		const textSpan = dom.$('span');
		const runningStatus = this.sidecarService.runningStatus;
		const downloadStatus = this.sidecarService.downloadStatus;
		const version = this.sidecarService.version;
		const { text, color, updateAvailable, hover } = this.getSidecarStatus(runningStatus, downloadStatus, version);
		textSpan.textContent = text;
		this.statusClickable = updateAvailable || runningStatus === SidecarRunningStatus.Unavailable;
		this._register(dom.addDisposableListener(textSpan, dom.EventType.CLICK, () => {
			if (this.statusClickable) {
				this.sidecarService.triggerRestart();
			}
		}));
		const managedHover = this._register(getBaseLayerHoverDelegate().setupManagedHover(
			getDefaultHoverDelegate('mouse'),
			element,
			hover
		));

		const iconSpan = dom.$('span');
		iconSpan.classList.add(...ThemeIcon.asClassNameArray(Codicon.circleFilled));
		iconSpan.style.color = color;
		element.appendChild(textSpan);
		element.appendChild(iconSpan);

		this._register(this.sidecarService.onDidChangeStatus(({ version, runningStatus, downloadStatus }) => {
			const { text, color, updateAvailable, hover } = this.getSidecarStatus(runningStatus, downloadStatus, version);
			textSpan.textContent = text;
			const clickable = updateAvailable || runningStatus === SidecarRunningStatus.Unavailable;
			this.statusClickable = clickable;
			textSpan.style.cursor = clickable ? 'pointer' : 'default';
			managedHover.update(clickable ? 'Click to restart the sidecar' : hover);
			iconSpan.style.color = color;

			if (runningStatus !== SidecarRunningStatus.Connected) {
				this.inputEditor.updateOptions({ readOnly: true });
			} else {
				this.inputEditor.updateOptions({ readOnly: false });
			}
		}));
	}

	private async getAgenticFeatureSupportInfo(iconSpan: HTMLSpanElement, textSpan: HTMLSpanElement, managedHover: IManagedHover) {
		const { supportsAgenticFeatures, currentModel } = await this.aiModelSelectionService.checkIfCurrentModelSelectionSupportsAgenticFeatures(this.mode);

		if (supportsAgenticFeatures) {
			dom.hide(iconSpan);
			managedHover.update(localize('chat.agenticSupportIndicator.supportedInfo', '{0} is optimized  for {1} mode', currentModel.name, this.mode.toLowerCase()));
			textSpan.textContent = '';
			textSpan.ariaHidden = 'true';
		} else {
			dom.show(iconSpan);
			textSpan.ariaHidden = 'false';
			managedHover.update(localize('chat.agenticSupportIndicator.notSupportedInfo', '{0} is not yet optimizted for {1} mode, we suggest you Sonnet to avoid unexpected results.', currentModel.name, this.mode.toLowerCase()));
		}
	}

	private addAgenticSupportIndicator(element: HTMLElement) {
		const iconSpan = dom.$('span');
		iconSpan.classList.add(...ThemeIcon.asClassNameArray(Codicon.warning));
		iconSpan.style.color = 'var(--vscode-editorGutter-modifiedBackground)';
		element.appendChild(iconSpan);

		const textSpan = dom.$('span');
		element.appendChild(textSpan);

		const managedHover = this._register(getBaseLayerHoverDelegate().setupManagedHover(
			getDefaultHoverDelegate('mouse'),
			element,
			''
		));

		this.getAgenticFeatureSupportInfo(iconSpan, textSpan, managedHover).then(() => {
			// element starts by being invisible
			element.style.visibility = 'visible';
		});

		this._register(this.aiModelSelectionService.onDidChangeModelSelection(() => {
			this.getAgenticFeatureSupportInfo(iconSpan, textSpan, managedHover);
		}));

		this._register(
			this.contextKeyService.onDidChangeContext(event => {
				if (event.affectsSome(new Set([CONTEXT_CHAT_MODE.key]))) {
					this.getAgenticFeatureSupportInfo(iconSpan, textSpan, managedHover);
				}
			})
		);
	}

	private async renderAttachedContext() {
		const container = this.attachedContextContainer;
		const oldHeight = container.offsetHeight;
		const store = new DisposableStore();
		this.attachedContextDisposables.value = store;

		dom.clearNode(container);
		const hoverDelegate = store.add(createInstantHoverDelegate());
		const attachments = [...this.attachmentModel.attachments.entries()];
		dom.setVisibility(Boolean(attachments.length), this.attachedContextContainer);
		if (!attachments.length) {
			this._indexOfLastAttachedContextDeletedWithKeyboard = -1;
		}

		const attachmentInitPromises: Promise<void>[] = [];
		for (const [index, attachment] of attachments) {
			const widget = dom.append(container, $('.aideagent-attached-context-attachment.show-file-icons'));
			const label = this._contextResourceLabels.create(widget, { supportIcons: true, hoverDelegate, hoverTargetOverride: widget });

			let ariaLabel: string | undefined;

			const resource = URI.isUri(attachment.value) ? attachment.value : attachment.value && typeof attachment.value === 'object' && 'uri' in attachment.value && URI.isUri(attachment.value.uri) ? attachment.value.uri : undefined;
			const range = attachment.value && typeof attachment.value === 'object' && 'range' in attachment.value && Range.isIRange(attachment.value.range) ? attachment.value.range : undefined;
			if (attachment.isImage) {
				ariaLabel = localize('chat.imageAttachment', "Attached image, {0}", attachment.name);

				const hoverElement = dom.$('div.chat-attached-context-hover');
				hoverElement.setAttribute('aria-label', ariaLabel);

				// Custom label
				const pillIcon = dom.$('div.chat-attached-context-pill', {}, dom.$('span.codicon.codicon-file-media'));
				const textLabel = dom.$('span.chat-attached-context-custom-text', {}, attachment.name);
				widget.appendChild(pillIcon);
				widget.appendChild(textLabel);

				attachmentInitPromises.push(Promises.withAsyncBody(async (resolve) => {
					let buffer: Uint8Array;
					try {
						this.attachButtonAndDisposables(widget, index, attachment, hoverDelegate);
						if (attachment.value instanceof URI) {
							const readFile = await this.fileService.readFile(attachment.value);
							if (store.isDisposed) {
								return;
							}
							buffer = readFile.value.buffer;
						} else {
							buffer = attachment.value as Uint8Array;
						}
						this.createImageElements(buffer, widget, hoverElement);
					} catch (error) {
						console.error('Error processing attachment:', error);
					}

					widget.style.position = 'relative';
					store.add(this.hoverService.setupManagedHover(hoverDelegate, widget, hoverElement, { trapFocus: false }));
					resolve();
				}));
			} else {
				const attachmentLabel = attachment.fullName ?? attachment.name;
				const withIcon = attachment.icon?.id ? `$(${attachment.icon.id}) ${attachmentLabel}` : attachmentLabel;
				label.setLabel(withIcon, undefined);

				ariaLabel = localize('chat.attachment', "Attached context, {0}", attachment.name);

				this.attachButtonAndDisposables(widget, index, attachment, hoverDelegate);
			}

			await Promise.all(attachmentInitPromises);
			if (store.isDisposed) {
				return;
			}

			if (resource) {
				widget.style.cursor = 'pointer';
				store.add(dom.addDisposableListener(widget, dom.EventType.CLICK, (e: MouseEvent) => {
					dom.EventHelper.stop(e, true);
					if (attachment.isDirectory) {
						this.openResource(resource, true);
					} else {
						this.openResource(resource, false, range);
					}
				}));

				store.add(dom.addDisposableListener(widget, dom.EventType.KEY_DOWN, (e: KeyboardEvent) => {
					const event = new StandardKeyboardEvent(e);
					if (event.equals(KeyCode.Enter) || event.equals(KeyCode.Space)) {
						dom.EventHelper.stop(e, true);
						if (attachment.isDirectory) {
							this.openResource(resource, true);
						} else {
							this.openResource(resource, false, range);
						}
					}
				}));
			}

			widget.tabIndex = 0;
			widget.ariaLabel = ariaLabel;
		}

		if (oldHeight !== container.offsetHeight) {
			this._onDidChangeHeight.fire();
		}
	}

	private getSidecarStatus(
		runningStatus: SidecarRunningStatus,
		downloadStatus: SidecarDownloadStatus,
		version: string,
	): { text: string; color: string; updateAvailable: boolean; hover: string } {
		let text = '';
		let hover = '';
		let color = 'var(--vscode-editorGutter-addedBackground)';
		let updateAvailable = false;

		if (runningStatus === SidecarRunningStatus.Connected) {
			text = 'Sidecar connected';
			hover = `${text} (v${version})`;
			if (downloadStatus.downloading && downloadStatus.update) {
				text += ' (downloading update)';
			} else if (!downloadStatus.downloading && downloadStatus.update) {
				text += ' (click to update)';
				updateAvailable = true;
			}
			color = 'var(--vscode-editorGutter-addedBackground)';
		} else if (downloadStatus.downloading) {
			text = `Downloading sidecar`;
			color = 'var(--vscode-editorGutter-modifiedBackground)';
		} else if (runningStatus === SidecarRunningStatus.Unavailable) {
			text = 'Sidecar not running';
			color = 'var(--vscode-editorGutter-deletedBackground)';
		} else {
			text = `${SidecarRunningStatus[runningStatus]}${runningStatus === SidecarRunningStatus.Connecting ? ' to' : ''} sidecar`;
			color = 'var(--vscode-editorGutter-modifiedBackground)';
		}

		return { text, color, updateAvailable, hover: hover ?? text };
	}

	private openResource(resource: URI, isDirectory: true): void;
	private openResource(resource: URI, isDirectory: false, range: IRange | undefined): void;
	private openResource(resource: URI, isDirectory?: boolean, range?: IRange): void {
		if (isDirectory) {
			// Reveal Directory in explorer
			this.commandService.executeCommand(revealInSideBarCommand.id, resource);
			return;
		}

		// Open file in editor
		const openTextEditorOptions: ITextEditorOptions | undefined = range ? { selection: range } : undefined;
		const options: OpenInternalOptions = {
			fromUserGesture: true,
			editorOptions: openTextEditorOptions,
		};
		this.openerService.open(resource, options);
	}

	private attachButtonAndDisposables(widget: HTMLElement, index: number, attachment: IChatRequestVariableEntry, hoverDelegate: IHoverDelegate) {
		const store = this.attachedContextDisposables.value;
		if (!store) {
			return;
		}

		const clearButton = new Button(widget, {
			supportIcons: true,
			hoverDelegate,
			title: localize('chat.attachment.clearButton', "Remove from context")
		});

		// If this item is rendering in place of the last attached context item, focus the clear button so the user can continue deleting attached context items with the keyboard
		if (index === Math.min(this._indexOfLastAttachedContextDeletedWithKeyboard, this.attachmentModel.size - 1)) {
			clearButton.focus();
		}

		store.add(clearButton);
		clearButton.icon = Codicon.close;
		store.add(Event.once(clearButton.onDidClick)((e) => {
			this._attachmentModel.delete(attachment.id);

			// Set focus to the next attached context item if deletion was triggered by a keystroke (vs a mouse click)
			if (dom.isKeyboardEvent(e)) {
				const event = new StandardKeyboardEvent(e);
				if (event.equals(KeyCode.Enter) || event.equals(KeyCode.Space)) {
					this._indexOfLastAttachedContextDeletedWithKeyboard = index;
				}
			}

			if (this._attachmentModel.size === 0) {
				this.focus();
			}

			this._onDidChangeContext.fire({ removed: [attachment] });
		}));
	}

	// Helper function to create and replace image
	private createImageElements(buffer: ArrayBuffer | Uint8Array, widget: HTMLElement, hoverElement: HTMLElement) {
		const blob = new Blob([buffer], { type: 'image/png' });
		const url = URL.createObjectURL(blob);
		const pillImg = dom.$('img.chat-attached-context-pill-image', { src: url, alt: '' });
		const pill = dom.$('div.chat-attached-context-pill', {}, pillImg);

		const existingPill = widget.querySelector('.chat-attached-context-pill');
		if (existingPill) {
			existingPill.replaceWith(pill);
		}

		const hoverImage = dom.$('img.chat-attached-context-image', { src: url, alt: '' });

		// Update hover image
		hoverElement.appendChild(hoverImage);

		hoverImage.onload = () => {
			URL.revokeObjectURL(url);
		};
	}

	async renderFollowups(items: IChatFollowup[] | undefined, response: IChatResponseViewModel | undefined): Promise<void> {
		if (!this.options.renderFollowups) {
			return;
		}
		this.followupsDisposables.clear();
		dom.clearNode(this.followupsContainer);

		if (items && items.length > 0) {
			this.followupsDisposables.add(this.instantiationService.createInstance<typeof ChatFollowups<IChatFollowup>, ChatFollowups<IChatFollowup>>(ChatFollowups, this.followupsContainer, items, this.location, undefined, followup => this._onDidAcceptFollowup.fire({ followup, response })));
		}
		this._onDidChangeHeight.fire();
	}

	get contentHeight(): number {
		const data = this.getLayoutData();
		return data.followupsHeight + data.inputPartEditorHeight + data.inputPartVerticalPadding + data.inputEditorBorder + data.attachmentsHeight + data.toolbarsHeight + data.statusMessageHeight;
	}

	layout(height: number, width: number) {
		this.cachedDimensions = new dom.Dimension(width, height);

		return this._layout(height, width);
	}

	private previousInputEditorDimension: IDimension | undefined;
	private _layout(height: number, width: number, allowRecurse = true): void {
		const data = this.getLayoutData();
		const inputEditorHeight = Math.min(data.inputPartEditorHeight, height - data.followupsHeight - data.attachmentsHeight - data.inputPartVerticalPadding - data.toolbarsHeight - data.statusMessageHeight);

		const followupsWidth = width - data.inputPartHorizontalPadding;
		this.followupsContainer.style.width = `${followupsWidth}px`;

		this._inputPartHeight = data.inputPartVerticalPadding + data.followupsHeight + inputEditorHeight + data.inputEditorBorder + data.attachmentsHeight + data.toolbarsHeight + data.statusMessageHeight;

		const initialEditorScrollWidth = this._inputEditor.getScrollWidth();
		const newEditorWidth = width - data.inputPartHorizontalPadding - data.editorBorder - data.inputPartHorizontalPaddingInside - data.toolbarsWidth - data.sideToolbarWidth;
		const newDimension = { width: newEditorWidth, height: inputEditorHeight };
		if (!this.previousInputEditorDimension || (this.previousInputEditorDimension.width !== newDimension.width || this.previousInputEditorDimension.height !== newDimension.height)) {
			// This layout call has side-effects that are hard to understand. eg if we are calling this inside a onDidChangeContent handler, this can trigger the next onDidChangeContent handler
			// to be invoked, and we have a lot of these on this editor. Only doing a layout this when the editor size has actually changed makes it much easier to follow.
			this._inputEditor.layout(newDimension);
			this.previousInputEditorDimension = newDimension;
		}

		if (allowRecurse && initialEditorScrollWidth < 10) {
			// This is probably the initial layout. Now that the editor is layed out with its correct width, it should report the correct contentHeight
			return this._layout(height, width, false);
		}
	}

	private getLayoutData() {
		const executeToolbarWidth = this.cachedExecuteToolbarWidth = this.executeToolbar.getItemsWidth();
		const inputToolbarWidth = this.cachedInputToolbarWidth = this.inputActionsToolbar.getItemsWidth();
		const executeToolbarPadding = (this.executeToolbar.getItemsLength() - 1) * 4;
		const inputToolbarPadding = (this.inputActionsToolbar.getItemsLength() - 1) * 4;
		return {
			inputEditorBorder: 2,
			followupsHeight: this.followupsContainer.offsetHeight,
			inputPartEditorHeight: Math.min(this._inputEditor.getContentHeight(), this.inputEditorMaxHeight),
			inputPartHorizontalPadding: this.options.renderStyle === 'compact' ? 12 : 32,
			inputPartVerticalPadding: this.options.renderStyle === 'compact' ? 12 : 30,
			attachmentsHeight: this.attachedContextContainer.offsetHeight,
			editorBorder: 2,
			inputPartHorizontalPaddingInside: 12,
			toolbarsWidth: this.options.renderStyle === 'compact' ? executeToolbarWidth + executeToolbarPadding + inputToolbarWidth + inputToolbarPadding : 0,
			toolbarsHeight: this.options.renderStyle === 'compact' ? 0 : 22,
			sideToolbarWidth: this.inputSideToolbarContainer ? dom.getTotalWidth(this.inputSideToolbarContainer) + 4 /*gap*/ : 0,
			statusMessageHeight: this.statusMessageContainer ? this.statusMessageContainer.offsetHeight : 0
		};
	}

	saveState(): void {
		this.saveCurrentValue(this.getInputState());
		const inputHistory = [...this.history];
		this.historyService.saveHistory(this.location, inputHistory);
	}
}

const historyKeyFn = (entry: IChatHistoryEntry) => JSON.stringify(entry);

function getLastPosition(model: ITextModel): IPosition {
	return { lineNumber: model.getLineCount(), column: model.getLineLength(model.getLineCount()) + 1 };
}

export interface AgentScopeSetterDelegate {
	onDidChangeScope: Event<string>;
	setScope: (scopeId: AgentScope) => void;
}

export class AgentScopeActionViewItem extends MenuEntryActionViewItem {
	constructor(
		action: MenuItemAction,
		private currentAgentScope: string,
		private delegate: AgentScopeSetterDelegate,
		@IKeybindingService keybindingService: IKeybindingService,
		@INotificationService notificationService: INotificationService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IThemeService themeService: IThemeService,
		@IContextMenuService contextMenuService: IContextMenuService,
		@IAccessibilityService _accessibilityService: IAccessibilityService
	) {
		super(action, undefined, keybindingService, notificationService, contextKeyService, themeService, contextMenuService, _accessibilityService);

		this._register(delegate.onDidChangeScope(scopeId => {
			this.currentAgentScope = scopeId;
			this.updateLabel();
		}));
	}

	override async onClick(event: MouseEvent): Promise<void> {
		this._openContextMenu();
	}

	override render(container: HTMLElement): void {
		super.render(container);
		container.classList.add('agentscope-picker-item');
	}

	protected override updateLabel(): void {
		if (this.label) {
			this.label.textContent = this.currentAgentScope;
			dom.reset(this.label, ...renderLabelWithIcons(`${this.currentAgentScope}$(chevron-down)`));
		}
	}

	private _openContextMenu() {
		const setAgentScopeAction = (scope: string): IAction => {
			return {
				id: scope,
				label: scope,
				tooltip: '',
				class: undefined,
				enabled: true,
				checked: scope === this.currentAgentScope,
				run: () => {
					this.currentAgentScope = scope;
					this.delegate.setScope(scope as AgentScope);
					this.updateLabel();
				}
			};
		};

		this._contextMenuService.showContextMenu({
			getAnchor: () => this.element!,
			getActions: () => [
				setAgentScopeAction('Selection'),
				setAgentScopeAction('Pinned Context'),
				setAgentScopeAction('Codebase'),
			]
		});
	}
}

const chatInputEditorContainerSelector = '.interactive-input-editor';
setupSimpleEditorSelectionStyling(chatInputEditorContainerSelector);
