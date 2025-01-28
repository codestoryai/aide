/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as nls from '../../../../nls.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { IUntypedEditorInput } from '../../../common/editor.js';
import { EditorInput } from '../../../common/editor/editorInput.js';
import { ModelSelectionEditorModel } from './modelSelectionEditorModel.js';

export class ModelSelectionEditorInput extends EditorInput {
	static readonly ID: string = 'workbench.input.modelSelection';
	readonly modelSelectionModel: ModelSelectionEditorModel;

	readonly resource = undefined;

	constructor(
		@IInstantiationService instantiationService: IInstantiationService
	) {
		super();

		this.modelSelectionModel = instantiationService.createInstance(ModelSelectionEditorModel);
	}

	override get typeId(): string {
		return ModelSelectionEditorInput.ID;
	}

	override getName(): string {
		return nls.localize('modelSelectionInputName', "Model Selection");
	}

	override async resolve(): Promise<ModelSelectionEditorModel> {
		return this.modelSelectionModel;
	}

	override matches(otherInput: EditorInput | IUntypedEditorInput): boolean {
		return otherInput instanceof ModelSelectionEditorInput;
	}

	override dispose(): void {
		this.modelSelectionModel.dispose();

		super.dispose();
	}
}
