/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { OpenAI } from 'openai';

export const generatePlanAndQueriesPrompt = (): string => {
	return `
		Think step-by-step to break down the requested problem or feature, and write up to three queries for the code search engine. These queries should find relevant code that is not already mentioned in the existing snippets. They should all mention different files and subtasks of the initial issue, avoid duplicates.
		Then add more instructions that build on the user's instructions. These instructions should help plan how to solve the issue.
		* The code search engine is based on semantic similarity. Ask questions that involve code snippets, function references, or mention relevant file paths.
		* The user's instructions should be treated as the source of truth, but sometimes the user will not mention the entire context. In that case, you should add the missing context.
		* Gather files that are relevant, including dependencies and similar files in the codebase. For example, if the user asked to write tests, look at similar tests.

		You MUST follow the following format delimited with XML tags:

		Step-by-step thoughts with explanations:
		* Thought 1 - Explanation 1
		* Thought 2 - Explanation 2
		...

		<queries>
		* query 1
		* query 2
		* query 3
		</queries>

		<additional_instructions>
		* additional instructions to be appended to the user's instructions
		</additional_instructions>
`;
};

export interface PlanAndQueriesResponse {
	queries: string[];
	additionalInstructions: string[];
}

export function generatePlanAndQueriesResponseParser(
	response: string
): PlanAndQueriesResponse | null {
	if (
		!response.includes('<additional_instructions>') ||
		!response.includes('</additional_instructions>')
	) {
		return null;
	}
	if (!response.includes('<queries>') || !response.includes('</queries>')) {
		return null;
	}

	const additionalInstructions = response
		.split('<additional_instructions>')[1]
		.split('</additional_instructions>')[0];
	const additionalInstructionsList = additionalInstructions.split('\n*');
	const instructions = additionalInstructionsList
		.map((instruction) => instruction.trim())
		.filter((instruction) => instruction.length > 0);

	const additionalQueries = response.split('<queries>')[1].split('</queries>')[0];
	const additionalQueriesList = additionalQueries.split('\n*');
	// console.log('additional queries list');
	// console.log(additionalQueriesList);
	const queries = additionalQueriesList
		.map((query) => query.trim())
		.filter((query) => query.length > 0);

	return {
		queries,
		additionalInstructions: instructions,
	};
}

export const fileFunctionsToParsePrompt = (): string => {
	return `
		Think step-by-step to break down the requested problem or feature, and then figure out what to change in the current codebase.
		Then, provide a list of files you would like to modify, follow the following rules:
		* Including the FULL name of the symbol, e.g. src.main.function and not just function, using the name of the code symbol as the truth.
		* ONLY modify existing code symbols and don't create new ones
		* Only modify code symbols that definitely need to be touched
		* Use detailed, natural language instructions on what to modify, with reference to variable names
		* Be concrete with instructions and do not write 'check for x' or 'look for y'. Simply write 'add x' or 'change y to z'.
		* There MUST be modify_code_symbol XML tags
		* The list of code symbols to modify may be empty, but you MUST leave the XML tags with a single list element with '* None'
		* modify up to 5 code symbols.
		You must list only a single code symbol for modification per line

		You MUST follow the following format delimited with XML tags:

		Step-by-step thoughts with explanations:
		* Thought 1 - Explanation 1
		* Thought 2 - Explanation 2
		...

		<modify_code_symbol>
		* code_symbol_1: instructions_1
		* code_symbol_2: instructions_2
		...
		</modify_code_symbol>
`;
};

export interface CodeSymbolModificationInstruction {
	codeSymbolName: string;
	instructions: string;
}

export interface FileFunctionsToParseResponse {
	codeSymbolModificationInstructionList: CodeSymbolModificationInstruction[];
}

