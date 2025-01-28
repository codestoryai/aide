/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export class TimeoutError extends Error {
	constructor(message?: string) {
		super(message);
		this.name = 'TimeoutError';
	}
}

export class AbortError extends Error {
	constructor(message?: string) {
		super();
		this.name = 'AbortError';
		this.message = message || '';
	}
}

const getDOMException = (errorMessage: string) => globalThis.DOMException === undefined
	? new AbortError(errorMessage)
	: new DOMException(errorMessage);

const getAbortedReason = (signal: AbortSignal) => {
	const reason = signal.reason === undefined
		? getDOMException('This operation was aborted.')
		: signal.reason;

	return reason instanceof Error ? reason : getDOMException(reason);
};

interface PTimeoutOptions {
	milliseconds: number;
	fallback?: () => any;
	message?: string | Error | false;
	customTimers?: {
		setTimeout: typeof setTimeout;
		clearTimeout: typeof clearTimeout;
	};
	signal?: AbortSignal;
}

interface CancelablePromise<T> extends Promise<T> {
	clear: () => void;
}

interface CancelableInput<T> extends Promise<T> {
	cancel?: () => void;
}

export default function pTimeout<T>(promise: CancelableInput<T>, options: PTimeoutOptions): CancelablePromise<T> {
	const {
		milliseconds,
		fallback,
		message,
		customTimers = { setTimeout, clearTimeout },
	} = options;

	let timer: ReturnType<typeof setTimeout> | undefined;

	const wrappedPromise = new Promise((resolve, reject) => {
		if (typeof milliseconds !== 'number' || Math.sign(milliseconds) !== 1) {
			throw new TypeError(`Expected \`milliseconds\` to be a positive number, got \`${milliseconds}\``);
		}

		if (options.signal) {
			const { signal } = options;
			if (signal.aborted) {
				reject(getAbortedReason(signal));
			}

			const abortHandler = () => {
				reject(getAbortedReason(signal));
			};

			signal.addEventListener('abort', abortHandler, { once: true });

			promise.finally(() => {
				signal.removeEventListener('abort', abortHandler);
			});
		}

		if (milliseconds === Number.POSITIVE_INFINITY) {
			promise.then(resolve, reject);
			return;
		}

		// We create the error outside of `setTimeout` to preserve the stack trace.
		const timeoutError = new TimeoutError();

		timer = customTimers.setTimeout.call(undefined, () => {
			if (fallback) {
				try {
					resolve(fallback());
				} catch (error) {
					reject(error);
				}

				return;
			}

			if (typeof promise.cancel === 'function') {
				promise.cancel();
			}

			if (message === false) {
				resolve(undefined);
			} else if (message instanceof Error) {
				reject(message);
			} else {
				timeoutError.message = message ?? `Promise timed out after ${milliseconds} milliseconds`;
				reject(timeoutError);
			}
		}, milliseconds);

		(async () => {
			try {
				resolve(await promise);
			} catch (error) {
				reject(error);
			}
		})();
	});

	const cancelablePromise = wrappedPromise.finally(() => {
		cancelablePromise.clear();
	}) as CancelablePromise<T>;

	cancelablePromise.clear = () => {
		customTimers.clearTimeout.call(undefined, timer);
		timer = undefined;
	};

	return cancelablePromise;
}
