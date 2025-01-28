/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
// Use ES6 module syntax for exports and imports

// Key generation function using template literals for clarity
// do something better here with hashing or something, too much memory right now
export function keyForPrompt(prefix: string, suffix: string): string {
	return `${prefix}${suffix}`;
}

export interface LRUCacheValue {
	completions: string[];
	multiLine: boolean;
}


// Class definition for LRUCache
export class LRUCache {
	private values: Map<string, LRUCacheValue>;
	private lruKeys: string[];
	private size: number;

	constructor(size: number = 10) {
		this.values = new Map<string, LRUCacheValue>();
		this.lruKeys = [];
		this.size = size;
	}

	private removeKeyFromLRU(key: string): void {
		const index = this.lruKeys.indexOf(key);
		if (index !== -1) {
			this.lruKeys.splice(index, 1);
		}
	}

	private touchKeyInLRU(key: string): void {
		this.removeKeyFromLRU(key);
		this.lruKeys.push(key);
	}

	public clear(): void {
		this.values.clear();
		this.lruKeys = [];
	}

	public deleteKey(key: string): void {
		this.removeKeyFromLRU(key);
		if (this.values.has(key)) {
			this.values.delete(key);
		}
	}

	public get(key: string): LRUCacheValue | undefined {
		if (this.values.has(key)) {
			const value = this.values.get(key);
			this.touchKeyInLRU(key);
			return value;
		}
		return undefined;
	}

	public put(key: string, value: LRUCacheValue): void {
		let keysToRemove: string[] = [];
		if (this.values.has(key)) {
			keysToRemove = [key];
		} else {
			if (this.lruKeys.length >= this.size) {
				keysToRemove = this.lruKeys.splice(0, 1);
			}
		}
		for (const keyToRemove of keysToRemove) {
			this.deleteKey(keyToRemove);
		}
		this.values.set(key, value);
		this.touchKeyInLRU(key);
	}
}

// we initialize a prompt completions lru cache here globally
export const PromptCompletionsLRUCache = new LRUCache(100);
