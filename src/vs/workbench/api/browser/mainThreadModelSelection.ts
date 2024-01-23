/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from 'vs/base/common/lifecycle';
import { IAIModelSelectionService, IModelSelectionSettings } from 'vs/platform/aiModel/common/aiModels';
import { ExtHostContext, ExtHostModelSelectionShape, MainContext, MainThreadModelSelectionShape } from 'vs/workbench/api/common/extHost.protocol';
import { IExtHostContext, extHostNamedCustomer } from 'vs/workbench/services/extensions/common/extHostCustomers';

@extHostNamedCustomer(MainContext.MainThreadModelSelection)
export class MainThreadModelSelection extends Disposable implements MainThreadModelSelectionShape {

	private readonly _proxy: ExtHostModelSelectionShape;

	constructor(
		extHostContext: IExtHostContext,
		@IAIModelSelectionService private readonly _modelSelectionService: IAIModelSelectionService,
	) {
		super();
		this._proxy = extHostContext.getProxy(ExtHostContext.ExtHostModelSelection);

		this._register(this._modelSelectionService.onDidChangeModelSelection(e => {
			this._proxy.$acceptConfigurationChanged(e);
		}));
	}

	async $getConfiguration(): Promise<IModelSelectionSettings> {
		return this._getConfigurationData();
	}

	private async _getConfigurationData(): Promise<IModelSelectionSettings> {
		return this._modelSelectionService.getValidatedModelSelectionSettings();
	}
}
