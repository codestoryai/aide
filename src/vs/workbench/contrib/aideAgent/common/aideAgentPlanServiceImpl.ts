/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { IAideAgentPlanModel } from './aideAgentPlanModel.js';
import { IAideAgentPlanService } from './aideAgentPlanService.js';
import { IAideAgentService } from './aideAgentService.js';

export class AideAgentPlanService extends Disposable implements IAideAgentPlanService {
	declare _serviceBrand: undefined;

	constructor(
		@IAideAgentService private readonly aideAgentService: IAideAgentService,
	) {
		super();
	}

	getActivePlan(sessionId: string): IAideAgentPlanModel | undefined {
		const chatModel = this.aideAgentService.getSession(sessionId);
		if (!chatModel) {
			return undefined;
		}

		return chatModel.plan;
	}
}
