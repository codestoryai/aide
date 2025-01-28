/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../../../base/common/event.js';
import { IMarkdownString } from '../../../../base/common/htmlContent.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { appendMarkdownString } from './aideAgentModel.js';
import { IAideAgentPlanProgressContent, IAideAgentPlanStep } from './aideAgentService.js';

export type IAideAgentPlanChangeEvent = IAideAgentPlanAddStepEvent;

export interface IAideAgentPlanAddStepEvent {
	kind: 'addPlanStep';
	step: IAideAgentPlanStepModel;
}

export interface IAideAgentPlanStepModel {
	readonly onDidChange: Event<void>;
	readonly id: string;
	readonly sessionId: string;
	description: IMarkdownString;
	progress: ReadonlyArray<IAideAgentPlanProgressContent>;
	isComplete: boolean;
}

export interface IAideAgentPlanModel {
	readonly onDidDispose: Event<void>;
	readonly onDidChange: Event<IAideAgentPlanChangeEvent>;
	readonly sessionId: string;
	getSteps(): IAideAgentPlanStepModel[];
}

export class AideAgentPlanStepModel extends Disposable implements IAideAgentPlanStepModel {
	private readonly _onDidChange = this._register(new Emitter<void>());
	readonly onDidChange = this._onDidChange.event;

	private static nextId = 0;

	public readonly id: string;
	private readonly _index: number;

	private _description: IMarkdownString;
	get description(): IMarkdownString {
		return this._description;
	}

	private _parts: IAideAgentPlanProgressContent[];
	get progress(): IAideAgentPlanProgressContent[] {
		return this._parts;
	}

	private _isComplete: boolean = false;
	get isComplete(): boolean {
		return this._isComplete;
	}

	constructor(
		readonly sessionId: string,
		initialValue: IAideAgentPlanStep
	) {
		super();

		this.id = 'step_' + AideAgentPlanStepModel.nextId++;

		this._index = initialValue.index;
		this._description = initialValue.description;
		this._parts = [initialValue];
	}

	updateStep(progress: IAideAgentPlanStep): void {
		if (this._index !== progress.index) {
			throw new Error('Index mismatch');
		}

		if (!progress.description) {
			return;
		}

		this._description = appendMarkdownString(this._description, progress.description);

		this._parts.push(progress);
		this._onDidChange.fire();
	}
}

export class AideAgentPlanModel extends Disposable implements IAideAgentPlanModel {
	private readonly _onDidDispose = this._register(new Emitter<void>());
	readonly onDidDispose = this._onDidDispose.event;

	private readonly _onDidChange = this._register(new Emitter<IAideAgentPlanChangeEvent>());
	readonly onDidChange = this._onDidChange.event;

	private _steps: AideAgentPlanStepModel[] = [];

	constructor(
		readonly sessionId: string,
		@IInstantiationService private readonly _instantiationService: IInstantiationService,
	) {
		super();
	}

	getSteps(): IAideAgentPlanStepModel[] {
		return this._steps;
	}

	updateSteps(progress: IAideAgentPlanStep): void {
		if (this._steps[progress.index]) {
			this._steps[progress.index].updateStep(progress);
		} else {
			const step = this._instantiationService.createInstance(AideAgentPlanStepModel, this.sessionId, progress);
			this._steps.push(step);
			this._onDidChange.fire({ kind: 'addPlanStep', step });
		}
	}

	override dispose(): void {
		this._steps.forEach(s => s.dispose());
		this._onDidDispose.fire();

		super.dispose();
	}
}
