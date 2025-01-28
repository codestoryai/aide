/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as dom from '../../../../base/browser/dom.js';
import { ITreeElement } from '../../../../base/browser/ui/tree/tree.js';
import { disposableTimeout } from '../../../../base/common/async.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable, DisposableStore } from '../../../../base/common/lifecycle.js';
import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { ServiceCollection } from '../../../../platform/instantiation/common/serviceCollection.js';
import { WorkbenchObjectTree } from '../../../../platform/list/browser/listService.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { IAideAgentPlanModel } from '../common/aideAgentPlanModel.js';
import { AideAgentPlanViewModel, IAideAgentPlanStepViewModel } from '../common/aideAgentPlanViewModel.js';
import { CodeBlockModelCollection } from '../common/codeBlockModelCollection.js';
import { IChatRendererDelegate } from './aideAgentListRenderer.js';
import { ChatEditorOptions } from './aideAgentOptions.js';
import { AideAgentPlanAccessibilityProvider } from './aideAgentPlanAccessibilityProvider.js';
import { AideAgentPlanListDelegate, AideAgentPlanListRenderer } from './aideAgentPlanListRenderer.js';
import { IChatWidgetStyles } from './aideAgentWidget.js';

const $ = dom.$;

function revealLastElement(list: WorkbenchObjectTree<any>) {
	list.scrollTop = list.scrollHeight - list.renderHeight;
}

export class AideAgentPlanWidget extends Disposable {
	private _onDidFocus = this._register(new Emitter<void>());
	readonly onDidFocus = this._onDidFocus.event;

	private _onDidScroll = this._register(new Emitter<void>());
	readonly onDidScroll = this._onDidScroll.event;

	private _onDidHide = this._register(new Emitter<void>());
	readonly onDidHide = this._onDidHide.event;

	private _onDidChangeHeight = this._register(new Emitter<number>());
	readonly onDidChangeHeight = this._onDidChangeHeight.event;

	private readonly _onDidChangeContentHeight = new Emitter<void>();
	readonly onDidChangeContentHeight: Event<void> = this._onDidChangeContentHeight.event;

	private tree!: WorkbenchObjectTree<IAideAgentPlanStepViewModel>;
	private renderer!: AideAgentPlanListRenderer;
	private readonly _codeBlockModelCollection: CodeBlockModelCollection;

	private editorOptions!: ChatEditorOptions;

	private listContainer!: HTMLElement;
	private container!: HTMLElement;
	private visibleChangeCount = 0;

	private readonly viewModelDisposables = this._register(new DisposableStore());
	private _viewModel: AideAgentPlanViewModel | undefined;
	private set viewModel(viewModel: AideAgentPlanViewModel | undefined) {
		if (this._viewModel === viewModel) {
			return;
		}

		this.viewModelDisposables.clear();

		this._viewModel = viewModel;
		if (viewModel) {
			this.viewModelDisposables.add(viewModel);
		}
	}

	get viewModel() {
		return this._viewModel;
	}

	private _visible = false;
	private previousTreeScrollHeight: number = 0;

	constructor(
		private readonly styles: IChatWidgetStyles,
		@IContextKeyService private readonly contextKeyService: IContextKeyService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IThemeService private readonly themeService: IThemeService,
	) {
		super();

		this._codeBlockModelCollection = this._register(instantiationService.createInstance(CodeBlockModelCollection));
	}

	render(parent: HTMLElement): void {
		this.editorOptions = this._register(this.instantiationService.createInstance(ChatEditorOptions, undefined, this.styles.listForeground, this.styles.inputEditorBackground, this.styles.resultEditorBackground));

		this.container = dom.append(parent, $('.interactive-session'));
		this.listContainer = dom.append(this.container, $('.interactive-list'));
		this.createList(this.listContainer);

		this._register(this.editorOptions.onDidChange(() => this.onDidStyleChange()));
		this.onDidStyleChange();

		if (this.viewModel) {
			this.onDidChangeItems();
		}
	}

	setVisible(visible: boolean): void {
		const wasVisible = this._visible;
		this._visible = visible;
		this.visibleChangeCount++;
		this.renderer.setVisible(visible);

		if (visible) {
			this._register(disposableTimeout(() => {
				// Progressive rendering paused while hidden, so start it up again.
				// Do it after a timeout because the container is not visible yet (it should be but offsetHeight returns 0 here)
				if (this._visible) {
					this.onDidChangeItems();
				}
			}, 0));
		} else if (wasVisible) {
			this._onDidHide.fire();
		}
	}

