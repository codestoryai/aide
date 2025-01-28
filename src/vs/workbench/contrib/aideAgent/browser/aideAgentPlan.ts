/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IViewsService } from '../../../services/views/common/viewsService.js';
import { AideAgentPlanViewPane } from './aideAgentPlanViewPane.js';
import { AideAgentPlanWidget } from './aideAgentPlanWidget.js';

export async function invokePlanView(viewsService: IViewsService): Promise<AideAgentPlanWidget | undefined> {
	return (await viewsService.openView<AideAgentPlanViewPane>(AIDE_AGENT_PLAN_VIEW_PANE_ID))?.widget;
}

export const AIDE_AGENT_PLAN_VIEW_PANE_ID = 'workbench.panel.aideAgentPlan';
