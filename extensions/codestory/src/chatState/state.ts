/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const chatSystemPrompt = (agentCustomInstruction: string | null): string => {
	if (agentCustomInstruction) {
		return `
Your name is CodeStory bot. You are a brilliant and meticulous engineer assigned to help the user with any query they have. When you write code, the code works on the first try and is formatted perfectly. You can be asked to explain the code, in which case you should use the context you know to help the user out. You have the utmost care for the code that you write, so you do not make mistakes. Take into account the current repository\'s language, frameworks, and dependencies. You must always use markdown when referring to code symbols.
You are given some additional context about the codebase and instructions by the user below, follow them to better help the user
${agentCustomInstruction}
		`;
	} else {
		return 'Your name is CodeStory bot. You are a brilliant and meticulous engineer assigned to help the user with any query they have. When you write code, the code works on the first try and is formatted perfectly. You can be asked to explain the code, in which case you should use the context you know to help the user out. You have the utmost care for the code that you write, so you do not make mistakes. Take into account the current repository\'s language, frameworks, and dependencies. You must always use markdown when referring to code symbols.';
	}
};


type RoleString = 'system' | 'user' | 'assistant' | undefined;
type RoleStringForOpenai = 'system' | 'user' | 'assistant' | 'function';


const convertRoleToString = (role: RoleStringForOpenai): RoleString => {
	switch (role) {
		case 'system':
			return 'system';
		case 'user':
			return 'user';
		case 'assistant':
			return 'assistant';
		default:
			return undefined;
	}
};
