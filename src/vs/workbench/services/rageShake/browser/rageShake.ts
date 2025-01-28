/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as dom from '../../../../base/browser/dom.js';
import { addDisposableListener } from '../../../../base/browser/dom.js';
import { Button } from '../../../../base/browser/ui/button/button.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { Disposable, DisposableStore } from '../../../../base/common/lifecycle.js';
import { ThemeIcon } from '../../../../base/common/themables.js';
import { localize } from '../../../../nls.js';
import { ICSAuthenticationService } from '../../../../platform/codestoryAccount/common/csAccount.js';
import { IContextKey, IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { SystemInfo } from '../../../../platform/diagnostics/common/diagnostics.js';
import { IEnvironmentService } from '../../../../platform/environment/common/environment.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { ILayoutService } from '../../../../platform/layout/browser/layoutService.js';
import { IProcessMainService } from '../../../../platform/process/common/process.js';
import { defaultButtonStyles } from '../../../../platform/theme/browser/defaultStyles.js';
import { IHostService } from '../../host/browser/host.js';
import { IRageShakeService, RageShakeView, RageShakeViewType } from '../common/rageShake.js';
import { RAGESHAKE_CARD_VISIBLE, RAGESHAKE_VIEW } from '../common/rageShakeContextKeys.js';
import './media/rageShake.css';

const $ = dom.$;

const views: { destination: RageShakeView; label: string; codicon: ThemeIcon }[] = [
	{ destination: RageShakeView.Issue, label: localize('rageShakeReportIssue', "Report an issue"), codicon: Codicon.warning },
	{ destination: RageShakeView.Idea, label: localize('rageShakeShareIdea', "Share an idea"), codicon: Codicon.lightBulb },
	{ destination: RageShakeView.Other, label: localize('rageShakeShareOther', "Tell us anything"), codicon: Codicon.commentDiscussion },
];

export class RageShakeService extends Disposable implements IRageShakeService {
	_serviceBrand: undefined;

	private isVisible: IContextKey<boolean>;

	private cardElement: HTMLElement;
	private bodyElement: HTMLElement;
	private backButton: Button;
	private headerTitleElement: HTMLElement;

	private screenShotContainerElement: HTMLElement | undefined;
	private screenShotButton: Button | undefined;
	private clearScreenShotButton: Button | undefined;
	private screenShotArrayBuffer: ArrayBuffer | undefined;

	private systemInformationButton: Button | undefined;
	private systemInfo: SystemInfo | undefined;
	private activeSessionId: string | undefined;

	private messageMap: Map<RageShakeViewType, string> = new Map();
	private readonly viewDisposables: DisposableStore;

	private currentView: IContextKey<RageShakeViewType>;


	constructor(
		@IContextKeyService private readonly contextKeyService: IContextKeyService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@ILayoutService private readonly layoutService: ILayoutService,
		@IProcessMainService private readonly processMainService: IProcessMainService,
		@IHostService private readonly hostService: IHostService,
		@ICSAuthenticationService private readonly csAuthenticationService: ICSAuthenticationService,
		@IEnvironmentService private readonly environmentService: IEnvironmentService,
	) {
		super();

		this.isVisible = RAGESHAKE_CARD_VISIBLE.bindTo(this.contextKeyService);
		this.currentView = RAGESHAKE_VIEW.bindTo(this.contextKeyService);

		this.viewDisposables = this._register(this.instantiationService.createInstance(DisposableStore));

		const container = this.layoutService.activeContainer;
		const card = this.cardElement = dom.append(container, $('.rageShake-card'));
		const header = card.appendChild($('header.rageShake-card-header'));
		const backButton = this.backButton = this._register(this.instantiationService.createInstance(Button, header, {}));
		backButton.icon = Codicon.arrowLeft;

		this.headerTitleElement = header.appendChild($('.rageShake-card-title'));

		const closeButton = this._register(this.instantiationService.createInstance(Button, header, {}));
		closeButton.icon = Codicon.close;

		this.bodyElement = card.appendChild($('.rageShake-card-body'));

		if (this.isVisible.get()) {
			dom.show(card);
		} else {
			dom.hide(card);
		}

		this._register(this.backButton.onDidClick(() => this.goBack()));
		this._register(closeButton.onDidClick(() => this.toggle()));
	}

	setActiveSessionId(sessionId: string) {
		this.activeSessionId = sessionId;
	}

	toggle() {
		if (!this.isVisible.get()) {
			this.show();
			this.isVisible.set(true);
		} else {
			this.hide();
			this.isVisible.set(false);
		}
	}

	private async getScreenShot() {
		const spinner = $('span.codicon.codicon-loading', { ariaHidden: true });
		this.screenShotButton?.element.prepend(spinner);
		// Hide widget for screenshot
		this.cardElement.style.opacity = '0';
		const arrayBuffer = this.screenShotArrayBuffer = await this.hostService.getScreenshot();
		// Reset visibility
		this.cardElement.style.opacity = '';
		this.screenShotButton?.element.removeChild(spinner);


		if (arrayBuffer) {
			const blob = new Blob([arrayBuffer], { type: 'image/jpeg' });
			const imageUrl = URL.createObjectURL(blob);

			if (this.screenShotButton && this.screenShotContainerElement) {
				this.screenShotButton.label = localize('rageShakeReportIssue.retakeScreenShot', "Retake screenshot");
				dom.clearNode(this.screenShotButton.element);
				this.screenShotButton.element.appendChild($('img', { src: imageUrl, 'class': 'rageShake-screenshot-preview' }));

				this.removeClearScreenShotButton();

				const clearScreenShotButton = this.clearScreenShotButton = this.instantiationService.createInstance(Button, this.screenShotContainerElement, {});
				this.viewDisposables.add(clearScreenShotButton);

				clearScreenShotButton.element.classList.add('rageShake-screenshot-clear-button');
				// Set label for accessibility and get monaco-text button look
				clearScreenShotButton.label = localize('rageShakeReportIssue.clearScreenShot', "Clear screenshot");
				// Clear node to style it freely
				dom.clearNode(clearScreenShotButton.element);
				clearScreenShotButton.element.appendChild($('span.codicon.codicon-trash', { ariaHidden: true }));
				this.viewDisposables.add(clearScreenShotButton.onDidClick(() => {
					this.resetScreenShotButton();
					this.removeClearScreenShotButton();
				}));
			}
		}
	}

	private resetScreenShotButton() {
		if (this.screenShotButton) {
			// Set label for accessibility and get monaco-text button look
			this.screenShotButton.label = localize('rageShakeReportIssue.takeScreenShot', "Take a screenshot");
			this.screenShotButton.element.classList.add('rageShake-screenshot-add-button');
			// Clear node to style it freely
			dom.clearNode(this.screenShotButton.element);
			this.screenShotButton.element.appendChild($('span.codicon.codicon-device-camera', { ariaHidden: true }));
		}
	}

	private removeClearScreenShotButton() {
		if (this.screenShotContainerElement && this.clearScreenShotButton) {
			if (this.screenShotContainerElement.contains(this.clearScreenShotButton.element)) {
				this.screenShotContainerElement.removeChild(this.clearScreenShotButton.element);
			}
			this.clearScreenShotButton.dispose();
			this.clearScreenShotButton = undefined;
		}
	}

	private async getSystemInformation() {
		this.systemInfo = await this.processMainService.$getSystemInfo();
		if (this.systemInformationButton) {
			this.systemInformationButton.label = localize('rageShakeReportIssue.systemInformationAttached', "System information added");
		}

	}

	private async sendFeedback() {
		const currentView = this.currentView.get();

		// Create the base data object
		const data = {
			systemInfo: this.systemInfo,
			type: currentView,
			message: currentView && this.messageMap.get(currentView) || undefined,
			sessionId: this.activeSessionId,
		};

		// Convert screenshot to base64 if it exists
		let screenshotBase64: string | undefined;
		if (this.screenShotArrayBuffer) {
			const array = new Uint8Array(this.screenShotArrayBuffer);
			const binary = array.reduce((str, byte) => str + String.fromCharCode(byte), '');
			screenshotBase64 = btoa(binary);
		}

		this.messageMap.clear();
		this.screenShotArrayBuffer = undefined;

		const headers: HeadersInit = {
			'Content-Type': 'application/json',
		};

		const session = await this.csAuthenticationService.getSession();
		if (session) {
			headers.Authorization = `Bearer ${session.accessToken}`;
		}

		const isDevelopment = !this.environmentService.isBuilt || this.environmentService.isExtensionDevelopment;
		const urlBase = isDevelopment ? 'https://staging-api.codestory.ai' : 'https://api.codestory.ai';

		// Send the request with JSON payload
		fetch(`${urlBase}/v1/debug/rage-shake`, {
			method: 'POST',
			headers,
			body: JSON.stringify({
				data,
				screenshot: screenshotBase64
			})
		});
	}

	private navigate(state: RageShakeViewType) {
		// Clear view disposables
		this.viewDisposables.clear();
		this.currentView.set(state);

		switch (state) {
			case RageShakeView.Start:
				this.showStart();
				break;
			case RageShakeView.Issue:
				this.showIssue();
				break;
			case RageShakeView.Idea:
				this.showIdea();
				break;
			case RageShakeView.Other:
				this.showOther();
				break;
		}

	}

	private showStart() {
		this.headerTitleElement.textContent = localize('rageShakeStart', "What's on your mind?");
		this.setVisibilityWithoutLayoutShift(false, this.backButton.element);
		dom.clearNode(this.bodyElement);

		const list = this.bodyElement.appendChild($('ul.rageShake-list'));

		for (const { destination, label, codicon } of views) {
			const listElement = list.appendChild($('li'));
			const button = this.instantiationService.createInstance(Button, listElement, { secondary: true, ...defaultButtonStyles });
			this.viewDisposables.add(button);

			button.label = label;
			button.element.prepend($(`span.rageShake-icon.codicon${ThemeIcon.asCSSSelector(codicon)}`, { ariaHidden: true }));
			this.viewDisposables.add(button.onDidClick(() => this.navigate(destination)));
		}
	}

	private createTextArea(placeholder: string) {
		const textArea = this.bodyElement.appendChild(document.createElement('textarea'));
		textArea.setAttribute('rows', '4');
		textArea.placeholder = placeholder;

		const currentView = this.currentView.get();
		const previousMessage = currentView && this.messageMap.get(currentView);
		textArea.value = previousMessage || '';

		this.viewDisposables.add(addDisposableListener(textArea, 'input', (event: InputEvent) => {
			const textArea = event.target as HTMLTextAreaElement;
			const view = this.currentView.get();
			if (view) {
				this.messageMap.set(view, textArea.value);
			}
		}));
	}

	private createSubmitButton(label: string) {
		const submitButton = this.viewDisposables.add(this.instantiationService.createInstance(Button, this.bodyElement, defaultButtonStyles));
		submitButton.label = label;
		this.viewDisposables.add(submitButton.onDidClick(() => {
			this.sendFeedback();
			this.toggle();
		}));
	}

	private showIssue() {
		this.headerTitleElement.textContent = localize('rageShakeReportIssue', "Report an issue");
		this.setVisibilityWithoutLayoutShift(true, this.backButton.element);
		dom.clearNode(this.bodyElement);
		this.createTextArea(localize('rageShakeReportIssue.placeholder', "Describe your issue"));

		const attachments = this.bodyElement.appendChild($('.rageShake-issue-attachments'));
		const screenShotContainer = this.screenShotContainerElement = attachments.appendChild($('.rageShake-screenshot-container'));
		if (this.screenShotButton) {
			this.screenShotButton.dispose();
		}
		const screenShotButton = this.screenShotButton = this.instantiationService.createInstance(Button, screenShotContainer, { secondary: true, ...defaultButtonStyles });
		this.viewDisposables.add(screenShotButton);
		this.resetScreenShotButton();


		this.viewDisposables.add(screenShotButton.onDidClick(() => this.getScreenShot()));


		if (this.systemInformationButton) {
			this.systemInformationButton.dispose();
		}

		this.systemInformationButton = this.viewDisposables.add(this.instantiationService.createInstance(Button, attachments, { secondary: true, ...defaultButtonStyles }));
		this.systemInformationButton.label = localize('rageShakeReportIssue.getSystemInformation', "Attach system information");
		this.viewDisposables.add(this.systemInformationButton.onDidClick(() => this.getSystemInformation()));

		this.createSubmitButton(localize('rageShakeReportIssue.submit', "Report issue"));
	}

	private showIdea() {
		this.headerTitleElement.textContent = localize('rageShakeShareIdea', "Share an idea");
		this.setVisibilityWithoutLayoutShift(true, this.backButton.element);
		dom.clearNode(this.bodyElement);
		this.createTextArea(localize('rageShakeShareIdea.placeholder', "Share your idea"));
		this.createSubmitButton(localize('rageShakeReportSend', "Send"));
	}

	private showOther() {
		this.headerTitleElement.textContent = localize('rageShakeShareOther', "Tell us anything");
		this.setVisibilityWithoutLayoutShift(true, this.backButton.element);
		dom.clearNode(this.bodyElement);
		this.createTextArea(localize('rageShakeShareOther.placeholder', "Tell us something else"));
		this.createSubmitButton(localize('rageShakeReportSend', "Send"));
	}

	private goBack() {
		this.navigate(RageShakeView.Start);
	}

	private async show() {
		dom.show(this.cardElement);
		this.navigate(this.currentView.get() || RageShakeView.Start);
	}

	private hide() {
		dom.hide(this.cardElement);
	}

	private setVisibilityWithoutLayoutShift(visible: boolean, element: HTMLElement) {
		element.style.transition = 'opacity 200ms';
		if (visible) {
			element.style.opacity = '1';
			const transitionEndListener = addDisposableListener(element, 'transitionend', () => {
				element.style.visibility = 'visible';
				transitionEndListener.dispose();
			}, { once: true });
			this._register(transitionEndListener);
			element.ariaHidden = 'false';
		} else {
			element.style.opacity = '0';
			const transitionEndListener = addDisposableListener(element, 'transitionend', () => {
				element.style.visibility = 'hidden';
				transitionEndListener.dispose();
			}, { once: true });
			this._register(transitionEndListener);
			element.ariaHidden = 'true';
		}
	}
}
