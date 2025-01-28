/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

declare module 'vscode' {
	/**
	 * Represents an authenticated CodeStory user's basic information
	 */
	interface AuthenticatedCSUser {
		/** User's email address */
		email: string;
	}

	/**
	 * Possible states of a user's CodeStory subscription
	 */
	type SubscriptionStatus =
		| 'free'           // Free tier access
		| 'pending_activation'    // Subscription is being activated
		| 'active'               // Active paid subscription
		| 'pending_cancellation' // Subscription will be cancelled at end of period
		| 'cancelled';          // Subscription has been cancelled

	/**
	 * Information about a user's CodeStory subscription
	 */
	interface SubscriptionResponse {
		/** Current status of the subscription */
		status: SubscriptionStatus;
		/** Timestamp when the subscription will end, if applicable */
		subscriptionEnding?: number;
	}

	/**
	 * Represents an authenticated session with CodeStory services
	 */
	export interface CSAuthenticationSession {
		/**
		 * The access token for API authentication
		 */
		readonly accessToken: string;

		/**
		 * The authenticated user's information
		 */
		readonly account: AuthenticatedCSUser;

		/**
		 * The user's subscription details
		 */
		readonly subscription: SubscriptionResponse;
	}

	/**
	 * Namespace for CodeStory authentication functionality
	 */
	export namespace csAuthentication {
		/**
		 * Retrieves the current authentication session if one exists
		 * @returns Promise resolving to the current session or undefined if not authenticated
		 */
		export function getSession(): Thenable<CSAuthenticationSession | undefined>;

		/**
		 * Refreshes the current authentication session
		 * @returns Promise resolving to the refreshed session or undefined if refresh failed
		 */
		export function refreshSession(): Thenable<CSAuthenticationSession | undefined>;
	}
}