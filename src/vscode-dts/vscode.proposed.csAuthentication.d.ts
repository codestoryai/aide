/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

declare module 'vscode' {
	interface AuthenticatedCSUser {
		email: string;
	}

	type SubscriptionStatus =
		| 'free'
		| 'pending_activation'
		| 'active'
		| 'pending_cancellation'
		| 'cancelled';

	interface SubscriptionResponse {
		status: SubscriptionStatus;
		subscriptionEnding?: number;
	}

	export interface CSAuthenticationSession {
		/**
		 * The access token.
		 */
		readonly accessToken: string;

		/**
		 * The authenticated user.
		 */
		readonly account: AuthenticatedCSUser;

		/**
		 * The subscription information.
		 */
		readonly subscription: SubscriptionResponse;
	}

	export namespace csAuthentication {
		export function getSession(): Thenable<CSAuthenticationSession | undefined>;
		export function refreshSession(): Thenable<CSAuthenticationSession | undefined>;
	}
}
