/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import type { Position, TextDocument } from 'vscode';

import type { DocumentContext } from '../get-current-doc-context';

import type { FetchCompletionResult, StreamCompletionResponse } from './fetch-and-process-completions';
import { TypeDefinitionProviderWithNode } from '../helpers/vscodeApi';

export interface ProviderConfig {
	/**
	 * A factory to create instances of the provider. This pattern allows us to
	 * inject provider specific parameters outside of the callers of the
	 * factory.
	 */
	create(options: Omit<ProviderOptions, 'id'>): Provider;

	/**
	 * Hints about the optimal context size (and length of the document prefix and suffix). It is
	 * intended to (or possible to) be precise here because the truncation of the document
	 * prefix/suffix uses characters, not the LLM's tokenizer.
	 */
	contextSizeHints: ProviderContextSizeHints;

	/**
	 * A string identifier for the provider config used in event logs.
	 */
	identifier: string;

	/**
	 * Defines which model is used with the respective provider.
	 */
	model: string;
}

interface ProviderContextSizeHints {
	/** Total max length of all context (prefix + suffix + snippets). */
	totalChars: number;

	/** Max length of the document prefix (text before the cursor). */
	prefixChars: number;

	/** Max length of the document suffix (text after the cursor). */
	suffixChars: number;
}

export interface ProviderOptions {
	/**
	 * A unique and descriptive identifier for the provider.
	 */
	id: string;

	/**
	 * The span id of the current completion request.
	 */
	spanId: string;

	position: Position;
	document: TextDocument;
	docContext: DocumentContext;
	multiline: boolean;
	/**
	 * Number of parallel LLM requests per completion.
	 */
	n: number;
	/**
	 *  Timeout in milliseconds for the first completion to be yielded from the completions generator.
	 */
	firstCompletionTimeout: number;

	// feature flags
	dynamicMultilineCompletions?: boolean;
	hotStreak?: boolean;
	fastPath?: boolean;
}

export abstract class Provider {
	constructor(public readonly options: Readonly<ProviderOptions>) { }

	public abstract generateCompletions(
		abortSignal: AbortSignal,
		startTime: number,
	): AsyncGenerator<FetchCompletionResult[]>;

	public abstract generateCompletionsPlain(
		abortSignal: AbortSignal,
		startTime: number,
		clipBoardContext: string | null,
		identifierNodes: TypeDefinitionProviderWithNode[],
	): AsyncIterable<StreamCompletionResponse>;
}
