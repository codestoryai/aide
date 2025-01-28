/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../../common/event.js';
import { $, addDisposableListener, EventType } from '../../dom.js';
import { IHoverDelegate } from '../hover/hoverDelegate.js';
import { getBaseLayerHoverDelegate } from '../hover/hoverDelegate2.js';
import { getDefaultHoverDelegate } from '../hover/hoverDelegateFactory.js';
import { Widget } from '../widget.js';
import './switch.css';

export interface ISwitchOpts {
	readonly options: string[];
	readonly value: string;
	readonly enabled?: boolean;
	readonly description?: string;
	readonly hoverDelegate?: IHoverDelegate;
}

export class Switch extends Widget {
	private readonly _onDidChange = this._register(new Emitter<string>());
	readonly onDidChange: Event<string> = this._onDidChange.event;

	private readonly _opts: ISwitchOpts;
	readonly domNode: HTMLElement;
	private _value: string;
	private _enabled: boolean;

	constructor(opts: ISwitchOpts) {
		super();

		this._opts = opts;
		this._value = this._opts.value;
		this._enabled = this._opts.enabled ?? true;

		// Create main container
		this.domNode = $('.monaco-switch');
		if (!this._enabled) {
			this.domNode.setAttribute('aria-disabled', 'true');
		}

		// Setup hover if description is provided
		this._register(getBaseLayerHoverDelegate().setupManagedHover(
			opts.hoverDelegate ?? getDefaultHoverDelegate('mouse'),
			this.domNode,
			this._opts.description ?? ''
		));

		// Create options
		this._opts.options.forEach((option, index) => {
			const button = $('button.switch-option');
			button.textContent = option;
			button.setAttribute('role', 'radio');
			button.setAttribute('aria-checked', String(option === this._value));

			this._register(addDisposableListener(button, EventType.CLICK, () => {
				if (this._enabled) {
					this.value = option;
					this._onDidChange.fire(option);
				}
			}));

			this.domNode.appendChild(button);

			// Add separator if not last option
			if (index < this._opts.options.length - 1) {
				const separator = $('span.switch-separator');
				separator.textContent = '/';
				this.domNode.appendChild(separator);
			}
		});

		this.updateOptionStates();
	}

	private updateOptionStates(): void {
		const buttons = this.domNode.querySelectorAll('button.switch-option');
		buttons.forEach(button => {
			const isSelected = button.textContent === this._value;
			button.classList.toggle('selected', isSelected);
			button.setAttribute('aria-checked', String(isSelected));
		});
	}

	get value(): string {
		return this._value;
	}

	set value(newValue: string) {
		if (this._value !== newValue && this._opts.options.includes(newValue)) {
			this._value = newValue;
			this.updateOptionStates();
		}
	}

	enable(): void {
		this._enabled = true;
		this.domNode.removeAttribute('aria-disabled');
	}

	disable(): void {
		this._enabled = false;
		this.domNode.setAttribute('aria-disabled', 'true');
	}
}
