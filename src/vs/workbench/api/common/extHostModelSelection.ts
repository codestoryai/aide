/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as vscode from 'vscode';
import { Emitter } from '../../../base/common/event.js';
import { toDisposable } from '../../../base/common/lifecycle.js';
import { ExtHostModelSelectionShape, IMainContext, MainContext, MainThreadModelSelectionShape } from './extHost.protocol.js';
import { IModelSelectionSettings, IModelSelectionValidationResponse } from '../../../platform/aiModel/common/aiModels.js';
import { CancellationToken } from '../../../base/common/cancellation.js';

export class ExtHostModelSelection implements ExtHostModelSelectionShape {
	private readonly _onModelSelectionChange = new Emitter<vscode.ModelSelection>();
	readonly onModelSelectionChange = this._onModelSelectionChange.event;

	private validationProvider: vscode.ModelConfigurationValidatorProvider | undefined;

	private readonly _proxy: MainThreadModelSelectionShape;

	constructor(
		mainContext: IMainContext,
	) {
		this._proxy = mainContext.getProxy(MainContext.MainThreadModelSelection);
	}

	async getConfiguration(): Promise<vscode.ModelSelection> {
		return this._proxy.$getConfiguration();
	}

	registerModelConfigurationValidator(validationProvider: vscode.ModelConfigurationValidatorProvider): vscode.Disposable {
		this.validationProvider = validationProvider;
		return toDisposable(() => {
			this.validationProvider = undefined;
		});
	}

	$acceptConfigurationChanged(data: vscode.ModelSelection): void {
		this._onModelSelectionChange.fire(data);
	}

	$validateModelConfiguration(data: IModelSelectionSettings, token: CancellationToken): Promise<IModelSelectionValidationResponse> {
		if (this.validationProvider) {
			return Promise.resolve(this.validationProvider.provideModelConfigValidation(data, token));
		}

		return Promise.resolve({ valid: false, error: 'Unable to validate model configuration. This is likely an issue at our end. Please let us know!' });
	}
}
