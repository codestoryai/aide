/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as dom from '../../../../base/browser/dom.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { createDecorator, IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { IWorkbenchLayoutService } from '../../../services/layout/browser/layoutService.js';
import { AideAgentFloatingWidget } from './aideAgentFloatingWidget.js';

export const IAideAgentFloatingWidgetService = createDecorator<IAideAgentFloatingWidgetService>('IAideAgentFloatingWidgetService');
export interface IAideAgentFloatingWidgetService {
	_serviceBrand: undefined;
	widget: AideAgentFloatingWidget;

	showFloatingWidget(): void;
	hideFloatingWidget(): void;
}

export class AideAgentFloatingWidgetService extends Disposable implements IAideAgentFloatingWidgetService {
	_serviceBrand: undefined;

	private _container: HTMLElement | undefined;
	private _mounted = false;

	private _widget: AideAgentFloatingWidget | undefined;
	get widget(): AideAgentFloatingWidget {
		if (!this._widget) {
			throw new Error('AideAgentFloatingWidgetService not initialized');
		}
		return this._widget;
	}

	constructor(
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IWorkbenchLayoutService private readonly workbenchLayoutService: IWorkbenchLayoutService,
	) {
		super();

		if (!this._mounted) {
			this.mountWidget();
		}

		this._register(this.workbenchLayoutService.onDidChangeActiveContainer(async () => {
			// note: we intentionally don't keep the activeContainer before the
			// `await` clause to avoid any races due to quickly switching windows.
			await this.workbenchLayoutService.whenContainerStylesLoaded(dom.getWindow(this.workbenchLayoutService.activeContainer));
			if (this._mounted) {
				this.unmountWidget();
			}
			this.mountWidget();
		}));
	}

	private mountWidget(): void {
		if (!this._container) {
			this._container = document.createElement('div');
			this._container.classList.add('command-palette-container');
			this.workbenchLayoutService.activeContainer.appendChild(this._container);
		}

		if (!this._mounted) {
			this._widget = this.instantiationService.createInstance(AideAgentFloatingWidget, this._container);
		}

		this._mounted = true;
	}

	private unmountWidget(): void {
		this._widget?.dispose();
		this._widget = undefined;
		this._mounted = false;
	}

	showFloatingWidget(): void {
		if (!this._widget) {
			throw new Error('AideAgentFloatingWidgetService not initialized');
		}
		this._widget.show();
	}

	hideFloatingWidget(): void {
		if (!this._widget) {
			throw new Error('AideAgentFloatingWidgetService not initialized');
		}
		this._widget.hide();
	}
}