	private createList(listContainer: HTMLElement): void {
		const scopedInstantiationService = this._register(this._register(this.instantiationService.createChild(new ServiceCollection([IContextKeyService, this.contextKeyService]))));
		const delegate = scopedInstantiationService.createInstance(AideAgentPlanListDelegate);
		const rendererDelegate: IChatRendererDelegate = {
			getListLength: () => this.tree.getNode(null).visibleChildrenCount,
			onDidScroll: this.onDidScroll,
		};

		// Create a dom element to hold UI from editor widgets embedded in chat messages
		const overflowWidgetsContainer = document.createElement('div');
		overflowWidgetsContainer.classList.add('chat-overflow-widget-container', 'monaco-editor');
		listContainer.append(overflowWidgetsContainer);

		this.renderer = this._register(scopedInstantiationService.createInstance(
			AideAgentPlanListRenderer,
			this.editorOptions,
			rendererDelegate,
			this._codeBlockModelCollection,
			overflowWidgetsContainer,
		));

		this.tree = this._register(<WorkbenchObjectTree<IAideAgentPlanStepViewModel>>scopedInstantiationService.createInstance(
			WorkbenchObjectTree,
			'AideAgentPlan',
			listContainer,
			delegate,
			[this.renderer],
			{
				identityProvider: { getId: (e: IAideAgentPlanStepViewModel) => e.id },
				horizontalScrolling: false,
				alwaysConsumeMouseWheel: false,
				supportDynamicHeights: true,
				hideTwistiesOfChildlessElements: true,
				accessibilityProvider: this.instantiationService.createInstance(AideAgentPlanAccessibilityProvider),
				setRowLineHeight: false,
			}
		));

		this._register(this.tree.onDidChangeContentHeight(() => {
			this.onDidChangeTreeContentHeight();
		}));
		this._register(this.renderer.onDidChangeItemHeight((e) => {
			this.tree.updateElementHeight(e.element, e.height);
		}));
		this._register(this.tree.onDidFocus(() => {
			this._onDidFocus.fire();
		}));
		this._register(this.tree.onDidScroll(() => {
			this._onDidScroll.fire();
		}));
	}

	private onDidChangeTreeContentHeight(): void {
		if (this.tree.scrollHeight !== this.previousTreeScrollHeight) {
			// Due to rounding, the scrollTop + renderHeight will not exactly match the scrollHeight.
			// Consider the tree to be scrolled all the way down if it is within 2px of the bottom.
			const lastElementWasVisible = this.tree.scrollTop + this.tree.renderHeight >= this.previousTreeScrollHeight - 2;
			if (lastElementWasVisible) {
				dom.scheduleAtNextAnimationFrame(dom.getWindow(this.listContainer), () => {
					// Can't set scrollTop during this event listener, the list might overwrite the change
					revealLastElement(this.tree);
				}, 0);
			}
		}

		this.previousTreeScrollHeight = this.tree.scrollHeight;
		this._onDidChangeContentHeight.fire();
	}

	private onDidStyleChange(): void {
		this.container.style.setProperty('--vscode-interactive-result-editor-background-color', this.editorOptions.configuration.resultEditor.backgroundColor?.toString() ?? '');
		this.container.style.setProperty('--vscode-interactive-session-foreground', this.editorOptions.configuration.foreground?.toString() ?? '');
		this.container.style.setProperty('--vscode-chat-list-background', this.themeService.getColorTheme().getColor(this.styles.listBackground)?.toString() ?? '');
	}

	setModel(model: IAideAgentPlanModel): void {
		if (!this.container) {
			throw new Error('Call render() before setModel()');
		}

		if (model.sessionId === this.viewModel?.sessionId) {
			return;
		}

		this._codeBlockModelCollection.clear();

		this.viewModel = this.instantiationService.createInstance(AideAgentPlanViewModel, model, this._codeBlockModelCollection);
		this.viewModelDisposables.add(Event.accumulate(this.viewModel.onDidChange, 0)(() => {
			if (!this.viewModel) {
				return;
			}

			this.onDidChangeItems();
		}));
		this.viewModelDisposables.add(this.viewModel.onDidDisposeModel(() => {
			this.viewModel = undefined;
			this.onDidChangeItems();
		}));

		if (this.tree) {
			this.onDidChangeItems();
		}
	}

	private onDidChangeItems(): void {
		if (this.tree && this._visible) {
			const treeItems = (this.viewModel?.getItems() ?? [])
				.map((step): ITreeElement<IAideAgentPlanStepViewModel> => {
					return {
						element: step,
						collapsed: false,
						collapsible: false
					};
				});

			this.tree.setChildren(null, treeItems, {
				diffIdentityProvider: {
					getId: (element) => {
						return element.dataId + `_${this.visibleChangeCount}`;
					}
				}
			});
		}
	}

	layout(height: number, width: number): void {
		width = Math.min(width, 600);

		this.tree.layout(height, width);
		this.tree.getHTMLElement().style.height = `${height}px`;
		this.renderer.layout(width);

		this.listContainer.style.height = `${height}px`;
		this._onDidChangeHeight.fire(height);
	}
}
