/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { PostHog } from 'posthog-node';
import * as vscode from 'vscode';
import { getUserId } from '../utilities/uniqueId';

let postHogClient: PostHog | undefined;
try {
	const codestoryConfiguration = vscode.workspace.getConfiguration('codestory');
	const disableTelemetry = codestoryConfiguration.get('disableTelemetry');
	if (disableTelemetry) {
		postHogClient = undefined;
	} else {
		postHogClient = new PostHog(
			'phc_dKVAmUNwlfHYSIAH1kgnvq3iEw7ovE5YYvGhTyeRlaB',
			{ host: 'https://app.posthog.com' }
		);
		postHogClient.identify({ distinctId: getUserId() });
	}
} catch (err) {
	console.error('Error initializing PostHog client', err);
}


export default postHogClient;
