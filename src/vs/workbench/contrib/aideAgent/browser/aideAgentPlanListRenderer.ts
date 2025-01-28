/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as dom from '../../../../base/browser/dom.js';
import { IListVirtualDelegate } from '../../../../base/browser/ui/list/list.js';
import { ITreeNode, ITreeRenderer } from '../../../../base/browser/ui/tree/tree.js';
import { coalesce } from '../../../../base/common/arrays.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { FuzzyScore } from '../../../../base/common/filters.js';
import { IMarkdownString } from '../../../../base/common/htmlContent.js';
import { Disposable, DisposableStore, dispose, IDisposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { ResourceMap } from '../../../../base/common/map.js';
import { MarkdownRenderer } from '../../../../editor/browser/widget/markdownRenderer/browser/markdownRenderer.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IAideAgentPlanStepViewModel } from '../common/aideAgentPlanViewModel.js';
import { IChatRendererContent } from '../common/aideAgentViewModel.js';
import { annotateSpecialMarkdownContent } from '../common/annotations.js';
import { CodeBlockModelCollection } from '../common/codeBlockModelCollection.js';
import { IChatCodeBlockInfo } from './aideAgent.js';
import { EditorPool } from './aideAgentContentParts/aideAgentMarkdownContentPart.js';
import { IChatRendererDelegate } from './aideAgentListRenderer.js';
import { ChatMarkdownRenderer } from './aideAgentMarkdownRenderer.js';
import { ChatEditorOptions } from './aideAgentOptions.js';
import { IAideAgentPlanContentPart, IAideAgentPlanContentPartRenderContext } from './aideAgentPlanContentParts/aideAgentPlanContentParts.js';
import { AideAgentPlanMarkdownContentPart } from './aideAgentPlanContentParts/aideAgentPlanMarkdownContentPart.js';

const $ = dom.$;

interface IAideAgentPlanListItemTemplate {
	currentElement?: IAideAgentPlanStepViewModel;
	renderedParts?: IAideAgentPlanContentPart[];
	readonly rowContainer: HTMLElement;
	readonly value: HTMLElement;
	readonly templateDisposables: IDisposable;
	readonly elementDisposables: DisposableStore;
}

interface IItemHeightChangeParams {
	element: IAideAgentPlanStepViewModel;
	height: number;
}

export class AideAgentPlanListRenderer extends Disposable implements ITreeRenderer<IAideAgentPlanStepViewModel, FuzzyScore, IAideAgentPlanListItemTemplate> {
	static readonly ID = 'aideAgentPlanListItem';

	private readonly codeBlocksByResponseId = new Map<string, IChatCodeBlockInfo[]>();
	private readonly codeBlocksByEditorUri = new ResourceMap<IChatCodeBlockInfo>();

	private readonly renderer: MarkdownRenderer;

	protected readonly _onDidChangeItemHeight = this._register(new Emitter<IItemHeightChangeParams>());
	readonly onDidChangeItemHeight: Event<IItemHeightChangeParams> = this._onDidChangeItemHeight.event;

	private readonly _editorPool: EditorPool;

	private _currentLayoutWidth: number = 0;
	private _isVisible = true;
	private _onDidChangeVisibility = this._register(new Emitter<boolean>());

	constructor(
		editorOptions: ChatEditorOptions,
		private readonly delegate: IChatRendererDelegate,
		private readonly codeBlockModelCollection: CodeBlockModelCollection,
		overflowWidgetsDomNode: HTMLElement | undefined,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@ILogService private readonly logService: ILogService,
	) {
		super();

		this.renderer = this.instantiationService.createInstance(ChatMarkdownRenderer, undefined);
		this._editorPool = this._register(this.instantiationService.createInstance(EditorPool, editorOptions, delegate, overflowWidgetsDomNode));
	}

	get templateId(): string {
		return AideAgentPlanListRenderer.ID;
	}

	setVisible(visible: boolean): void {
		this._isVisible = visible;
		this._onDidChangeVisibility.fire(visible);
	}

	layout(width: number): void {
		this._currentLayoutWidth = width - 40 /* padding */;
		for (const editor of this._editorPool.inUse()) {
			editor.layout(this._currentLayoutWidth);
		}
	}

	renderTemplate(container: HTMLElement): IAideAgentPlanListItemTemplate {
		const templateDisposables = new DisposableStore();
		const rowContainer = dom.append(container, $('.aideagent-item-container'));

		const value = dom.append(rowContainer, $('.value'));
		const elementDisposables = new DisposableStore();

		return { elementDisposables, rowContainer, templateDisposables, value };
	}

	renderElement(node: ITreeNode<IAideAgentPlanStepViewModel, FuzzyScore>, index: number, templateData: IAideAgentPlanListItemTemplate): void {
		const element = node.element;
		templateData.currentElement = element;

		if (index === this.delegate.getListLength() - 1 && !element.isComplete) {
			const timer = templateData.elementDisposables.add(new dom.WindowIntervalTimer());
			const runProgressiveRender = (initial?: boolean) => {
				try {
					if (this.doNextProgressiveRender(element, templateData, !!initial)) {
						timer.cancel();
					}
				} catch (err) {
					// Kill the timer if anything went wrong, avoid getting stuck in a nasty rendering loop.
					timer.cancel();
					this.logService.error(err);
				}
			};
			timer.cancelAndSet(runProgressiveRender, 50, dom.getWindow(templateData.rowContainer));
			runProgressiveRender(true);
		} else {
			this.basicRenderElement(element, index, templateData);
		}
	}

	private basicRenderElement(element: IAideAgentPlanStepViewModel, index: number, templateData: IAideAgentPlanListItemTemplate): boolean {
		const value: IChatRendererContent[] = [];
		value.push(...annotateSpecialMarkdownContent(element.value));

		dom.clearNode(templateData.value);

		const parts: IAideAgentPlanContentPart[] = [];
		value.forEach((data, index) => {
			const context: IAideAgentPlanContentPartRenderContext = {
				element,
				index,
				content: value,
				preceedingContentParts: parts,
			};
			const newPart = this.renderPlanContentPart(data, templateData, context);
			if (newPart) {
				templateData.value.appendChild(newPart.domNode);
				parts.push(newPart);
			}
		});

		if (templateData.renderedParts) {
			dispose(templateData.renderedParts);
		}
		templateData.renderedParts = parts;

		const newHeight = templateData.rowContainer.offsetHeight;
		const fireEvent = !element.currentRenderedHeight || element.currentRenderedHeight !== newHeight;
		if (fireEvent) {
			const disposable = templateData.elementDisposables.add(dom.scheduleAtNextAnimationFrame(dom.getWindow(templateData.value), () => {
				// Have to recompute the height here because codeblock rendering is currently async and it may have changed.
				// If it becomes properly sync, then this could be removed.
				element.currentRenderedHeight = templateData.rowContainer.offsetHeight;
				disposable.dispose();
				this._onDidChangeItemHeight.fire({ element, height: element.currentRenderedHeight });
			}));
		}

		return true;
	}

	private updateItemHeight(templateData: IAideAgentPlanListItemTemplate): void {
		if (!templateData.currentElement) {
			return;
		}

		const newHeight = templateData.rowContainer.offsetHeight;
		templateData.currentElement.currentRenderedHeight = newHeight;
		this._onDidChangeItemHeight.fire({ element: templateData.currentElement, height: newHeight });
	}

	private doNextProgressiveRender(element: IAideAgentPlanStepViewModel, templateData: IAideAgentPlanListItemTemplate, isInRenderElement?: boolean): boolean {
		if (!this._isVisible) {
			return true;
		}

		const contentForThisTurn = this.getNextProgressiveRenderContent(element);
		const partsToRender = this.diff(templateData.renderedParts ?? [], contentForThisTurn, element);

		// Render all parts
		this.renderContentDiff(partsToRender, contentForThisTurn, element, templateData);

		const height = templateData.rowContainer.offsetHeight;
		element.currentRenderedHeight = height;
		if (!isInRenderElement) {
			this._onDidChangeItemHeight.fire({ element, height: templateData.rowContainer.offsetHeight });
		}

		// Always return true to indicate rendering is complete
		return true;
	}

	private renderContentDiff(partsToRender: ReadonlyArray<IChatRendererContent | null>, contentForThisTurn: ReadonlyArray<IChatRendererContent>, element: IAideAgentPlanStepViewModel, templateData: IAideAgentPlanListItemTemplate): void {
		const renderedParts = templateData.renderedParts ?? [];
		templateData.renderedParts = renderedParts;
		partsToRender.forEach((partToRender, index) => {
			if (!partToRender) {
				// null=no change
				return;
			}

			const alreadyRenderedPart = templateData.renderedParts?.[index];
			if (alreadyRenderedPart) {
				alreadyRenderedPart.dispose();
			}

			const preceedingContentParts = renderedParts.slice(0, index);
			const context: IAideAgentPlanContentPartRenderContext = {
				element,
				content: contentForThisTurn,
				preceedingContentParts,
				index
			};
			const newPart = this.renderPlanContentPart(partToRender, templateData, context);
			if (newPart) {
				// Maybe the part can't be rendered in this context, but this shouldn't really happen
				if (alreadyRenderedPart) {
					try {
						// This method can throw HierarchyRequestError
						alreadyRenderedPart.domNode.replaceWith(newPart.domNode);
					} catch (err) {
						this.logService.error('AideAgentPlanListItemRenderer#renderChatContentDiff: error replacing part', err);
					}
				} else {
					templateData.value.appendChild(newPart.domNode);
				}

				renderedParts[index] = newPart;
			} else if (alreadyRenderedPart) {
				alreadyRenderedPart.domNode.remove();
			}
		});
	}

	private getNextProgressiveRenderContent(element: IAideAgentPlanStepViewModel): IChatRendererContent[] {
		const renderableResponse = annotateSpecialMarkdownContent(element.value);
		return renderableResponse;
	}

	private diff(renderedParts: ReadonlyArray<IAideAgentPlanContentPart>, contentToRender: ReadonlyArray<IChatRendererContent>, element: IAideAgentPlanStepViewModel): ReadonlyArray<IChatRendererContent | null> {
		const diff: (IChatRendererContent | null)[] = [];
		for (let i = 0; i < contentToRender.length; i++) {
			const content = contentToRender[i];
			const renderedPart = renderedParts[i];

			if (!renderedPart || !renderedPart.hasSameContent(content, contentToRender.slice(i + 1), element)) {
				diff.push(content);
			} else {
				// null -> no change
				diff.push(null);
			}
		}

		return diff;
	}

	private renderPlanContentPart(content: IChatRendererContent, templateData: IAideAgentPlanListItemTemplate, context: IAideAgentPlanContentPartRenderContext): IAideAgentPlanContentPart | undefined {
		if (content.kind === 'planStep') {
			return this.renderMarkdown(content.description, templateData, context);
		}

		return undefined;
	}

	private renderMarkdown(markdown: IMarkdownString, templateData: IAideAgentPlanListItemTemplate, context: IAideAgentPlanContentPartRenderContext): IAideAgentPlanContentPart {
		const element = context.element;
		const fillInIncompleteTokens = !element.isComplete;
		const codeBlockStartIndex = context.preceedingContentParts.reduce((acc, part) => acc + (part instanceof AideAgentPlanMarkdownContentPart ? part.codeblocks.length : 0), 0);
		// TODO(@ghostwriternr): This conversion to markdownContent kind is a bit unnecessary, but it's simple.
		const markdownPart = this.instantiationService.createInstance(AideAgentPlanMarkdownContentPart, { content: markdown, kind: 'markdownContent' }, context, this._editorPool, fillInIncompleteTokens, codeBlockStartIndex, this.renderer, this._currentLayoutWidth, this.codeBlockModelCollection);
		const markdownPartId = markdownPart.id;
		markdownPart.addDisposable(markdownPart.onDidChangeHeight(() => {
			markdownPart.layout(this._currentLayoutWidth);
			this.updateItemHeight(templateData);
		}));

		// Code blocks
		const codeBlocksByResponseId = this.codeBlocksByResponseId.get(element.id) ?? [];
		this.codeBlocksByResponseId.set(element.id, codeBlocksByResponseId);
		markdownPart.addDisposable(toDisposable(() => {
			const codeBlocksByResponseId = this.codeBlocksByResponseId.get(element.id);
			if (codeBlocksByResponseId) {
				// Only delete if this is my code block
				markdownPart.codeblocks.forEach((info, i) => {
					const codeblock = codeBlocksByResponseId[codeBlockStartIndex + i];
					if (codeblock?.ownerMarkdownPartId === markdownPartId) {
						delete codeBlocksByResponseId[codeBlockStartIndex + i];
					}
				});
			}
		}));

		markdownPart.codeblocks.forEach((info, i) => {
			codeBlocksByResponseId[codeBlockStartIndex + i] = info;
			if (info.uri) {
				const uri = info.uri;
				this.codeBlocksByEditorUri.set(uri, info);
				markdownPart.addDisposable(toDisposable(() => {
					const codeblock = this.codeBlocksByEditorUri.get(uri);
					if (codeblock?.ownerMarkdownPartId === markdownPartId) {
						this.codeBlocksByEditorUri.delete(uri);
					}
				}));
			}
		});

		return markdownPart;
	}

	disposeElement(element: ITreeNode<IAideAgentPlanStepViewModel, FuzzyScore>, index: number, templateData: IAideAgentPlanListItemTemplate, height: number | undefined): void {
		if (templateData.renderedParts) {
			try {
				dispose(coalesce(templateData.renderedParts));
				templateData.renderedParts = undefined;
				dom.clearNode(templateData.value);
			} catch (err) {
				throw err;
			}
		}

		templateData.currentElement = undefined;
		templateData.elementDisposables.clear();
	}

	disposeTemplate(templateData: IAideAgentPlanListItemTemplate): void {
		templateData.templateDisposables.dispose();
	}
}

export class AideAgentPlanListDelegate implements IListVirtualDelegate<IAideAgentPlanStepViewModel> {
	private readonly defaultElementHeight = 200;

	getHeight(element: IAideAgentPlanStepViewModel): number {
		const height = ('currentRenderedHeight' in element ? element.currentRenderedHeight : undefined) ?? this.defaultElementHeight;
		return height;
	}

	getTemplateId(element: IAideAgentPlanStepViewModel): string {
		return AideAgentPlanListRenderer.ID;
	}

	hasDynamicHeight(element: IAideAgentPlanStepViewModel): boolean {
		return true;
	}
}