export function generateFileFunctionsResponseParser(
	response: string
): FileFunctionsToParseResponse {
	// console.log('[generateFileFunctionsResponseParser] what kind of response', response);
	if (!response.includes('<modify_code_symbol>') || !response.includes('</modify_code_symbol>')) {
		return {
			codeSymbolModificationInstructionList: [],
		};
	}

	const modifyCodeSymbol = response
		.split('<modify_code_symbol>')[1]
		.split('</modify_code_symbol>')[0];
	const modifyCodeSymbolList = modifyCodeSymbol.split('\n*');
	const codeSymbolModificationInstructionList = modifyCodeSymbolList
		.map((codeSymbol) => codeSymbol.trim())
		.filter((codeSymbol) => codeSymbol.length > 0)
		.filter((codeSymbol) => codeSymbol !== 'None')
		.map((codeSymbol) => {
			// console.log(codeSymbol);
			const codeSymbolName = codeSymbol.split(':')[0].trim();
			const instructions = codeSymbol.split(':')[1].trim();
			return {
				codeSymbolName,
				instructions,
			};
		});

	return {
		codeSymbolModificationInstructionList,
	};
}

export const modifyCodeSnippetPrompt = (
	code: string,
	codeSnippet: string,
	instructions: string,
	filename: string
): string => {
	return `
File Name: ${filename}
<old_file>
${code}
</old_file>

---

User's request:
${instructions}

<code_snippet_to_change_for_instructions>
${codeSnippet}
</code_snippet_to_change_for_instructions>

---

Limit your changes to the context. Don't include the name of the language when doing the code generation step so after \`\`\` don't write the name of the language right after, as it messes up the parsing logic.
Instructions:
1. Complete the Code Planning step
2. Complete the Code Modification step, remembering to NOT write ellipses, code things out in full, and use multiple small hunks.
`;
};

export const generateModifyCodeHallucinationPrompt = (): OpenAI.Chat.CreateChatCompletionRequestMessage[] => {
	const modifyCodeHallucinationPrompt2: OpenAI.Chat.CreateChatCompletionRequestMessage[] = [
		{
			content: `
<old_file>
example = True
if example:
	x = 1 # comment
	print("hello")
	x = 2

class Example:
	foo: int = 1

	def func():
		a = 3

</old_file>

---

Code Planning:
<code_planning>
Step-by-step thoughts with explanations:
* Thought 1
* Thought 2
...

Detailed plan of modifications:
* Modification 1
* Modification 2
...
</code_planning>

Code Generation:
\`\`\`
Generate a diff based on the given plan using the search and replace pairs in the format below.
* Always prefer the least amount of changes possible, but ensure the solution is complete
* Prefer multiple small changes over a single large change.
* NEVER write ellipses anywhere in the diffs.Simply write two diff hunks: one for the beginning and another for the end.
* Always add lines before and after.The ORIGINAL section should be at least 5 lines long.

The format is as follows:

<code_generation>
<<<< ORIGINAL
line_before
old_code
line_after
====
line_before
new_code
line_after
>>>> UPDATED
</code_generation>
\`\`\`

Commit message: "the commit message"

Request: "Change hello to goodbye and change 3 to 4". Limit your changes to the request.

Instructions:
1. Complete the Code Planning step
2. Complete the Code Generation step
			`,
			role: 'user',
		},
		{
			content: `
Code Planning:
<code_planning>
Step-by-step thoughts with explanations:
* We need to print "goodbye" instead of "hello".
* We need to update the value of the variable a from 3 to 4.

Detailed plan of modifications:
* Change the output of the print statement from "hello" to "goodbye" as an example modification.
* I will update the value of a from 3 to 4.
</code_planning>

Code Generation:
\`\`\`
<code_generation>
<<<< ORIGINAL
example = True
if example:
x = 1 # comment
	print("hello")
	x = 2
====
example = True
if example:
x = 1 # comment
	print("goodbye")
	x = 2
>>>> UPDATED

<<<< ORIGINAL
class Example:
foo: int = 1

	def func():
	a = 3
====
class Example:
foo: int = 1

	def func():
	a = 4
>>>> UPDATED
</code_generation>
\`\`\`

Commit message: "Changed goodbye to hello and 3 to 4
				`,
			role: 'assistant',
		}
	];

	/*
	const modifyCodeHallucinationPrompt: OpenAI.Chat.CreateChatCompletionRequestMessage[] = [
		{
			content: `
File Name: (non - existent example)
<old_file>
example = True
if example:
		x = 1 # comment
	print('hello')
	x = 2

def func():
	a = 3

		< /old_file>

	---

		Code Planning:
	<code_planning>
		Step - by - step thoughts with explanations:
* Thought 1 - Explanation 1
		* Thought 2 - Explanation 2
...

Detailed plan of modifications:
* Modification 1
	* Modification 2
...

Lines to change in the file: (include multiple small changes as opposed to one large change)
* lines a - b: Do x
	* lines c: Change to y
...
</code_planning>

Code Generation:
\`\`\`
Generate a diff based on the given plan using the search and replace pairs in the following format.Always prefer the least amount of changes possible.Do not remove comments.
<code_generation>
<<<< ORIGINAL
old_code
====
new_code
>>>> UPDATED
</code_generation>
\`\`\`

Context: 'Change hello to goodbye and change 3 to 4'. Limit your changes to the context.
Instructions:
1. Complete the Code Planning step
2. Complete the Code Generation step`,
			role: 'user',
		},
		{
			content: `
Code Planning:
<code_planning>
Step- by - step thoughts with explanations:
* Thought 1 - This script is an example script not in the repo.To show that I fully understand git diff format, I must write the diffs.

Detailed plan of modifications:
* Modification 1 - Change the output of the print statement from 'hello' to 'goodbye' as an example modification.
* Modification 2 - I will update the value of a from 3 to 4.

Lines to change in the file:
* lines 4: update print statement
	* lines 8: update value of a
		< /code_planning>

Code Generation:
<code_generation>
\`\`\`
<<<< ORIGINAL
x = 1 # comment
print('hello')
x = 2
====
x = 1 # comment
print('goodbye')
x = 2
>>>> UPDATED

<<<< ORIGINAL
def func():
	a = 3
====
def func():
	a = 4
>>>> UPDATED
< /code_generation>
\`\`\``,
			role: 'assistant',
		},
	];
	*/
	return modifyCodeHallucinationPrompt2;
};

