/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as dom from '../../../../../base/browser/dom.js';
import { Codicon } from '../../../../../base/common/codicons.js';
import { Emitter } from '../../../../../base/common/event.js';
import { IMarkdownString } from '../../../../../base/common/htmlContent.js';
import { Disposable, IDisposable } from '../../../../../base/common/lifecycle.js';
import { equalsIgnoreCase } from '../../../../../base/common/strings.js';
import { ThemeIcon } from '../../../../../base/common/themables.js';
import { URI } from '../../../../../base/common/uri.js';
import { MarkdownRenderer } from '../../../../../editor/browser/widget/markdownRenderer/browser/markdownRenderer.js';
import { Range } from '../../../../../editor/common/core/range.js';
import { ILanguageService } from '../../../../../editor/common/languages/language.js';
import { getIconClasses } from '../../../../../editor/common/services/getIconClasses.js';
import { IModelService } from '../../../../../editor/common/services/model.js';
import { IResolvedTextEditorModel, ITextModelService } from '../../../../../editor/common/services/resolverService.js';
import { MenuId } from '../../../../../platform/actions/common/actions.js';
import { IContextKeyService } from '../../../../../platform/contextkey/common/contextkey.js';
import { FileKind } from '../../../../../platform/files/common/files.js';
import { IInstantiationService } from '../../../../../platform/instantiation/common/instantiation.js';
import { ILabelService } from '../../../../../platform/label/common/label.js';
import { IEditorService } from '../../../../services/editor/common/editorService.js';
import { IChatProgressRenderableResponseContent } from '../../common/aideAgentModel.js';
import { IChatMarkdownContent } from '../../common/aideAgentService.js';
import { isRequestVM, isResponseVM } from '../../common/aideAgentViewModel.js';
import { IMarkdownVulnerability } from '../../common/annotations.js';
import { CodeBlockModelCollection } from '../../common/codeBlockModelCollection.js';
import { IChatCodeBlockInfo, IChatListItemRendererOptions, IEditPreviewCodeBlockInfo } from '../aideAgent.js';
import { IChatRendererDelegate } from '../aideAgentListRenderer.js';
import { ChatMarkdownDecorationsRenderer } from '../aideAgentMarkdownDecorationsRenderer.js';
import { ChatEditorOptions } from '../aideAgentOptions.js';
import { CodeBlockPart, ICodeBlockData, localFileLanguageId, parseLocalFileData } from '../codeBlockPart.js';
import { EditPreviewBlockPart, IEditPreviewBlockData } from '../editPreviewPart.js';
import '../media/aideAgentCodeBlockPill.css';
import { IDisposableReference, ResourcePool } from './aideAgentCollections.js';
import { IChatContentPart, IChatContentPartRenderContext } from './aideAgentContentParts.js';

const $ = dom.$;

const defaultRendererOptions: IChatListItemRendererOptions = {
	editableCodeBlock: false
};

export class ChatMarkdownContentPart extends Disposable implements IChatContentPart {
	private static idPool = 0;
	public readonly id = String(++ChatMarkdownContentPart.idPool);
	public readonly domNode: HTMLElement;
	private readonly allRefs: IDisposableReference<CodeBlockPart | CollapsedCodeBlock>[] = [];
	private readonly allEditPreviewRefs: IDisposableReference<EditPreviewBlockPart>[] = [];

	private readonly _onDidChangeHeight = this._register(new Emitter<void>());
	public readonly onDidChangeHeight = this._onDidChangeHeight.event;

	public readonly codeblocks: IChatCodeBlockInfo[] = [];
	public readonly editPreviewBlocks: IEditPreviewCodeBlockInfo[] = [];

