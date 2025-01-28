/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { LSPQuickFixInvocationRequest, SidecarQuickFixInvocationResponse, SidecarQuickFixRequest, SidecarQuickFixResponse } from './types';

class QuickFixList {
	request_ids: Map<string, { label: string; arguments: any; command: string; id: number }[]>;

	constructor() {
		this.request_ids = new Map();
	}

	insertForRequestId(requestId: string, options: { label: string; command: string; arguments: any; id: number }[]) {
		this.request_ids.set(requestId, options);
	}

	getForRequestId(requestId: string, selectedActionId: number): { label: string; command: string; arguments: any } | undefined {
		const options = this.request_ids.get(requestId);
		if (options === undefined) {
			return undefined;
		} else {
			const selectedOption = options.find((value) => {
				return value.id === selectedActionId;
			});
			return selectedOption;
		}
	}
}

const QUICK_FIX_LIST = new QuickFixList();

export async function quickFixInvocation(request: LSPQuickFixInvocationRequest): Promise<SidecarQuickFixInvocationResponse> {
	const requestId = request.request_id;
	const actionId = request.index;
	const file_path = request.fs_file_path;
	const possibleAction = QUICK_FIX_LIST.getForRequestId(requestId, actionId);
	if (possibleAction !== undefined) {
		if (Array.isArray(possibleAction.arguments)) {
			// If arguments is an array, spread the arguments
			await vscode.commands.executeCommand(possibleAction.command, ...possibleAction.arguments);
		} else {
			// If arguments is an object, pass it directly
			await vscode.commands.executeCommand(possibleAction.command, possibleAction.arguments);
		}
		// we also save the file after invoking it
		await vscode.workspace.save(vscode.Uri.file(file_path));
		return {
			request_id: requestId,
			invocation_success: true,
		};
	} else {
		return {
			request_id: requestId,
			invocation_success: false,
		};
	}
}

// some things to consider over here:
// rust analyzer sends over the following command when there are multiple
// types which can satisfy the requirement: rust-analyzer.applyActionGroup
// and then we have to select the best one, the types for the sub-commands are
// the following: {command: 'rust-analyzer.applyActionGroup', arguments: Vec<{label: string, arguments: vec<...>}>}
// so we have to pass the labels and arguments over here
// to invoke any of the actions this is what we use:
// ```rust
// await vscode.commands.executeCommand(
//	 "rust-analyzer.resolveCodeAction",
//	 selectedAction.arguments,
// );
// ```
// if we get 'rust-analyzer.applyActionGroup' we can try to flatten it and select the best
// option from the LLM
// we can store this and then send it over later on no problems
// we do have to store the document after applying the action so its completely saved
// the other case is when we have a single import resolution happening, in which case
// we can use the following:
// we get the following in the command: {command: `rust-analyzer.resolveCodeAction`, arguments: Vec<...>} and can directly
// invoke it from the arguments, so now we have something to build on top of

// TODO(skcd): This is not complete yet, we have to invoke the request
// multiple times and then invoke the request and save the changes
export async function quickFixList(request: SidecarQuickFixRequest): Promise<SidecarQuickFixResponse> {
	const textDocumentUri = vscode.Uri.file(request.fs_file_path);
	const requestId = request.request_id;
	const startPosition = request.range.startPosition;
	const endPosition = request.range.endPosition;
	const quickFixRange = new vscode.Range(new vscode.Position(startPosition.line, startPosition.character), new vscode.Position(endPosition.line, endPosition.character));
	await vscode.workspace.openTextDocument(textDocumentUri);
	const codeActions: vscode.CodeAction[] = await vscode.commands.executeCommand(
		'vscode.executeCodeActionProvider',
		textDocumentUri,
		quickFixRange,
	);
	const actionsFlattened: { label: string; arguments: any; command: string; id: number }[] = [];
	let actionIndex = 0;
	// Over here try to get all the code actions which we need to execute
	codeActions.forEach((codeAction) => {
		if (codeAction.command?.command === 'rust-analyzer.applyActionGroup') {
			// command.arguments can be an array of arrays - this was silently wrecking quick_fix_list parsing in sidecar
			const commandPossibleArguments = codeAction.command.arguments ?? [];

			// hierarchy doesn't carry meaning - flattening fixes above issue
			const flattenedArguments = commandPossibleArguments.flat();

			flattenedArguments.forEach((commandPossibleArgument) => {
				// extra safe check
				if (typeof commandPossibleArgument === 'object' && commandPossibleArgument !== null) {
					actionsFlattened.push({
						label: commandPossibleArgument.label,
						arguments: commandPossibleArgument.arguments,
						command: 'rust-analyzer.resolveCodeAction',
						id: actionIndex++, // postfix increment (increments by 1, returns original value)
					});
				} else {
					console.warn('Unexpected argument type:', commandPossibleArgument);
				}
			});
		} else {
			const actionCommand = codeAction.command;
			if (actionCommand !== undefined) {
				if (actionCommand.command === 'inlineChat.start') {
					// If its any of the inlineChat.start, then we skip it (this is 'Fix with Aide')
					return;
				} else {
					actionsFlattened.push({
						label: actionCommand.title,
						command: actionCommand.command,
						arguments: actionCommand.arguments,
						id: actionIndex,
					});
					actionIndex = actionIndex + 1;
				}
			}
		}
	});
	// console.log('actions');
	// console.log(actionsFlattened);
	// console.log('actions list');
	QUICK_FIX_LIST.insertForRequestId(requestId, actionsFlattened);

	const options = actionsFlattened.map((action) => {
		return {
			label: action.label,
			index: action.id,
		};
	});

	return { options };
}
