/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CompletionRequest } from '../../inlineCompletion/sidecarCompletion';
import { SideCarClient } from '../../sidecar/client';
import { forkSignal, zipGenerators } from '../utils';
import * as CompletionLogger from '../logger';
import { FetchCompletionResult, StreamCompletionResponse, fetchAndProcessDynamicMultilineCompletions } from './fetch-and-process-completions';
import { Provider, ProviderOptions } from './provider';
import { TypeDefinitionProviderWithNode } from '../helpers/vscodeApi';

export class SidecarProvider extends Provider {
	private _sidecarClient: SideCarClient;
	private _logger: CompletionLogger.LoggingService;
	constructor(options: ProviderOptions, sidecarClient: SideCarClient, logger: CompletionLogger.LoggingService) {
		super(options);
		this._sidecarClient = sidecarClient;
		this._logger = logger;
	}

	public generateCompletionsPlain(
		abortSignal: AbortSignal,
		startTime: number,
		clipBoardContext: string | null,
		identifierNodes: TypeDefinitionProviderWithNode[],
	): AsyncIterable<StreamCompletionResponse> {
		const { languageId, uri } = this.options.document;
		const completionRequest: CompletionRequest = {
			filepath: uri.fsPath,
			language: languageId,
			text: this.options.document.getText(),
			position: {
				line: this.options.position.line,
				character: this.options.position.character,
				byteOffset: this.options.document.offsetAt(this.options.position),
			},
			clipboard: clipBoardContext ?? undefined,
			id: this.options.spanId,
			requestId: this.options.spanId,
			identifierNodes,
		};
		// const now = performance.now();
		this._logger.logInfo('sidecar.inlineProvider.generate_completions_plain.send_completion_request', {
			'event_name': 'send_completion_request',
			'id': this.options.spanId,
		});
		const responseStream = this._sidecarClient.inlineCompletionTextNewLine(
			completionRequest,
			abortSignal,
			this._logger,
			this.options.spanId,
			startTime,
		);
		return responseStream;
	}

	public generateCompletions(abortSignal: AbortSignal, startTime: number): AsyncGenerator<FetchCompletionResult[]> {
		const { languageId, uri } = this.options.document;
		this._logger.logInfo('sidecar.inlineProvider', {
			'event_name': 'generate_completions',
			'id': this.options.spanId,
		});
		const fetchAndProcessCompletionsImpl = fetchAndProcessDynamicMultilineCompletions;
		// send over the request to the sidecar
		const completionRequest: CompletionRequest = {
			filepath: uri.fsPath,
			language: languageId,
			text: this.options.document.getText(),
			position: {
				line: this.options.position.line,
				character: this.options.position.character,
				byteOffset: this.options.document.offsetAt(this.options.position),
			},
			id: this.options.spanId,
			requestId: this.options.spanId,
			identifierNodes: [],
		};
		const now = performance.now();
		this._logger.logInfo(
			'sidecar.inlineProvider.send_completion_request',
			{
				'event_name': 'send_completion_request',
				'id': this.options.spanId,
			}
		);
		const responseStream = this._sidecarClient.inlineCompletionTextNewLine(
			completionRequest,
			abortSignal,
			this._logger,
			this.options.spanId,
			startTime,
		);
		this._logger.logInfo(
			'sidecar.inlineProvider.responseStream',
			{
				'event_name': 'response_stream',
				'id': this.options.spanId,
				'time_taken': performance.now() - now,
			}
		);
		const abortController = forkSignal(abortSignal);
		const stream = fetchAndProcessCompletionsImpl({
			completionResponseGenerator: responseStream,
			abortController,
			providerSpecificPostProcess: (insertText: string) => insertText,
			providerOptions: this.options,
			logger: this._logger,
			spanId: this.options.spanId,
		});
		return zipGenerators([stream]);
	}
}
