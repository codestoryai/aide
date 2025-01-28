/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { BaseActionViewItem } from '../../../base/browser/ui/actionbar/actionViewItems.js';
import { addDisposableListener, EventType, getWindow } from '../../../base/browser/dom.js';
import { IHoverDelegate } from '../../../base/browser/ui/hover/hoverDelegate.js';
import { IKeybindingService } from '../../keybinding/common/keybinding.js';
import { IContextKeyService } from '../../contextkey/common/contextkey.js';
import { IThemeService } from '../../theme/common/themeService.js';
import { localize } from '../../../nls.js';
import { MenuItemAction } from '../common/actions.js';
import { Icon, isICommandActionToggleInfo } from '../../action/common/action.js';
import { ThemeIcon } from '../../../base/common/themables.js';
import { DisposableStore, toDisposable } from '../../../base/common/lifecycle.js';
import { isDark } from '../../theme/common/theme.js';
import { asCSSUrl } from '../../../base/browser/cssValue.js';
import { ActionRunner } from '../../../base/common/actions.js';
import './fancyToggleActionViewItem.css';

export interface IFancyToggleActionViewItemOptions {
	draggable?: boolean;
	keybinding?: string | null;
	hoverDelegate?: IHoverDelegate;
}

export interface MenuToggleItemAction extends MenuItemAction {
	checked: boolean;
}

export function isMenuToggleItemAction(action: MenuItemAction): action is MenuToggleItemAction {
	return action.checked === true || action.checked === false;
}

export class FancyToggleActionViewItem extends BaseActionViewItem {
	private static readonly lastCheckedState = new Map<string, boolean>();

	private _container!: HTMLElement;
	private _label!: HTMLElement;

	// Store references to separate elements for untoggled/toggled icons:
	private _untoggledIcon!: HTMLSpanElement;
	private _toggledIcon!: HTMLSpanElement;

	// Disposables for each icon's dynamic styling (so we can clean up old classes)
	private readonly _untoggledIconDispose = this._register(new DisposableStore());
	private readonly _toggledIconDispose = this._register(new DisposableStore());

	protected get _menuItemAction(): MenuItemAction {
		return <MenuItemAction>this._action;
	}

	constructor(
		context: unknown,
		action: MenuItemAction /* (with .checked always boolean) */,
		private readonly _options: IFancyToggleActionViewItemOptions | undefined,
		@IKeybindingService private readonly _keybindingService: IKeybindingService,
		@IContextKeyService private readonly _contextKeyService: IContextKeyService,
		@IThemeService private readonly _themeService: IThemeService,
	) {
		super(context, action, _options);
		this.actionRunner = new ActionRunner();
	}

	override render(container: HTMLElement): void {
		this._container = container;
		container.classList.add('fancy-toggle');

		// Create the "handle" <a>
		const label = document.createElement('a');
		label.classList.add('action-label', 'fancy-toggle-handle');
		label.setAttribute('role', 'checkbox');
		label.tabIndex = -1;

		this._label = label;
		container.appendChild(label);

		// Listen for clicks
		this._register(
			addDisposableListener(label, EventType.CLICK, e => {
				e.preventDefault();
				e.stopPropagation();
				this.onClick(e);
			})
		);

		// Prepare the icon elements
		this._untoggledIcon = document.createElement('span');
		this._untoggledIcon.classList.add('fancy-toggle-icon', 'untoggled-icon');
		label.appendChild(this._untoggledIcon);

		this._toggledIcon = document.createElement('span');
		this._toggledIcon.classList.add('fancy-toggle-icon', 'toggled-icon');
		label.appendChild(this._toggledIcon);

		// Set initial final state
		this._updateInformation();

		// Animate transition based on the *previous* known checked state
		this._applyInitialCheckedStateForTransition();

		super.render(container);

		// Watch for theme changes
		this._register(this._themeService.onDidColorThemeChange(() => this._updateInformation()));
	}

	override focus(): void {
		if (this._label) {
			this._label.tabIndex = 0;
			this._label.focus();
		}
	}

	override blur(): void {
		if (this._label) {
			this._label.tabIndex = -1;
			this._label.blur();
		}
	}

	override isFocused(): boolean {
		return !!this._label && this._label.tabIndex === 0;
	}

	override setFocusable(focusable: boolean): void {
		if (this._label) {
			this._label.tabIndex = focusable ? 0 : -1;
		}
	}

	override async onClick(event: MouseEvent): Promise<void> {
		if (!this.action.enabled) {
			return;
		}
		super.onClick(event);
	}

