/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IDisposable } from '../../../../base/common/lifecycle.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { IEditorPartsView } from '../../../browser/parts/editor/editor.js';
import { IEditorPartUIState } from '../../../browser/parts/editor/editorPart.js';
import { ICreatePreviewEditorPartResult, PreviewEditorPart } from '../../../browser/parts/preview/previewPart.js';

export const IPreviewPartService = createDecorator<IPreviewPartService>('previewPartService');

export interface IPreviewPartService {

	readonly _serviceBrand: undefined;
	readonly mainPart: PreviewEditorPart;
	getPart(container: HTMLElement): IDisposable; // @g-danna Should be getOverlayedPart ?
	getOrCreateEditorGroupPart(editorPartsView: IEditorPartsView, state?: IEditorPartUIState): ICreatePreviewEditorPartResult;
	getBoundingClientRect(): DOMRect;
	// createAuxiliaryPreviewPart(container: HTMLElement, editorsContainer: HTMLElement): PreviewPart;
}
