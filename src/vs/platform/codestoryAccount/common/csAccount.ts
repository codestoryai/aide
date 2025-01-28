/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../base/common/event.js';
import { createDecorator } from '../../instantiation/common/instantiation.js';

/**
 * Represents an authenticated session for a CodeStory user
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
 * Represents a CodeStory user's profile information
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
 * Structure for encoded authentication tokens
 */
export type EncodedCSTokenData = {
	access_token: string;
	refresh_token: string;
};

/**
 * Response structure for user profile data including waitlist position
 */
export type CSUserProfileResponse = {
	user: CSUser;
	waitlistPosition: number;
};

/**
 * Possible states for a user's subscription
 */
export type SubscriptionStatus =
	| 'free'
	| 'pending_activation'
	| 'active'
	| 'pending_cancellation'
	| 'cancelled';

/**
 * Possible states for a subscription invoice
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
 * Structure representing current usage metrics for a subscription
 */
export type CurrentUsage = {
	freeUsage: number;
	overageUsage: number;
	estimatedUsage: number;
	breakdown: Record<string, number>;
};

/**
 * Complete subscription response including status and usage information
 */
export type SubscriptionResponse = {
	status: SubscriptionStatus;
	usage: CurrentUsage;
	invoiceStatus?: InvoiceStatus;
	subscriptionEnding?: number;
};

/**
 * Determines if a given subscription status allows access to premium features
 */
export const statusAllowsAccess = (status: SubscriptionStatus): boolean => {
	return status === 'free' || status === 'active' || status === 'pending_cancellation';
};

/**
 * Service interface for managing CodeStory account functionality
 */
export const ICSAccountService = createDecorator<ICSAccountService>('csAccountService');
export interface ICSAccountService {
	readonly _serviceBrand: undefined;

	/**
	 * Toggles the account interface visibility
	 */
	toggle(): void;
	/**
	 * Ensures the user is authorized to access premium features
	 * @returns Promise<boolean> indicating authorization status
	 */
	ensureAuthorized(): Promise<boolean>;
}

/**
 * Service interface for handling CodeStory authentication
 */
export const ICSAuthenticationService = createDecorator<ICSAuthenticationService>('csAuthenticationService');
export interface ICSAuthenticationService {
	readonly _serviceBrand: undefined;
	readonly onDidAuthenticate: Event<CSAuthenticationSession>;

	/**
	 * Creates a new authentication session
	 */
	createSession(): Promise<CSAuthenticationSession>;
	/**
	 * Deletes an existing authentication session
	 */
	deleteSession(sessionId: string): Promise<void>;
	/**
	 * Refreshes the authentication tokens
	 */
	refreshTokens(): Promise<void>;
	/**
	 * Retrieves the current authentication session if it exists
	 */
	getSession(): Promise<CSAuthenticationSession | undefined>;
}