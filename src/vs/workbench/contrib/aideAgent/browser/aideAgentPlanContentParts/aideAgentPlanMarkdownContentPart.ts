/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as dom from '../../../../../base/browser/dom.js';
import { Emitter } from '../../../../../base/common/event.js';
import { Disposable, IDisposable } from '../../../../../base/common/lifecycle.js';
import { equalsIgnoreCase } from '../../../../../base/common/strings.js';
import { URI } from '../../../../../base/common/uri.js';
import { MarkdownRenderer } from '../../../../../editor/browser/widget/markdownRenderer/browser/markdownRenderer.js';
import { Range } from '../../../../../editor/common/core/range.js';
import { IResolvedTextEditorModel, ITextModelService } from '../../../../../editor/common/services/resolverService.js';
import { IContextKeyService } from '../../../../../platform/contextkey/common/contextkey.js';
import { IInstantiationService } from '../../../../../platform/instantiation/common/instantiation.js';
import { IAideAgentPlanStepViewModel, isAideAgentPlanStepVM } from '../../common/aideAgentPlanViewModel.js';
import { IChatMarkdownContent } from '../../common/aideAgentService.js';
import { IChatRendererContent } from '../../common/aideAgentViewModel.js';
import { IMarkdownVulnerability } from '../../common/annotations.js';
import { CodeBlockModelCollection } from '../../common/codeBlockModelCollection.js';
import { IChatCodeBlockInfo } from '../aideAgent.js';
import { IDisposableReference } from '../aideAgentContentParts/aideAgentCollections.js';
import { EditorPool } from '../aideAgentContentParts/aideAgentMarkdownContentPart.js';
import { ChatMarkdownDecorationsRenderer } from '../aideAgentMarkdownDecorationsRenderer.js';
import { CodeBlockPart, ICodeBlockData, localFileLanguageId, parseLocalFileData } from '../codeBlockPart.js';
import { IAideAgentPlanContentPart, IAideAgentPlanContentPartRenderContext } from './aideAgentPlanContentParts.js';

const $ = dom.$;

export class AideAgentPlanMarkdownContentPart extends Disposable implements IAideAgentPlanContentPart {
	private static idPool = 0;
	public readonly id = String(++AideAgentPlanMarkdownContentPart.idPool);
	public readonly domNode: HTMLElement;
	private readonly allRefs: IDisposableReference<CodeBlockPart>[] = [];

	private readonly _onDidChangeHeight = this._register(new Emitter<void>());
	public readonly onDidChangeHeight = this._onDidChangeHeight.event;

	public readonly codeblocks: IChatCodeBlockInfo[] = [];

	constructor(
		private readonly markdown: IChatMarkdownContent,
		context: IAideAgentPlanContentPartRenderContext,
		private readonly editorPool: EditorPool,
		fillInIncompleteTokens = false,
		codeBlockStartIndex = 0,
		renderer: MarkdownRenderer,
		currentWidth: number,
		private readonly codeBlockModelCollection: CodeBlockModelCollection,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IInstantiationService instantiationService: IInstantiationService,
		@ITextModelService private readonly textModelService: ITextModelService,
	) {
		super();

		const element = context.element;

		// We release editors in order so that it's more likely that the same editor will be assigned if this element is re-rendered right away, like it often is during progressive rendering
		const orderedDisposablesList: IDisposable[] = [];
		let codeBlockIndex = codeBlockStartIndex;
		const result = this._register(renderer.render(markdown.content, {
			fillInIncompleteTokens,
			codeBlockRendererSync: (languageId, text) => {
				const index = codeBlockIndex++;
				let textModel: Promise<IResolvedTextEditorModel>;
				let range: Range | undefined;
				let vulns: readonly IMarkdownVulnerability[] | undefined;
				let codemapperUri: URI | undefined;
				if (equalsIgnoreCase(languageId, localFileLanguageId)) {
					try {
						const parsedBody = parseLocalFileData(text);
						range = parsedBody.range && Range.lift(parsedBody.range);
						textModel = this.textModelService.createModelReference(parsedBody.uri).then(ref => ref.object);
					} catch (e) {
						return $('div');
					}
				} else {
					const sessionId = element.sessionId;
					const modelEntry = this.codeBlockModelCollection.getOrCreate(sessionId, element, index);
					const fastUpdateModelEntry = this.codeBlockModelCollection.updateSync(sessionId, element, index, { text, languageId });
					vulns = modelEntry.vulns;
					codemapperUri = fastUpdateModelEntry.codemapperUri;
					textModel = modelEntry.model;
				}

				const codeBlockInfo = { languageId, textModel, codeBlockIndex: index, element, range, parentContextKeyService: contextKeyService, vulns, codemapperUri };

				const ref = this.renderCodeBlock(codeBlockInfo, text, currentWidth, false);
				this.allRefs.push(ref);

				// Attach this after updating text/layout of the editor, so it should only be fired when the size updates later (horizontal scrollbar, wrapping)
				// not during a renderElement OR a progressive render (when we will be firing this event anyway at the end of the render)
				this._register(ref.object.onDidChangeContentHeight(() => this._onDidChangeHeight.fire()));

				const ownerMarkdownPartId = this.id;
				const info: IChatCodeBlockInfo = new class {
					readonly ownerMarkdownPartId = ownerMarkdownPartId;
					readonly codeBlockIndex = index;
					readonly element = element;
					readonly isStreaming = true;
					codemapperUri = undefined; // will be set async
					public get uri() {
						// here we must do a getter because the ref.object is rendered
						// async and the uri might be undefined when it's read immediately
						return ref.object.uri;
					}
					public focus() {
						ref.object.focus();
					}
					public getContent(): string {
						return ref.object.editor.getValue();
					}
				}();
				this.codeblocks.push(info);
				orderedDisposablesList.push(ref);
				return ref.object.element;
			},
			asyncRenderCallback: () => this._onDidChangeHeight.fire(),
		}));


		const markdownDecorationsRenderer = instantiationService.createInstance(ChatMarkdownDecorationsRenderer);
		this._register(markdownDecorationsRenderer.walkTreeAndAnnotateReferenceLinks(markdown, result.element));

		orderedDisposablesList.reverse().forEach(d => this._register(d));
		this.domNode = result.element;
	}

	private renderCodeBlock(data: ICodeBlockData, text: string, currentWidth: number, editableCodeBlock: boolean | undefined): IDisposableReference<CodeBlockPart> {
		const ref = this.editorPool.get();
		const editorInfo = ref.object;
		if (isAideAgentPlanStepVM(data.element)) {
			this.codeBlockModelCollection.update(data.element.sessionId, data.element, data.codeBlockIndex, { text, languageId: data.languageId }).then((e) => {
				// Update the existing object's codemapperUri
				this.codeblocks[data.codeBlockIndex].codemapperUri = e.codemapperUri;
			});
		}

		editorInfo.render(data, currentWidth, editableCodeBlock);

		return ref;
	}

	hasSameContent(other: IChatRendererContent, followingContent: IChatRendererContent[], element: IAideAgentPlanStepViewModel): boolean {
		return other.kind === 'planStep' && other.description.value === this.markdown.content.value;
	}

	layout(width: number): void {
		this.allRefs.forEach((ref) => {
			if (ref.object instanceof CodeBlockPart) {
				ref.object.layout(width);
			}
		});
	}

	addDisposable(disposable: IDisposable): void {
		this._register(disposable);
	}
}
