/*
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
// Key used to store the number of times the account card has been shown
const STORAGE_KEY = 'csAccount.requestCount';

/**
 * Implementation of the CodeStory Account Service for browser environments.
 * Handles user authentication, account UI visibility, and session management.
 */
export class CSAccountService extends Disposable implements ICSAccountService {
    _serviceBrand: undefined;

    // Current authenticated session state
    private authenticatedSession: CSAuthenticationSession | undefined;

    // Context key to track account card visibility
    private isVisible: IContextKey<boolean>;
    private csAccountCard: HTMLElement | undefined;

    // Base URL for CodeStory website, varies based on environment
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

        // Set website base URL based on environment (development vs production)
        const isDevelopment = !this.environmentService.isBuilt || this.environmentService.isExtensionDevelopment;
        this._websiteBase = isDevelopment ? 'https://staging.aide.dev' : 'https://aide.dev';

        // Initialize visibility context and refresh session state
        this.isVisible = CS_ACCOUNT_CARD_VISIBLE.bindTo(this.contextKeyService);
        this.refresh();
    }

    /**
     * Refreshes the current authentication session state
     */
    private async refresh(): Promise<void> {
        const session = await this.csAuthenticationService.getSession();
        this.authenticatedSession = session || undefined;
    }

    /**
     * Toggles the visibility of the account card UI
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
     * Ensures the user is authorized and has valid subscription access.
     * Shows the account card if authentication is needed.
     * @returns Promise<boolean> indicating if authorization was successful
     */
    async ensureAuthorized(): Promise<boolean> {
        const count = this.storageService.getNumber(STORAGE_KEY, StorageScope.PROFILE, 0);
        try {
            let csAuthSession = await this.csAuthenticationService.getSession();
            if (!csAuthSession) {
                // Show the account card and wait for authentication
                this.toggle();
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

            // Verify subscription status and update request count
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

    /**
     * Displays the account card UI with either login prompt or user profile
     * based on authentication status
     */
    private async show(): Promise<void> {
        const container = this.layoutService.activeContainer;
        const csAccountCard = this.csAccountCard = dom.append(container, $('.cs-account-card'));
        if (!this.authenticatedSession) {
            await this.refresh();
        }

        if (this.authenticatedSession) {
            // Display authenticated user's profile information
            const user = this.authenticatedSession.account;
            const profileRow = dom.append(this.csAccountCard, $('.profile-row'));
            
            // Add profile picture or default icon
            if (user.profile_picture_url) {
                const profilePicture = dom.append(profileRow, $<HTMLImageElement>('img.profile-picture'));
                profilePicture.src = user.profile_picture_url;
            } else {
                const profilePicture = dom.append(profileRow, $('.profile-picture'));
                profilePicture.classList.add(...ThemeIcon.asClassNameArray(Codicon.account));
            }

            // Add user details (name and email)
            const userDetails = dom.append(profileRow, $('.user-details'));
            const name = dom.append(userDetails, $('.name'));
            const email = dom.append(userDetails, $('.email'));
            name.textContent = user.first_name + ' ' + user.last_name;
            email.textContent = user.email;

            // Add logout button
            const logoutButton = this._register(this.instantiationService.createInstance(Button, csAccountCard, defaultButtonStyles));
            logoutButton.label = 'Log Out';
            this._register(logoutButton.onDidClick(() => {
                if (!this.authenticatedSession) {
                    return;
                }

                // Handle logout by deleting session and refreshing UI
                this.csAuthenticationService.deleteSession(this.authenticatedSession.id).then(() => {
                    this.authenticatedSession = undefined;
                    this.hide();
                    this.show();
                });
            }));
        } else {
            // Display login prompt for unauthenticated users
            const loginPrompt = dom.append(this.csAccountCard, $('.login-prompt'));
            loginPrompt.textContent = 'Log in to CodeStory Account';
            const loginDescription = dom.append(this.csAccountCard, $('.login-description'));
            loginDescription.textContent = 'To get access to AI features';

            // Add login button
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
     * Removes the account card UI from the DOM
     */
    private hide(): void {
        if (this.csAccountCard) {
            this.csAccountCard.remove();
        }
    }
}