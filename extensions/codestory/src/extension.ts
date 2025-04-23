/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as os from 'os';
import * as vscode from 'vscode';
import { createInlineCompletionItemProvider } from './completions/create-inline-completion-item-provider';
import { AideAgentSessionProvider } from './completions/providers/aideAgentProvider';
import { CSEventHandler } from './csEvents/csEventHandler';
import { isViteConfigFile, ReactDevtoolsManager } from './devtools/react/DevtoolsManager';
import { getGitCurrentHash, getGitRepoName } from './git/helper';
import { aideCommands } from './inlineCompletion/commands';
import { startupStatusBar } from './inlineCompletion/statusBar';
import logger from './logger';
import postHogClient from './posthog/client';
import { RecentEditsRetriever } from './server/editedFiles';
import { RepoRef, RepoRefBackend, SideCarClient } from './sidecar/client';
import { getSideCarModelConfiguration } from './sidecar/types';
import { SimpleBrowserManager } from './simpleBrowser/simpleBrowserManager';
import { loadOrSaveToStorage } from './storage/types';
import { copySettings, migrateFromVSCodeOSS } from './utilities/copySettings';
import { killProcessOnPort } from './utilities/killPort';
import { shouldTrackFile } from './utilities/openTabs';
import { findPortPosition } from './utilities/port';
import { checkReadonlyFSMode } from './utilities/readonlyFS';
import { restartSidecarBinary, setupSidecar } from './utilities/setupSidecarBinary';
import { sidecarURL, sidecarUseSelfRun } from './utilities/sidecarUrl';
import { getUniqueId } from './utilities/uniqueId';
import { ProjectContext } from './utilities/workspaceContext';
import { installCommandMap, PACKAGE_NAME as COMPONENT_TAGGER_PACKAGE_NAME, PackageManager, transformViteConfig } from './devtools/react/installVitePlugin';
import { executeTerminalCommand } from './terminal/TerminalManager';
import { basename, dirname } from 'node:path';

export let SIDECAR_CLIENT: SideCarClient | null = null;

const showBrowserCommand = 'codestory.show-simple-browser';

