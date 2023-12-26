/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from 'vs/base/common/cancellation';
import { IDisposable, toDisposable } from 'vs/base/common/lifecycle';
import { ExtensionIdentifier } from 'vs/platform/extensions/common/extensions';
import { createDecorator } from 'vs/platform/instantiation/common/instantiation';
import { IProgress } from 'vs/platform/progress/common/progress';

export const enum ChatMessageRole {
	System,
	User,
	Assistant,
	Function,
}

export interface ICSChatMessage {
	readonly role: ChatMessageRole;
	readonly content: string;
	readonly name?: string;
}

export interface ICSChatResponseFragment {
	index: number;
	part: string;
}

export interface ICSChatResponseProviderMetadata {
	readonly extension: ExtensionIdentifier;
	readonly model: string;
	readonly description?: string;
}

export interface IChatResponseProvider {
	metadata: ICSChatResponseProviderMetadata;
	provideChatResponse(messages: ICSChatMessage[], options: { [name: string]: any }, progress: IProgress<ICSChatResponseFragment>, token: CancellationToken): Promise<any>;
}

export const ICSChatProviderService = createDecorator<ICSChatProviderService>('csChatProviderService');

export interface ICSChatProviderService {

	readonly _serviceBrand: undefined;

	lookupChatResponseProvider(identifier: string): ICSChatResponseProviderMetadata | undefined;

	registerChatResponseProvider(identifier: string, provider: IChatResponseProvider): IDisposable;

	fetchChatResponse(identifier: string, messages: ICSChatMessage[], options: { [name: string]: any }, progress: IProgress<ICSChatResponseFragment>, token: CancellationToken): Promise<any>;
}

export class ChatProviderService implements ICSChatProviderService {
	readonly _serviceBrand: undefined;

	private readonly _providers: Map<string, IChatResponseProvider> = new Map();

	lookupChatResponseProvider(identifier: string): ICSChatResponseProviderMetadata | undefined {
		return this._providers.get(identifier)?.metadata;
	}

	registerChatResponseProvider(identifier: string, provider: IChatResponseProvider): IDisposable {
		if (this._providers.has(identifier)) {
			throw new Error(`Chat response provider with identifier ${identifier} is already registered.`);
		}
		this._providers.set(identifier, provider);
		return toDisposable(() => this._providers.delete(identifier));
	}

	fetchChatResponse(identifier: string, messages: ICSChatMessage[], options: { [name: string]: any }, progress: IProgress<ICSChatResponseFragment>, token: CancellationToken): Promise<any> {
		const provider = this._providers.get(identifier);
		if (!provider) {
			throw new Error(`Chat response provider with identifier ${identifier} is not registered.`);
		}
		return provider.provideChatResponse(messages, options, progress, token);
	}
}
