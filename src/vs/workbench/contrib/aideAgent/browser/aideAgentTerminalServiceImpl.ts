/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';

import { ITerminalGroupService } from '../../terminal/browser/terminal.js';
import { IAideAgentTerminalService } from '../common/aideAgentTerminalService.js';

export class AideAgentTerminalService extends Disposable implements IAideAgentTerminalService {
	declare _serviceBrand: undefined;

	private readonly _onDidAgentAddTerminal = this._register(new Emitter<void>());
	public readonly onDidAgentAddTerminal = this._onDidAgentAddTerminal.event;

	private nextTerminalToShow?: string;

	constructor(
		@ITerminalGroupService private readonly terminalGroupService: ITerminalGroupService,
	) {
		super();

		this.terminalGroupService.onDidChangeInstances(() => {
			this.doShowTerminal();
		});
		this.doShowTerminal();
	}

	showTerminal(id: string) {
		this.nextTerminalToShow = id;
		this.doShowTerminal();
		setTimeout(() => {
			if (this.nextTerminalToShow) {
				// clean up after a bit
				this.nextTerminalToShow = undefined;
			}
		}, 5000);
	}

	// This is a separate method because there may be a race condition in the rpc
	// when we create a new terminal from the extension and we call aideAgentTerminals.showTerminal()
	private doShowTerminal(): void {
		if (!this.nextTerminalToShow) {
			return;
		}
		for (const terminal of this.terminalGroupService.instances) {
			if (terminal.metadata && terminal.metadata.hasOwnProperty('codestoryId')) {
				if (this.nextTerminalToShow === terminal.metadata.codestoryId) {
					this.terminalGroupService.showPanel(true);
					this.terminalGroupService.setActiveInstance(terminal);
					this.nextTerminalToShow = undefined;
					this._onDidAgentAddTerminal.fire();
				}
			}
		}
	}
}
