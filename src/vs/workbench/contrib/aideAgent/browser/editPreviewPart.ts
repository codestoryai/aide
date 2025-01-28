/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as dom from '../../../../base/browser/dom.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { combinedDisposable, Disposable, MutableDisposable } from '../../../../base/common/lifecycle.js';
import { URI } from '../../../../base/common/uri.js';
import { IDiffEditorConstructionOptions } from '../../../../editor/browser/editorBrowser.js';
import { EditorExtensionsRegistry } from '../../../../editor/browser/editorExtensions.js';
import { ICodeEditorWidgetOptions } from '../../../../editor/browser/widget/codeEditor/codeEditorWidget.js';
import { DiffEditorWidget } from '../../../../editor/browser/widget/diffEditor/diffEditorWidget.js';
import { EDITOR_FONT_DEFAULTS, IEditorOptions } from '../../../../editor/common/config/editorOptions.js';
import { IResolvedTextEditorModel } from '../../../../editor/common/services/resolverService.js';
import { BracketMatchingController } from '../../../../editor/contrib/bracketMatching/browser/bracketMatching.js';
import { ContextMenuController } from '../../../../editor/contrib/contextmenu/browser/contextmenu.js';
import { ContentHoverController } from '../../../../editor/contrib/hover/browser/contentHoverController.js';
import { GlyphHoverController } from '../../../../editor/contrib/hover/browser/glyphHoverController.js';
import { ViewportSemanticTokensContribution } from '../../../../editor/contrib/semanticTokens/browser/viewportSemanticTokens.js';
import { SmartSelectController } from '../../../../editor/contrib/smartSelect/browser/smartSelect.js';
import { WordHighlighterContribution } from '../../../../editor/contrib/wordHighlighter/browser/wordHighlighter.js';
import { localize } from '../../../../nls.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { FileKind } from '../../../../platform/files/common/files.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { ServiceCollection } from '../../../../platform/instantiation/common/serviceCollection.js';
import { ResourceLabel } from '../../../browser/labels.js';
import { MenuPreventer } from '../../codeEditor/browser/menuPreventer.js';
import { SelectionClipboardContributionID } from '../../codeEditor/browser/selectionClipboard.js';
import { getSimpleEditorOptions } from '../../codeEditor/browser/simpleEditorOptions.js';
import { isResponseVM } from '../common/aideAgentViewModel.js';
import { IChatRendererDelegate } from './aideAgentListRenderer.js';
import { ChatEditorOptions } from './aideAgentOptions.js';

const $ = dom.$;
const defaultCodeblockPadding = 10;

export interface IEditPreviewBlockData {
	readonly element: unknown;
	readonly uri: URI;
	readonly languageId: string;
	original: {
		model: Promise<IResolvedTextEditorModel>;
		text: string;
		codeBlockIndex: number;
	};
	modified: {
		model: Promise<IResolvedTextEditorModel>;
		text: string;
		codeBlockIndex: number;
	};
	readonly parentContextKeyService?: IContextKeyService;
}

export class EditPreviewBlockPart extends Disposable {
	protected readonly _onDidChangeContentHeight = this._register(new Emitter<void>());
	public readonly onDidChangeContentHeight = this._onDidChangeContentHeight.event;

	private readonly diffEditor: DiffEditorWidget;
	private readonly resourceLabel: ResourceLabel;
	readonly element: HTMLElement;
	private readonly header: HTMLElement;

	private readonly _lastDiffEditorViewModel = this._store.add(new MutableDisposable());
	private currentScrollWidth = 0;

