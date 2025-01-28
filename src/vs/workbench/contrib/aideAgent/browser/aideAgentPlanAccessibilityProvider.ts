/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AriaRole } from '../../../../base/browser/ui/aria/aria.js';
import { IListAccessibilityProvider } from '../../../../base/browser/ui/list/listWidget.js';
import { IObservable } from '../../../../base/common/observable.js';
import { localize } from '../../../../nls.js';
import { IAideAgentPlanStepViewModel } from '../common/aideAgentPlanViewModel.js';

export class AideAgentPlanAccessibilityProvider implements IListAccessibilityProvider<IAideAgentPlanStepViewModel> {
	getWidgetRole(): AriaRole {
		return 'list';
	}

	getRole(element: IAideAgentPlanStepViewModel): AriaRole | undefined {
		return 'listitem';
	}

	getWidgetAriaLabel(): string {
		return localize('aideAgentPlan', "Plan");
	}

	getAriaLabel(element: IAideAgentPlanStepViewModel): string | IObservable<string> | null {
		return '';
	}
}
