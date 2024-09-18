/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { addDisposableListener, Dimension } from '../../../../base/browser/dom.js';
import * as aria from '../../../../base/browser/ui/aria/aria.js';
import { toDisposable } from '../../../../base/common/lifecycle.js';
import { assertType } from '../../../../base/common/types.js';
import { ICodeEditor } from '../../../../editor/browser/editorBrowser.js';
import { EditorLayoutInfo, EditorOption } from '../../../../editor/common/config/editorOptions.js';
import { Position } from '../../../../editor/common/core/position.js';
import { Range } from '../../../../editor/common/core/range.js';
import { ZoneWidget } from '../../../../editor/contrib/zoneWidget/browser/zoneWidget.js';
import { localize } from '../../../../nls.js';
import { IContextKey, IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { ACTION_ACCEPT_CHANGES, ACTION_REGENERATE_RESPONSE, ACTION_TOGGLE_DIFF, CTX_INLINE_CHAT_OUTER_CURSOR_POSITION, EditMode, InlineChatConfigKeys, MENU_INLINE_CHAT_EXECUTE, MENU_INLINE_CHAT_WIDGET_STATUS } from '../../../../workbench/contrib/inlineAideChat/common/inlineChat.js';
import { EditorBasedInlineChatWidget } from './inlineChatWidget.js';
import { isEqual } from '../../../../base/common/resources.js';
import { StableEditorBottomScrollState } from '../../../../editor/browser/stableEditorScroll.js';
import { ScrollType } from '../../../../editor/common/editorCommon.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { AideChatAgentLocation } from '../../../../workbench/contrib/aideChat/common/aideChatAgents.js';
import { ILogService } from '../../../../platform/log/common/log.js';

export class InlineChatZoneWidget extends ZoneWidget {

	readonly widget: EditorBasedInlineChatWidget;

	private readonly _ctxCursorPosition: IContextKey<'above' | 'below' | ''>;
	private _dimension?: Dimension;

	constructor(
		location: AideChatAgentLocation,
		editor: ICodeEditor,
		@IInstantiationService private readonly _instaService: IInstantiationService,
		@ILogService private _logService: ILogService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IConfigurationService configurationService: IConfigurationService,
	) {
		super(editor, { showFrame: false, showArrow: false, isAccessible: true, className: 'inline-chat-widget', keepEditorSelection: true, showInHiddenAreas: true, ordinal: 10000 });

		this._ctxCursorPosition = CTX_INLINE_CHAT_OUTER_CURSOR_POSITION.bindTo(contextKeyService);

		this._disposables.add(toDisposable(() => {
			this._ctxCursorPosition.reset();
		}));

		this.widget = this._instaService.createInstance(EditorBasedInlineChatWidget, location, this.editor, {
			statusMenuId: {
				menu: MENU_INLINE_CHAT_WIDGET_STATUS,
				options: {
					buttonConfigProvider: action => {
						if (new Set([ACTION_REGENERATE_RESPONSE, ACTION_TOGGLE_DIFF]).has(action.id)) {
							return { isSecondary: true, showIcon: true, showLabel: false };
						} else if (action.id === ACTION_ACCEPT_CHANGES) {
							return { isSecondary: false };
						} else {
							return { isSecondary: true };
						}
					}
				}
			},
			chatWidgetViewOptions: {
				menus: {
					executeToolbar: MENU_INLINE_CHAT_EXECUTE,
					telemetrySource: 'interactiveEditorWidget-toolbar',
				},
				rendererOptions: {
					renderTextEditsAsSummary: (uri) => {
						// render edits as summary only when using Live mode and when
						// dealing with the current file in the editor
						return isEqual(uri, editor.getModel()?.uri)
							&& configurationService.getValue<EditMode>(InlineChatConfigKeys.Mode) === EditMode.Live;
					},
				}
			}
		});
		this._disposables.add(this.widget);

		let scrollState: StableEditorBottomScrollState | undefined;
		this._disposables.add(this.widget.chatWidget.onWillMaybeChangeHeight(() => {
			if (this.position) {
				scrollState = StableEditorBottomScrollState.capture(this.editor);
			}
		}));
		this._disposables.add(this.widget.onDidChangeHeight(() => {
			if (this.position) {
				// only relayout when visible
				scrollState ??= StableEditorBottomScrollState.capture(this.editor);
				const height = this._computeHeight();
				this._relayout(height.linesValue);
				scrollState.restore(this.editor);
				scrollState = undefined;
				this._revealTopOfZoneWidget(this.position, height);
			}
		}));

		this.create();

		this._disposables.add(addDisposableListener(this.domNode, 'click', e => {
			if (!this.editor.hasWidgetFocus() && !this.widget.hasFocus()) {
				this.editor.focus();
			}
		}, true));


		// todo@jrieken listen ONLY when showing
		const updateCursorIsAboveContextKey = () => {
			if (!this.position || !this.editor.hasModel()) {
				this._ctxCursorPosition.reset();
			} else if (this.position.lineNumber === this.editor.getPosition().lineNumber) {
				this._ctxCursorPosition.set('above');
			} else if (this.position.lineNumber + 1 === this.editor.getPosition().lineNumber) {
				this._ctxCursorPosition.set('below');
			} else {
				this._ctxCursorPosition.reset();
			}
		};
		this._disposables.add(this.editor.onDidChangeCursorPosition(e => updateCursorIsAboveContextKey()));
		this._disposables.add(this.editor.onDidFocusEditorText(e => updateCursorIsAboveContextKey()));
		updateCursorIsAboveContextKey();
	}

	protected override _fillContainer(container: HTMLElement): void {
		container.appendChild(this.widget.domNode);
	}

	protected override _doLayout(heightInPixel: number): void {

		const info = this.editor.getLayoutInfo();
		let width = info.contentWidth - (info.glyphMarginWidth + info.decorationsWidth);
		width = Math.min(640, width);

		this._dimension = new Dimension(width, heightInPixel);
		this.widget.layout(this._dimension);
	}

	private _computeHeight(): { linesValue: number; pixelsValue: number } {
		const chatContentHeight = this.widget.contentHeight;
		const editorHeight = this.editor.getLayoutInfo().height;

		const contentHeight = Math.min(chatContentHeight, Math.max(this.widget.minHeight, editorHeight * 0.42));
		const heightInLines = contentHeight / this.editor.getOption(EditorOption.lineHeight);
		return { linesValue: heightInLines, pixelsValue: contentHeight };
	}

	protected override _onWidth(_widthInPixel: number): void {
		if (this._dimension) {
			this._doLayout(this._dimension.height);
		}
	}

	override show(position: Position): void {
		assertType(this.container);

		const scrollState = StableEditorBottomScrollState.capture(this.editor);
		const info = this.editor.getLayoutInfo();
		const marginWithoutIndentation = info.glyphMarginWidth + info.decorationsWidth + info.lineNumbersWidth;
		this.container.style.marginLeft = `${marginWithoutIndentation}px`;

		const height = this._computeHeight();
		super.show(position, height.linesValue);
		this.widget.chatWidget.setVisible(true);
		this.widget.focus();

		scrollState.restore(this.editor);

		this._revealTopOfZoneWidget(position, height);
	}

	override updatePositionAndHeight(position: Position): void {
		const scrollState = StableEditorBottomScrollState.capture(this.editor);
		const height = this._computeHeight();
		super.updatePositionAndHeight(position, height.linesValue);
		scrollState.restore(this.editor);

		this._revealTopOfZoneWidget(position, height);
	}

	private _revealTopOfZoneWidget(position: Position, height: { linesValue: number; pixelsValue: number }) {

		// reveal top of zone widget

		const lineNumber = position.lineNumber <= 1 ? 1 : 1 + position.lineNumber;

		const scrollTop = this.editor.getScrollTop();
		const lineTop = this.editor.getTopForLineNumber(lineNumber);
		const zoneTop = lineTop - height.pixelsValue;

		const editorHeight = this.editor.getLayoutInfo().height;
		const lineBottom = this.editor.getBottomForLineNumber(lineNumber);

		let newScrollTop = zoneTop;
		let forceScrollTop = false;

		if (lineBottom >= (scrollTop + editorHeight)) {
			// revealing the top of the zone would pust out the line we are interested it and
			// therefore we keep the line in the view port
			newScrollTop = lineBottom - editorHeight;
			forceScrollTop = true;
		}

		if (newScrollTop < scrollTop || forceScrollTop) {
			this._logService.trace('[IE] REVEAL zone', { zoneTop, lineTop, lineBottom, scrollTop, newScrollTop, forceScrollTop });
			this.editor.setScrollTop(newScrollTop, ScrollType.Immediate);
		}
	}

	protected override revealRange(range: Range, isLastLine: boolean): void {
		// noop
	}

	protected override _getWidth(info: EditorLayoutInfo): number {
		return info.width - info.minimap.minimapWidth;
	}

	override hide(): void {
		const scrollState = StableEditorBottomScrollState.capture(this.editor);
		this._ctxCursorPosition.reset();
		this.widget.reset();
		this.widget.chatWidget.setVisible(false);
		super.hide();
		aria.status(localize('inlineChatClosed', 'Closed inline chat widget'));
		scrollState.restore(this.editor);
	}
}
