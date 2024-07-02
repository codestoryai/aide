/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { Disposable, MutableDisposable } from 'vs/base/common/lifecycle';
import { Emitter } from 'vs/base/common/event';
import { CodeEditorWidget } from 'vs/editor/browser/widget/codeEditor/codeEditorWidget';
import { localize } from 'vs/nls';
import * as dom from 'vs/base/browser/dom';
import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { AccessibilityVerbositySettingId } from 'vs/workbench/contrib/accessibility/browser/accessibilityConfiguration';
import { AccessibilityCommandId } from 'vs/workbench/contrib/accessibility/common/accessibilityCommands';
import { getSimpleCodeEditorWidgetOptions, getSimpleEditorOptions } from 'vs/workbench/contrib/codeEditor/browser/simpleEditorOptions';
import { DEFAULT_FONT_FAMILY } from 'vs/base/browser/fonts';
import { IEditorConstructionOptions } from 'vs/editor/browser/config/editorConfiguration';
import { EditorExtensionsRegistry } from 'vs/editor/browser/editorExtensions';
import { HoverController } from 'vs/editor/contrib/hover/browser/hoverController';
import { IContextKey, IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { ServiceCollection } from 'vs/platform/instantiation/common/serviceCollection';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { ITextModel } from 'vs/editor/common/model';
import { IModelService } from 'vs/editor/common/services/model';
import { URI } from 'vs/base/common/uri';

import 'vs/css!./commandPalette';
import { CONTEXT_COMMAND_PALETTE_INPUT_HAS_FOCUS } from 'vs/workbench/contrib/aideCommandPalette/browser/aideCommandPaletteContextKeys';
import { EditorTabsMode, IWorkbenchLayoutService, LayoutSettings, Parts } from 'vs/workbench/services/layout/browser/layoutService';
import { StandardMouseEvent } from 'vs/base/browser/mouseEvent';
import { clamp } from 'vs/base/common/numbers';
import { IStorageService, StorageScope, StorageTarget } from 'vs/platform/storage/common/storage';
import { CodeWindow, mainWindow } from 'vs/base/browser/window';

const $ = dom.$;

const INPUT_EDITOR_MIN_HEIGHT = 24;

const COMMAND_PALETTE_POSITION_KEY = 'aide.commandPalette.widgetposition';
const COMMAND_PALETTE_Y_KEY = 'aide.commandPalette.widgety';

export class AideCommandPaletteWidget extends Disposable {

	/** coordinate of the debug toolbar per aux window */
	private readonly auxWindowCoordinates = new WeakMap<CodeWindow, { x: number; y: number | undefined }>();

	private static readonly INPUT_EDITOR_URI = URI.parse('aideCommandPalette:input');
	private _onDidChangeHeight = this._register(new Emitter<void>());
	readonly onDidChangeHeight = this._onDidChangeHeight.event;

	private _onDidFocus = this._register(new Emitter<void>());
	readonly onDidFocus = this._onDidFocus.event;

	private _onDidBlur = this._register(new Emitter<void>());
	readonly onDidBlur = this._onDidBlur.event;

	private inputEditorHeight = 0;
	readonly _container!: HTMLElement;

	private _inputEditor!: CodeEditorWidget;
	private _inputEditorContainer!: HTMLElement;

	get inputEditor() {
		return this._inputEditor;
	}

	private inputModel: ITextModel | undefined;
	private inputEditorHasFocus: IContextKey<boolean>;

	constructor(
		readonly container: HTMLElement,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IStorageService private readonly storageService: IStorageService,
		@IWorkbenchLayoutService private readonly layoutService: IWorkbenchLayoutService,
		@IModelService private readonly modelService: IModelService,
		@IContextKeyService private readonly contextKeyService: IContextKeyService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IKeybindingService private readonly keybindingService: IKeybindingService,
	) {
		super();

		this.inputEditorHasFocus = CONTEXT_COMMAND_PALETTE_INPUT_HAS_FOCUS.bindTo(contextKeyService);
		this._container = container;
	}

	id: string = 'aideCommandPalette';

	private _getAriaLabel(): string {
		const verbose = this.configurationService.getValue<boolean>(AccessibilityVerbositySettingId.Chat);
		if (verbose) {
			const kbLabel = this.keybindingService.lookupKeybinding(AccessibilityCommandId.OpenAccessibilityHelp)?.getLabel();
			return kbLabel ? localize('actions.commandPalette.accessibiltyHelp', "Command palette input, Type to interact with Aide, press enter to send out the request. Use {0} for Chat Accessibility Help.", kbLabel) : localize('commandPalette.accessibilityHelpNoKb', "Command palette input, Type to interact with Aide, press enter to run. Use the Command Palette Accessibility Help command for more information.");
		}
		return localize('chatInput', "Chat Input");
	}

	setValue(value: string): void {
		this.inputEditor.setValue(value);
		// always leave cursor at the end
		this.inputEditor.setPosition({ lineNumber: 1, column: value.length + 1 });
	}

	focus() {
		this._inputEditor.focus();
	}

	hasFocus(): boolean {
		return this._inputEditor.hasWidgetFocus();
	}

	render(initialValue = ''): void {

		const inputScopedContextKeyService = this._register(this.contextKeyService.createScoped(this._container));
		const scopedInstantiationService = this.instantiationService.createChild(new ServiceCollection([IContextKeyService, inputScopedContextKeyService]));


		const options: IEditorConstructionOptions = getSimpleEditorOptions(this.configurationService);
		options.readOnly = false;
		options.ariaLabel = this._getAriaLabel();
		options.fontFamily = DEFAULT_FONT_FAMILY;
		options.fontSize = 13;
		options.lineHeight = 20;
		options.padding = { top: 8, bottom: 8 };
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

		this._inputEditorContainer = dom.append(this.container, $('.command-palette-input-editor'));
		const editorOptions = getSimpleCodeEditorWidgetOptions();
		editorOptions.contributions?.push(...EditorExtensionsRegistry.getSomeEditorContributions([HoverController.ID]));
		this._inputEditor = this._register(scopedInstantiationService.createInstance(CodeEditorWidget, this._inputEditorContainer, options, editorOptions));


		let inputModel = this.modelService.getModel(AideCommandPaletteWidget.INPUT_EDITOR_URI);

		if (!inputModel) {
			inputModel = this.modelService.createModel('', null, AideCommandPaletteWidget.INPUT_EDITOR_URI, true);
			this._register(inputModel);
		}
		this.inputModel = inputModel;
		this._inputEditor.setModel(this.inputModel);
		// I don't like that we need to manally invoke this, I didn't find a call to this on ChatInputPart
		this._inputEditor.render();

		this._register(this._inputEditor.onDidFocusEditorText(() => {
			this.inputEditorHasFocus.set(true);
			this._onDidFocus.fire();
			this._inputEditorContainer.classList.toggle('focused', true);
		}));

		this._register(this._inputEditor.onDidBlurEditorText(() => {
			this.inputEditorHasFocus.set(false);
			this._inputEditorContainer.classList.toggle('focused', false);

			this._onDidBlur.fire();
		}));

		this._register(this._inputEditor.onDidChangeModelContent(() => {
			const currentHeight = Math.max(this._inputEditor.getContentHeight(), INPUT_EDITOR_MIN_HEIGHT);
			if (currentHeight !== this.inputEditorHeight) {
				this.inputEditorHeight = currentHeight;
				this._onDidChangeHeight.fire();
				this.layout();
			}
		}));

		this._register(dom.addDisposableGenericMouseDownListener(this._container, (event: MouseEvent) => {
			this._container.classList.add('dragged');
			const activeWindow = dom.getWindow(this.layoutService.activeContainer);

			const mouseMoveListener = dom.addDisposableGenericMouseMoveListener(activeWindow, (e: MouseEvent) => {
				const mouseMoveEvent = new StandardMouseEvent(activeWindow, e);
				// Prevent default to stop editor selecting text #8524
				mouseMoveEvent.preventDefault();
				// Reduce x by width of drag handle to reduce jarring #16604
				this.setCoordinates(mouseMoveEvent.posx - 14, mouseMoveEvent.posy - 14);
			});

			const mouseUpListener = dom.addDisposableGenericMouseUpListener(activeWindow, (e: MouseEvent) => {
				this.storePosition();
				this._container.classList.remove('dragged');

				mouseMoveListener.dispose();
				mouseUpListener.dispose();
			});
		}));


		const resizeListener = this._register(new MutableDisposable());
		const registerResizeListener = () => {
			resizeListener.value = this._register(dom.addDisposableListener(
				dom.getWindow(this.layoutService.activeContainer), dom.EventType.RESIZE, () => this.setCoordinates())
			);
		};
		registerResizeListener();

		this.setCoordinates();

		this.layout();
	}

	private setYCoordinate(y: number): void {
		const [yMin, yMax] = this.yRange;
		y = Math.max(yMin, Math.min(y, yMax));
		this._container.style.top = `${y}px`;
	}

	private get yDefault() {
		return this.layoutService.mainContainerOffset.top;
	}

	private _yRange: [number, number] | undefined;
	private get yRange(): [number, number] {
		if (!this._yRange) {
			const isTitleBarVisible = this.layoutService.isVisible(Parts.TITLEBAR_PART, dom.getWindow(this.layoutService.activeContainer));
			const yMin = isTitleBarVisible ? 0 : this.layoutService.mainContainerOffset.top;
			// TODO - improve this,
			const yMax = this.layoutService.activeContainer.clientHeight - this._container.clientHeight;
			this._yRange = [yMin, yMax];
		}
		return this._yRange;
	}

	private setCoordinates(x?: number, y?: number): void {

		const widgetWidth = this._container.clientWidth;
		const currentWindow = dom.getWindow(this.layoutService.activeContainer);
		const isMainWindow = currentWindow === mainWindow;

		if (x === undefined) {
			const positionPercentage = isMainWindow
				? Number(this.storageService.get(COMMAND_PALETTE_POSITION_KEY, StorageScope.PROFILE))
				: this.auxWindowCoordinates.get(currentWindow)?.x;
			x = positionPercentage !== undefined && !isNaN(positionPercentage)
				? positionPercentage * currentWindow.innerWidth
				: (0.5 * currentWindow.innerWidth - 0.5 * widgetWidth);
		}

		x = clamp(x, 0, currentWindow.innerWidth - widgetWidth); // do not allow the widget to overflow on the right
		this._container.style.left = `${x}px`;

		if (y === undefined) {
			y = isMainWindow
				? this.storageService.getNumber(COMMAND_PALETTE_Y_KEY, StorageScope.PROFILE)
				: this.auxWindowCoordinates.get(currentWindow)?.y;
		}

		this.setYCoordinate(y ?? this.yDefault);
	}

	private storePosition(): void {
		const activeWindow = dom.getWindow(this.layoutService.activeContainer);
		const isMainWindow = this.layoutService.activeContainer === this.layoutService.mainContainer;

		const rect = this._container.getBoundingClientRect();
		const y = rect.top;
		const x = rect.left / activeWindow.innerWidth;
		if (isMainWindow) {
			this.storageService.store(COMMAND_PALETTE_POSITION_KEY, x, StorageScope.PROFILE, StorageTarget.MACHINE);
			this.storageService.store(COMMAND_PALETTE_Y_KEY, y, StorageScope.PROFILE, StorageTarget.MACHINE);
		} else {
			this.auxWindowCoordinates.set(activeWindow, { x, y });
		}
	}


	layout(): void {
		const height = Math.max(this._inputEditor.getContentHeight(), INPUT_EDITOR_MIN_HEIGHT);
		this._inputEditor.layout({ width: 400, height });
	}

}
