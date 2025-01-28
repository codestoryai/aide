/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as dom from '../../../../base/browser/dom.js';
import { Disposable, DisposableStore, dispose } from '../../../../base/common/lifecycle.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { ICodeEditor, IOverlayWidget, IOverlayWidgetPosition } from '../../../browser/editorBrowser.js';
import { EmbeddedCodeEditorWidget } from '../../../browser/widget/codeEditor/embeddedCodeEditorWidget.js';
import { IEditorOptions } from '../../../common/config/editorOptions.js';
import { Range } from '../../../common/core/range.js';
import { ScrollType } from '../../../common/editorCommon.js';

/*
class DecorationsManager implements IDisposable {

	private static readonly DecorationOptions = ModelDecorationOptions.register({
	description: 'reference-decoration',
	stickiness: TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
	className: 'reference-decoration'
});

	private _decorations = new Map<string, OneReference>();
	private _decorationIgnoreSet = new Set<string>();
	private readonly _callOnDispose = new DisposableStore();
	private readonly _callOnModelChange = new DisposableStore();

constructor(private _editor: ICodeEditor, private _model: ReferencesModel) {
	this._callOnDispose.add(this._editor.onDidChangeModel(() => this._onModelChanged()));
	this._onModelChanged();
}

dispose(): void {
	this._callOnModelChange.dispose();
	this._callOnDispose.dispose();
	this.removeDecorations();
}

	private _onModelChanged(): void {
	this._callOnModelChange.clear();
	const model = this._editor.getModel();
	if(!model) {
		return;
	}
		for(const ref of this._model.references) {
	if (ref.uri.toString() === model.uri.toString()) {
		this._addDecorations(ref.parent);
		return;
	}
}
	}

	private _addDecorations(reference: FileReferences): void {
	if(!this._editor.hasModel()) {
	return;
}
this._callOnModelChange.add(this._editor.getModel().onDidChangeDecorations(() => this._onDecorationChanged()));

const newDecorations: IModelDeltaDecoration[] = [];
const newDecorationsActualIndex: number[] = [];

for (let i = 0, len = reference.children.length; i < len; i++) {
	const oneReference = reference.children[i];
	if (this._decorationIgnoreSet.has(oneReference.id)) {
		continue;
	}
	if (oneReference.uri.toString() !== this._editor.getModel().uri.toString()) {
		continue;
	}
	newDecorations.push({
		range: oneReference.range,
		options: DecorationsManager.DecorationOptions
	});
	newDecorationsActualIndex.push(i);
}

this._editor.changeDecorations((changeAccessor) => {
	const decorations = changeAccessor.deltaDecorations([], newDecorations);
	for (let i = 0; i < decorations.length; i++) {
		this._decorations.set(decorations[i], reference.children[newDecorationsActualIndex[i]]);
	}
});
	}

	private _onDecorationChanged(): void {
	const toRemove: string[] = [];

	const model = this._editor.getModel();
	if(!model) {
		return;
	}

		for(const [decorationId, reference] of this._decorations) {

	const newRange = model.getDecorationRange(decorationId);

	if (!newRange) {
		continue;
	}

	let ignore = false;
	if (Range.equalsRange(newRange, reference.range)) {
		continue;

	}

	if (Range.spansMultipleLines(newRange)) {
		ignore = true;

	} else {
		const lineLength = reference.range.endColumn - reference.range.startColumn;
		const newLineLength = newRange.endColumn - newRange.startColumn;

		if (lineLength !== newLineLength) {
			ignore = true;
		}
	}

	if (ignore) {
		this._decorationIgnoreSet.add(reference.id);
		toRemove.push(decorationId);
	} else {
		reference.range = newRange;
	}
}

for (let i = 0, len = toRemove.length; i < len; i++) {
	this._decorations.delete(toRemove[i]);
}
this._editor.removeDecorations(toRemove);
	}

removeDecorations(): void {
	this._editor.removeDecorations([...this._decorations.keys()]);
	this._decorations.clear();
}
} */

export class LayoutData {
	ratio: number = 0.7;
	heightInLines: number = 18;

	static fromJSON(raw: string): LayoutData {
		let ratio: number | undefined;
		let heightInLines: number | undefined;
		try {
			const data = <LayoutData>JSON.parse(raw);
			ratio = data.ratio;
			heightInLines = data.heightInLines;
		} catch {
			//
		}
		return {
			ratio: ratio || 0.7,
			heightInLines: heightInLines || 18
		};
	}
}

// interface OffscreenEdits {
// 	readonly range: IRange[];
// }


export class OverlayWidgetDelegate implements IOverlayWidget {

	private readonly _id: string;
	private readonly _domNode: HTMLElement;

	constructor(id: string, domNode: HTMLElement) {
		this._id = id;
		this._domNode = domNode;
	}

	getId(): string {
		return this._id;
	}

	getDomNode(): HTMLElement {
		return this._domNode;
	}

	getPosition(): IOverlayWidgetPosition | null {
		return null;
	}
}

/**
 * Widget that shows inside the editor
 */
export class GlimpseEditsWidget extends Disposable {

	//private _overlayWidget: OverlayWidgetDelegate | null = null;
	//private _model?: OffscreenEdits;

	//private _editorModel: ITextModel | null;
	//private _decorationsManager?: DecorationsManager;
	//private _dim = new dom.Dimension(400, 200);

	private readonly _disposeOnNewModel = new DisposableStore();
	private readonly _callOnDispose = new DisposableStore();
	private _preview!: ICodeEditor;


	container: HTMLElement | null = null;
	///domNode: HTMLElement;

	constructor(
		private readonly editor: ICodeEditor,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
	) {
		super();
		//this._editorModel = editor.getModel();
		this.create();
	}

	override dispose(): void {
		this._callOnDispose.dispose();
		this._disposeOnNewModel.dispose();
		dispose(this._preview);
		super.dispose();
	}

	create() {
		//this.domNode.classList.add('glimpse-widget');
		this.container = document.createElement('div');
		this.container.classList.add('glimpse-widget-container');
		//this._fillContainer(this.container);
	}


	focusOnPreviewEditor(): void {
		this._preview.focus();
	}

	isPreviewEditorFocused(): boolean {
		return this._preview.hasTextFocus();
	}

	protected _fillBody(containerElement: HTMLElement): void {
		// editor
		const previewContainer = dom.append(containerElement, dom.$('div.preview.inline'));
		const options: IEditorOptions = {
			scrollBeyondLastLine: false,
			scrollbar: {
				verticalScrollbarSize: 14,
				horizontal: 'auto',
				useShadows: true,
				verticalHasArrows: false,
				horizontalHasArrows: false,
				alwaysConsumeMouseWheel: true
			},
			overviewRulerLanes: 2,
			fixedOverflowWidgets: true,
			minimap: {
				enabled: false
			}
		};
		this._preview = this.instantiationService.createInstance(EmbeddedCodeEditorWidget, previewContainer, options, {}, this.editor);

	}

	async revealEdit(edit: Range) {
		await this._revealEdit(edit);
		//this._onDidChangeEdit.fire('test');
	}

	// Warning(@g-danna) - This range will change as new edits stream in
	private _revealedEdit?: Range;

	private async _revealEdit(edit: Range) {
		// check if there is anything to do...
		if (this._revealedEdit === edit) {
			return;
		}
		this._revealedEdit = edit;
		const sel = Range.lift(edit).collapseToStart();
		this._preview.setSelection(sel);
		this._preview.revealRangeInCenter(sel, ScrollType.Immediate);
	}
}
