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
    private _currentEvent: string[];

    constructor() {
        this._buffer = [];
        this._currentEvent = [];
    }

    public transform(chunk: string): string[] {
        const finalAnswer: string[] = [];

        for (let i = 0, len = chunk.length; i < len; ++i) {
            // Handle line endings
            if (chunk[i] === '\n') {
                const line = this._buffer.join('');
                this._buffer = [];

                // Skip empty lines
                if (!line.trim()) {
                    // Empty line marks end of event
                    if (this._currentEvent.length > 0) {
                        const event = this._currentEvent.join('\n');
                        if (event.includes('data:')) {
                            finalAnswer.push(event);
                        }
                        this._currentEvent = [];
                    }
                    continue;
                }

                this._currentEvent.push(line);
                continue;
            }

            this._buffer.push(chunk[i]);
        }

        // Handle any remaining buffer at the end of chunk
        if (this._buffer.length > 0) {
            const line = this._buffer.join('');
            if (line.trim()) {
                this._currentEvent.push(line);
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
// Test if 401 error thrown is thrown and caught correctly
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