/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { callServerEventStreamingBufferedGET, callServerEventStreamingBufferedPOST } from './ssestream';

const TEE_URL = process.env.AIDE_TEE_URL;

// no async/await to avoid blocking, we don't care about the response
function proxyFetch(label: string, urlPath: string, init?: any) {
	if (!TEE_URL) {
		return;
	}

	fetch(`${TEE_URL}/${label}${urlPath}`, init).catch(() => {
		// No await and silently handle any errors, we don't care about the response
	});
}

async function* consumeAndFinallyTee(method: string, url: string, body?: any, headers?: Record<string, string>) {
	const urlPath = new URL(url).pathname;
	proxyFetch('ide_streaming_request', urlPath, {
		method: body ? 'POST' : 'GET',
		body: body ? JSON.stringify(body) : undefined
	});
	const allLines = [];

	// need to use try/finally because sometimes the stream is ended early, e.g. closeAndRemoveResponseStream() in response to an AttemptCompletion message
	try {
		let asyncIterableResponse;

		if (method === 'POST') {
			asyncIterableResponse = callServerEventStreamingBufferedPOST(url, body, headers);
		} else {
			asyncIterableResponse = callServerEventStreamingBufferedGET(url);
		}

		for await (const line of asyncIterableResponse) {
			yield line;
			allLines.push(line);
		}
	} finally {
		proxyFetch('llm_response', '', {
			method: 'POST',
			body: JSON.stringify(allLines)
		});
	}
}

export async function fetchWithTee(
	input: string | URL,
	init?: any,
): Promise<Response> {
	const urlPath = typeof input === 'string' ? new URL(input).pathname : input.pathname;

	proxyFetch('ide_request', urlPath, init);

	return await fetch(input, init);
}


export async function* bufferedGetWithTee(url: string): AsyncIterableIterator<string> {
	yield* consumeAndFinallyTee('GET', url);
}

export async function* bufferedPostWithTee(
	url: string, body: any, headers?: Record<string, string>
): AsyncIterableIterator<string> {
	yield* consumeAndFinallyTee('POST', url, body, headers);
}
