/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
export const generateContextForEmbedding = (
	codeSnippet: string,
	filePath: string,
	scopePart: string | null
): string => {
	return `
	Code snippet:
	${codeSnippet}

	File path it belongs to:
	${filePath}

	Scope part:
	${scopePart}
`;
};