	constructor(
		private readonly options: ChatEditorOptions,
		delegate: IChatRendererDelegate,
		overflowWidgetsDomNode: HTMLElement | undefined,
		@IInstantiationService instantiationService: IInstantiationService,
		@IContextKeyService private readonly contextKeyService: IContextKeyService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
	) {
		super();
		this.element = $('.interactive-result-code-block');
		this.element.classList.add('compare');

		this.contextKeyService = this._register(contextKeyService.createScoped(this.element));
		const scopedInstantiationService = this._register(instantiationService.createChild(new ServiceCollection([IContextKeyService, this.contextKeyService])));
		const editorHeader = this.header = dom.append(this.element, $('.interactive-result-header.show-file-icons'));
		const editorElement = dom.append(this.element, $('.interactive-result-editor'));
		this.diffEditor = this.createDiffEditor(scopedInstantiationService, editorElement, {
			...getSimpleEditorOptions(this.configurationService),
			lineNumbers: 'off',
			scrollBeyondLastLine: false,
			lineDecorationsWidth: 12,
			dragAndDrop: false,
			padding: { top: defaultCodeblockPadding, bottom: defaultCodeblockPadding },
			mouseWheelZoom: false,
			scrollbar: {
				vertical: 'hidden',
				alwaysConsumeMouseWheel: false
			},
			definitionLinkOpensInPeek: false,
			gotoLocation: {
				multiple: 'goto',
				multipleDeclarations: 'goto',
				multipleDefinitions: 'goto',
				multipleImplementations: 'goto',
			},
			ariaLabel: localize('chat.codeBlockHelp', 'Code block'),
			overflowWidgetsDomNode,
			...this.getEditorOptionsFromConfig(),
		});

		this.resourceLabel = this._register(scopedInstantiationService.createInstance(ResourceLabel, editorHeader, { supportIcons: true }));

		this._register(this.options.onDidChange(() => {
			this.diffEditor.updateOptions(this.getEditorOptionsFromConfig());
		}));

		this._register(this.diffEditor.getModifiedEditor().onDidScrollChange(e => {
			this.currentScrollWidth = e.scrollWidth;
		}));
		this._register(this.diffEditor.onDidContentSizeChange(e => {
			if (e.contentHeightChanged) {
				this._onDidChangeContentHeight.fire();
			}
		}));
		this._register(this.diffEditor.getModifiedEditor().onDidBlurEditorWidget(() => {
			this.element.classList.remove('focused');
			WordHighlighterContribution.get(this.diffEditor.getModifiedEditor())?.stopHighlighting();
			this.clearWidgets();
		}));
		this._register(this.diffEditor.getModifiedEditor().onDidFocusEditorWidget(() => {
			this.element.classList.add('focused');
			WordHighlighterContribution.get(this.diffEditor.getModifiedEditor())?.restoreViewState(true);
		}));

		// Parent list scrolled
		if (delegate.onDidScroll) {
			this._register(delegate.onDidScroll(e => {
				this.clearWidgets();
			}));
		}
	}

	private createDiffEditor(instantiationService: IInstantiationService, parent: HTMLElement, options: Readonly<IDiffEditorConstructionOptions>): DiffEditorWidget {
		const widgetOptions: ICodeEditorWidgetOptions = {
			isSimpleWidget: false,
			contributions: EditorExtensionsRegistry.getSomeEditorContributions([
				MenuPreventer.ID,
				SelectionClipboardContributionID,
				ContextMenuController.ID,

				WordHighlighterContribution.ID,
				ViewportSemanticTokensContribution.ID,
				BracketMatchingController.ID,
				SmartSelectController.ID,
				ContentHoverController.ID,
				GlyphHoverController.ID,
			])
		};

		return this._register(instantiationService.createInstance(DiffEditorWidget, parent, {
			renderSideBySide: false,
			scrollbar: { useShadows: false, alwaysConsumeMouseWheel: false, ignoreHorizontalScrollbarInContentHeight: true, },
			renderMarginRevertIcon: false,
			diffCodeLens: false,
			scrollBeyondLastLine: false,
			stickyScroll: { enabled: false },
			originalAriaLabel: localize('original', 'Original'),
			modifiedAriaLabel: localize('modified', 'Modified'),
			diffAlgorithm: 'advanced',
			readOnly: true,
			isInEmbeddedEditor: true,
			useInlineViewWhenSpaceIsLimited: true,
			experimental: {
				useTrueInlineView: true,
			},
			renderSideBySideInlineBreakpoint: 300,
			renderOverviewRuler: false,
			compactMode: true,
			hideUnchangedRegions: { enabled: true, contextLineCount: 1 },
			renderGutterMenu: false,
			...options
		}, { originalEditor: widgetOptions, modifiedEditor: widgetOptions }));
	}