export interface CodeModificationContextAndDiff {
	codeModification: string;
	codeDiff: string;
}

export const parseCodeModificationResponse = (
	response: string
): CodeModificationContextAndDiff | null => {
	// console.log('[parseCodeModificationResponse] response', response);
	if (!response.includes('<code_planning>') || !response.includes('</code_planning>')) {
		return null;
	}
	if (!response.includes('<code_generation>') || !response.includes('</code_generation>')) {
		return null;
	}

	const codePlanning = response.split('<code_planning>')[1].split('</code_planning>')[0];
	const codePlanningList = codePlanning.split('\n*');
	const codePlanningInstructions = codePlanningList
		.map((instruction) => instruction.trim())
		.filter((instruction) => instruction.length > 0);

	const codeGeneration = response.split('<code_generation>')[1].split('</code_generation>')[0];
	const codeGenerationList = codeGeneration.split('\n*');
	const codeGenerationInstructions = codeGenerationList
		.map((instruction) => instruction.trim())
		.filter((instruction) => instruction.length > 0);

	return {
		codeModification: codePlanningInstructions.join('\n'),
		codeDiff: codeGenerationInstructions.join('\n'),
	};
};

export const newFileContentAndDiffPrompt = (
	fileName: string,
	oldFileContent: string,
	codeSnippetToChangeInstruction: string,
	diffToApply: string,
	whyDiffIsNecessary: string
): string => {
	return `
Think step-by-step regarding the instructions and how you can create new file content after applying the diff.
Include any new dependencies which you think are missing in the file (we take care of installing it)
Don't change any part of the code which is not mentioned in the diff and DON't modify the logic or remove comments.
When you put code in \`\`\` don't include the name of the language right after, never do that as it leads to errors when parsing.

<file_name>
${fileName}
</file_name>

<old_file_content>
${oldFileContent}
</old_file_content>

<code_snippet_to_change>
${codeSnippetToChangeInstruction}
</code_snippet_to_change>

<diff_to_apply>
${diffToApply}
</diff_to_apply>

<why_diff_is_necessary>
${whyDiffIsNecessary}
</why_diff_is_necessary>

Step by step thoughts with explanations:
<thoughts_with_explanation>
* Thought 1 - Explanation 1
* Thought 2 - Explanation 2
...
</thoughts_with_explanation>

Detailed plan for changing the file content:
<plan_for_file_content_generation>
* Step 1
* Step 2
...
</plan_for_file_content_generation>

Final file content:
<final_file_content>
... (fill this with the new file content)
</final_file_content>
`;
};

