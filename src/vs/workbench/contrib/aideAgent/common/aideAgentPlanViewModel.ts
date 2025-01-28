/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import * as marked from '../../../../base/common/marked/marked.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { IAideAgentPlanModel, IAideAgentPlanStepModel } from './aideAgentPlanModel.js';
import { IAideAgentPlanProgressContent } from './aideAgentService.js';
import { annotateVulnerabilitiesInText } from './annotations.js';
import { CodeBlockModelCollection } from './codeBlockModelCollection.js';

export function isAideAgentPlanStepVM(item: any): item is IAideAgentPlanStepViewModel {
	return !!item && typeof item === 'object' && 'value' in item;
}

export type IAideAgentPlanViewModelChangeEvent = IAideAgentPlanAddStepEvent | null;
export interface IAideAgentPlanAddStepEvent {
	kind: 'addPlanStep';
}

export interface IAideAgentPlanStepViewModel {
	readonly id: string;
	readonly sessionId: string;
	readonly dataId: string;
	readonly isComplete: boolean;
	readonly value: ReadonlyArray<IAideAgentPlanProgressContent>;
	currentRenderedHeight: number | undefined;
}

export interface IAideAgentPlanViewModel {
	readonly model: IAideAgentPlanModel;
	readonly sessionId: string;
	readonly onDidChange: Event<IAideAgentPlanViewModelChangeEvent>;
	getItems(): IAideAgentPlanStepViewModel[];
}

export class AideAgentPlanStepViewModel extends Disposable implements IAideAgentPlanStepViewModel {
	private _modelChangeCount = 0;

	currentRenderedHeight: number | undefined;

	private readonly _onDidChange = this._register(new Emitter<void>());
	readonly onDidChange = this._onDidChange.event;

	constructor(
		private readonly _model: IAideAgentPlanStepModel,
	) {
		super();

		this._register(_model.onDidChange(() => {
			// new data -> new id, new content to render
			this._modelChangeCount++;

			this._onDidChange.fire();
		}));
	}

	get id(): string {
		return this._model.id;
	}

	get sessionId(): string {
		return this._model.sessionId;
	}

	get dataId(): string {
		return this._model.id + `_${this._modelChangeCount}`;
	}

	get value(): ReadonlyArray<IAideAgentPlanProgressContent> {
		return this._model.progress;
	}

	get isComplete(): boolean {
		return this._model.isComplete;
	}
}

export class AideAgentPlanViewModel extends Disposable implements IAideAgentPlanViewModel {
	private readonly _onDidDisposeModel = this._register(new Emitter<void>());
	readonly onDidDisposeModel = this._onDidDisposeModel.event;

	private readonly _onDidChange = this._register(new Emitter<IAideAgentPlanViewModelChangeEvent>());
	readonly onDidChange = this._onDidChange.event;

	private readonly _items: AideAgentPlanStepViewModel[] = [];

	get model(): IAideAgentPlanModel {
		return this._model;
	}

	get sessionId() {
		return this._model.sessionId;
	}

	constructor(
		private readonly _model: IAideAgentPlanModel,
		public readonly codeBlockModelCollection: CodeBlockModelCollection,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
	) {
		super();

		// Initialize with existing steps from the model
		_model.getSteps().forEach((step: IAideAgentPlanStepModel) => {
			this.onAddPlanStep(step);
		});

		this._register(_model.onDidDispose(() => this._onDidDisposeModel.fire()));
		this._register(_model.onDidChange(e => {
			if (e.kind === 'addPlanStep') {
				this.onAddPlanStep(e.step);
			}
		}));
	}

	getItems(): IAideAgentPlanStepViewModel[] {
		return this._items;
	}

	private onAddPlanStep(step: IAideAgentPlanStepModel) {
		const stepModel = this.instantiationService.createInstance(AideAgentPlanStepViewModel, step);
		this._register(stepModel.onDidChange(() => {
			if (stepModel.isComplete) {
				this.updateCodeBlockTextModels(stepModel);
			}
			this._onDidChange.fire(null);
		}));
		this._items.push(stepModel);
		this.updateCodeBlockTextModels(stepModel);
	}

	override dispose(): void {
		super.dispose();
		this._items.forEach(item => item.dispose());
	}

	updateCodeBlockTextModels(model: IAideAgentPlanStepViewModel) {
		const content = annotateVulnerabilitiesInText(model.value).map(x => x.content.value).join('');

		let codeBlockIndex = 0;
		marked.walkTokens(marked.lexer(content), token => {
			if (token.type === 'code') {
				const lang = token.lang || '';
				const text = token.text;
				this.codeBlockModelCollection.update(this._model.sessionId, model, codeBlockIndex++, { text, languageId: lang });
			}
		});
	}
}
