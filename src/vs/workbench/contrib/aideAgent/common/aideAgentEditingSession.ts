/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { coalesceInPlace } from '../../../../base/common/arrays.js';
import { Iterable } from '../../../../base/common/iterator.js';
import { DisposableStore } from '../../../../base/common/lifecycle.js';
import { EditOperation, ISingleEditOperation } from '../../../../editor/common/core/editOperation.js';
import { LineRange } from '../../../../editor/common/core/lineRange.js';
import { Position } from '../../../../editor/common/core/position.js';
import { Range } from '../../../../editor/common/core/range.js';
import { IDocumentDiff } from '../../../../editor/common/diff/documentDiffProvider.js';
import { DetailedLineRangeMapping, RangeMapping } from '../../../../editor/common/diff/rangeMapping.js';
import { IIdentifiedSingleEditOperation, ITextModel, IValidEditOperation, TrackedRangeStickiness } from '../../../../editor/common/model.js';
import { ModelDecorationOptions } from '../../../../editor/common/model/textModel.js';
import { IEditorWorkerService } from '../../../../editor/common/services/editorWorker.js';
import { IModelContentChangedEvent } from '../../../../editor/common/textModelEvents.js';

export const enum HunkState {
	Pending = 0,
	Accepted = 1,
	Rejected = 2
}

export type HunkDisplayData = {
	decorationIds: string[];
	hunk: HunkInformation;
	position: Position;
	remove(): void;
};

class RawHunk {
	constructor(
		readonly original: LineRange,
		readonly modified: LineRange,
		readonly changes: RangeMapping[]
	) { }
}

interface IChatTextEditGroupState {
	sha1: string;
	applied: number;
}

type RawHunkData = {
	textModelNDecorations: string[];
	textModel0Decorations: string[];
	state: HunkState;
	editState: IChatTextEditGroupState;
};

export interface HunkInformation {
	/**
	 * The first element [0] is the whole modified range and subsequent elements are word-level changes
	 */
	getRangesN(): Range[];
	getRanges0(): Range[];
	isInsertion(): boolean;
	discardChanges(): void;
	/**
	 * Accept the hunk. Applies the corresponding edits into textModel0
	 */
	acceptChanges(): void;
	getState(): HunkState;
}

export class HunkData {

	private static readonly _HUNK_TRACKED_RANGE = ModelDecorationOptions.register({
		description: 'aide-agent-hunk-tracked-range',
		stickiness: TrackedRangeStickiness.AlwaysGrowsWhenTypingAtEdges
	});

	private static readonly _HUNK_THRESHOLD = 8;

	private readonly _store = new DisposableStore();
	private readonly _data = new Map<RawHunk, RawHunkData>();
	private _ignoreChanges: boolean = false;

	constructor(
		@IEditorWorkerService private readonly _editorWorkerService: IEditorWorkerService,
		private readonly _textModel0: ITextModel,
		private readonly _textModelN: ITextModel,
	) {

		this._store.add(_textModelN.onDidChangeContent(e => {
			if (!this._ignoreChanges) {
				this._mirrorChanges(e);
			}
		}));
	}

	dispose(): void {
		if (!this._textModelN.isDisposed()) {
			this._textModelN.changeDecorations(accessor => {
				for (const { textModelNDecorations } of this._data.values()) {
					textModelNDecorations.forEach(accessor.removeDecoration, accessor);
				}
			});
		}
		if (!this._textModel0.isDisposed()) {
			this._textModel0.changeDecorations(accessor => {
				for (const { textModel0Decorations } of this._data.values()) {
					textModel0Decorations.forEach(accessor.removeDecoration, accessor);
				}
			});
		}
		this._data.clear();
		this._store.dispose();
	}

	set ignoreTextModelNChanges(value: boolean) {
		this._ignoreChanges = value;
	}

	get ignoreTextModelNChanges(): boolean {
		return this._ignoreChanges;
	}

