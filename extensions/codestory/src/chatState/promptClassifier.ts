/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// const systemMessage = `You are an expert classifier who can detect the kind of request made by a developer working with a codebase. The developer is expected to give one of the following: An instruction, a search query, a request for an explanation, more general question or help on how to use the editor.

// - An instruction will be used by an AI agent to make the requested changes to the codebase.
// - The search query will be used by an AI agent to semantically look for code pointers within the codebase.
// - Explanations are for explaining a selected piece of code or an entire file
// - A general query could be a programming question that a developer might be facing when they're working.
// - Help which the user is asking about help on using the editor or the chat.

// You are expected to return only one word, which is one of: "instruction", "search", "explain" , "general" or "help".
// `;


// We want to figure out which instruction to use for the chat given the the
// current user question.
// There are couple of cases to consider here:
// It might be that the user has used a slash command, in which case we already
// know what instruction to use
// otherwise we look at the current instruction the user has provided and pass
// that through the classifier to figure out what sub-instruction to use


export type UserMessageType = 'explain' | 'general' | 'instruction' | 'search' | 'help';

export const deterministicClassifier = (userMessage: string): UserMessageType | null => {
	if (userMessage.startsWith('/help')) {
		return 'help';
	}
	if (userMessage.startsWith('/explain')) {
		return 'explain';
	}
	if (userMessage.startsWith('/search')) {
		return 'search';
	}
	if (userMessage.startsWith('/agent')) {
		return 'instruction';
	}
	if (userMessage.startsWith('/general')) {
		return 'general';
	}
	return null;
};
