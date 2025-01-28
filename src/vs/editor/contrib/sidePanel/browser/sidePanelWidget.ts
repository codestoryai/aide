/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as dom from '../../../../base/browser/dom.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { autorun, IObservable, observableFromEvent } from '../../../../base/common/observable.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { ICodeEditor, IOverlayWidget, IOverlayWidgetPosition, OverlayWidgetPositionPreference } from '../../../browser/editorBrowser.js';
import './sidePanelWidget.css';

const $ = dom.$;

/**
 * Notes:
 * - Public methods to be implemented that control the flow. These can be overridden.
 * - Anything we don't expect/need to be overridden would be private
 * - abstract methods to be created which need to be implemented by implementing classes
 * - For now, we'll assume this will always be opened on the right side
 *
 * In our case, let's try to offload the implementation of the core functionality to the workbench layer
 * So the abstract class should help with creating a widget in the right location and offer ways to open/close
 * I'm assuming we'd implement the open/close itself through buttons at the right end of the tab row (workbench)
 * As well as be managed through the probe widget.
 * Should be resizable, with a min-width.
 *
 * The API I'd like to start with is perhaps:
 * 1. Show (public)
 * 2. _fillContainer (abstract)
 */
export abstract class SidePanelWidget extends Disposable implements IOverlayWidget {
	private static readonly ID = 'editor.contrib.sidePanelWidget';
	private readonly _scrollTop: IObservable<number>;

	panelId: string;
	domNode: HTMLElement;
	minWidth: number = 300;

	constructor(
		readonly editor: ICodeEditor
	) {
		super();

		this.editor = editor;
		this.domNode = $('.editor-side-panel-container');
		this.panelId = generateUuid();

		this._scrollTop = observableFromEvent(this.editor.onDidScrollChange, () => /** @description editor.getScrollTop */ this.editor.getScrollTop());
		this._register(autorun(reader => {
			/** @description update padding top when editor scroll changes */
			const newScrollTop = this._scrollTop.read(reader);
			this.setScrollTop(newScrollTop);
		}));

		this._register(this.editor.onDidLayoutChange(() => {
			this.layout();
		}));
	}

	private setScrollTop(scrollTop: number): void {
		this.domNode.style.position = 'absolute';
		this.domNode.style.top = `-${scrollTop}px`;
	}

	protected show(): void {
		this._fillContainer(this.domNode);
		this.editor.addOverlayWidget(this);
		this.layout();

		dom.getWindow(this.domNode).requestAnimationFrame(() => {
			this.setScrollTop(this.editor.getScrollTop());
		});
	}

	hide(): void {
		dom.clearNode(this.domNode);
		this.editor.removeOverlayWidget(this);
	}

	layout(): void {
		this.domNode.style.height = `${this.editor.getScrollHeight()}px`;
		const layoutFraction = this.editor.getLayoutInfo().width * 0.3;
		this.domNode.style.width = `${Math.min(layoutFraction, this.minWidth)}px`;

		this.editor.layoutOverlayWidget(this);
	}

	protected abstract _fillContainer(container: HTMLElement): void;

	getId(): string {
		return `${SidePanelWidget.ID}_${this.panelId}`;
	}

	getDomNode(): HTMLElement {
		return this.domNode;
	}

	getPosition(): IOverlayWidgetPosition | null {
		return {
			preference: OverlayWidgetPositionPreference.TOP_RIGHT_CORNER
		};
	}
}
