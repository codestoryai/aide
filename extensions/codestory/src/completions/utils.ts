/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
export class TimeoutError extends Error { }

/**
 * Creates a new signal that forks a parent signal. When the parent signal is aborted, the forked
 * signal will be aborted as well. This allows propagating abort signals across asynchronous
 * operations.
 *
 * Aborting the forked controller however does not affect the parent.
 */
export function forkSignal(signal: AbortSignal): AbortController {
	const controller = new AbortController();
	if (signal.aborted) {
		controller.abort();
	}
	signal.addEventListener('abort', () => controller.abort());
	return controller;
}

/**
 * Creates a simple subscriber that can be used to register callbacks
 */
type Listener<T> = (value: T) => void;
interface Subscriber<T> {
	subscribe(listener: Listener<T>): () => void;
	notify(value: T): void;
}
export function createSubscriber<T>(): Subscriber<T> {
	const listeners: Set<Listener<T>> = new Set();
	function subscribe(listener: Listener<T>): () => void {
		listeners.add(listener);
		return () => listeners.delete(listener);
	}

	function notify(value: T): void {
		for (const listener of listeners) {
			listener(value);
		}
	}

	return {
		subscribe,
		notify,
	};
}

export async function* zipGenerators<T>(generators: AsyncGenerator<T>[]): AsyncGenerator<T[]> {
	while (true) {
		const res = await Promise.all(generators.map(generator => generator.next()));

		if (res.every(r => r.done)) {
			return;
		}

		yield res.map(r => r.value);
	}
}

export async function* generatorWithErrorObserver<T>(
	generator: AsyncGenerator<T>,
	errorObserver: (error: unknown) => void
): AsyncGenerator<T> {
	while (true) {
		try {
			const res = await generator.next();
			if (res.done) {
				return;
			}
			yield res.value;
		} catch (error: unknown) {
			errorObserver(error);
			throw error;
		}
	}
}

export async function* generatorWithTimeout<T>(
	generator: AsyncGenerator<T>,
	timeoutMs: number,
	abortController: AbortController
): AsyncGenerator<T> {
	// timeout of 0 means no timeout
	if (timeoutMs === 0) {
		return;
	}

	const timeoutPromise = createTimeout(timeoutMs).finally(() => {
		abortController.abort();
	});

	while (true) {
		const { value, done } = await Promise.race([generator.next(), timeoutPromise]);

		if (value) {
			yield value;
		}

		if (done) {
			break;
		}
	}
}

function createTimeout(timeoutMs: number): Promise<never> {
	return new Promise((_, reject) =>
		setTimeout(() => reject(new TimeoutError('The request timed out')), timeoutMs)
	);
}
