/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/


// export const getDefaultPrompt = (codeContext?: string): string | null => {
// 	if (codeContext === null) {
// 		return null;
// 	} else {
// 		return `
// 		The use has provided you with the following code context which you should use to answer their question:
// 		<code_context>
// 		${codeContext}
// 		</code_context>
// 		You have to answer the user question using the provided code Context and also previous context if they have provided you.
// 		Before answering the user question, you should first understand the user question and think step by step and then answer it.
// 		If you are generating code, you should generate it in the language of the code context.

// 		You MUST follow the following format delimited with XML tags:

// 		Step-by-step thoughts with explanations:
// 		* Thought 1 - Explanation 1
// 		* Thought 2 - Explanation 2
// 		...

// 		<your_answer>
// 		...
// 		</your_answer>
// 			`;

// 	}
// };
