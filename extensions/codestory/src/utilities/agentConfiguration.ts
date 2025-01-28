/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

/**
 * Toggle for the agent to use additional reasoning in the hot loop when working
 * on a task
 */
export const sidecarUsesAgentReasoning = (): boolean => {
	const aideConfiguration = vscode.workspace.getConfiguration('aide');
	const agentUseReasoning = aideConfiguration.get('enableAgentReasoning');
	return !!agentUseReasoning;
};
