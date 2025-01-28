/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { insertIntoDocContext, type DocumentContext } from '../get-current-doc-context'
import { LoggingService } from '../logger'
import { getFirstLine } from '../text-processing'

interface GetUpdatedDocumentContextParams {
	insertText: string
	languageId: string
	docContext: DocumentContext
}

/**
 * 1. Generates the object with `multilineTrigger` and `multilineTriggerPosition` fields pretending like the first line of the completion is already in the document.
 * 2. If the updated document context has the multiline trigger, returns the generated object
 * 3. Otherwise, returns an empty object.
 */
export function getDynamicMultilineDocContext(
	params: GetUpdatedDocumentContextParams,
	logger: LoggingService,
	spanId: string,
): Pick<DocumentContext, 'multilineTrigger' | 'multilineTriggerPosition'> | undefined {
	const { insertText, languageId, docContext } = params;

	const updatedDocContext = insertIntoDocContext({
		languageId,
		insertText: getFirstLine(insertText),
		dynamicMultilineCompletions: true,
		docContext,
	}, logger, spanId);

	const isMultilineBasedOnFirstLine = Boolean(updatedDocContext.multilineTrigger);

	if (isMultilineBasedOnFirstLine) {
		return {
			multilineTrigger: updatedDocContext.multilineTrigger,
			multilineTriggerPosition: updatedDocContext.multilineTriggerPosition,
		};
	}

	return undefined;
}
