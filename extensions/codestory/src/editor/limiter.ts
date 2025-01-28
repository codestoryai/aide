/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export class TimeoutError extends Error { }

export class AbortError extends Error { }

export class CustomAbortController {
	public signal = new CustomAbortSignal();
	public abort(): void {
		this.signal.abort();
	}
}
export class CustomAbortSignal {
	private listeners: Set<() => void> = new Set();
	public aborted = false;

	public addEventListener(_eventName: 'abort', listener: () => void): void {
		if (this.aborted) {
			void Promise.resolve().then(() => listener());
			return;
		}
		this.listeners.add(listener);
	}

	public removeEventListener(listener: () => void): void {
		this.listeners.delete(listener);
	}

	public abort(): void {
		if (this.aborted) {
			return;
		}
		this.aborted = true;
		for (const listener of this.listeners) {
			listener();
		}
		this.listeners.clear();
	}
}

type PromiseCreator<T> = () => Promise<T>;
interface Queued<T> {
	creator: PromiseCreator<T>;
	abortSignal?: AbortSignal | CustomAbortSignal;
	resolve: (value: T) => void;
	reject: (reason: Error) => void;
}

export type Limiter = <T>(creator: PromiseCreator<T>, abortSignal?: AbortSignal | CustomAbortSignal) => Promise<T>;

export function createLimiter(limit: number, timeout: number): Limiter {
	const queue: Queued<unknown>[] = [];
	let inflightPromises = 0;

	function processNext(): void {
		if (inflightPromises >= limit) {
			return;
		}

		if (queue.length === 0) {
			return;
		}

		const next = queue.shift()!;
		inflightPromises += 1;

		let didTimeout = false;

		const timeoutId = setTimeout(() => {
			didTimeout = true;
			next.reject(new TimeoutError());
			inflightPromises -= 1;
			processNext();
		}, timeout);

		const runner = next.creator();
		runner
			.then(value => {
				if (didTimeout) {
					return;
				}
				next.resolve(value);
			})
			.catch(error => {
				if (didTimeout) {
					return;
				}
				next.reject(error);
			})
			.finally(() => {
				if (didTimeout) {
					return;
				}
				clearTimeout(timeoutId);
				inflightPromises -= 1;
				processNext();
			});
	}

	return function enqueue<T>(creator: () => Promise<T>, abortSignal?: AbortSignal | CustomAbortSignal): Promise<T> {
		let queued: Queued<T>;
		const promise = new Promise<T>((resolve, reject) => {
			queued = {
				creator,
				abortSignal,
				resolve,
				reject,
			};
		});
		queue.push(queued! as Queued<unknown>);
		abortSignal?.addEventListener('abort', () => {
			// Only abort queued requests
			const index = queue.indexOf(queued! as Queued<unknown>);
			if (index < 0) {
				return;
			}

			queued.reject(new AbortError());
			queue.splice(index, 1);
		});

		processNext();

		return promise;
	};
}
