/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { onceDocumentLoaded } from './events';

const vscode = acquireVsCodeApi();

// TODO(@g-danna) Add shared types
function getSettings() {
	const element = document.getElementById('simple-browser-settings');
	if (element) {
		const data = element.getAttribute('data-settings');
		if (data) {
			return JSON.parse(data);
		}
	}

	throw new Error(`Could not load settings`);
}

const settings = getSettings();

const browserIframe = document.querySelector('iframe#browser') as HTMLIFrameElement;

const rootNodeId = 'root';
const rootDomNode = document.getElementById(rootNodeId);
if (!rootDomNode) {
	throw new Error(`Root node with id '${rootNodeId} not found.`);
}

const header = document.querySelector('.header')!;
const input = header.querySelector<HTMLInputElement>('.url-input')!;
const forwardButton = header.querySelector<HTMLButtonElement>('.forward-button')!;
const backButton = header.querySelector<HTMLButtonElement>('.back-button')!;
const reloadButton = header.querySelector<HTMLButtonElement>('.reload-button')!;
const clearOverlaysButton = header.querySelector<HTMLButtonElement>('.clear-overlays-button')!;
const openExternalButton = header.querySelector<HTMLButtonElement>('.open-external-button')!;

window.addEventListener('message', (e) => {
	switch (e.data.type) {
		case 'focus': {
			browserIframe.focus();
			break;
		}
		case 'didChangeFocusLockIndicatorEnabled': {
			toggleFocusLockIndicatorEnabled(e.data.enabled);
			break;
		}
	}
});

function getInputValue(url: URL) {
	const displayLocation = new URL(url);
	const port = url.port;
	const activeSession = settings.sessions[port];
	if (activeSession) {
		displayLocation.port = activeSession.toString();
	}

	if (displayLocation.searchParams.has('vscodeBrowserReqId')) {
		displayLocation.searchParams.delete('vscodeBrowserReqId');
	}
	return displayLocation.href;
}

onceDocumentLoaded(() => {
	setInterval(() => {
		const iframeFocused = document.activeElement?.tagName === 'IFRAME';
		document.body.classList.toggle('iframe-focused', iframeFocused);
	}, 50);

	browserIframe.addEventListener('load', () => {
		window.addEventListener('message', (event) => {
			if (event.isTrusted && event.data.type === 'location-change') {
				const newLocation = new URL(event.data.location);
				input.value = getInputValue(newLocation);
			}
		});
	});

	input.addEventListener('change', (e) => {
		const url = (e.target as HTMLInputElement).value;
		navigateTo(url);
	});

	forwardButton.addEventListener('click', () => {
		history.forward();
	});

	backButton.addEventListener('click', () => {
		history.back();
	});

	clearOverlaysButton.addEventListener('click', () => {
		vscode.postMessage({
			type: 'clearOverlays'
		});
	});

	openExternalButton.addEventListener('click', () => {
		vscode.postMessage({
			type: 'openExternal',
			url: input.value,
		});
	});

	reloadButton.addEventListener('click', () => {
		// This does not seem to trigger what we want
		// history.go(0);

		// This incorrectly adds entries to the history but does reload
		// It also always incorrectly always loads the value in the input bar,
		// which may not match the current page if the user has navigated
		navigateTo(input.value);
	});

	navigateTo(settings.url, true);
	input.value = getInputValue(new URL(settings.url));

	toggleFocusLockIndicatorEnabled(settings.focusLockIndicatorEnabled);

	function navigateTo(rawUrl: string, isIntitialization = false): void {
		try {
			const url = new URL(rawUrl);
			// Try to bust the cache for the iframe
			// There does not appear to be any way to reliably do this except modifying the url
			url.searchParams.append('vscodeBrowserReqId', Date.now().toString());

			browserIframe.src = url.toString();
		} catch {
			browserIframe.src = rawUrl;
		}

		const payload = { url: rawUrl, originalUrl: settings.originalUrl };

		if (!isIntitialization) {
			// We are not initializing, send a message to change the URL and kick off
			// related lifecycle events
			vscode.postMessage({
				type: 'updateUrl',
				data: payload
			});
		}
		vscode.setState(payload);
	}
});

function toggleFocusLockIndicatorEnabled(enabled: boolean) {
	document.body.classList.toggle('enable-focus-lock-indicator', enabled);
}

/**
 * API exposed to webviews.
 *
 * @template StateType Type of the persisted state stored for the webview.
 */
export interface WebviewApi<StateType> {
	/**
	 * Post a message to the owner of the webview.
	 *
	 * @param message Data to post. Must be JSON serializable.
	 */
	postMessage(message: unknown): void;

	/**
	 * Get the persistent state stored for this webview.
	 *
	 * @return The current state or `undefined` if no state has been set.
	 */
	getState(): StateType | undefined;

	/**
	 * Set the persistent state stored for this webview.
	 *
	 * @param newState New persisted state. This must be a JSON serializable object. Can be retrieved
	 * using {@link getState}.
	 *
	 * @return The new state.
	 */
	setState<T extends StateType | undefined>(newState: T): T;
}

declare global {
	/**
	 * Acquire an instance of the webview API.
	 *
	 * This may only be called once in a webview's context. Attempting to call `acquireVsCodeApi` after it has already
	 * been called will throw an exception.
	 *
	 * @template StateType Type of the persisted state stored for the webview.
	 */
	// tslint:disable-next-line:no-unnecessary-generics
	function acquireVsCodeApi<StateType = unknown>(): WebviewApi<StateType>;
}