	private extractUriFromMarkdown(markdown: IMarkdownString): { uris: URI[]; cleanMarkdown: IMarkdownString } {
		const lines = markdown.value.split('\n');
		const extractedUris: URI[] = [];
		let inCodeBlock = false;

		// Find URIs and filter lines in a single pass
		const modifiedLines = lines.filter((line, i) => {
			const currentLine = line.trim();

			// Track if we're in a code block
			if (currentLine.startsWith('```')) {
				inCodeBlock = !inCodeBlock;
				return true;
			}

			// Skip URI extraction if we're inside a code block
			if (inCodeBlock) {
				return true;
			}

			// Only process standalone lines that look like file paths
			if (currentLine && (
				(currentLine.startsWith('/') && !currentLine.includes('/>') && !currentLine.includes('<')) || // Unix-style absolute path
				/^[a-zA-Z]:[/\\]/.test(currentLine) || // Windows-style absolute path
				currentLine.startsWith('file://'))) { // file:// URI
				try {
					// For plain paths, convert to file URI
					const uriToTry = currentLine.startsWith('file://')
						? currentLine
						: `file://${currentLine}`;
					const uri = URI.parse(uriToTry);

					// Additional validation - path should look like a real file path
					if (uri.path && uri.path.length > 2 && !uri.path.includes('<') && !uri.path.includes('>')) {
						extractedUris.push(uri);
						return false; // Remove the URI line
					}
				} catch {
					// Not a valid URI, keep the line
				}
			}
			return true;
		});

		return {
			uris: extractedUris,
			cleanMarkdown: { ...markdown, value: modifiedLines.join('\n') }
		};
	}

	private parseOutSRSystemMessage(markdown: IMarkdownString): { hasSearchReplace: boolean; cleanMarkdown: IMarkdownString } {
		const lines = markdown.value.split('\n');
		const hasSearchReplace = lines.some(line => line.includes('SEARCH/REPLACE'));

		if (!hasSearchReplace) {
			return { hasSearchReplace: false, cleanMarkdown: markdown };
		}

		const modifiedLines = lines.filter(line => !line.includes('SEARCH/REPLACE'));

		return {
			hasSearchReplace: true,
			cleanMarkdown: { ...markdown, value: modifiedLines.join('\n') }
		};
	}