	private _updateInformation(): void {
		if (!this._container || !this._label) {
			return;
		}

		const tooltip = this._getTooltip();
		if (tooltip) {
			this._label.title = tooltip;
			this._label.setAttribute('aria-label', tooltip);
		} else {
			this._label.removeAttribute('title');
			this._label.removeAttribute('aria-label');
		}

		if (this.action.enabled) {
			this._label.classList.remove('disabled');
			this._label.removeAttribute('aria-disabled');
		} else {
			this._label.classList.add('disabled');
			this._label.setAttribute('aria-disabled', 'true');
		}

		// Always treat it like a checkbox:
		this._label.setAttribute('aria-checked', this.action.checked ? 'true' : 'false');
	}

	// No more toggling the entire logic for is or isn't a toggle;
	// just always apply the fancy-toggle-checked class:
	private _updateStyles(checked: boolean) {
		this._container.classList.toggle('fancy-toggle-checked', checked);
		this._updateIcon(checked);
	}

	private _getTooltip(): string | undefined {
		const keybinding = this._options?.keybinding
			? this._keybindingService.lookupKeybinding(this.action.id, this._contextKeyService)
			: undefined;

		let tooltip = this.action.tooltip || this.action.label;
		if (tooltip && keybinding) {
			const kbLabel = keybinding.getLabel();
			if (kbLabel) {
				tooltip = localize('titleAndKb', '{0} ({1})', tooltip, kbLabel);
			}
		}
		return tooltip || undefined;
	}

	private _updateIcon(checked: boolean): void {
		if (!this._label || !this._container) {
			return;
		}
		const actionItem = this._menuItemAction.item;
		if (!actionItem) {
			return;
		}

		// Clear old dynamic classes/disposables first:
		this._untoggledIconDispose.clear();
		this._toggledIconDispose.clear();

		// "untoggled" icon from actionItem.icon
		this._applyIconToElement(
			this._untoggledIcon,
			actionItem.icon,
			this._untoggledIconDispose
		);

		// "toggled" icon from actionItem.toggled.icon (assuming .toggled is set)
		// If the item is declared as a toggle, it presumably has toggled info:
		const toggleIcon =
			checked &&
				isICommandActionToggleInfo(actionItem.toggled) &&
				actionItem.toggled.icon
				? actionItem.toggled.icon
				: actionItem.icon;

		this._applyIconToElement(
			this._toggledIcon,
			toggleIcon,
			this._toggledIconDispose
		);

		// Now control which one is visible by setting opacity:
		this._untoggledIcon.style.opacity = checked ? '0' : '1';
		this._toggledIcon.style.opacity = checked ? '1' : '0';
	}

	// Helper: apply path-based or theme-based icon to a specific element
	private _applyIconToElement(
		element: HTMLElement,
		icon: Icon | undefined,
		store: DisposableStore
	): void {
		// Remove old theme classes / background first
		element.classList.remove(...Array.from(element.classList).filter(c => c.startsWith('codicon-')));
		element.style.backgroundImage = '';

		// If no icon is defined, just stop
		if (!icon) {
			return;
		}

		if (ThemeIcon.isThemeIcon(icon)) {
			// Theme-based icon
			const iconClasses = ThemeIcon.asClassNameArray(icon);
			element.classList.add(...iconClasses);
			store.add(
				toDisposable(() => {
					element.classList.remove(...iconClasses);
				})
			);
		} else {
			// Path-based icon (light/dark)
			const themeType = this._themeService.getColorTheme().type;
			const iconPath = isDark(themeType) ? icon.dark : icon.light;
			element.style.backgroundImage = `url(${asCSSUrl(iconPath)})`;

			// Re-apply on theme changes
			store.add(
				this._themeService.onDidColorThemeChange(() => {
					const newThemeType = this._themeService.getColorTheme().type;
					const newIconPath = isDark(newThemeType) ? icon.dark : icon.light;
					element.style.backgroundImage = `url(${asCSSUrl(newIconPath)})`;
				})
			);

			// Clean up if we remove the icon
			store.add(
				toDisposable(() => {
					element.style.backgroundImage = '';
				})
			);
		}
	}

	private _applyInitialCheckedStateForTransition(): void {
		if (!this._container || !this._label) {
			return;
		}

		const oldChecked = FancyToggleActionViewItem.lastCheckedState.get(this.action.id);
		const newChecked = !!this.action.checked;

		// If first time or no change, do nothing
		if (oldChecked === undefined) {
			return;
		}

		this._updateStyles(oldChecked);

		if (oldChecked === newChecked) {
			return;
		}

		getWindow(this._container).requestAnimationFrame(() => {
			getWindow(this._container).requestAnimationFrame(() => {
				this._updateStyles(newChecked);
			});
		});
	}

	// On dispose, remember the final state
	override dispose(): void {
		FancyToggleActionViewItem.lastCheckedState.set(this.action.id, !!this.action.checked);
		super.dispose();
	}
}
