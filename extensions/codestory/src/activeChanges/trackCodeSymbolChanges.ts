/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// We want to keep track of the code symbols which have changed so we can provide
// an overview of what changes have been done up until now
// This will be useful in creating a better what was I doing feature
import { OpenAI } from 'openai';

import { CodeSymbolInformation } from '../utilities/types';

export const getFileExtension = (filePath: string): string | undefined => {
	return filePath.split('.').pop();
};

export type CodeSymbolChangeType = 'added' | 'removed' | 'modified';

export type CodeSymbolChangeInFile = {
	fsPath: string;
	codeSymbolsWhichChanged: CodeSymbolChange[];
};

// We are going to store if the code symbol was added modified or removed from
// our workspace
export interface CodeSymbolChange {
	name: string;
	codeSymbol: CodeSymbolInformation;
	changeType: CodeSymbolChangeType;
	changeTime: Date;
	diffPatch: string;
	componentIdentifier: string;
	commitIdentifier: string;
}


export const getCodeSymbolsChangedInSameBlockDescription = (
	codeSymbolChanges: {
		name: string;
		diffPatch: string;
		lastEditTime: number;
		languageId: string;
	}[]
): OpenAI.Chat.CreateChatCompletionRequestMessage[] => [
		{
			role: 'system',
			content: `
				You are a senior engineer helping another engineer write good commit messages for the set of related changes they are doing. You have to answer in 2-3 sentence description of the 'how' of the change. It should also answer the question: 'What was I doing?' which means the user will look at this to quickly understand the changes they have done in these related code symbol changes.
				Since the changes are linked together, you will be given the list of related changes and they are related almost always because they one of the code symbols uses the other one which was changed.

				You have to generate the description of what has changed so the user can jump back to work after simply reading it.

				When describing the change happening to the code symbols which are related, dont talk about which code symbols were changed, try to write like a human what the change was about,

				for example if I am passing a new variable you can write: we are passing a new variable from function A to function B ... etc
				Always mention code symbols in markdown so they can rendered properly, you are also given the language in which the change was made, use that to figure out if there are common traits of the changes.. like
				- passing a variable through a repeated function call
				- reason with all the changes present in the timewise order, so you can use that to create an easy to see overview of the changes
				I want you to output the final answer in a JSON properly formatted as:
				\`\`\`
				{
					"changes": [
						"First change",
						"Second change",
						"Third change",
						....
					],
					"summary": "This is a summary of the changes"
				}
				\`\`\`
				when talking about the change only mention the what of the change in the codeblocks combined together. Be concise in your answer and dont try to fill in the list of changes if you can describe it in a concise way.
				The summary has to be less than 72 characters.
				ONLY REPLY WITH THE JSON OBJECT AND NOTHING ELSE`,
		},
		{
			role: 'user',
			content: `
				The changed made were in the following code symbols:
				You are given a json like structure with the fields name (name of the code symbol which changed)
				diffPatch: The changes made in the code symbol in a diff view
				lastEditTime: The last time the code symbol was edited

				${JSON.stringify(codeSymbolChanges)}
			`,
		},
	];
