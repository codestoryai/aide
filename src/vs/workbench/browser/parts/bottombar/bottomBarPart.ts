/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, append } from '../../../../base/browser/dom.js';
import { IDisposable } from '../../../../base/common/lifecycle.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { IStorageService } from '../../../../platform/storage/common/storage.js';
import { editorBackground } from '../../../../platform/theme/common/colorRegistry.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { IBottomBarPartService } from '../../../services/bottomBarPart/browser/bottomBarPartService.js';
import { IWorkbenchLayoutService, Parts } from '../../../services/layout/browser/layoutService.js';
import { MultiWindowParts, Part } from '../../part.js';

export class BottomBarPartService extends MultiWindowParts<BottomBarPart> implements IBottomBarPartService {
	declare _serviceBrand: undefined;

	readonly mainPart = this._register(this.instantiationService.createInstance(BottomBarPart));

	constructor(
		@IInstantiationService protected readonly instantiationService: IInstantiationService,
		@IStorageService storageService: IStorageService,
		@IThemeService themeService: IThemeService,
	) {
		super('workbench.bottomBarPartService', themeService, storageService);

		this._register(this.registerPart(this.mainPart));
	}

	/*
	createAuxiliaryBottomBarPart(container: HTMLElement, editorContainer: HTMLElement): BottomBarPart {
		const bottomBarPartContainer = document.createElement('div');
		const bottomBarPart = this.instantiationService.createInstance(BottomBarPart);
		this._register(bottomBarPart);
		bottomBarPartContainer.classList.add('part', 'bottombar-part');
		container.insertBefore(bottomBarPartContainer, editorContainer.nextSibling);
		return bottomBarPart;
	}
	*/
}

export type BottomBarPosition = {
	bottom: number;
	left: number;
};

export class BottomBarPart extends Part implements IDisposable {
	static readonly activePanelSettingsKey = 'workbench.bottombar.activepanelid';

	private _content!: HTMLElement;
	get content(): HTMLElement {
		return this._content;
	}

	readonly minimumWidth: number = 200;
	readonly maximumWidth: number = Number.POSITIVE_INFINITY;
	readonly minimumHeight: number = 90;
	readonly maximumHeight: number = Number.POSITIVE_INFINITY;

	constructor(
		@IStorageService storageService: IStorageService,
		@IWorkbenchLayoutService layoutService: IWorkbenchLayoutService,
		@IThemeService themeService: IThemeService,
	) {
		super(
			Parts.BOTTOMBAR_PART,
			{ hasTitle: false },
			themeService,
			storageService,
			layoutService
		);
	}

	protected override createContentArea(parent: HTMLElement): HTMLElement {
		this.element = parent;

		this.getColor(editorBackground);
		this.element.style.backgroundColor = this.getColor(editorBackground)?.toString() || 'transparent';
		this._content = append(this.element, $('.content'));
		return this._content;
	}

	override layout(width: number, height: number, top: number, left: number): void {
		super.layout(width, height, top, left);
		super.layoutContents(width, height);
	}

	toJSON(): object {
		return {
			type: Parts.BOTTOMBAR_PART,
		};
	}
}