export async function activate(context: vscode.ExtensionContext) {
	const session = await vscode.csAuthentication.getSession({ hardCheck: false });
	const email = session?.account.email ?? '';

	// Project root here
	const uniqueUserId = getUniqueId();
	logger.info(`[CodeStory]: ${uniqueUserId} Activating extension with storage: ${context.globalStorageUri}`);
	postHogClient?.capture({
		distinctId: getUniqueId(),
		event: 'extension_activated',
		properties: {
			platform: os.platform(),
			product: 'aide',
			email,
		},
	});

	let rootPath = vscode.workspace.rootPath;
	if (!rootPath) {
		rootPath = '';
	}

	// Create the copy settings from vscode command for the extension
	const registerCopySettingsCommand = vscode.commands.registerCommand(
		'codestory.importSettings',
		async () => await copySettings(logger)
	);
	context.subscriptions.push(registerCopySettingsCommand);
	migrateFromVSCodeOSS(logger);

	const readonlyFS = checkReadonlyFSMode();
	if (readonlyFS) {
		vscode.window.showErrorMessage('Move Aide to the Applications folder using Finder. More instructions here: [link](https://docs.codestory.ai/troubleshooting#macos-readonlyfs-warning)');
		return;
	}

	// Now we get all the required information and log it
	const repoName = await getGitRepoName(rootPath);
	const repoHash = await getGitCurrentHash(rootPath);

	// We also get some context about the workspace we are in and what we are upto
	const projectContext = new ProjectContext();
	await projectContext.collectContext();

	postHogClient?.capture({
		distinctId: await getUniqueId(),
		event: 'activated_lsp',
		properties: {
			product: 'aide',
			email,
			repoName,
			repoHash,
		}
	});

	// Setup the sidecar client here
	const sidecarDisposable = await setupSidecar(context.globalStorageUri.fsPath);
	context.subscriptions.push(sidecarDisposable);
	vscode.sidecar.onDidTriggerSidecarRestart(() => {
		restartSidecarBinary(context.globalStorageUri.fsPath);
	});

	// Get model selection configuration
	const modelConfiguration = await vscode.modelSelection.getConfiguration();
	const sidecarClient = new SideCarClient(modelConfiguration);
	SIDECAR_CLIENT = sidecarClient;

	// Setup the current repo representation here
	const currentRepo = new RepoRef(
		// We assume the root-path is the one we are interested in
		rootPath,
		RepoRefBackend.local,
	);
	// setup the callback for the model configuration
	vscode.modelSelection.onDidChangeConfiguration((config) => {
		sidecarClient.updateModelConfiguration(config);
	});
	vscode.modelSelection.registerModelConfigurationValidator({
		async provideModelConfigValidation(config) {
			if (!session) {
				return { valid: false, error: 'You must be logged in' };
			}

			const sidecarModelConfig = await getSideCarModelConfiguration(config, session.accessToken);
			return sidecarClient.validateModelConfiguration(sidecarModelConfig);
		},
	});

	// register the inline code completion provider
	await createInlineCompletionItemProvider(
		{
			triggerNotice: notice => {
				console.log(notice);
			},
			sidecarClient,
		}
	);
	// register the commands here for inline completion
	aideCommands();
	// set the status bar as well
	startupStatusBar();

	// Get the storage object here
	const codeStoryStorage = await loadOrSaveToStorage(context.globalStorageUri.fsPath, rootPath);
	logger.info(codeStoryStorage);
	logger.info(rootPath);

	/*
	// Register the semantic search command here
	vscode.commands.registerCommand('codestory.semanticSearch', async (prompt: string): Promise<CodeSymbolInformationEmbeddings[]> => {
		logger.info('[semanticSearch][extension] We are executing semantic search :' + prompt);
		postHogClient?.capture({
			distinctId: await getUniqueId(),
			event: 'search',
			properties: {
				prompt,
				repoName,
				repoHash,
			},
		});
		// We should be using the searchIndexCollection instead here, but for now
		// embedding search is fine
		// Here we will ping the semantic client instead so we can get the results
		const results = await sidecarClient.getSemanticSearchResult(
			prompt,
			currentRepo,
		);
		return results;
	});
	*/

	// Gets access to all the events the editor is throwing our way
	const csEventHandler = new CSEventHandler(context);
	context.subscriptions.push(csEventHandler);

	// add the recent edits retriver to the subscriptions
	// so we can grab the recent edits very quickly
	const recentEditsRetriever = new RecentEditsRetriever(30 * 1000, vscode.workspace);
	context.subscriptions.push(recentEditsRetriever);

	// Register the agent session provider
	const agentSessionProvider = new AideAgentSessionProvider(
		currentRepo,
		projectContext,
		sidecarClient,
		recentEditsRetriever,
		context,
	);
	context.subscriptions.push(agentSessionProvider);

	// When the selection changes in the editor we should trigger an event
	vscode.window.onDidChangeTextEditorSelection(async (event) => {
		const textEditor = event.textEditor;
		if (shouldTrackFile(textEditor.document.uri)) {
			// track the changed selection over here
			const selections = event.selections;
			if (selections.length !== 0) {
				await csEventHandler.onDidChangeTextDocumentSelection(textEditor.document.uri.fsPath, selections);
			}
		}
	});

	// Listen to all the files which are changing, so we can keep our tree sitter cache hot
	vscode.workspace.onDidChangeTextDocument(async (event) => {
		const documentUri = event.document.uri;
		// if its a schema type, then skip tracking it
		if (documentUri.scheme === 'vscode') {
			return;
		}
		// TODO(skcd): we want to send the file change event to the sidecar over here
		if (shouldTrackFile(documentUri)) {
			await sidecarClient.documentContentChange(
				documentUri.fsPath,
				event.contentChanges,
				event.document.getText(),
				event.document.languageId,
			);
		}
	});

	const diagnosticsListener = vscode.languages.onDidChangeDiagnostics(async (event) => {
		for (const uri of event.uris) {
			// filter out diagnostics which are ONLY errors and warnings
			const diagnostics = vscode.languages.getDiagnostics(uri).filter((diagnostic) => {
				return (diagnostic.severity === vscode.DiagnosticSeverity.Error || diagnostic.severity === vscode.DiagnosticSeverity.Warning);
			});

			// Send diagnostics to sidecar
			try {
				await sidecarClient.sendDiagnostics(uri.toString(), diagnostics);
			} catch (error) {
				// console.error(`Failed to send diagnostics for ${uri.toString()}:`, error);
			}
		}
	});

	// shouldn't all listeners have this?
	context.subscriptions.push(diagnosticsListener);

	// Contains bindings to react devtools headless frontend
	const reactDevtoolsManager = new ReactDevtoolsManager();
	context.subscriptions.push(reactDevtoolsManager);

	reactDevtoolsManager.onActiveSessionStatusChange((status) => {
		vscode.devtools.setStatus(status);
		if (status === 'devtools-connected') {
			postHogClient?.capture({
				distinctId: getUniqueId(),
				event: 'devtools.activated_devtools',
				properties: {
					product: 'aide',
					email,
					repoName,
					repoHash,
				}
			});
		}
	});

	reactDevtoolsManager.onActiveSessionInspectHostChange((isInspecting) => {
		vscode.devtools.setIsInspectingHost(isInspecting);
	});

	reactDevtoolsManager.onActiveSessionInspectedElementChange((payload) => {
		vscode.devtools.setLatestPayload(payload);
	});

	vscode.devtools.onDidTriggerInspectingHostStart(() => {
		reactDevtoolsManager.startInspectingHost();
	});

	vscode.devtools.onDidTriggerInspectingHostStop(() => {
		reactDevtoolsManager.stopInspectingHost();
	});

	vscode.devtools.onDidTriggerInspectingClearOverlays(() => {
		reactDevtoolsManager.inspectingClearOverlays();
	});

	async function openUrl(url: string) {
		try {
			const parsedUrl = new URL(url);
			const proxyedPort = await reactDevtoolsManager.startOrGetSession(Number(parsedUrl.port));
			const proxyedUrl = new URL(parsedUrl);
			proxyedUrl.port = proxyedPort.toString();


			const sessions: Record<number, number> = {};
			for (const [port, session] of reactDevtoolsManager.sessions.entries()) {
				sessions[session.proxyPort!] = port;
			}

			simpleBrowserManager.show(proxyedUrl.href, { metadata: { sessions }, inPreview: true });
			// TODO(@g-danna) Make dedicated service to keep these nicely in sync?
			vscode.commands.executeCommand('workbench.action.showPreview');
		} catch (err) {
			vscode.window.showErrorMessage('The URL you provided is not valid');
		}
	}

	const simpleBrowserManager = new SimpleBrowserManager(
		context.extensionUri,
		() => {
			reactDevtoolsManager.inspectingClearOverlays();
		}
	);
	context.subscriptions.push(simpleBrowserManager);

	context.subscriptions.push(simpleBrowserManager.onUrlChange(({ url }) => {
		openUrl(url);
	}));

	context.subscriptions.push(simpleBrowserManager);


	// Open simple browser command
	context.subscriptions.push(vscode.commands.registerCommand(showBrowserCommand, async (providedUrl?: string) => {

		const prefilledUrl = 'http://localhost:3000';
		const portPosition = findPortPosition(prefilledUrl);

		const url = providedUrl || (await vscode.window.showInputBox({
			placeHolder: vscode.l10n.t("https://localhost:3000"),
			value: prefilledUrl,
			valueSelection: portPosition ? [portPosition.start, portPosition.end] : undefined,
			prompt: vscode.l10n.t("Insert the url of your dev server")
		}));

		if (url) {
			openUrl(url);
			return true;
		}
		return false;
	}));

	const addVitePluginCommand = vscode.commands.registerCommand(
		'codestory.install-vite-plugin',
		async (givenViteConfigUri?: vscode.Uri) => {
			try {

				// Check that we have a workspace at all
				const workspaceFolders = vscode.workspace.workspaceFolders;
				if (!workspaceFolders || workspaceFolders.length === 0) {
					throw new Error('No workspace folder found');
				}

				// Decide which vite.config file to modify
				let viteConfigUri = givenViteConfigUri;

				if (!viteConfigUri) {
					const activeEditor = vscode.window.activeTextEditor;
					if (
						activeEditor &&
						isViteConfigFile(activeEditor.document.uri)
					) {
						// Use the currently open file if it's a vite.config
						viteConfigUri = activeEditor.document.uri;
					} else {
						// Otherwise, find all vite.config.* in the workspace
						const allConfigs = await vscode.workspace.findFiles(
							'**/vite.config.{ts,js,mjs,cjs}',
							'**/node_modules/**'
						);
						if (allConfigs.length === 0) {
							throw new Error('No Vite config file found in this workspace');
						} else if (allConfigs.length === 1) {
							// (a) If there is only one, offer to use it or manually pick
							const single = allConfigs[0];
							const pick = await vscode.window.showQuickPick(
								[
									{ label: 'Use the single config found', description: single.fsPath },
									{ label: 'Manually select from all found configs', description: '' },
								],
								{ placeHolder: 'One config found. Which do you want to use?' }
							);
							if (!pick) {
								// User canceled
								return;
							}
							if (pick.label === 'Use the single config found') {
								viteConfigUri = single;
							} else {
								// "Manually select" - in this simplest approach,
								// we just show a pick of the (only) config in the array.
								// (You could also do more advanced logic if needed.)
								const secondPick = await vscode.window.showQuickPick(
									allConfigs.map((uri) => ({
										label: basename(uri.fsPath),
										description: uri.fsPath,
									})),
									{ placeHolder: 'Select a Vite config' }
								);
								if (!secondPick) {
									return;
								}
								viteConfigUri = allConfigs.find(
									(uri) => uri.fsPath === secondPick.description
								);
							}
						} else {
							// (b) If there's more than one, prompt the user
							// first show them all discovered configs + last fallback
							const picks = allConfigs.map((uri) => ({
								label: basename(uri.fsPath),
								description: uri.fsPath,
							}));
							picks.push({
								label: 'Manually choose from a list',
								description: '',
							});

							const pick = await vscode.window.showQuickPick(picks, {
								placeHolder: 'Multiple Vite configs found. Select one, or pick from the list.',
							});
							if (!pick) {
								return;
							}
							if (pick.label === 'Manually choose from a list') {
								// Show them again in a second pick - or do something more elaborate if needed
								const secondPick = await vscode.window.showQuickPick(
									picks.slice(0, -1), // everything except "manually choose"
									{ placeHolder: 'Select a Vite config' }
								);
								if (!secondPick) {
									return;
								}
								viteConfigUri = allConfigs.find(
									(uri) => basename(uri.fsPath) === secondPick.label
								);
							} else {
								// They've chosen one of the actual config files
								viteConfigUri = allConfigs.find(
									(uri) => basename(uri.fsPath) === pick.label
								);
							}
						}
					}
				}

				if (!viteConfigUri) {
					// If we still have no config, abort
					throw new Error('No valid vite.config file to modify');
				}

				// 3. Prompt for package manager
				const packageManagerPicks = [
					{ label: PackageManager.npm, picked: true },
					{ label: PackageManager.pnpm },
					{ label: PackageManager.yarn },
					{ label: PackageManager.bun },
				];
				const chosenPackageManager = await vscode.window.showQuickPick(
					packageManagerPicks,
					{ placeHolder: 'Select your package manager…' }
				);
				if (!chosenPackageManager) {
					vscode.window.showInformationMessage(
						'Plugin not installed - user canceled.'
					);
					return;
				}

				// Install the plugin
				vscode.window.showInformationMessage(
					`Installing latest ${COMPONENT_TAGGER_PACKAGE_NAME}`
				);


				const commandCwd = dirname(viteConfigUri.fsPath);
				await executeTerminalCommand(
					installCommandMap.get(chosenPackageManager.label)!,
					commandCwd
				);

				// Read the config file
				const viteConfigData = await vscode.workspace.fs.readFile(viteConfigUri);
				const viteConfigText = Buffer.from(viteConfigData).toString('utf8');

				// Transform the config text
				const transformed = await transformViteConfig(viteConfigText);
				if (!transformed) {
					throw new Error(
						`Could not parse or transform your ${viteConfigUri.fsPath}`
					);
				}

				// Write the transformed text back
				await vscode.workspace.fs.writeFile(
					viteConfigUri,
					Buffer.from(transformed)
				);
				vscode.window.showInformationMessage(
					`Successfully added plugin configuration to: ${viteConfigUri.fsPath}`
				);

				await vscode.commands.executeCommand('setContext', 'devtools.shouldShowAddPlugin', false);
				await vscode.commands.executeCommand('editor.action.formatDocument');

			} catch (error: any) {
				vscode.window.showErrorMessage(`Error: ${error}`);
			}
		}
	);
	context.subscriptions.push(addVitePluginCommand);

	// Register generate commit message command
	const generateCommitMessageCommand = vscode.commands.registerCommand(
		'codestory.generateCommitMessage',
		async () => {
			try {
				const rootPath = vscode.workspace.rootPath;
				if (!rootPath) {
					vscode.window.showErrorMessage('No workspace folder found');
					return;
				}

				// Get commit message
				const commitMessage = await generateCommitMessage(rootPath);
				
				// Show the commit message in a quick pick to allow editing
				const result = await vscode.window.showInputBox({
					value: commitMessage,
					prompt: 'Edit commit message if needed',
					placeHolder: 'Commit message'
				});

				if (result) {
					// Execute git commit command with the message
					const terminal = vscode.window.createTerminal('Git Commit');
					terminal.sendText(`git commit -m "${result.replace(/"/g, '\\"')}"`);
					terminal.show();
				}
			} catch (error) {
				vscode.window.showErrorMessage('Failed to generate commit message');
			}
		}
	);
	context.subscriptions.push(generateCommitMessageCommand);
}

export async function deactivate() {
	if (!sidecarUseSelfRun()) {
		const sidecarUrl = sidecarURL();
		const port = parseInt(sidecarUrl.split(':').at(-1) ?? '42424');
		await killProcessOnPort(port);
	}
}