/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { getWindow } from '../../../../base/browser/dom.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { Emitter } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { AgentMode } from '../../../../platform/aideAgent/common/model.js';
import { IContextKey, IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { IEnvironmentService } from '../../../../platform/environment/common/environment.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { IWorkspaceContextService, IWorkspaceFolder } from '../../../../platform/workspace/common/workspace.js';
import { IHostService } from '../../../services/host/browser/host.js';
import { IPreviewPartService } from '../../../services/previewPart/browser/previewPartService.js';
import { IFileQuery, ISearchService, QueryType } from '../../../services/search/common/search.js';
import { IViewsService } from '../../../services/views/common/viewsService.js';
import { IDynamicVariable } from '../common/aideAgentVariables.js';
import { DevtoolsStatus, IDevtoolsService, InspectionResult } from '../common/devtoolsService.js';
import { CONTEXT_DEVTOOLS_STATUS, CONTEXT_IS_DEVTOOLS_FEATURE_ENABLED, CONTEXT_IS_INSPECTING_HOST, CONTEXT_SHOULD_SHOW_ADD_PLUGIN } from '../common/devtoolsServiceContextKeys.js';
import { ChatViewId } from './aideAgent.js';
import { ChatViewPane } from './aideAgentViewPane.js';
import { URI } from '../../../../base/common/uri.js';
import { ChatDynamicVariableModel } from './contrib/aideAgentDynamicVariables.js';
import { convertBufferToScreenshotVariable } from './contrib/screenshot.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { EditorResourceAccessor } from '../../../common/editor.js';
import { basename } from '../../../../base/common/resources.js';


const viteConfigs = new Set(['vite.config.ts', 'vite.config.js', 'vite.config.mjs', 'vite.config.cjs']);

const taggerPackageName = '@codestoryai/component-tagger';

type PackageJSONType = {
	dependencies?: Record<string, string>;
	devDependencies?: Record<string, string>;
};

export class DevtoolsService extends Disposable implements IDevtoolsService {
	declare _serviceBrand: undefined;

	private readonly _onDidChangeStatus = this._register(new Emitter<DevtoolsStatus>());
	public readonly onDidChangeStatus = this._onDidChangeStatus.event;

	private readonly _onDidTriggerInspectingHostStart = this._register(new Emitter<void>());
	public readonly onDidTriggerInspectingHostStart = this._onDidTriggerInspectingHostStart.event;

	private readonly _onDidTriggerInspectingHostStop = this._register(new Emitter<void>());
	public readonly onDidTriggerInspectingHostStop = this._onDidTriggerInspectingHostStop.event;

	private readonly _onDidInspectingClearOverlays = this._register(new Emitter<void>());
	public readonly onDidInspectingClearOverlays = this._onDidInspectingClearOverlays.event;

	private _isFeatureEnabled: IContextKey<boolean>;

	private _shouldShowAddPlugin: IContextKey<boolean>;

	private _status: IContextKey<DevtoolsStatus>;
	get status(): DevtoolsStatus {
		const contextKeyValue = this._status.get();
		if (contextKeyValue === undefined) {
			console.error(`Context key for ${CONTEXT_DEVTOOLS_STATUS.key} is undefined. Resetting`);
			this._status.reset();
		}
		return this._status.get()!;
	}

	set status(status: DevtoolsStatus) {
		this._status.set(status);
		this.onStatusChange();
	}

	private _latestPayload: InspectionResult | null | undefined;
	get latestPayload() {
		return this._latestPayload;
	}

	set latestPayload(payload: InspectionResult | null | undefined) {
		this._latestPayload = payload;
	}

	private _latestResource: URI | undefined;
	get latestResource() {
		return this._latestResource;
	}

	private _isInspecting: IContextKey<boolean>;
	get isInspecting() {
		const contextKeyValue = this._isInspecting.get();
		if (contextKeyValue === undefined) {
			console.error(`Context key for ${CONTEXT_IS_INSPECTING_HOST.key} in is undefined. Resetting`);
			this._isInspecting.reset();
		}
		return this._isInspecting.get()!;
	}

	set isInspecting(isInspecting: boolean) {
		this._isInspecting.set(isInspecting);
		// Stopped inspecting and we have some payload
		if (!isInspecting && typeof this._latestPayload !== 'undefined') {
			this.addReference(this._latestPayload);
		}
	}

	constructor(
		@IContextKeyService private readonly contextKeyService: IContextKeyService,
		@IViewsService private readonly viewsService: IViewsService,
		@IFileService private readonly fileService: IFileService,
		@IEnvironmentService private readonly environmentService: IEnvironmentService,
		@IHostService private readonly hostService: IHostService,
		@IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService,
		@ISearchService private readonly searchService: ISearchService,
		@IPreviewPartService private readonly previewPartService: IPreviewPartService,
		@IEditorService private readonly editorService: IEditorService
	) {
		super();

		this._status = CONTEXT_DEVTOOLS_STATUS.bindTo(this.contextKeyService);
		this._isInspecting = CONTEXT_IS_INSPECTING_HOST.bindTo(this.contextKeyService);
		this._isFeatureEnabled = CONTEXT_IS_DEVTOOLS_FEATURE_ENABLED.bindTo(this.contextKeyService);
		this._shouldShowAddPlugin = CONTEXT_SHOULD_SHOW_ADD_PLUGIN.bindTo(this.contextKeyService);

		this.editorService.onDidActiveEditorChange(() => this.checkIfShouldShowAddPlugin());
		// (You might also listen for workspace folder changes, if that matters)
	}

	async initialize() {
		const isReactProject = await this.hasReactDependencyInAnyPackageJson();
		this._isFeatureEnabled.set(isReactProject);
	}

	private async checkForReactDependencyInProject(workspaceFolder: IWorkspaceFolder) {
		// Search for all package.json files under the folder, excluding settings and ignore files
		const searchQuery: IFileQuery = {
			type: QueryType.File,
			folderQueries: [{ folder: workspaceFolder.uri, disregardGlobalIgnoreFiles: false, disregardIgnoreFiles: false }],
			filePattern: 'package.json',
		};

		const searchResults = await this.searchService.fileSearch(searchQuery, CancellationToken.None);
		for (const fileMatch of searchResults.results) {
			try {
				// Load content of each package.json
				const fileContent = (await this.fileService.readFile(fileMatch.resource)).value.toString();
				const parsed = JSON.parse(fileContent);

				// Check if 'react' is in dependencies or devDependencies
				if (this.checkForDependency('react', parsed)) {
					return fileMatch;
				}
			} catch {
				// Ignore file parsing errors
			}
		}
		return false;
	}


	private async checkIfShouldShowAddPlugin() {
		const editor = this.editorService.activeEditor;
		const resource = EditorResourceAccessor.getOriginalUri(editor);
		if (!resource) {
			return;
		}
		const fileName = basename(resource);
		if (viteConfigs.has(fileName)) {
			const folder = this.workspaceContextService.getWorkspaceFolder(resource);
			if (!folder) {
				return;
			}
			const matchedPackageJson = await this.checkForReactDependencyInProject(folder);
			if (matchedPackageJson) {
				const fileContent = (await this.fileService.readFile(matchedPackageJson.resource)).value.toString();
				const parsed = JSON.parse(fileContent);
				const hasComponentTagger = this.checkForDependency(taggerPackageName, parsed);
				this._shouldShowAddPlugin.set(!hasComponentTagger);
			}
		}
	}

	private checkForDependency(dependency: string, parsedJSON: PackageJSONType) {
		const depsValues = parsedJSON.dependencies ? Object.keys(parsedJSON.dependencies) : [];
		const depsSet = new Set(depsValues);
		const devDepsValues = parsedJSON.devDependencies ? Object.keys(parsedJSON.devDependencies) : [];
		const devDepsSet = new Set(devDepsValues);
		return depsSet.has(dependency) || devDepsSet.has(dependency);
	}


	private async hasReactDependencyInAnyPackageJson(): Promise<boolean> {
		// Get all workspace folders (there may be multiple)
		const { folders } = await this.workspaceContextService.getCompleteWorkspace();
		if (!folders?.length) {
			return false;
		}

		for (const folder of folders) {
			const isReactProject = await this.checkForReactDependencyInProject(folder);
			if (isReactProject) { return true; }
		}
		return false;
	}


	private getWidget() {
		const chatViewPane = this.viewsService.getViewWithId<ChatViewPane>(ChatViewId);
		if (!chatViewPane) {
			throw new Error(`Chat view pane must be initialized before calling the Devtools service`);
		}
		return chatViewPane.widget;
	}


	private onStatusChange() {
		const isDevelopment = !this.environmentService.isBuilt || this.environmentService.isExtensionDevelopment;
		if (isDevelopment) {
			console.log('Devtools service status: ', this.status);
		}
		// This can be used as a proxy if the user has opened the browser preview
		if (this.status === DevtoolsStatus.DevtoolsConnected) {
			const widget = this.getWidget();
			widget.input.setMode(AgentMode.Agentic);
		}
		this._onDidChangeStatus.fire(this.status);
	}

	private async attachScreenshot() {
		const screenshot = await this.hostService.getScreenshot();
		const widget = this.getWidget();
		if (screenshot) {
			const previewClientRect = this.previewPartService.getBoundingClientRect();
			const pixelRatio = getWindow(this.previewPartService.mainPart.element).devicePixelRatio;
			const cropRectangle: CropRectangle = {
				x: previewClientRect.left * pixelRatio,
				y: previewClientRect.top * pixelRatio,
				width: previewClientRect.width * pixelRatio,
				height: previewClientRect.height * pixelRatio
			};
			const croppedScreenShot = await cropImage(screenshot, cropRectangle);
			widget.attachmentModel.addContext(convertBufferToScreenshotVariable(croppedScreenShot));
		}
	}


	private async addReference(payload: InspectionResult | null) {
		const widget = this.getWidget();
		const input = widget.inputEditor;
		const inputModel = input.getModel();

		if (!inputModel) {
			return;
		}

		const dynamicVariablesModel = widget.getContrib<ChatDynamicVariableModel>(ChatDynamicVariableModel.ID);
		if (!dynamicVariablesModel) {
			return;
		}

		if (payload === null) {
			this.attachScreenshot();
		} else if (widget.viewModel?.model) {
			widget.viewModel.model.isDevtoolsContext = true;

			const file = await this.fileService.stat(payload.location.uri);
			const displayName = `@${payload.componentName || file.name}:${payload.location.range.startLineNumber}-${payload.location.range.endLineNumber}`;
			const inputModelFullRange = inputModel.getFullModelRange();
			// By default, append to the end of the model
			let replaceRange = {
				startColumn: inputModelFullRange.endColumn,
				endColumn: inputModelFullRange.endColumn,
				startLineNumber: inputModelFullRange.endLineNumber,
				endLineNumber: inputModelFullRange.endLineNumber,
			};

			const selection = input.getSelection();
			// If there is a selection, use that
			if (selection) {
				replaceRange = {
					startColumn: selection.startColumn,
					endColumn: selection.endColumn,
					startLineNumber: selection.startLineNumber,
					endLineNumber: selection.endLineNumber
				};
			}
			const isLeading = replaceRange.startColumn === 1;
			// Add leading space if we are not at the very beginning of the text model
			const output = isLeading ? displayName : ' ' + displayName;

			this.attachScreenshot();

			const success = input.executeEdits('addReactComponentSource', [{ range: replaceRange, text: output }]);
			if (success) {
				const variable: IDynamicVariable = {
					id: 'vscode.file',
					range: {
						...replaceRange,
						// Include the actual length of the variable
						startColumn: replaceRange.startColumn + (isLeading ? 0 : 1),
						endColumn: replaceRange.endColumn + displayName.length + (isLeading ? 0 : 1),
					},
					data: { uri: payload.location.uri, range: payload.location.range }
				};
				dynamicVariablesModel.addReference(variable);
				input.focus();
			}

		}
	}

	startInspectingHost(): void {
		this._isInspecting.set(true);
		this._onDidTriggerInspectingHostStart.fire();
	}

	stopInspectingHost(): void {
		this._isInspecting.set(false);
		this._onDidTriggerInspectingHostStop.fire();
		this._onDidInspectingClearOverlays.fire();
	}

	toggleInspectingHost(): void {
		if (this._isInspecting.get()) {
			this.stopInspectingHost();
		} else {
			this.startInspectingHost();
		}
	}
}



export type CropRectangle = {
	x: number;
	y: number;
	width: number;
	height: number;
};

async function cropImage(buffer: ArrayBufferLike, cropRectangle: CropRectangle): Promise<ArrayBufferLike> {
	// Create blob with JPEG type
	const originalBlob = new Blob([buffer], { type: 'image/jpeg' });
	const url = URL.createObjectURL(originalBlob);
	const img = await createImage(url);

	const canvas = document.createElement('canvas');
	const ctx = canvas.getContext('2d', { alpha: false }); // JPEG doesn't support alpha
	if (!ctx) {
		throw new Error('Failed to get canvas context');
	}

	// Set canvas dimensions to crop size
	canvas.width = cropRectangle.width;
	canvas.height = cropRectangle.height;

	// Set white background (since JPEG doesn't support transparency)
	ctx.fillStyle = '#FFFFFF';
	ctx.fillRect(0, 0, canvas.width, canvas.height);

	// Draw the cropped portion
	ctx.drawImage(
		img,
		Math.round(cropRectangle.x), Math.round(cropRectangle.y),          // Start at this point
		Math.round(cropRectangle.width), Math.round(cropRectangle.height), // Width and height of source rectangle
		0, 0,                                                              // Place at canvas origin
		Math.round(cropRectangle.width), Math.round(cropRectangle.height)  // Width and height of destination rectangle
	);

	// Clean up
	URL.revokeObjectURL(url);

	const newBlob = await canvasToBlob(canvas);
	return newBlob.arrayBuffer();
}

function createImage(src: string): Promise<HTMLImageElement> {
	return new Promise((resolve, reject) => {
		const img = new Image();
		img.onload = () => {
			resolve(img);
		};
		img.onerror = reject;
		img.src = src;
	});
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
	return new Promise<Blob>((resolve, reject) => {
		canvas.toBlob(
			(blob) => {
				if (blob) {
					resolve(blob);
				} else {
					reject(new Error('Failed to create blob'));
				}
			},
			'image/jpeg',
			0.95  // High quality JPEG
		);
	});
}