	constructor(
		private readonly markdown: IChatMarkdownContent,
		context: IChatContentPartRenderContext,
		private readonly editorPool: EditorPool,
		private readonly editPreviewEditorPool: EditPreviewEditorPool,
		fillInIncompleteTokens = false,
		codeBlockStartIndex = 0,
		renderer: MarkdownRenderer,
		currentWidth: number,
		private readonly codeBlockModelCollection: CodeBlockModelCollection,
		private readonly rendererOptions = defaultRendererOptions,
		@IContextKeyService contextKeyService: IContextKeyService,
		@ITextModelService private readonly textModelService: ITextModelService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
	) {
		super();

		const element = context.element;

		// Extract URIs before rendering
		const { uris: extractedUris, cleanMarkdown: uriCleanedMarkdown } = this.extractUriFromMarkdown(markdown.content);
		// Remove SEARCH/REPLACE system messages
		const { cleanMarkdown } = this.parseOutSRSystemMessage(uriCleanedMarkdown);
		let currentUriIndex = 0;

		// We release editors in order so that it's more likely that the same editor will be assigned if this element is re-rendered right away, like it often is during progressive rendering
		const orderedDisposablesList: IDisposable[] = [];
		let codeBlockIndex = codeBlockStartIndex;
		const result = this._register(renderer.render(cleanMarkdown, {
			fillInIncompleteTokens,
			codeBlockRendererSync: (languageId, text, raw) => {
				if (!isRequestVM(element) && !isResponseVM(element)) {
					return $('div');
				}

				if (raw?.includes('```')) {
					const uriTagAfterBackticks = raw.match(/```[\s\n]*<vscode_codeblock_uri>.*?<\/vscode_codeblock_uri>/);
					if (uriTagAfterBackticks) {
						raw = raw.replace(uriTagAfterBackticks[0], '```');
					}
				}

				const isCodeBlockComplete = !isResponseVM(context.element) || context.element.isComplete || !raw || raw?.endsWith('```');
				if ((!text || (text.startsWith('<vscode_codeblock_uri>') && !text.includes('\n'))) && !isCodeBlockComplete && rendererOptions.renderCodeBlockPills) {
					const hideEmptyCodeblock = $('div');
					hideEmptyCodeblock.style.display = 'none';
					return hideEmptyCodeblock;
				}

				const editPreviewBlock = this.parseEditPreviewBlock(text);
				if (editPreviewBlock) {
					const sessionId = isResponseVM(element) || isRequestVM(element) ? element.sessionId : '';
					const originalIndex = codeBlockIndex++;
					const original = this.codeBlockModelCollection.getOrCreate(sessionId, element, originalIndex).model;
					const modifiedIndex = codeBlockIndex++;
					const modified = this.codeBlockModelCollection.getOrCreate(sessionId, element, modifiedIndex).model;

					const ref = this.renderEditPreviewBlock({
						uri: extractedUris[currentUriIndex++] || URI.parse(''), // Use the current URI
						element,
						languageId,
						parentContextKeyService: contextKeyService,
						original: { model: original, text: editPreviewBlock.original, codeBlockIndex: originalIndex },
						modified: { model: modified, text: editPreviewBlock.modified, codeBlockIndex: modifiedIndex }
					}, currentWidth);
					this.allEditPreviewRefs.push(ref);

					this._register(ref.object.onDidChangeContentHeight(() => this._onDidChangeHeight.fire()));

					const ownerMarkdownPartId = this.id;
					const info: IEditPreviewCodeBlockInfo = new class {
						readonly ownerMarkdownPartId = ownerMarkdownPartId;
						readonly element = element;
					}();
					this.editPreviewBlocks.push(info);

					orderedDisposablesList.push(ref);
					return ref.object.element;
				}

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
					const sessionId = isResponseVM(element) || isRequestVM(element) ? element.sessionId : '';
					const modelEntry = this.codeBlockModelCollection.getOrCreate(sessionId, element, index);
					const fastUpdateModelEntry = this.codeBlockModelCollection.updateSync(sessionId, element, index, { text, languageId });
					vulns = modelEntry.vulns;
					codemapperUri = fastUpdateModelEntry.codemapperUri;
					textModel = modelEntry.model;
				}

				const hideToolbar = isResponseVM(element) && element.errorDetails?.responseIsFiltered;
				const codeBlockInfo = { languageId, textModel, codeBlockIndex: index, element, range, hideToolbar, parentContextKeyService: contextKeyService, vulns, codemapperUri };

				if (!rendererOptions.renderCodeBlockPills || !codemapperUri) {
					const ref = this.renderCodeBlock(codeBlockInfo, text, currentWidth, rendererOptions.editableCodeBlock);
					this.allRefs.push(ref);

					// Attach this after updating text/layout of the editor, so it should only be fired when the size updates later (horizontal scrollbar, wrapping)
					// not during a renderElement OR a progressive render (when we will be firing this event anyway at the end of the render)
					this._register(ref.object.onDidChangeContentHeight(() => this._onDidChangeHeight.fire()));

					const ownerMarkdownPartId = this.id;
					const info: IChatCodeBlockInfo = new class {
						readonly ownerMarkdownPartId = ownerMarkdownPartId;
						readonly codeBlockIndex = index;
						readonly element = element;
						readonly isStreaming = !rendererOptions.renderCodeBlockPills;
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
				} else {
					// TODO(@ghostwriternr): This check is not the best, because it's hit far before we're done making edits. But I'm unable to get the isComplete
					// condition to work properly here. Come back and fix this.
					const isStreaming = /* isResponseVM(element) ? !element.isComplete : */ !isCodeBlockComplete;
					const ref = this.renderCodeBlockPill(codeBlockInfo.codemapperUri, !isStreaming);
					if (isResponseVM(codeBlockInfo.element)) {
						// TODO@joyceerhl: remove this code when we change the codeblockUri API to make the URI available synchronously
						this.codeBlockModelCollection.update(codeBlockInfo.element.sessionId, codeBlockInfo.element, codeBlockInfo.codeBlockIndex, { text, languageId: codeBlockInfo.languageId }).then((e) => {
							// Update the existing object's codemapperUri
							this.codeblocks[codeBlockInfo.codeBlockIndex].codemapperUri = e.codemapperUri;
							this._onDidChangeHeight.fire();
						});
					}
					this.allRefs.push(ref);
					const ownerMarkdownPartId = this.id;
					const info: IChatCodeBlockInfo = new class {
						readonly ownerMarkdownPartId = ownerMarkdownPartId;
						readonly codeBlockIndex = index;
						readonly element = element;
						readonly isStreaming = isStreaming;
						readonly codemapperUri = codemapperUri;
						public get uri() {
							return undefined;
						}
						public focus() {
							return ref.object.element.focus();
						}
						public getContent(): string {
							return ''; // Not needed for collapsed code blocks
						}
					}();
					this.codeblocks.push(info);
					orderedDisposablesList.push(ref);
					return ref.object.element;
				}
			},
			asyncRenderCallback: () => this._onDidChangeHeight.fire(),
		}));

		const markdownDecorationsRenderer = instantiationService.createInstance(ChatMarkdownDecorationsRenderer);
		this._register(markdownDecorationsRenderer.walkTreeAndAnnotateReferenceLinks(markdown, result.element));

		orderedDisposablesList.reverse().forEach(d => this._register(d));
		this.domNode = result.element;
	}

