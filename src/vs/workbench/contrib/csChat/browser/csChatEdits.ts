/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancelablePromise, Queue, createCancelablePromise } from 'vs/base/common/async';
import { Emitter, Event } from 'vs/base/common/event';
import { Disposable, DisposableStore } from 'vs/base/common/lifecycle';
import { MovingAverage } from 'vs/base/common/numbers';
import { StopWatch } from 'vs/base/common/stopwatch';
import { themeColorFromId } from 'vs/base/common/themables';
import { URI } from 'vs/base/common/uri';
import { ICodeEditor } from 'vs/editor/browser/editorBrowser';
import { ICodeEditorService } from 'vs/editor/browser/services/codeEditorService';
import { ISingleEditOperation } from 'vs/editor/common/core/editOperation';
import { LineRange } from 'vs/editor/common/core/lineRange';
import { IRange, Range } from 'vs/editor/common/core/range';
import { IDocumentDiff } from 'vs/editor/common/diff/documentDiffProvider';
import { IEditorDecorationsCollection } from 'vs/editor/common/editorCommon';
import { IWorkspaceTextEdit, Location, WorkspaceEdit } from 'vs/editor/common/languages';
import { IModelDeltaDecoration, ITextModel, IValidEditOperation, OverviewRulerLane } from 'vs/editor/common/model';
import { ModelDecorationOptions, createTextBufferFactoryFromSnapshot } from 'vs/editor/common/model/textModel';
import { IEditorWorkerService } from 'vs/editor/common/services/editorWorker';
import { IModelService } from 'vs/editor/common/services/model';
import { localize } from 'vs/nls';
import { IContextKey, IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { IInstantiationService, createDecorator } from 'vs/platform/instantiation/common/instantiation';
import { ServiceCollection } from 'vs/platform/instantiation/common/serviceCollection';
import { ILogService } from 'vs/platform/log/common/log';
import { Progress } from 'vs/platform/progress/common/progress';
import { ICSChatAgentEditRequest, ICSChatAgentEditResponse, ICSChatAgentService } from 'vs/workbench/contrib/csChat/common/csChatAgents';
import { CONTEXT_CHAT_EDIT_CODEBLOCK_NUMBER_IN_PROGRESS, CONTEXT_CHAT_EDIT_RESPONSEID_IN_PROGRESS } from 'vs/workbench/contrib/csChat/common/csChatContextKeys';
import { IChatEditSummary } from 'vs/workbench/contrib/csChat/common/csChatModel';
import { IChatResponseViewModel } from 'vs/workbench/contrib/csChat/common/csChatViewModel';
import { countWords } from 'vs/workbench/contrib/csChat/common/csChatWordCounter';
import { ProgressingEditsOptions, asProgressiveEdit, performAsyncTextEdit } from 'vs/workbench/contrib/inlineCSChat/browser/inlineCSChatStrategies';
import { CTX_INLINE_CHAT_CHANGE_HAS_DIFF, CTX_INLINE_CHAT_CHANGE_SHOWS_DIFF, overviewRulerInlineChatDiffInserted } from 'vs/workbench/contrib/inlineCSChat/common/inlineCSChat';

interface ICSChatCodeblockTextModels {
	textModel0: ITextModel;
	textModelN: ITextModel;
	textModelNAltVersion: number;
	textModelNSnapshotAltVersion: number | undefined;
}

export const ICSChatEditSessionService = createDecorator<ICSChatEditSessionService>('csChatEditSessionService');

export interface ICSChatEditSessionService {
	readonly _serviceBrand: undefined;

	readonly isEditing: boolean;
	readonly activeEditResponseId: string | undefined;
	readonly activeEditCodeblockNumber: number | undefined;

	sendEditRequest(responseVM: IChatResponseViewModel, request: ICSChatAgentEditRequest): Promise<{ responseCompletePromise: Promise<void> } | undefined>;
	getEditRangesInProgress(uri?: URI): Location[];
	confirmEdits(uri: URI): Promise<void>;
	cancelEdits(): Promise<void>;
}

export abstract class EditModeStrategy {
	protected static _decoBlock = ModelDecorationOptions.register({
		description: 'cschat',
		showIfCollapsed: false,
		isWholeLine: true,
		className: 'cschat-block-selection',
	});

	protected readonly _onDidAccept = new Emitter<void>();
	protected readonly _onDidDiscard = new Emitter<void>();

	readonly onDidAccept: Event<void> = this._onDidAccept.event;
	readonly onDidDiscard: Event<void> = this._onDidDiscard.event;

	toggleDiff?: () => any;

	dispose(): void {
		this._onDidAccept.dispose();
		this._onDidDiscard.dispose();
	}

	abstract start(): Promise<void>;
	abstract apply(): Promise<void>;
	abstract cancel(): Promise<void>;
	abstract makeProgressiveChanges(edits: ISingleEditOperation[], timings: ProgressingEditsOptions): Promise<void>;
	abstract makeChanges(edits: ISingleEditOperation[]): Promise<void>;
	abstract undoChanges(altVersionId: number): Promise<void>;
	abstract renderChanges(): Promise<void>;
	abstract getEditRangeInProgress(): Location[];
}

export class ChatEditSessionService extends Disposable implements ICSChatEditSessionService {
	declare readonly _serviceBrand: undefined;

	private editResponseIdInProgress: IContextKey<string>;
	private editCodeblockInProgress: IContextKey<number>;

	private activeResponse: IChatResponseViewModel | undefined;
	private _pendingRequests = new Map<string, CancelablePromise<void>>();
	private _pendingEdits = new Map<string, WorkspaceEdit[]>();
	private _receivedProgress = new Map<string, ICSChatAgentEditResponse[]>();

	private readonly textModels = new Map<URI, ICSChatCodeblockTextModels>();
	private readonly editStrategies = new Map<URI, EditModeStrategy>();

	constructor(
		@ILogService private readonly logService: ILogService,
		@IContextKeyService private readonly contextKeyService: IContextKeyService,
		@IInstantiationService private readonly instaService: IInstantiationService,
		@IModelService private readonly modelService: IModelService,
		@ICodeEditorService private readonly codeEditorService: ICodeEditorService,
		@ICSChatAgentService protected readonly csChatAgentService: ICSChatAgentService,
	) {
		super();
		this.editResponseIdInProgress = CONTEXT_CHAT_EDIT_RESPONSEID_IN_PROGRESS.bindTo(contextKeyService);
		this.editCodeblockInProgress = CONTEXT_CHAT_EDIT_CODEBLOCK_NUMBER_IN_PROGRESS.bindTo(contextKeyService);
	}

	get isEditing(): boolean {
		return this._pendingRequests.size > 0;
	}

	get activeEditResponseId(): string | undefined {
		const responseId = this.editResponseIdInProgress.get();
		return responseId === '' ? undefined : responseId;
	}

	get activeEditCodeblockNumber(): number | undefined {
		const codeblockNumber = this.editCodeblockInProgress.get();
		return codeblockNumber === -1 ? undefined : codeblockNumber;
	}

	async sendEditRequest(responseVM: IChatResponseViewModel, request: ICSChatAgentEditRequest): Promise<{ responseCompletePromise: Promise<void> } | undefined> {
		if (request.context.length !== 1) {
			this.error('sendRequest', `Expected exactly one context, got ${request.context.length}`);
			return;
		}

		this.activeResponse = responseVM;
		this.editResponseIdInProgress.set(responseVM.id);
		this.editCodeblockInProgress.set(request.context[0].codeBlockIndex);
		responseVM.recordEdits(request.context[0].codeBlockIndex, undefined);

		if (this._pendingRequests.has(responseVM.sessionId)) {
			this.trace('sendRequest', `Session ${responseVM.sessionId} already has a pending request`);
			return;
		}

		const responseCompletePromise = this._sendEditRequestAsync(responseVM, request);
		return { responseCompletePromise };
	}

	private async _sendEditRequestAsync(responseVM: IChatResponseViewModel, request: ICSChatAgentEditRequest): Promise<void> {
		const progressiveEditsAvgDuration = new MovingAverage();
		const progressiveEditsClock = StopWatch.create();
		const progressiveEditsQueue = new Queue();

		const rawResponsePromise = createCancelablePromise<void>(async token => {
			const progressCallback = async (progress: ICSChatAgentEditResponse) => {
				if (token.isCancellationRequested) {
					return;
				}

				this._receivedProgress.set(responseVM.sessionId, [...(this._receivedProgress.get(responseVM.sessionId) ?? []), progress]);

				const pendingEdits = this._pendingEdits.get(responseVM.sessionId);
				this._pendingEdits.set(responseVM.sessionId, pendingEdits ? [...pendingEdits, progress.edits] : [progress.edits]);
				progressiveEditsAvgDuration.update(progressiveEditsClock.elapsed());
				progressiveEditsClock.reset();

				progressiveEditsQueue.queue(async () => {
					if (token.isCancellationRequested) {
						return;
					}

					const editOpts = {
						duration: progressiveEditsAvgDuration.value,
						token,
					};
					await this._makeChanges(responseVM, progress, editOpts);
				});
			};

			const listener = token.onCancellationRequested(() => {
				this._pendingEdits.delete(responseVM.sessionId);
				progressiveEditsQueue.dispose();
			});

			try {
				const response = await this.csChatAgentService.makeEdits(request, progressCallback, token);
				if (token.isCancellationRequested) {
					return;
				}

				if (response) {
					await this._makeChanges(responseVM, response, undefined);
				}
			} finally {
				listener.dispose();
			}
		});

		this._pendingRequests.set(responseVM.sessionId, rawResponsePromise);
		rawResponsePromise.finally(() => {
			this._pendingRequests.delete(responseVM.sessionId);
		});
		return rawResponsePromise;
	}

	private async _makeChanges(response: IChatResponseViewModel, progress: ICSChatAgentEditResponse, opts: ProgressingEditsOptions | undefined) {
		const editOperations: { uri: URI; edit: ISingleEditOperation }[] = progress.edits.edits.map(edit => {
			const typedEdit = edit as IWorkspaceTextEdit;
			return {
				uri: typedEdit.resource,
				edit: {
					range: Range.lift(typedEdit.textEdit.range),
					text: typedEdit.textEdit.text,
				}
			};
		});

		for (const editOp of editOperations) {
			const { uri, edit } = editOp;
			const textModels = await this.getTextModels(uri);
			let codeEditor: ICodeEditor | undefined | null = this.codeEditorService.listCodeEditors().find(editor => editor.getModel()?.uri.toString() === uri.toString());
			if (!codeEditor) {
				codeEditor = await this.codeEditorService.openCodeEditor(
					{ resource: uri },
					this.codeEditorService.getFocusedCodeEditor()
				);

				if (!codeEditor) {
					this.error('sendRequest', `Failed to find code editor for ${uri.toString()}`);
				}
			}

			if (!codeEditor) {
				return;
			}

			let editStrategy = this.editStrategies.get(uri);
			if (!editStrategy) {
				const scopedInstantiationService = this.instaService.createChild(new ServiceCollection([IContextKeyService, this.contextKeyService]));
				editStrategy = scopedInstantiationService.createInstance(LiveStrategy, this.activeEditCodeblockNumber!, textModels, codeEditor, response);
				this.editStrategies.set(uri, editStrategy);
			}

			if (opts) {
				await editStrategy.makeProgressiveChanges([edit], opts);
			} else {
				await editStrategy.makeChanges([edit]);
			}
			await editStrategy.renderChanges();
		}
	}

	private async getTextModels(uri: URI): Promise<ICSChatCodeblockTextModels> {
		const textModel = this.textModels.get(uri);
		if (!textModel) {
			const textModelN = this.modelService.getModel(uri);
			if (!textModelN) {
				this.error('getTextModels', `Text model for ${uri.toString()} not found`);
				throw new Error(`Text model for ${uri.toString()} not found`);
			}

			const textModel0 = this.modelService.createModel(
				createTextBufferFactoryFromSnapshot(textModelN.createSnapshot()),
				{ languageId: textModelN.getLanguageId(), onDidChange: Event.None },
				undefined, true
			);

			const model = {
				textModel0,
				textModelN,
				textModelNAltVersion: textModelN.getAlternativeVersionId(),
				textModelNSnapshotAltVersion: undefined
			};
			this.textModels.set(uri, model);
			return model;
		}
		return textModel;
	}

	getEditRangesInProgress(forUri?: URI): Location[] {
		const locations: Location[] = [];
		if (forUri) {
			const editStrategy = this.editStrategies.get(forUri);
			if (editStrategy) {
				const editRanges = editStrategy.getEditRangeInProgress();
				locations.push(...editRanges);
			}
		} else {
			for (const [_, editStrategy] of this.editStrategies) {
				const editRanges = editStrategy.getEditRangeInProgress();
				locations.push(...editRanges);
			}
		}
		return locations;
	}

	confirmEdits(uri: URI): Promise<void> {
		const editStrategy = this.editStrategies.get(uri);
		if (!editStrategy) {
			this.error('confirmEdits', `Edit strategy for ${uri.toString()} not found`);
			return Promise.resolve();
		}
		editStrategy.apply();

		this.dispose();
		return Promise.resolve();
	}

	cancelEdits(): Promise<void> {
		this.editStrategies.forEach(editStrategy => editStrategy.cancel());
		this.activeResponse?.recordEdits(this.editCodeblockInProgress.get()!, undefined);

		this.dispose();
		return Promise.resolve();
	}

	private trace(method: string, message: string): void {
		this.logService.trace(`CSChatEditSession#${method}: ${message}`);
	}

	private error(method: string, message: string): void {
		this.logService.error(`CSChatEditSession#${method} ${message}`);
	}

	public override dispose(): void {
		super.dispose();

		const codeblockNumber = this.editCodeblockInProgress.get();

		this._receivedProgress.clear();
		this._pendingEdits.clear();
		this.editStrategies.forEach(editStrategy => editStrategy.dispose());
		this.editStrategies.clear();
		this.textModels.forEach(textModel => {
			textModel.textModel0.dispose();
		});
		this.textModels.clear();
		this.editResponseIdInProgress.reset();
		this.editCodeblockInProgress.reset();
		const appliedEdits = this.activeResponse?.appliedEdits.get(codeblockNumber!);
		this.activeResponse?.recordEdits(codeblockNumber!, appliedEdits);
		this.activeResponse = undefined;
	}
}

export class LiveStrategy extends EditModeStrategy {
	private readonly _decoInsertedText = ModelDecorationOptions.register({
		description: 'cschat-edit-modified-line',
		className: 'cschat-edit-inserted-range-linehighlight',
		isWholeLine: true,
		overviewRuler: {
			position: OverviewRulerLane.Full,
			color: themeColorFromId(overviewRulerInlineChatDiffInserted),
		}
	});

	// private readonly _decoInsertedTextRange = ModelDecorationOptions.register({
	// 	description: 'inline-chat-inserted-range-linehighlight',
	// 	className: 'inline-chat-inserted-range',
	// });

	private readonly _store: DisposableStore = new DisposableStore();
	private readonly _renderStore: DisposableStore = new DisposableStore();

	private readonly _ctxCurrentChangeHasDiff: IContextKey<boolean>;
	private readonly _ctxCurrentChangeShowsDiff: IContextKey<boolean>;

	private readonly _progressiveEditingDecorations: IEditorDecorationsCollection;

	private _editCount: number = 0;

	constructor(
		protected readonly _editCodeblockInProgress: number,
		protected readonly _models: ICSChatCodeblockTextModels,
		protected readonly _editor: ICodeEditor,
		protected readonly _response: IChatResponseViewModel,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IEditorWorkerService protected readonly _editorWorkerService: IEditorWorkerService,
		@IInstantiationService protected readonly _instaService: IInstantiationService,
	) {
		super();
		this._ctxCurrentChangeHasDiff = CTX_INLINE_CHAT_CHANGE_HAS_DIFF.bindTo(contextKeyService);
		this._ctxCurrentChangeShowsDiff = CTX_INLINE_CHAT_CHANGE_SHOWS_DIFF.bindTo(contextKeyService);

		this._progressiveEditingDecorations = this._editor.createDecorationsCollection();
	}

	override dispose(): void {
		this._resetDiff();
		this._store.dispose();
		super.dispose();
	}

	private _resetDiff(): void {
		this._ctxCurrentChangeHasDiff.reset();
		this._ctxCurrentChangeShowsDiff.reset();
		this._renderStore.clear();
		this._progressiveEditingDecorations.clear();
	}

	async start() {
		this._resetDiff();
	}

	async apply() {
		this._resetDiff();
		if (this._editCount > 0) {
			this._editor.pushUndoStop();
		}
	}

	async cancel() {
		this._resetDiff();
		const { textModelN: modelN, textModelNAltVersion, textModelNSnapshotAltVersion } = this._models;
		if (modelN.isDisposed()) {
			return;
		}
		const targetAltVersion = textModelNSnapshotAltVersion ?? textModelNAltVersion;
		await undoModelUntil(modelN, targetAltVersion);
	}

	override async undoChanges(altVersionId: number): Promise<void> {
		this._renderStore.clear();

		const { textModelN } = this._models;
		await undoModelUntil(textModelN, altVersionId);
	}

	override async makeChanges(edits: ISingleEditOperation[]): Promise<void> {
		return this._makeChanges(edits, undefined);
	}

	override async makeProgressiveChanges(edits: ISingleEditOperation[], opts: ProgressingEditsOptions): Promise<void> {
		return this._makeChanges(edits, opts);
	}

	private async _makeChanges(edits: ISingleEditOperation[], opts: ProgressingEditsOptions | undefined): Promise<void> {

		// push undo stop before first edit
		if (++this._editCount === 1) {
			this._editor.pushUndoStop();
		}

		// add decorations once per line that got edited
		const progress = new Progress<IValidEditOperation[]>(edits => {

			const newLines = new Set<number>();
			for (const edit of edits) {
				LineRange.fromRange(edit.range).forEach(line => newLines.add(line));
			}
			const existingRanges = this._progressiveEditingDecorations.getRanges().map(LineRange.fromRange);
			for (const existingRange of existingRanges) {
				existingRange.forEach(line => newLines.delete(line));
			}
			const newDecorations: IModelDeltaDecoration[] = [];
			for (const line of newLines) {
				newDecorations.push({ range: new Range(line, 1, line, Number.MAX_VALUE), options: this._decoInsertedText });
			}

			this._progressiveEditingDecorations.append(newDecorations);
		});

		if (opts) {
			// ASYNC
			const durationInSec = opts.duration / 1000;
			for (const edit of edits) {
				const wordCount = countWords(edit.text ?? '');
				const speed = wordCount / durationInSec;
				// console.log({ durationInSec, wordCount, speed: wordCount / durationInSec });
				await performAsyncTextEdit(this._models.textModelN, asProgressiveEdit(edit, speed, opts.token), progress);
			}

		} else {
			// SYNC
			this._editor.executeEdits('inline-chat-live', edits, undoEdits => {
				progress.report(undoEdits);
				return null;
			});
		}
	}

	protected _updateSummaryMessage(uri: URI, diff: IDocumentDiff | null) {
		const mappings = diff?.changes ?? [];
		if (mappings.length === 0) {
			return;
		}

		let linesChanged = 0;
		for (const change of mappings) {
			linesChanged += change.changedLineCount;
		}
		let message: string;
		if (linesChanged === 0) {
			message = localize('lines.0', "Nothing changed");
		} else if (linesChanged === 1) {
			message = localize('lines.1', "Changed 1 line");
		} else {
			message = localize('lines.N', "Changed {0} lines", linesChanged);
		}

		// Get editSummary with range containing the whole codeblock
		const range: IRange = mappings.map(m => m.modified).reduce((prev, curr) => {
			return {
				startLineNumber: Math.min(prev.startLineNumber, curr.startLineNumber),
				startColumn: 1,
				endLineNumber: Math.max(prev.endLineNumber, curr.endLineNumberExclusive),
				endColumn: 1
			};
		}, { startLineNumber: Number.MAX_VALUE, startColumn: 1, endLineNumber: 0, endColumn: 1 } as IRange);
		const editSummary: IChatEditSummary = {
			location: { uri, range },
			summary: message
		};
		this._response.recordEdits(this._editCodeblockInProgress, editSummary);
	}

	override renderChanges(): Promise<void> {
		throw new Error('Method not implemented.');
	}

	override getEditRangeInProgress(): Location[] {
		throw new Error('Method not implemented.');
	}
}

async function undoModelUntil(model: ITextModel, targetAltVersion: number): Promise<void> {
	while (targetAltVersion < model.getAlternativeVersionId() && model.canUndo()) {
		await model.undo();
	}
}
