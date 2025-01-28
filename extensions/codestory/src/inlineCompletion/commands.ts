/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ConfigurationTarget, commands, workspace } from 'vscode';
// import { SidecarCompletionProvider } from './sidecarCompletion';

// We register all the commands here related to tab autocomplete and we do so
// in a very simple way by even passing.

type Command = {
	command: string;
	callback: (...args: any[]) => any;
	thisArg?: any;
};

// const configTarget = ConfigurationTarget.Global;

/*
const toggleInlineCompletionTriggerMode: Command = {
	command: 'aide.toggleInlineCompletionTriggerMode',
	callback: (value: 'automatic' | 'manual' | undefined) => {
		const configuration = workspace.getConfiguration('aide');
		let target = value;
		if (!target) {
			const current = configuration.get('inlineCompletion.triggerMode', 'automatic');
			if (current === 'automatic') {
				target = 'manual';
			} else {
				target = 'automatic';
			}
		}
		configuration.update('inlineCompletion.triggerMode', target, configTarget, false);
	},
};


const applyCallback: Command = {
	command: 'aide.applyCallback',
	callback: (callback) => {
		callback?.();
	},
};

const triggerInlineCompletion: Command = {
	command: 'aide.inlineCompletion.trigger',
	callback: () => {
		commands.executeCommand('editor.action.inlineSuggest.trigger');
	},
};

const acceptInlineCompletion: Command = {
	command: 'aide.inlineCompletion.accept',
	callback: () => {
		commands.executeCommand('editor.action.inlineSuggest.commit');
	},
};

// I have to handleEvent and then handle it on the sidecar completion provider just like how we are doing
// it in tabby https://github.com/TabbyML/tabby/blob/main/clients/vscode/src/commands.ts#L212
const acceptInlineCompletionNextWord = (completionProvider: SidecarCompletionProvider): Command => {
	return {
		command: 'aide.inlineCompletion.acceptNextWord',
		callback: () => {
			completionProvider.handleEvent('accept_word');
			commands.executeCommand('editor.action.inlineSuggest.acceptNextWord');
		},
	};
};

const acceptInlineCompletionNextLine = (completionProvider: SidecarCompletionProvider): Command => {
	return {
		command: 'aide.inlineCompletion.acceptNextLine',
		callback: () => {
			completionProvider.handleEvent('accept_line');
			commands.executeCommand('editor.action.inlineSuggest.acceptNextLine');
		},
	};
};

const dismissInlineCompletion = (completionProvider: SidecarCompletionProvider): Command => {
	return {
		command: 'aide.inlineCompletion.dismiss',
		callback: () => {
			completionProvider.handleEvent('dismiss');
			commands.executeCommand('editor.action.inlineSuggest.hide');
		},
	};
};
*/

const toggleInlineCompletion: Command = {
	command: 'aide.inlineCompletion.toggle',
	callback: () => {
		const config = workspace.getConfiguration('aide');
		const enabled = config.get('inlineCompletion.enableTabAutocomplete');
		config.update(
			'inlineCompletion.enableTabAutocomplete',
			!enabled,
			ConfigurationTarget.Global
		);
	},
};

export const aideCommands = (
	// completionProvider: SidecarCompletionProvider,
) =>
	[
		// toggleInlineCompletionTriggerMode,
		// applyCallback,
		// triggerInlineCompletion,
		// acceptInlineCompletion,
		toggleInlineCompletion,
		// acceptInlineCompletionNextWord(completionProvider),
		// acceptInlineCompletionNextLine(completionProvider),
		// dismissInlineCompletion(completionProvider),
	].map((command) => commands.registerCommand(command.command, command.callback, command.thisArg));
