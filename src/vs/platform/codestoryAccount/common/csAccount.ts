/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../base/common/event.js';
import { createDecorator } from '../../instantiation/common/instantiation.js';

/**
 * Represents an authenticated CodeStory session with user information and tokens.
 */
export interface CSAuthenticationSession {
	id: string;
	accessToken: string;
	refreshToken: string;
	account: CSUser;
	waitlistPosition: number;
	subscription: SubscriptionResponse;
}

/**
 * Represents a CodeStory user's profile information.
 */
export type CSUser = {
	id: string;
	first_name: string;
	last_name: string;
	email: string;
	created_at: string;
	updated_at: string;
	email_verified: boolean;
	profile_picture_url: string;
};

/**
 * Structure for encoded token data returned from authentication.
 */
export type EncodedCSTokenData = {
	access_token: string;
	refresh_token: string;
};

/**
 * Response structure for user profile data including waitlist position.
 */
export type CSUserProfileResponse = {
	user: CSUser;
	waitlistPosition: number;
};

/**
 * Possible states of a user's subscription.
 */
export type SubscriptionStatus =
	| 'free'
	| 'pending_activation'
	| 'active'
	| 'pending_cancellation'
	| 'cancelled';

/**
 * Possible states of a subscription invoice.
 */
type InvoiceStatus =
	| 'active'
	| 'canceled'
	| 'incomplete'
	| 'incomplete_expired'
	| 'past_due'
	| 'paused'
	| 'trialing'
	| 'unpaid';

/**
 * Tracks the usage metrics for a user's subscription.
 */
export type CurrentUsage = {
	freeUsage: number;
	overageUsage: number;
	estimatedUsage: number;
	breakdown: Record<string, number>;
};

/**
 * Complete subscription information including status and usage.
 */
export type SubscriptionResponse = {
	status: SubscriptionStatus;
	usage: CurrentUsage;
	invoiceStatus?: InvoiceStatus;
	subscriptionEnding?: number;
};

/**
 * Determines if a given subscription status allows access to premium features.
 * @param status The subscription status to check.
 * @returns boolean indicating if the status allows access.
 */
export const statusAllowsAccess = (status: SubscriptionStatus): boolean => {
	return status === 'free' || status === 'active' || status === 'pending_cancellation';
};

export const ICSAccountService = createDecorator<ICSAccountService>('csAccountService');

/**
 * Service for managing CodeStory account interactions in the UI.
 */
export interface ICSAccountService {
	readonly _serviceBrand: undefined;

	/**
	 * Toggles the account card visibility in the UI.
	 */
	toggle(): void;

	/**
	 * Ensures the user is authorized and has a valid subscription.
	 * @returns Promise resolving to boolean indicating if user is authorized.
	 */
	ensureAuthorized(): Promise<boolean>;
}

export const ICSAuthenticationService = createDecorator<ICSAuthenticationService>('csAuthenticationService');

/**
 * Service for handling CodeStory authentication operations.
 */
export interface ICSAuthenticationService {
	readonly _serviceBrand: undefined;

	/**
	 * Event fired when a user successfully authenticates.
	 */
	readonly onDidAuthenticate: Event<CSAuthenticationSession>;

	/**
	 * Creates a new authentication session.
	 * @returns Promise resolving to the new session.
	 */
	createSession(): Promise<CSAuthenticationSession>;

	/**
	 * Deletes an existing authentication session.
	 * @param sessionId The ID of the session to delete.
	 */
	deleteSession(sessionId: string): Promise<void>;

	/**
	 * Refreshes the authentication tokens.
	 */
	refreshTokens(): Promise<void>;

	/**
	 * Retrieves the current authentication session if it exists.
	 * @returns Promise resolving to the current session or undefined.
	 */
	getSession(): Promise<CSAuthenticationSession | undefined>;
}