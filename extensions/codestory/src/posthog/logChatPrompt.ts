/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import postHogClient from './client';

// this is not used
export const logChatPrompt = (
	prompt: string,
	githubRepoName: string,
	githubRepoHash: string,
	uniqueId: string,
) => {
	postHogClient?.capture({
		distinctId: uniqueId,
		event: 'chat_message',
		properties: {
			prompt,
			githubRepoName,
			githubRepoHash,
		},
	});
};

// this is not used
export const logSearchPrompt = (
	prompt: string,
	githubRepoName: string,
	githubRepoHash: string,
	uniqueId: string,
) => {
	postHogClient?.capture({
		distinctId: uniqueId,
		event: 'search_prompt',
		properties: {
			prompt,
			githubRepoName,
			githubRepoHash,
		},
	});
};