	private parseEditPreviewBlock(text: string): { original: string; modified: string } | null {
		const startMarker = '<<<<<<< SEARCH';
		const separatorMarker = '=======';
		const endMarker = '>>>>>>> REPLACE';

		const startIndex = text.indexOf(startMarker);
		if (startIndex === -1) {
			return null;
		}

		let original = '';
		let modified = '';

		const contentAfterStart = text.slice(startIndex + startMarker.length);
		const separatorIndex = contentAfterStart.indexOf(separatorMarker);
		const endIndex = contentAfterStart.indexOf(endMarker);

		if (separatorIndex !== -1 && endIndex !== -1) {
			// Full block with both search and replace
			original = contentAfterStart.slice(0, separatorIndex).trim();
			modified = contentAfterStart.slice(separatorIndex + separatorMarker.length, endIndex).trim();
		} else if (separatorIndex !== -1) {
			// Separator exists but end doesn't
			original = contentAfterStart.slice(0, separatorIndex).trim();
			modified = contentAfterStart.slice(separatorIndex + separatorMarker.length).trim();
		} else {
			// Partial block with only start
			original = contentAfterStart.trim();
		}

		return { original, modified };
	}

	private renderCodeBlockPill(uri: URI | undefined, isCodeBlockComplete?: boolean): IDisposableReference<CollapsedCodeBlock> {
		const codeBlock = this.instantiationService.createInstance(CollapsedCodeBlock);
		if (uri) {
			codeBlock.render(uri, !isCodeBlockComplete);
		}

		return {
			object: codeBlock,
			isStale: () => false,
			dispose: () => codeBlock.dispose()
		};
	}

	private renderCodeBlock(data: ICodeBlockData, text: string, currentWidth: number, editableCodeBlock: boolean | undefined): IDisposableReference<CodeBlockPart> {
		const ref = this.editorPool.get();
		const editorInfo = ref.object;
		if (isResponseVM(data.element)) {
			this.codeBlockModelCollection.update(data.element.sessionId, data.element, data.codeBlockIndex, { text, languageId: data.languageId }).then((e) => {
				// Update the existing object's codemapperUri
				this.codeblocks[data.codeBlockIndex].codemapperUri = e.codemapperUri;
			});
		}

		editorInfo.render(data, currentWidth, editableCodeBlock);

		return ref;
	}

	private renderEditPreviewBlock(data: IEditPreviewBlockData, currentWidth: number): IDisposableReference<EditPreviewBlockPart> {
		const ref = this.editPreviewEditorPool.get();
		const editPreviewEditorInfo = ref.object;
		if (isResponseVM(data.element)) {
			this.codeBlockModelCollection.update(data.element.sessionId, data.element, data.original.codeBlockIndex, { text: data.original.text, languageId: data.languageId });
			this.codeBlockModelCollection.update(data.element.sessionId, data.element, data.modified.codeBlockIndex, { text: data.modified.text, languageId: data.languageId });
		}

		editPreviewEditorInfo.render(data, currentWidth);
		return ref;
	}

	hasSameContent(other: IChatProgressRenderableResponseContent): boolean {
		return other.kind === 'markdownContent' && !!(other.content.value === this.markdown.content.value
			|| this.rendererOptions.renderCodeBlockPills && this.codeblocks.at(-1)?.isStreaming && this.codeblocks.at(-1)?.codemapperUri !== undefined && other.content.value.lastIndexOf('```') === this.markdown.content.value.lastIndexOf('```'));
	}

