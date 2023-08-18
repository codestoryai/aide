/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { v4 as uuidv4 } from 'uuid';
import { commands } from 'vscode';
import { EmbeddingsSearch } from '../codeGraph/embeddingsSearch';
import { CodeGraph } from '../codeGraph/graph';
import { TSMorphProjectManagement } from '../utilities/parseTypescript';
import { MessageHandlerData } from '@estruyf/vscode';
import { debuggingFlow } from '../llm/recipe/debugging';
import { ToolingEventCollection } from '../timeline/events/collection';
import logger from '../logger';
import { PromptState } from '../types';
import { AgentViewProvider } from '../views/AgentView';
import { PythonServer } from '../utilities/pythonServerClient';
import { CSChatProvider } from '../chatprovider';

export const debug = (
	provider: AgentViewProvider,
	csChatProvider: CSChatProvider,
	embeddingIndex: EmbeddingsSearch,
	tsMorphProjectManagement: TSMorphProjectManagement,
	pythonServer: PythonServer,
	codeGraph: CodeGraph,
	repoName: string,
	repoHash: string,
	workingDirectory: string,
	testSuiteRunCommand: string,
) => {
	return commands.registerCommand(
		'codestory.debug',
		async ({ payload, ...message }: MessageHandlerData<PromptState>) => {
			logger.info('[CodeStory] Debugging');
			logger.info(payload);
			const toolingEventCollection = new ToolingEventCollection(
				`/tmp/${uuidv4()}`,
				codeGraph,
				provider,
				csChatProvider,
				message.command,
			);
			try {
				await debuggingFlow(
					payload.prompt,
					toolingEventCollection,
					codeGraph,
					embeddingIndex,
					tsMorphProjectManagement,
					pythonServer,
					workingDirectory,
					testSuiteRunCommand,
				);
			} catch (e) {
				logger.info('[CodeStory] Debugging failed');
				logger.error(e);
			}
		}
	);
};