	private _mirrorChanges(event: IModelContentChangedEvent) {

		// mirror textModelN changes to textModel0 execept for those that
		// overlap with a hunk

		type HunkRangePair = { rangeN: Range; range0: Range; markAccepted: () => void };
		const hunkRanges: HunkRangePair[] = [];

		const ranges0: Range[] = [];

		for (const entry of this._data.values()) {

			if (entry.state === HunkState.Pending) {
				// pending means the hunk's changes aren't "sync'd" yet
				for (let i = 1; i < entry.textModelNDecorations.length; i++) {
					const rangeN = this._textModelN.getDecorationRange(entry.textModelNDecorations[i]);
					const range0 = this._textModel0.getDecorationRange(entry.textModel0Decorations[i]);
					if (rangeN && range0) {
						hunkRanges.push({
							rangeN, range0,
							markAccepted: () => entry.state = HunkState.Accepted
						});
					}
				}

			} else if (entry.state === HunkState.Accepted) {
				// accepted means the hunk's changes are also in textModel0
				for (let i = 1; i < entry.textModel0Decorations.length; i++) {
					const range = this._textModel0.getDecorationRange(entry.textModel0Decorations[i]);
					if (range) {
						ranges0.push(range);
					}
				}
			}
		}

		hunkRanges.sort((a, b) => Range.compareRangesUsingStarts(a.rangeN, b.rangeN));
		ranges0.sort(Range.compareRangesUsingStarts);

		const edits: IIdentifiedSingleEditOperation[] = [];

		for (const change of event.changes) {

			let isOverlapping = false;

			let pendingChangesLen = 0;

			for (const entry of hunkRanges) {
				if (entry.rangeN.getEndPosition().isBefore(Range.getStartPosition(change.range))) {
					// pending hunk _before_ this change. When projecting into textModel0 we need to
					// subtract that. Because diffing is relaxed it might include changes that are not
					// actual insertions/deletions. Therefore we need to take the length of the original
					// range into account.
					pendingChangesLen += this._textModelN.getValueLengthInRange(entry.rangeN);
					pendingChangesLen -= this._textModel0.getValueLengthInRange(entry.range0);

				} else if (Range.areIntersectingOrTouching(entry.rangeN, change.range)) {
					// an edit overlaps with a (pending) hunk. We take this as a signal
					// to mark the hunk as accepted and to ignore the edit. The range of the hunk
					// will be up-to-date because of decorations created for them
					entry.markAccepted();
					isOverlapping = true;
					break;

				} else {
					// hunks past this change aren't relevant
					break;
				}
			}

			if (isOverlapping) {
				// hunk overlaps, it grew
				continue;
			}

			const offset0 = change.rangeOffset - pendingChangesLen;
			const start0 = this._textModel0.getPositionAt(offset0);

			let acceptedChangesLen = 0;
			for (const range of ranges0) {
				if (range.getEndPosition().isBefore(start0)) {
					// accepted hunk _before_ this projected change. When projecting into textModel0
					// we need to add that
					acceptedChangesLen += this._textModel0.getValueLengthInRange(range);
				}
			}

			const start = this._textModel0.getPositionAt(offset0 + acceptedChangesLen);
			const end = this._textModel0.getPositionAt(offset0 + acceptedChangesLen + change.rangeLength);
			edits.push(EditOperation.replace(Range.fromPositions(start, end), change.text));
		}

		this._textModel0.pushEditOperations(null, edits, () => null);
	}

	async recompute(editState: IChatTextEditGroupState, diff?: IDocumentDiff | null) {

		diff ??= await this._editorWorkerService.computeDiff(this._textModel0.uri, this._textModelN.uri, { ignoreTrimWhitespace: false, maxComputationTimeMs: Number.MAX_SAFE_INTEGER, computeMoves: false }, 'advanced');

		let mergedChanges: DetailedLineRangeMapping[] = [];

		if (diff && diff.changes.length > 0) {
			// merge changes neighboring changes
			mergedChanges = [diff.changes[0]];
			for (let i = 1; i < diff.changes.length; i++) {
				const lastChange = mergedChanges[mergedChanges.length - 1];
				const thisChange = diff.changes[i];
				if (thisChange.modified.startLineNumber - lastChange.modified.endLineNumberExclusive <= HunkData._HUNK_THRESHOLD) {
					mergedChanges[mergedChanges.length - 1] = new DetailedLineRangeMapping(
						lastChange.original.join(thisChange.original),
						lastChange.modified.join(thisChange.modified),
						(lastChange.innerChanges ?? []).concat(thisChange.innerChanges ?? [])
					);
				} else {
					mergedChanges.push(thisChange);
				}
			}
		}

		const hunks = mergedChanges.map(change => new RawHunk(change.original, change.modified, change.innerChanges ?? []));

		editState.applied = hunks.length;

		this._textModelN.changeDecorations(accessorN => {

			this._textModel0.changeDecorations(accessor0 => {

				// clean up old decorations
				for (const { textModelNDecorations, textModel0Decorations } of this._data.values()) {
					textModelNDecorations.forEach(accessorN.removeDecoration, accessorN);
					textModel0Decorations.forEach(accessor0.removeDecoration, accessor0);
				}

				this._data.clear();

				// add new decorations
				for (const hunk of hunks) {

					const textModelNDecorations: string[] = [];
					const textModel0Decorations: string[] = [];

					textModelNDecorations.push(accessorN.addDecoration(lineRangeAsRange(hunk.modified, this._textModelN), HunkData._HUNK_TRACKED_RANGE));
					textModel0Decorations.push(accessor0.addDecoration(lineRangeAsRange(hunk.original, this._textModel0), HunkData._HUNK_TRACKED_RANGE));

					for (const change of hunk.changes) {
						textModelNDecorations.push(accessorN.addDecoration(change.modifiedRange, HunkData._HUNK_TRACKED_RANGE));
						textModel0Decorations.push(accessor0.addDecoration(change.originalRange, HunkData._HUNK_TRACKED_RANGE));
					}

					this._data.set(hunk, {
						editState,
						textModelNDecorations,
						textModel0Decorations,
						state: HunkState.Pending
					});
				}
			});
		});
	}

