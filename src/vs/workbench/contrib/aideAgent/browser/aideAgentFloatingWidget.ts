/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as dom from '../../../../base/browser/dom.js';
import { StandardMouseEvent } from '../../../../base/browser/mouseEvent.js';
import { CodeWindow, mainWindow } from '../../../../base/browser/window.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { Disposable, MutableDisposable } from '../../../../base/common/lifecycle.js';
import { clamp } from '../../../../base/common/numbers.js';
import { ThemeIcon } from '../../../../base/common/themables.js';
import { IContextKey, IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { ServiceCollection } from '../../../../platform/instantiation/common/serviceCollection.js';
import { ILayoutService } from '../../../../platform/layout/browser/layoutService.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { editorBackground } from '../../../../platform/theme/common/colorRegistry.js';
import { SIDE_BAR_FOREGROUND } from '../../../common/theme.js';
import { ChatAgentLocation } from '../common/aideAgentAgents.js';
import { CONTEXT_CHAT_FLOATING_WIDGET_FOCUSED, CONTEXT_CHAT_FLOATING_WIDGET_VISIBLE } from '../common/aideAgentContextKeys.js';
import { IAideAgentService } from '../common/aideAgentService.js';
import { ChatWidget } from './aideAgentWidget.js';
import './media/aideAgentFloatingWidget.css';

const FLOATING_WIDGET_POSITION_KEY = 'aideAgent.floatingWidget.widgetposition';
const FLOATING_WIDGET_Y_KEY = 'aideAgent.floatingWidget.y';

export class AideAgentFloatingWidget extends Disposable {
	private isVisible: IContextKey<boolean>;
	private isFocused: IContextKey<boolean>;
	private widget: ChatWidget;

	private get yDefault() {
		return this.layoutService.mainContainerOffset.top;
	}

	/** coordinate of the command palette per aux window */
	private readonly auxWindowCoordinates = new WeakMap<CodeWindow, { x: number; y: number | undefined }>();

	constructor(
		private readonly container: HTMLElement,
		@IAideAgentService private readonly aideAgentService: IAideAgentService,
		@IContextKeyService private readonly contextKeyService: IContextKeyService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@ILayoutService private readonly layoutService: ILayoutService,
		@IStorageService private readonly storageService: IStorageService,
	) {
		super();

		this.isVisible = CONTEXT_CHAT_FLOATING_WIDGET_VISIBLE.bindTo(contextKeyService);
		this.isFocused = CONTEXT_CHAT_FLOATING_WIDGET_FOCUSED.bindTo(contextKeyService);
		const scopedInstantiationService = this._register(this.instantiationService.createChild(
			new ServiceCollection([
				IContextKeyService,
				this._register(this.contextKeyService.createScoped(container))
			])
		));
		this.widget = this._register(
			scopedInstantiationService.createInstance(
				ChatWidget,
				ChatAgentLocation.Panel,
				{ isPassthrough: true },
				{
					renderInputOnTop: true,
					renderFollowups: false,
					renderStyle: 'compact',
					supportsFileReferences: true,
					filter() { return false; },
				},
				{
					listForeground: SIDE_BAR_FOREGROUND,
					listBackground: editorBackground,
					overlayBackground: editorBackground,
					inputEditorBackground: editorBackground,
					resultEditorBackground: editorBackground
				}
			)
		);
		this.widget.render(container);
		this.widget.setDynamicChatTreeItemLayout(0, 0);
		this.updateModel();
		this.layout();
		this._register(this.widget.input.onDidChangeHeight(() => {
			this.layout();
		}));
		this._register(this.widget.onDidAcceptInput(() => {
			this.widget.input.setValue('', true);
			this.hide();
		}));
		this._register(this.widget.input.onDidFocus(() => {
			this.isFocused.set(true);
		}));
		this._register(this.widget.input.onDidBlur(() => {
			this.isFocused.set(false);
		}));

		dom.append(this.container, dom.$('div.drag-area' + ThemeIcon.asCSSSelector(Codicon.gripper)));

		this._register(dom.addDisposableGenericMouseDownListener(this.container, (event: MouseEvent) => {
			if (dom.isHTMLElement(event.target) && (event.target === this.widget.input.element || this.widget.input.element.contains(event.target))) {
				return;
			}

			this.container.classList.add('dragged');
			const activeWindow = dom.getWindow(this.layoutService.activeContainer);

			const widgetRect = this.container.getBoundingClientRect();
			const mouseDownEvent = new StandardMouseEvent(activeWindow, event);
			const xInWidget = mouseDownEvent.posx - widgetRect.left;
			const yInWidget = mouseDownEvent.posy - widgetRect.top;

			const mouseMoveListener = dom.addDisposableGenericMouseMoveListener(activeWindow, (e: MouseEvent) => {
				const mouseMoveEvent = new StandardMouseEvent(activeWindow, e);
				// Prevent default to stop editor selecting text
				mouseMoveEvent.preventDefault();

				this.setCoordinates(mouseMoveEvent.posx - xInWidget, mouseMoveEvent.posy - yInWidget);
			});

			const mouseUpListener = dom.addDisposableGenericMouseUpListener(activeWindow, (e: MouseEvent) => {
				this.storePosition();
				this.container.classList.remove('dragged');

				mouseMoveListener.dispose();
				mouseUpListener.dispose();
			});
		}));

		const resizeListener = this._register(new MutableDisposable());
		const registerResizeListener = () => {
			resizeListener.value = this._register(dom.addDisposableListener(
				dom.getWindow(this.layoutService.activeContainer), dom.EventType.RESIZE, () => {
					this.setCoordinates();
					this.layout();
				})
			);
		};
		registerResizeListener();
	}

	show(): void {
		if (this.isVisible.get()) {
			this.setCoordinates();
			return;
		}

		dom.show(this.container);

		this.isVisible.set(true);
		this.setCoordinates();
		this.widget.focusInput();
		this.layout();
	}

	hide(): void {
		if (!this.isVisible.get()) {
			return;
		}

		this.container.classList.add('hiding');

		// Wait for the animation to finish before hiding the container
		setTimeout(() => {
			this.isVisible.set(false);
			dom.hide(this.container);
			this.container.classList.remove('hiding');
		}, 200); // Duration of the animation
	}

	private updateModel(): void {
		const model = this.aideAgentService.startSession(ChatAgentLocation.Panel, CancellationToken.None, true);
		if (!model) {
			throw new Error('Could not start chat session');
		}

		this.widget.setModel(model, {});
	}

	private layout() {
		const height = Math.max(this.widget.input.contentHeight, 38);
		const width = Math.max(this.container.offsetWidth, 600);

		this.container.style.width = `${width + 2 /* border */}px`;
		this.container.style.height = `${height + 6 /* padding + border */}px`;
		this.widget.layout(height, width);
	}

	private setCoordinates(x?: number, y?: number): void {
		const widgetWidth = this.container.clientWidth;

		const currentWindow = dom.getWindow(this.layoutService.activeContainer);
		const isMainWindow = currentWindow === mainWindow;

		if (x === undefined) {
			const positionPercentage = isMainWindow
				? Number(this.storageService.get(FLOATING_WIDGET_POSITION_KEY, StorageScope.PROFILE))
				: this.auxWindowCoordinates.get(currentWindow)?.x;
			x = positionPercentage !== undefined && !isNaN(positionPercentage)
				? positionPercentage * currentWindow.innerWidth
				: (0.5 * currentWindow.innerWidth - 0.5 * widgetWidth);
		}
		x = clamp(x, 0, currentWindow.innerWidth - widgetWidth); // do not allow the widget to overflow on the right
		this.container.style.left = `${x}px`;

		if (y === undefined) {
			y = isMainWindow
				? this.storageService.getNumber(FLOATING_WIDGET_Y_KEY, StorageScope.PROFILE)
				: this.auxWindowCoordinates.get(currentWindow)?.y;
		}
		if (y === undefined) {
			y = this.yDefault;
		}

		const yMax = this.layoutService.activeContainer.clientHeight - this.container.clientHeight;
		y = Math.max(0, Math.min(y, yMax));
		this.container.style.top = `${y}px`;
	}

	private storePosition(): void {
		const activeWindow = dom.getWindow(this.layoutService.activeContainer);
		const isMainWindow = this.layoutService.activeContainer === this.layoutService.mainContainer;

		const rect = this.container.getBoundingClientRect();
		const y = rect.top;
		const x = rect.left / activeWindow.innerWidth;
		if (isMainWindow) {
			this.storageService.store(FLOATING_WIDGET_POSITION_KEY, x, StorageScope.PROFILE, StorageTarget.MACHINE);
			this.storageService.store(FLOATING_WIDGET_Y_KEY, y, StorageScope.PROFILE, StorageTarget.MACHINE);
		} else {
			this.auxWindowCoordinates.set(activeWindow, { x, y });
		}
	}
}