export interface NewFileContentAndDiffResponse {
	newFileContent: string;
}

export function generateNewFileContentAndDiffResponseParser(
	response: string
): NewFileContentAndDiffResponse | null {
	if (!response.includes('<final_file_content>') || !response.includes('</final_file_content>')) {
		return null;
	}
	const newFileContent = response
		.split('<final_file_content>')[1]
		.split('</final_file_content>')[0];

	// So the code might be in ```\n{code}\n``` we want to parse that
	// out
	const codeSnippetRegex = /```\n([\s\S]*)\n```/g;
	const codeSnippetMatch = codeSnippetRegex.exec(newFileContent);
	if (codeSnippetMatch) {
		return {
			newFileContent: codeSnippetMatch[1],
		};
	}
	return {
		newFileContent,
	};
}


export const generateTestScriptGenerationPrompt = (
	testFramework: string,
	fileName: string,
	codeSymbolName: string,
	newFileContent: string,
	diffToApply: string,
	whyDiffIsNecessary: string,
	moduleName: string,
): string => {
	return `
Think step-by-step regarding the instructions and how you can test the changes you have done to the function. You have to generate a script to test out your changes.
You are given the instructions on what has to change for the function, but we want to prove it works. So we need to generate a script for it. The script should ideally just call this function and do some checks later on, and all of it should be written in the same language as the original language of the file.
Your test should make sure that the changes made solve the user query if its a bug they asked your to fix.
Please make sure to include the relevant imports from the original file which you will need to import for your test script.
Don't forget to satisfy all the parameters for the function being tested in the generated code.

If you are importing from the current file use the module name provided as the source of the import.

We might be using a particular test framework, so make sure your test runs for that framework

Generate a new test file which can be run via ${testFramework}

<test_framework_used>
${testFramework}
</test_framework_used>

<file_name>
${fileName}
</file_name>

<code_name_which_changed>
${codeSymbolName}
</code_name_which_changed>

<new_file_content>
${newFileContent}
</new_file_content>


<diff_we_applied>
${diffToApply}
</diff_we_applied>

<why_diff_was_necessary>
${whyDiffIsNecessary}
</why_diff_is_necessary>

<module_name_for_imports>
${moduleName}
</module_name_for_imports>

Follow the XML below and make sure to fill each xml section with your output

Step by step thoughts on how to test the change with explanations:
<thoughts_with_explanation>
* Thought 1 - Explanation 1
* Thought 2 - Explanation 2
...
</thoughts_with_explanation>

Detailed plan for test script generation:
<plan_for_test_script_generation>
* Step 1
* Step 2
...
</plan_for_test_script_generation>

Imports required:
<imports>
* import x
* import y
...
</imports>

Test setup required required (no user input should be requested):
<test_setup_required>
* Step 1: For example create files for input which you are going to test on
* Step 2: ....
...
</test_setup_required>

Test script:
<test_script>
... (fill this with the test script)
</test_script>
`;
};

export interface TextExecutionHarness {
	testScript: string;
	imports: string;
	planForTestScriptGeneration: string;
	thoughtsWithExplanation: string;
	codeSymbolName: string;
	testSetupRequired: string;
	testFileLocation: string;
}


