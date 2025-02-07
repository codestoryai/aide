/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as dom from '../../../base/browser/dom.js';
import { Button } from '../../../base/browser/ui/button/button.js';
import { Codicon } from '../../../base/common/codicons.js';
import { Disposable } from '../../../base/common/lifecycle.js';
import { ThemeIcon } from '../../../base/common/themables.js';
import { IContextKey, IContextKeyService } from '../../contextkey/common/contextkey.js';
import { IEnvironmentService } from '../../environment/common/environment.js';
import { IInstantiationService } from '../../instantiation/common/instantiation.js';
import { ILayoutService } from '../../layout/browser/layoutService.js';
import { INotificationService, Severity } from '../../notification/common/notification.js';
import { IOpenerService } from '../../opener/common/opener.js';
import { IStorageService, StorageScope, StorageTarget } from '../../storage/common/storage.js';
import { defaultButtonStyles } from '../../theme/browser/defaultStyles.js';
import { CSAuthenticationSession, ICSAccountService, ICSAuthenticationService, statusAllowsAccess } from '../common/csAccount.js';
import { CS_ACCOUNT_CARD_VISIBLE } from '../common/csAccountContextKeys.js';
import './media/csAccount.css';

const $ = dom.$;
const STORAGE_KEY = 'csAccount.requestCount';

/**
 * Implementation of the CodeStory Account Service for browser environments.
 * Manages user authentication, account UI, and subscription validation.
 */
export class CSAccountService extends Disposable implements ICSAccountService {
	_serviceBrand: undefined;

	private authenticatedSession: CSAuthenticationSession | undefined;

	private isVisible: IContextKey<boolean>;
	private csAccountCard: HTMLElement | undefined;

	private _websiteBase: string | null = null;

	constructor(
		@IContextKeyService private readonly contextKeyService: IContextKeyService,
		@ICSAuthenticationService private readonly csAuthenticationService: ICSAuthenticationService,
		@IEnvironmentService private readonly environmentService: IEnvironmentService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@ILayoutService private readonly layoutService: ILayoutService,
		@INotificationService private readonly notificationService: INotificationService,
		@IStorageService private readonly storageService: IStorageService,
		@IOpenerService private readonly openerService: IOpenerService
	) {
		super();

		// Set website base URL based on environment
		const isDevelopment = !this.environmentService.isBuilt || this.environmentService.isExtensionDevelopment;
		if (isDevelopment) {
			this._websiteBase = 'https://staging.aide.dev';
		} else {
			this._websiteBase = 'https://aide.dev';
		}

		this.isVisible = CS_ACCOUNT_CARD_VISIBLE.bindTo(this.contextKeyService);
		this.refresh();
	}

	/**
	 * Refreshes the current authentication session.
	 * Retrieves the session from the authentication service and updates the local state.
	 */
	private async refresh(): Promise<void> {
		const session = await this.csAuthenticationService.getSession();
		if (session) {
			this.authenticatedSession = session;
		} else {
			this.authenticatedSession = undefined;
		}
	}

	/**
	 * Toggles the visibility of the account card in the UI.
	 */
	toggle(): void {
		if (!this.isVisible.get()) {
			this.show();
			this.isVisible.set(true);
		} else {
			this.hide();
			this.isVisible.set(false);
		}
	}

	/**
	 * Ensures the user is authorized and has a valid subscription.
	 * Shows the account card if not authenticated and validates subscription status.
	 * @returns Promise<boolean> True if user is authorized, false otherwise.
	 */
	async ensureAuthorized(): Promise<boolean> {
		const count = this.storageService.getNumber(STORAGE_KEY, StorageScope.PROFILE, 0);
		try {
			let csAuthSession = await this.csAuthenticationService.getSession();
			if (!csAuthSession) {
				// Show the account card
				this.toggle();
				// Wait for the user to authenticate
				csAuthSession = await new Promise<CSAuthenticationSession>((resolve, reject) => {
					const disposable = this.csAuthenticationService.onDidAuthenticate(session => {
						if (session) {
							resolve(session);
						} else {
							reject(new Error('Authentication failed'));
						}
						disposable.dispose();
					});
				});
			}

			// Check if the user has a valid subscription
			const subscription = csAuthSession.subscription;
			if (statusAllowsAccess(subscription.status)) {
				this.storageService.store(STORAGE_KEY, count + 1, StorageScope.PROFILE, StorageTarget.MACHINE);
				return true;
			} else {
				this.notificationService.prompt(
					Severity.Error,
					'You need a valid subscription to continue using Aide. Please visit the account page to update your subscription.',
					[
						{
							label: 'Open Billing Portal',
							keepOpen: true,
							run: async () => {
								await this.openerService.open(`${this._websiteBase}/account`);
							},
						},
						{
							label: 'Refresh',
							run: async () => {
								await this.csAuthenticationService.refreshTokens();
							}
						}
					]
				);
				return false;
			}
		} catch (error) {
			// Handle any errors that occurred during the authentication
			console.error('Error during refresh:', error);
			this.notificationService.error('An error occurred during the authentication process. Please try again later.');
			return false; // Authentication failed
		}
	}

	/**
	 * Displays the account card UI.
	 * Shows different UI based on authentication status.
	 */
	private async show(): Promise<void> {
		const container = this.layoutService.activeContainer;
		const csAccountCard = this.csAccountCard = dom.append(container, $('.cs-account-card'));
		if (!this.authenticatedSession) {
			await this.refresh();
		}

		if (this.authenticatedSession) {
			// User is signed in - show profile information
			const user = this.authenticatedSession.account;
			const profileRow = dom.append(this.csAccountCard, $('.profile-row'));
			if (user.profile_picture_url) {
				const profilePicture = dom.append(profileRow, $<HTMLImageElement>('img.profile-picture'));
				profilePicture.src = user.profile_picture_url;
			} else {
				const profilePicture = dom.append(profileRow, $('.profile-picture'));
				profilePicture.classList.add(...ThemeIcon.asClassNameArray(Codicon.account));
			}

			const userDetails = dom.append(profileRow, $('.user-details'));
			const name = dom.append(userDetails, $('.name'));
			const email = dom.append(userDetails, $('.email'));
			name.textContent = user.first_name + ' ' + user.last_name;
			email.textContent = user.email;

			const logoutButton = this._register(this.instantiationService.createInstance(Button, csAccountCard, defaultButtonStyles));
			logoutButton.label = 'Log Out';
			this._register(logoutButton.onDidClick(() => {
				if (!this.authenticatedSession) {
					return;
				}

				this.csAuthenticationService.deleteSession(this.authenticatedSession.id).then(() => {
					this.authenticatedSession = undefined;

					this.hide();
					this.show();
				});
			}));
		} else {
			// User is not signed in - show login UI
			const loginPrompt = dom.append(this.csAccountCard, $('.login-prompt'));
			loginPrompt.textContent = 'Log in to CodeStory Account';
			const loginDescription = dom.append(this.csAccountCard, $('.login-description'));
			loginDescription.textContent = 'To get access to AI features';

			const loginButton = this._register(this.instantiationService.createInstance(Button, csAccountCard, defaultButtonStyles));
			loginButton.label = 'Log In...';
			this._register(loginButton.onDidClick(() => {
				this.csAuthenticationService.createSession().then(session => {
					this.authenticatedSession = session;

					this.hide();
					this.show();
				});
			}));
		}
	}

	/**
	 * Removes the account card from the UI.
	 */
	private hide(): void {
		if (this.csAccountCard) {
			this.csAccountCard.remove();
		}
	}
}