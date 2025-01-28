/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { DisposableStore, IDisposable } from '../../../../base/common/lifecycle.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { IStorageService } from '../../../../platform/storage/common/storage.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { IWorkbenchLayoutService, OverlayedParts } from '../../../services/layout/browser/layoutService.js';
import { OverlayedPart } from '../../overlayedPart.js';
import { GroupDirection } from '../../../services/editor/common/editorGroupsService.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { IHostService } from '../../../services/host/browser/host.js';
import { IEditorGroupView, IEditorPartsView } from '../editor/editor.js';
import { EditorPart, IEditorPartUIState } from '../editor/editorPart.js';
import { getWindow } from '../../../../base/browser/dom.js';
import { IEditorPartOptions } from '../../../common/editor.js';
import './media/previewPart.css';
import { mainWindow } from '../../../../base/browser/window.js';


export interface IPreviewEditorPartOpenOptions {
	readonly state?: IEditorPartUIState;
}

export interface ICreatePreviewEditorPartResult {
	readonly part: PreviewEditorPartImpl;
	readonly instantiationService: IInstantiationService;
	readonly disposables: DisposableStore;
}


export class PreviewEditorPart extends OverlayedPart implements IDisposable {
	static readonly activePanelSettingsKey = 'workbench.preview.activepanelid';

	private _content!: HTMLElement;
	get content(): HTMLElement {
		return this._content;
	}

	private editorPartContainer!: HTMLDivElement;
	private editorCreationResults: ICreatePreviewEditorPartResult | undefined;

	constructor(
		@IStorageService storageService: IStorageService,
		@IWorkbenchLayoutService layoutService: IWorkbenchLayoutService,
		@IThemeService themeService: IThemeService,
		@IInstantiationService private readonly instantiationService: IInstantiationService
	) {
		super(
			OverlayedParts.PREVIEW_PART,
			themeService,
			storageService,
			layoutService
		);

		// Register this part as an overlay section of the workbench:
		layoutService.registerOverlayedPart(this);
	}

	override createContentArea(parent: HTMLElement): HTMLElement {

		// starts invisible by default
		parent.style.visibility = 'hidden';

		// Main container for your preview part
		const container = document.createElement('div');
		container.classList.add('preview-part-content');
		parent.appendChild(container);

		// A nested div for the editor part specifically
		this.editorPartContainer = document.createElement('div');
		this.editorPartContainer.classList.add('part', 'editor');
		container.appendChild(this.editorPartContainer);
		return container;
	}

	getOrCreateEditorPart(editorPartsView: IEditorPartsView, state?: IEditorPartUIState): ICreatePreviewEditorPartResult {
		if (!this.editorCreationResults) {
			const disposables = new DisposableStore();
			const editorPart = disposables.add(this.instantiationService.createInstance(PreviewEditorPartImpl, editorPartsView, state));
			editorPart.create(this.editorPartContainer);

			this.editorCreationResults = {
				part: editorPart,
				instantiationService: this.instantiationService,
				disposables: disposables
			};
		}

		// Temporary workaround to display for now
		getWindow(this.element).setTimeout(() => {
			this.layout(this.width, this.height);
		}, 10);

		return this.editorCreationResults;
	}

	override layout(width: number, height: number): void {
		super.layout(width, height);
		// Forward layout calls to your editor part
		const editorPart = this.editorCreationResults?.part;
		if (editorPart) {
			editorPart.layout(width, height, 0, 0);
		}
	}

	hide(): void {
		const editorPart = this.editorCreationResults?.part;
		if (editorPart) {
			editorPart.setVisible(false);
		}
	}


	focus(): void {
		const editorPart = this.editorCreationResults?.part;

		if (editorPart) {
			editorPart.setVisible(true);
			editorPart.activeGroup.focus();
		}
		// Temporary workaround to display for now
		getWindow(this.element).setTimeout(() => {
			this.layout(this.width, this.height);
		}, 10);
	}

	toJSON(): object {
		return {
			type: OverlayedParts.PREVIEW_PART,
		};
	}

	// If you want to easily retrieve the "activeGroup" or create a new one here:
	get activeGroup() {
		const editorPart = this.assertEditorPartIsDefined();
		return editorPart.activeGroup;
	}

	addGroup() {
		const editorPart = this.assertEditorPartIsDefined();
		return editorPart.addGroup(
			this.activeGroup,
			GroupDirection.LEFT
		);
	}

	private assertEditorPartIsDefined(): PreviewEditorPartImpl {
		if (!this.editorCreationResults?.part) {
			throw new Error(`Preview editor has not been created`);
		}
		return this.editorCreationResults.part;
	}

	override dispose(): void {
		super.dispose();
		const editorPart = this.assertEditorPartIsDefined();
		editorPart.dispose();
	}
}

export class PreviewEditorPartImpl extends EditorPart {
	constructor(
		editorPartsView: IEditorPartsView,
		private readonly state: IEditorPartUIState | undefined,
		@IInstantiationService instantiationService: IInstantiationService,
		@IThemeService themeService: IThemeService,
		@IConfigurationService configurationService: IConfigurationService,
		@IStorageService storageService: IStorageService,
		@IWorkbenchLayoutService layoutService: IWorkbenchLayoutService,
		@IHostService hostService: IHostService,
		@IContextKeyService contextKeyService: IContextKeyService
	) {
		super(
			editorPartsView,
			'workbench.parts.previewEditor',
			'Preview Editor Part',
			mainWindow.vscodeWindowId,
			instantiationService,
			themeService,
			configurationService,
			storageService,
			layoutService,
			hostService,
			contextKeyService
		);
	}

	override get partOptions(): IEditorPartOptions {

		const options = { ...super.partOptions };
		options.showTabs = 'none'; // tab bar is hidden
		return options;
	}

	// If you want custom logic when removing the last group,
	// you can override removeGroup(...) similarly to AuxiliaryEditorPartImpl:
	override removeGroup(group: number | IEditorGroupView, preserveFocus?: boolean): void {
		if (this.count === 1 && this.activeGroup === this.assertGroupView(group)) {
			// If removing the last group, do something special (close the part?)
			// e.g. this.closePreview();
		} else {
			super.removeGroup(group, preserveFocus);
		}
	}

	// Optionally override loadState/saveState if you do *not* want to persist
	// group layouts as the main editor does.
	protected override loadState() {
		return this.state;
	}
	protected override saveState(): void {
		return; // disabled, preview editor part state is tracked outside
	}
}
