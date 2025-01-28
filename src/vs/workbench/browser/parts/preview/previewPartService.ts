/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { IStorageService } from '../../../../platform/storage/common/storage.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { IPreviewPartService } from '../../../services/previewPart/browser/previewPartService.js';
import { MultiWindowParts } from '../../part.js';
import { IEditorPartsView } from '../editor/editor.js';
import { IEditorPartUIState } from '../editor/editorPart.js';
import { PreviewEditorPart } from './previewPart.js';

export class PreviewPartService extends MultiWindowParts<PreviewEditorPart> implements IPreviewPartService {
	declare _serviceBrand: undefined;

	readonly mainPart = this._register(this.instantiationService.createInstance(PreviewEditorPart));

	constructor(
		@IInstantiationService protected readonly instantiationService: IInstantiationService,
		@IStorageService storageService: IStorageService,
		@IThemeService themeService: IThemeService,
	) {
		super('workbench.previewPartService', themeService, storageService);

		this._register(this.registerPart(this.mainPart));
	}

	getOrCreateEditorGroupPart(editorPartsView: IEditorPartsView, state?: IEditorPartUIState) {
		return this.mainPart.getOrCreateEditorPart(editorPartsView, state);
	}

	getBoundingClientRect() {
		return this.mainPart.element.getBoundingClientRect();
	}
}