	private getEditorOptionsFromConfig(): IEditorOptions {
		return {
			wordWrap: this.options.configuration.resultEditor.wordWrap,
			fontLigatures: this.options.configuration.resultEditor.fontLigatures,
			bracketPairColorization: this.options.configuration.resultEditor.bracketPairColorization,
			fontFamily: this.options.configuration.resultEditor.fontFamily === 'default' ?
				EDITOR_FONT_DEFAULTS.fontFamily :
				this.options.configuration.resultEditor.fontFamily,
			fontSize: this.options.configuration.resultEditor.fontSize,
			fontWeight: this.options.configuration.resultEditor.fontWeight,
			lineHeight: this.options.configuration.resultEditor.lineHeight,
		};
	}

	async render(data: IEditPreviewBlockData, width: number) {
		if (data.parentContextKeyService) {
			this.contextKeyService.updateParent(data.parentContextKeyService);
		}

		if (this.options.configuration.resultEditor.wordWrap === 'on') {
			// Initialize the editor with the new proper width so that getContentHeight
			// will be computed correctly in the next call to layout()
			this.layout(width);
		}

		await this.updateEditor(data);

		this.layout(width);
		this.diffEditor.updateOptions({ ariaLabel: localize('chat.editPreviewBlockLabel', "Edit Preview") });

		this.resourceLabel.element.setFile(data.uri, {
			fileKind: FileKind.FILE,
			fileDecorations: { colors: true, badges: false },
			hidePath: true,
		});
	}

	private async updateEditor(data: IEditPreviewBlockData): Promise<void> {
		if (!isResponseVM(data.element)) {
			return;
		}

		const original = (await data.original.model).textEditorModel;
		const modified = (await data.modified.model).textEditorModel;

		const viewModel = this.diffEditor.createViewModel({ original, modified });
		await viewModel.waitForDiff();

		const listener = Event.any(original.onWillDispose, modified.onWillDispose)(() => {
			// this a bit weird and basically duplicates https://github.com/microsoft/vscode/blob/7cbcafcbcc88298cfdcd0238018fbbba8eb6853e/src/vs/editor/browser/widget/diffEditor/diffEditorWidget.ts#L328
			// which cannot call `setModel(null)` without first complaining
			this.diffEditor.setModel(null);
		});
		this.diffEditor.setModel(viewModel);
		this._lastDiffEditorViewModel.value = combinedDisposable(listener, viewModel);
	}

	layout(width: number): void {
		const contentHeight = this.getContentHeight();
		const editorBorder = 2;
		const dimension = { width: width - editorBorder, height: contentHeight };
		this.element.style.height = `${dimension.height + dom.getTotalHeight(this.header)}px`;
		this.element.style.width = `${dimension.width}px`;
		this.diffEditor.layout(dimension);
		this.updatePaddingForLayout();
	}

	private getContentHeight() {
		return this.diffEditor.getContentHeight();
	}

	private updatePaddingForLayout() {
		const horizontalScrollbarVisible = this.currentScrollWidth > this.diffEditor.getModifiedEditor().getLayoutInfo().contentWidth;
		const scrollbarHeight = this.diffEditor.getModifiedEditor().getLayoutInfo().horizontalScrollbarHeight;
		const bottomPadding = horizontalScrollbarVisible ?
			Math.max(defaultCodeblockPadding - scrollbarHeight, 2) :
			defaultCodeblockPadding;
		this.diffEditor.updateOptions({ padding: { top: defaultCodeblockPadding, bottom: bottomPadding } });
	}

	reset() {
		this.clearWidgets();
	}

	private clearWidgets() {
		ContentHoverController.get(this.diffEditor.getOriginalEditor())?.hideContentHover();
		ContentHoverController.get(this.diffEditor.getModifiedEditor())?.hideContentHover();
		GlyphHoverController.get(this.diffEditor.getOriginalEditor())?.hideContentHover();
		GlyphHoverController.get(this.diffEditor.getModifiedEditor())?.hideContentHover();
	}
}
