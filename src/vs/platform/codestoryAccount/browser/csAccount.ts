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

export class CSAccountService extends Disposable implements ICSAccountService {
	/** Service brand for DI identification */
	_serviceBrand: undefined;

	/** Stores the current authenticated session information */
	private authenticatedSession: CSAuthenticationSession | undefined;

	/** Context key to track the visibility state of the account card */
	private isVisible: IContextKey<boolean>;
	
	/** Reference to the account card DOM element */
	private csAccountCard: HTMLElement | undefined;

	/** Base URL for the CodeStory website - changes based on environment */
	private _websiteBase: string | null = null;

	/**
	 * Creates a new instance of the CSAccountService
	 * @param contextKeyService - Service for managing context keys
	 * @param csAuthenticationService - Service for handling authentication
	 * @param environmentService - Service for environment information
	 * @param instantiationService - Service for instantiating components
	 * @param layoutService - Service for managing UI layout
	 * @param notificationService - Service for showing notifications
	 * @param storageService - Service for persistent storage
	 * @param openerService - Service for opening external URLs
	 */
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

		const isDevelopment = !this.environmentService.isBuilt || this.environmentService.isExtensionDevelopment;
		if (isDevelopment) {
			this._websiteBase = 'https://staging.aide.dev';
		} else {
			this._websiteBase = 'https://aide.dev';
		}

		this.isVisible = CS_ACCOUNT_CARD_VISIBLE.bindTo(this.contextKeyService);
		this.refresh();
	}

	private async refresh(): Promise<void> {
		const session = await this.csAuthenticationService.getSession();
		if (session) {
			this.authenticatedSession = session;
		} else {
			this.authenticatedSession = undefined;
		}
	}

	/**
	 * Toggles the visibility of the account card
	 * If the card is hidden, shows it and sets visibility context key to true
	 * If the card is visible, hides it and sets visibility context key to false
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
				return false; // User is not on the trial period
			}
		} catch (error) {
			// Handle any errors that occurred during the authentication
			console.error('Error during refresh:', error);
			this.notificationService.error('An error occurred during the authentication process. Please try again later.');
			return false; // Authentication failed
		}
	}

	private async show(): Promise<void> {
		const container = this.layoutService.activeContainer;
		const csAccountCard = this.csAccountCard = dom.append(container, $('.cs-account-card'));
		if (!this.authenticatedSession) {
			await this.refresh();
		}

		if (this.authenticatedSession) {
			// User is signed in
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
			// User is not signed in
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

	private hide(): void {
		if (this.csAccountCard) {
			this.csAccountCard.remove();
		}
	}
}