	layout(width: number): void {
		this.allRefs.forEach((ref, index) => {
			if (ref.object instanceof CodeBlockPart) {
				ref.object.layout(width);
			} else if (ref.object instanceof CollapsedCodeBlock) {
				const codeblockModel = this.codeblocks[index];
				if (codeblockModel.codemapperUri && ref.object.uri?.toString() !== codeblockModel.codemapperUri.toString()) {
					ref.object.render(codeblockModel.codemapperUri, codeblockModel.isStreaming);
				}
			}
		});
		this.allEditPreviewRefs.forEach(ref => ref.object.layout(width));
	}

	addDisposable(disposable: IDisposable): void {
		this._register(disposable);
	}
}

export class EditorPool extends Disposable {

	private readonly _pool: ResourcePool<CodeBlockPart>;

	public inUse(): Iterable<CodeBlockPart> {
		return this._pool.inUse;
	}

	constructor(
		options: ChatEditorOptions,
		delegate: IChatRendererDelegate,
		overflowWidgetsDomNode: HTMLElement | undefined,
		@IInstantiationService instantiationService: IInstantiationService,
	) {
		super();
		this._pool = this._register(new ResourcePool(() => {
			return instantiationService.createInstance(CodeBlockPart, options, MenuId.AideAgentCodeBlock, delegate, overflowWidgetsDomNode);
		}));
	}

	get(): IDisposableReference<CodeBlockPart> {
		const codeBlock = this._pool.get();
		let stale = false;
		return {
			object: codeBlock,
			isStale: () => stale,
			dispose: () => {
				codeBlock.reset();
				stale = true;
				this._pool.release(codeBlock);
			}
		};
	}
}

export class EditPreviewEditorPool extends Disposable {
	private readonly _pool: ResourcePool<EditPreviewBlockPart>;

	public inUse(): Iterable<EditPreviewBlockPart> {
		return this._pool.inUse;
	}

	constructor(
		options: ChatEditorOptions,
		delegate: IChatRendererDelegate,
		overflowWidgetsDomNode: HTMLElement | undefined,
		@IInstantiationService instantiationService: IInstantiationService,
	) {
		super();
		this._pool = this._register(new ResourcePool(() => {
			return instantiationService.createInstance(EditPreviewBlockPart, options, delegate, overflowWidgetsDomNode);
		}));
	}

	get(): IDisposableReference<EditPreviewBlockPart> {
		const editPreviewBlock = this._pool.get();
		let stale = false;
		return {
			object: editPreviewBlock,
			isStale: () => stale,
			dispose: () => {
				editPreviewBlock.reset();
				stale = true;
				this._pool.release(editPreviewBlock);
			}
		};
	}
}

class CollapsedCodeBlock extends Disposable {
	public readonly element: HTMLElement;

	private _uri: URI | undefined;
	public get uri(): URI | undefined {
		return this._uri;
	}

	private isStreaming: boolean | undefined;

	constructor(
		@ILabelService private readonly labelService: ILabelService,
		@IEditorService private readonly editorService: IEditorService,
		@IModelService private readonly modelService: IModelService,
		@ILanguageService private readonly languageService: ILanguageService,
	) {
		super();
		this.element = $('.aideagent-codeblock-pill-widget');
		this.element.classList.add('show-file-icons');
		this._register(dom.addDisposableListener(this.element, 'click', async () => {
			if (this.uri) {
				this.editorService.openEditor({ resource: this.uri });
			}
		}));
	}

	render(uri: URI, isStreaming?: boolean) {
		if (this.uri?.toString() === uri.toString() && this.isStreaming === isStreaming) {
			return;
		}

		this._uri = uri;
		this.isStreaming = isStreaming;

		const iconText = this.labelService.getUriBasenameLabel(uri);

		let iconClasses: string[] = [];
		if (isStreaming) {
			const codicon = ThemeIcon.modify(Codicon.loading, 'spin');
			iconClasses = ThemeIcon.asClassNameArray(codicon);
		} else {
			const fileKind = uri.path.endsWith('/') ? FileKind.FOLDER : FileKind.FILE;
			iconClasses = getIconClasses(this.modelService, this.languageService, uri, fileKind);
		}

		const iconEl = dom.$('span.icon');
		iconEl.classList.add(...iconClasses);
		this.element.replaceChildren(iconEl, dom.$('span.icon-label', {}, iconText));
	}
}
