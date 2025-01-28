/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../base/common/cancellation.js';
import { IDisposable } from '../../../../base/common/lifecycle.js';
import { ThemeIcon } from '../../../../base/common/themables.js';
import { URI } from '../../../../base/common/uri.js';
import { IRange } from '../../../../editor/common/core/range.js';
import { Location } from '../../../../editor/common/languages.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { ChatAgentLocation } from './aideAgentAgents.js';
import { IChatModel, IChatRequestVariableData, IChatRequestVariableEntry } from './aideAgentModel.js';
import { IParsedChatRequest } from './aideAgentParserTypes.js';
import { IChatContentReference, IChatProgressMessage, IChatSendRequestOptions } from './aideAgentService.js';

export interface IChatVariableData {
	id: string;
	name: string;
	icon?: ThemeIcon;
	fullName?: string;
	description: string;
	modelDescription?: string;
	isSlow?: boolean;
	canTakeArgument?: boolean;
}

export type IChatRequestVariableValue = string | URI | Location | unknown;

export type IChatVariableResolverProgress =
	| IChatContentReference
	| IChatProgressMessage;

export interface IChatVariableResolver {
	(messageText: string, arg: string | undefined, model: IChatModel, progress: (part: IChatVariableResolverProgress) => void, token: CancellationToken): Promise<IChatRequestVariableValue | undefined>;
}

export const IAideAgentVariablesService = createDecorator<IAideAgentVariablesService>('IAideAgentVariablesService');

export interface IAideAgentVariablesService {
	_serviceBrand: undefined;
	registerVariable(data: IChatVariableData, resolver: IChatVariableResolver): IDisposable;
	hasVariable(name: string): boolean;
	getVariable(name: string): IChatVariableData | undefined;
	getVariables(location: ChatAgentLocation): Iterable<Readonly<IChatVariableData>>;
	getDynamicVariables(sessionId: string): ReadonlyArray<IDynamicVariable>; // should be its own service?
	attachContext(name: string, value: string | URI | Location | unknown, location: ChatAgentLocation): void;

	/**
	 * Resolves all variables that occur in `prompt`
	 */
	resolveVariables(prompt: IParsedChatRequest, attachedContextVariables: IChatRequestVariableEntry[] | undefined, model: IChatModel, progress: (part: IChatVariableResolverProgress) => void, options: IChatSendRequestOptions | undefined, token: CancellationToken): Promise<IChatRequestVariableData>;
	resolveVariable(variableName: string, promptText: string, model: IChatModel, progress: (part: IChatVariableResolverProgress) => void, token: CancellationToken): Promise<IChatRequestVariableValue | undefined>;
}

export interface IDynamicVariable {
	range: IRange;
	id: string;
	fullName?: string;
	icon?: ThemeIcon;
	prefix?: string;
	modelDescription?: string;
	data: IChatRequestVariableValue;
}
