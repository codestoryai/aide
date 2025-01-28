/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../../../base/common/event.js';
import { URI } from '../../../../base/common/uri.js';
import { IContextKey, IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { IPinnedContextService } from '../common/pinnedContext.js';
import { CONTEXT_HAS_PINNED_CONTEXT } from '../common/pinnedContextContextKeys.js';

export class PinnedContextService implements IPinnedContextService {
	readonly _serviceBrand: undefined;

	private pinnedContexts: URI[] = [];
	private pinnedContextSet: Set<string> = new Set();
	private readonly _onDidChangePinnedContexts = new Emitter<void>();
	readonly onDidChangePinnedContexts: Event<void> = this._onDidChangePinnedContexts.event;

	private hasPinnedContext: IContextKey<boolean>;

	constructor(
		@IContextKeyService private readonly contextKeyService: IContextKeyService
	) {
		this.hasPinnedContext = CONTEXT_HAS_PINNED_CONTEXT.bindTo(this.contextKeyService);
	}

	private updateContextKeys(): void {
		this.hasPinnedContext.set(this.pinnedContexts.length > 0);
	}

	private onChangePinnedContexts(): void {
		this._onDidChangePinnedContexts.fire();
		this.updateContextKeys();
	}

	addContext(uri: URI): void {
		const uriString = uri.toString();
		if (!this.pinnedContextSet.has(uriString)) {
			this.pinnedContexts.push(uri);
			this.pinnedContextSet.add(uriString);
			this.onChangePinnedContexts();
		}
	}

	removeContext(uri: URI): void {
		const uriString = uri.toString();
		const initialLength = this.pinnedContexts.length;
		this.pinnedContexts = this.pinnedContexts.filter(pinnedUri => pinnedUri.toString() !== uriString);
		this.pinnedContextSet.delete(uriString);
		if (this.pinnedContexts.length !== initialLength) {
			this.onChangePinnedContexts();
		}
	}

	clearContexts(): void {
		if (this.pinnedContexts.length > 0) {
			this.pinnedContexts = [];
			this.pinnedContextSet.clear();
			this.onChangePinnedContexts();
		}
	}

	setContexts(uris: URI[]): void {
		this.pinnedContexts = uris;
		this.pinnedContextSet = new Set(uris.map(uri => uri.toString()));
		this.onChangePinnedContexts();
	}

	getPinnedContexts(): URI[] {
		return [...this.pinnedContexts];
	}

	hasContext(uri: URI): boolean {
		return this.pinnedContextSet.has(uri.toString());
	}
}
