/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export async function* callServerEvent(url: string): AsyncIterableIterator<string> {
	const response = await fetch(url, {
		method: 'GET',
		headers: {
			'Content-Type': 'application/json',
			'accept': 'text/event-stream',
		},
	});
	if (response.body === null) {
		return;
	}
	const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();

	try {
		while (true) {
			const { value, done } = await reader.read();
			if (done) {
				break;
			}
			yield value;
		}
	} finally {
		reader.releaseLock();
	}
}

class BufferedStream {
	private _buffer: string[];

	constructor() {
		this._buffer = [];
	}

	public transform(chunk: string): string[] {
		const finalAnswer: string[] = [];

		for (let i = 0, len = chunk.length; i < len; ++i) {

			// axum sends \n\n as the separator between events
			// log when we have a hit for this
			let isEventSeparator = false;
			if (i !== 0) {
				isEventSeparator = chunk[i] === '\n' && chunk[i - 1] === '\n';
			}

			// Keep buffering unless we've hit the end of an event
			if (!isEventSeparator) {
				this._buffer.push(chunk[i]);
				continue;
			}

			const event = this._buffer.join('');

			if (event) {
				finalAnswer.push(event);
			}

			this._buffer = [];
		}
		return finalAnswer;
	}
}

export async function* callServerEventStreamingBufferedGET(url: string): AsyncIterableIterator<string> {
	const response = await fetch(url, {
		method: 'GET',
		headers: {
			'Content-Type': 'application/json',
			'accept': 'text/event-stream',
		},
	});

	if (response.body === null) {
		return;
	}

	const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
	const bufferedReader = new BufferedStream();

	try {
		while (true) {
			const { value, done } = await reader.read();
			let newValues: string[] = [];
			if (value !== undefined) {
				newValues = bufferedReader.transform(value);
			}
			if (done) {
				break;
			}
			for (const value of newValues) {
				yield value;
			}
		}
	} finally {
		reader.releaseLock();
	}
}

// auth header may be passed here
export async function* callServerEventStreamingBufferedPOST(url: string, body: any, headers?: Record<string, string>): AsyncIterableIterator<string> {
	const response = await fetch(url, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			'accept': 'text/event-stream',
			...headers,
		},
		body: JSON.stringify(body),
	});

	if (response.body === null) {
		return;
	}

	const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
	const bufferedReader = new BufferedStream();

	try {
		while (true) {
			const { value, done } = await reader.read();
			let newValues: string[] = [];
			if (value !== undefined) {
				newValues = bufferedReader.transform(value);
			}
			if (done) {
				break;
			}
			for (const value of newValues) {
				yield value;
			}
		}
	} finally {
		reader.releaseLock();
	}
}
