/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../../base/common/event.js';
import { URI } from '../../../../base/common/uri.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';

export const pinnedContextPaneId = 'pinnedContext';
export const MANAGE_PINNED_CONTEXT = 'pinnedContext.manage';

export interface PinnedContextItem {
	readonly uri: URI;
}

const PINNED_CONTEXT_SERVICE_ID = 'pinnedContextService';
export const IPinnedContextService = createDecorator<IPinnedContextService>(PINNED_CONTEXT_SERVICE_ID);
export interface IPinnedContextService {
	readonly _serviceBrand: undefined;

	readonly onDidChangePinnedContexts: Event<void>;

	addContext(uri: URI): void;
	removeContext(uri: URI): void;
	clearContexts(): void;

	setContexts(uris: URI[]): void;
	getPinnedContexts(): URI[];
	hasContext(uri: URI): boolean;
}