export const parseTestPlanResponseForHarness = (
	response: string,
	codeSymbolName: string,
): TextExecutionHarness | null => {
	if (!response.includes('<test_script>') || !response.includes('</test_script>')) {
		return null;
	}
	if (!response.includes('<imports>') || !response.includes('</imports>')) {
		return null;
	}
	if (!response.includes('<plan_for_test_script_generation>') || !response.includes('</plan_for_test_script_generation>')) {
		return null;
	}
	if (!response.includes('<thoughts_with_explanation>') || !response.includes('</thoughts_with_explanation>')) {
		return null;
	}
	if (!response.includes('<test_setup_required>') || !response.includes('</test_setup_required>')) {
		return null;
	}
	const testScript = response.split('<test_script>')[1].split('</test_script>')[0];
	const imports = response.split('<imports>')[1].split('</imports>')[0];
	const planForTestScriptGeneration = response.split('<plan_for_test_script_generation>')[1].split('</plan_for_test_script_generation>')[0];
	const thoughtsWithExplanation = response.split('<thoughts_with_explanation>')[1].split('</thoughts_with_explanation>')[0];
	const testSetupRequired = response.split('<test_setup_required>')[1].split('</test_setup_required>')[0];
	const fileNameForCodeSymbol = codeSymbolName.replace('.', '/') + '.ts';
	const directoryLocation = '/tmp';
	const testFileLocation = directoryLocation + '/' + fileNameForCodeSymbol;
	return {
		testScript,
		imports,
		planForTestScriptGeneration,
		thoughtsWithExplanation,
		codeSymbolName,
		testSetupRequired,
		testFileLocation,
	};
};


export const generateTestExecutionPrompt = (
	testFramework: string,
	imports: string,
	codeSymbolName: string,
	codeSymbolContent: string,
	testSetupRequired: string,
	testScript: string,
): string => {
	return `
Lets think step-by-step regarding the setup process for the final test file generation.
You have to generate the final test script to test out a solution of the user query.
You have to make sure the code executes on first try and always works.
Pay attention to what the code symbol is doing so you can do the appropriate setup.
For example it might be just reading files and not creating them.
Do NOT MOCK ANY FUNCTION

If you want to use files, you can use the ones in /tmp/codestory/typescript.ts, /tmp/codestory/typescript1.ts or /tmp/codestory/python.py
As for directory use /tmp/codestory/ as the directory always

We might be using a particular test framework, so make sure your test runs for that framework

Generate a new test file which can be run via ${testFramework}

<imports_required_for_running_test_script>
${imports}
</imports_required_for_running_test_script>

<code_symbol_being_tested>
${codeSymbolName}
</code_symbol_being_tested>

<code_symbol_content>
${codeSymbolContent}
</code_symbol_content>

<test_setup_required>
${testSetupRequired}
</test_setup_required>

<partially_generated_test_script>
${testScript}
</partially_generated_test_script>


Always remember to include the xml tags for each section when you are filling them in.

Step by step thoughts on how to generate the test script to run with explanations:
<thoughts_with_explanation>
* Thought 1 - Explanation 1
* Thought 2 - Explanation 2
...
</thoughts_with_explanation>

Detailed plan for test script generation:
<plan_for_test_script_generation>
* Step 1
* Step 2
...
</plan_for_test_script_generation>

Generate the full test script, and repeat yourself event if its the same
Test script:
<test_script>
... (fill this with the test script)
</test_script>
`;
};

export interface TestExecutionFinalSetupResponse {
	testScript: string;
}

export const parseTestExecutionFinalSetupResponse = (
	response: string,
): TestExecutionFinalSetupResponse | null => {
	if (!response.includes('<test_script>') || !response.includes('</test_script>')) {
		return null;
	}
	const testScript = response.split('<test_script>')[1].split('</test_script>')[0];
	// The test script might be in ```\n{code}\n``` we want to parse that
	// out
	const codeSnippetRegex = /```\n([\s\S]*)\n```/g;
	const codeSnippetMatch = codeSnippetRegex.exec(testScript);
	if (codeSnippetMatch) {
		return {
			testScript: codeSnippetMatch[1],
		};
	}
	return null;
};
