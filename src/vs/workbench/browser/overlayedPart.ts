/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IDimension } from '../../base/browser/dom.js';
import { Emitter } from '../../base/common/event.js';
import { IStorageService } from '../../platform/storage/common/storage.js';
import { IColorTheme, IThemeService } from '../../platform/theme/common/themeService.js';
import { Component } from '../common/component.js';
import { IWorkbenchLayoutService } from '../services/layout/browser/layoutService.js';
import './media/part.css';

export interface IPartOptions {
	readonly hasTitle?: boolean;
	readonly borderWidth?: () => number;
}

export interface ILayoutContentResult {
	readonly headerSize: IDimension;
	readonly titleSize: IDimension;
	readonly contentSize: IDimension;
	readonly footerSize: IDimension;
}


export interface IOverlayedView {
	element: HTMLElement;
	layout(width: number, height: number): void;
}


export abstract class OverlayedPart extends Component implements IOverlayedView {

	protected _onDidVisibilityChange = this._register(new Emitter<boolean>());
	readonly onDidVisibilityChange = this._onDidVisibilityChange.event;

	protected _onDidSizeChange = this._register(new Emitter<IDimension>());
	readonly onDidSizeChange = this._onDidSizeChange.event;

	private parent: HTMLElement | undefined;
	private contentArea: HTMLElement | undefined;
	element!: HTMLElement;

	private _width: number = 0;
	private _height: number = 0;
	get width() { return this._width; }
	get height() { return this._height; }

	constructor(
		id: string,
		themeService: IThemeService,
		storageService: IStorageService,
		protected readonly layoutService: IWorkbenchLayoutService
	) {
		super(id, themeService, storageService);
		this._register(layoutService.registerOverlayedPart(this));
	}

	create(parent: HTMLElement, options?: object): void {
		this.contentArea = this.createContentArea(parent, options);
		this.element = parent;
		this.parent = parent;
		this.element.style.position = 'absolute';
		this.element.style.inset = '0';
		// this.element.style.zIndex = '10'; // Restore this to put it on top of other elements
		this.element.style.overflow = 'hidden';
		this.updateStyles();
	}

	protected getContentArea(): HTMLElement | undefined {
		return this.contentArea;
	}

	protected override onThemeChange(theme: IColorTheme): void {
		// only call if our create() method has been called
		if (this.parent) {
			super.onThemeChange(theme);
		}
	}

	protected createContentArea(parent: HTMLElement, options?: object): HTMLElement | undefined {
		return undefined;
	}


	/**
	 * Returns the overall part container.
	 */
	getContainer(): HTMLElement | undefined {
		return this.parent;
	}

	layout(newWidth: number, newHeight: number): void {
		if (newWidth === this._width || newHeight === this._height) {
			this._onDidSizeChange.fire({ width: newWidth, height: newHeight });
		}
		this._width = newWidth;
		this._height = newHeight;
		this.element.style.width = `${this._width}px`;
		this.element.style.height = `${this._height}px`;
	}

	setVisible(visible: boolean) {
		this._onDidVisibilityChange.fire(visible);
	}
}
