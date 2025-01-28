/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { h } from '../../../../base/browser/dom.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { Emitter } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { ThemeIcon } from '../../../../base/common/themables.js';
import { URI } from '../../../../base/common/uri.js';
import { Range } from '../../../../editor/common/core/range.js';
import { MenuWorkbenchToolBar } from '../../../../platform/actions/browser/toolbar.js';
import { MenuId } from '../../../../platform/actions/common/actions.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { AideAgentCodeEditsContentPart, CodeEditsPool } from './aideAgentCodeEditPart.js';
import './media/aideAgentEditPreviewWidget.css';

const defaultIconClasses = ThemeIcon.asClassNameArray(Codicon.symbolEvent);
const cancelledIconClasses = ThemeIcon.asClassNameArray(Codicon.close);
const errorIconClasses = ThemeIcon.asClassNameArray(Codicon.error);
const questionIconClasses = ThemeIcon.asClassNameArray(Codicon.question);
const progressIconClasses = ThemeIcon.asClassNameArray(ThemeIcon.modify(Codicon.sync, 'spin'));

export class AideAgentEditPreviewWidget extends Disposable {
	protected readonly _elements = h(
		'div.aideagent-edit-preview@root',
		[
			h('div.header@header', [
				h('div.title@title', [
					h('div.icon@icon'),
					h('div.title@titleText'),
				]),
				h('div.actions-toolbar@toolbar'),
			]),
			h('div.code-edits@codeEdits')
		]
	);

	private readonly _onDidChangeHeight = this._register(new Emitter<void>());
	public readonly onDidChangeHeight = this._onDidChangeHeight.event;

	private readonly _onDidChangeVisibility = this._register(new Emitter<boolean>());
	public readonly onDidChangeVisibility = this._onDidChangeVisibility.event;

	private codeEditsPool: CodeEditsPool;
	private editsList!: AideAgentCodeEditsContentPart;

	private _visible = false;
	get visible() {
		return this._visible;
	}

	set visible(value: boolean) {
		this._visible = value;
		this._elements.root.classList.toggle('hidden', !value);
		this._onDidChangeHeight.fire();
	}

	private isProgressing = false;

	constructor(
		parent: HTMLElement,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
	) {
		super();

		this.codeEditsPool = this.instantiationService.createInstance(CodeEditsPool, this.onDidChangeVisibility);

		this.visible = false;
		parent.appendChild(this._elements.root);
		this.render();
	}

	private render() {
		const iconElement = this._elements.icon;
		iconElement.classList.add(...defaultIconClasses);

		const titleElement = this._elements.titleText;
		titleElement.textContent = '';

		const toolbarContainer = this._elements.toolbar;
		this._register(this.instantiationService.createInstance(MenuWorkbenchToolBar, toolbarContainer, MenuId.AideAgentEditPreviewWidget, {
			menuOptions: {
				shouldForwardArgs: true
			}
		}));

		this.editsList = this.instantiationService.createInstance(
			AideAgentCodeEditsContentPart,
			this.codeEditsPool
		);
		this._elements.codeEdits.appendChild(this.editsList.domNode);
	}



	updateProgress(message: string) {
		this.visible = Boolean(message) ? true : false; // Hide if empty string
		this._elements.icon.removeAttribute('class'); // Clear existing classes
		if (message === 'Complete') {
			this._elements.icon.classList.add(...defaultIconClasses);
			this.isProgressing = false;
		} else if (message === 'Cancelled') {
			this._elements.icon.classList.add(...cancelledIconClasses);
			this.isProgressing = false;
		} else if (message === 'Error') {
			this._elements.icon.classList.add(...errorIconClasses);
			this.isProgressing = false;
		} else if (message === 'Question') {
			this._elements.icon.classList.add(...questionIconClasses);
			this.isProgressing = false;
		} else if (!this.isProgressing) {
			this._elements.icon.classList.add(...progressIconClasses);
			this.isProgressing = true;
		}

		const titleElement = this._elements.titleText;
		titleElement.textContent = message;
	}

	setCodeEdits(codeEdits: Map<URI, Range[]>) {
		this.editsList.setInput({ edits: codeEdits });
		this._onDidChangeHeight.fire();
	}

	clear() {
		this.editsList.setInput({ edits: new Map() });
		this._onDidChangeHeight.fire();
	}
}