	get size(): number {
		return this._data.size;
	}

	get pending(): number {
		return Iterable.reduce(this._data.values(), (r, { state }) => r + (state === HunkState.Pending ? 1 : 0), 0);
	}

	private _discardEdits(item: HunkInformation): ISingleEditOperation[] {
		const edits: ISingleEditOperation[] = [];
		const rangesN = item.getRangesN();
		const ranges0 = item.getRanges0();
		for (let i = 1; i < rangesN.length; i++) {
			const modifiedRange = rangesN[i];

			const originalValue = this._textModel0.getValueInRange(ranges0[i]);
			edits.push(EditOperation.replace(modifiedRange, originalValue));
		}
		return edits;
	}

	discardAll() {
		const edits: ISingleEditOperation[][] = [];
		for (const item of this.getInfo()) {
			if (item.getState() === HunkState.Pending) {
				edits.push(this._discardEdits(item));
			}
		}
		const undoEdits: IValidEditOperation[][] = [];
		this._textModelN.pushEditOperations(null, edits.flat(), (_undoEdits) => {
			undoEdits.push(_undoEdits);
			return null;
		});
		return undoEdits.flat();
	}

	getInfo(): HunkInformation[] {

		const result: HunkInformation[] = [];

		for (const [hunk, data] of this._data.entries()) {
			const item: HunkInformation = {
				getState: () => {
					return data.state;
				},
				isInsertion: () => {
					return hunk.original.isEmpty;
				},
				getRangesN: () => {
					const ranges = data.textModelNDecorations.map(id => this._textModelN.getDecorationRange(id));
					coalesceInPlace(ranges);
					return ranges;
				},
				getRanges0: () => {
					const ranges = data.textModel0Decorations.map(id => this._textModel0.getDecorationRange(id));
					coalesceInPlace(ranges);
					return ranges;
				},
				discardChanges: () => {
					// DISCARD: replace modified range with original value. The modified range is retrieved from a decoration
					// which was created above so that typing in the editor keeps discard working.
					if (data.state === HunkState.Pending) {
						const edits = this._discardEdits(item);
						this._textModelN.pushEditOperations(null, edits, () => null);
						data.state = HunkState.Rejected;
						if (data.editState.applied > 0) {
							data.editState.applied -= 1;
						}
					}
				},
				acceptChanges: () => {
					// ACCEPT: replace original range with modified value. The modified value is retrieved from the model via
					// its decoration and the original range is retrieved from the hunk.
					if (data.state === HunkState.Pending) {
						const edits: ISingleEditOperation[] = [];
						const rangesN = item.getRangesN();
						const ranges0 = item.getRanges0();
						for (let i = 1; i < ranges0.length; i++) {
							const originalRange = ranges0[i];
							const modifiedValue = this._textModelN.getValueInRange(rangesN[i]);
							edits.push(EditOperation.replace(originalRange, modifiedValue));
						}
						this._textModel0.pushEditOperations(null, edits, () => null);
						data.state = HunkState.Accepted;
					}
				}
			};
			result.push(item);
		}

		return result;
	}
}

function lineRangeAsRange(lineRange: LineRange, model: ITextModel): Range {
	return lineRange.isEmpty
		? new Range(lineRange.startLineNumber, 1, lineRange.startLineNumber, model.getLineLength(lineRange.startLineNumber))
		: new Range(lineRange.startLineNumber, 1, lineRange.endLineNumberExclusive - 1, model.getLineLength(lineRange.endLineNumberExclusive - 1));
}

export function calculateChanges(edits: HunkInformation[]) {
	const changes = edits.reduce((acc, edit) => {
		const newRanges = edit.getRangesN() || [];
		const oldRanges = edit.getRanges0() || [];
		if (edit.isInsertion()) {
			const wholeNewRange = newRanges[0];
			acc.added += wholeNewRange.endLineNumber - wholeNewRange.startLineNumber + 1;
		} else if (newRanges.length > 0 && oldRanges.length > 0) {
			const wholeNewRange = newRanges[0];
			const wholeOldRange = oldRanges[0];

			acc.added += wholeNewRange.endLineNumber - wholeNewRange.startLineNumber + 1;
			acc.removed += wholeOldRange.endLineNumber - wholeOldRange.startLineNumber + 1;
		}
		return acc;
	}, { added: 0, removed: 0 });
	return changes;
}
