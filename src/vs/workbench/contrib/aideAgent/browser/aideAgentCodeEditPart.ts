/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as dom from '../../../../base/browser/dom.js';
import { IListRenderer, IListVirtualDelegate } from '../../../../base/browser/ui/list/list.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable, DisposableStore, IDisposable } from '../../../../base/common/lifecycle.js';
import { basename, basenameOrAuthority, dirname } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { Range } from '../../../../editor/common/core/range.js';
import { localize } from '../../../../nls.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { ILabelService } from '../../../../platform/label/common/label.js';
import { WorkbenchList } from '../../../../platform/list/browser/listService.js';
import { IOpenerService } from '../../../../platform/opener/common/opener.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { IResourceLabel, ResourceLabels } from '../../../browser/labels.js';
import { createFileIconThemableTreeContainerScope } from '../../files/browser/views/explorerView.js';
import { IDisposableReference, ResourcePool } from './aideAgentContentParts/aideAgentCollections.js';
const $ = dom.$;

interface IAideAgentCodeEditsItem {
	uri: URI;
	range: Range;
}

interface IChatCodeEdits {
	edits: Map<URI, Range[]>;
}

export class AideAgentCodeEditsContentPart extends Disposable {
	public readonly domNode: HTMLElement;
	private list: WorkbenchList<IAideAgentCodeEditsItem>;
	private readonly _onDidChangeHeight = this._register(new Emitter<void>());
	public readonly onDidChangeHeight = this._onDidChangeHeight.event;
	constructor(pool: CodeEditsPool) {
		super();

		const ref = this._register(pool.get());
		const list = this.list = ref.object;
		this.domNode = list.getHTMLElement().parentElement!;
	}

	setInput(codeEdits: IChatCodeEdits) {
		const data: IAideAgentCodeEditsItem[] = [];
		for (const [uri, ranges] of codeEdits.edits) {
			for (const range of ranges) {
				data.push({ uri, range });
			}
		}
		const height = data.length * 22;
		this.list.layout(height);
		this.list.getHTMLElement().style.height = `${height}px`;
		this.list.splice(0, this.list.length, data);
	}

	addDisposable(disposable: IDisposable): void {
		this._register(disposable);
	}
}

export class CodeEditsPool extends Disposable {
	private _pool: ResourcePool<WorkbenchList<IAideAgentCodeEditsItem>>;
	public get inUse(): ReadonlySet<WorkbenchList<IAideAgentCodeEditsItem>> {
		return this._pool.inUse;
	}

	constructor(
		private _onDidChangeVisibility: Event<boolean>,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IThemeService private readonly themeService: IThemeService
	) {
		super();
		this._pool = this._register(new ResourcePool(() => this.listFactory()));
	}

	private listFactory(): WorkbenchList<IAideAgentCodeEditsItem> {
		const resourceLabels = this._register(this.instantiationService.createInstance(ResourceLabels, { onDidChangeVisibility: this._onDidChangeVisibility }));
		const container = $('.aideagent-codeedit-list');
		this._register(createFileIconThemableTreeContainerScope(container, this.themeService));
		const list = this.instantiationService.createInstance(
			WorkbenchList<IAideAgentCodeEditsItem>,
			'AideAgentCodeEditsRenderer',
			container,
			new AideAgentCodeEditsListDelegate(),
			[this.instantiationService.createInstance(AideAgentCodeEditsListRenderer, resourceLabels)],
			{
				alwaysConsumeMouseWheel: false,
				accessibilityProvider: {
					getAriaLabel: (e: IAideAgentCodeEditsItem) => basename(e.uri),
					getWidgetAriaLabel: () => localize('codeEditsListAriaLabel', "Code edits")
				},
				identityProvider: {
					getId: (e: IAideAgentCodeEditsItem) => e.uri.toString()
				},
			}
		);
		return list;
	}

	get(): IDisposableReference<WorkbenchList<IAideAgentCodeEditsItem>> {
		const object = this._pool.get();
		let stale = false;
		return {
			object,
			isStale: () => stale,
			dispose: () => {
				stale = true;
				this._pool.release(object);
			}
		};
	}
}

class AideAgentCodeEditsListDelegate implements IListVirtualDelegate<IAideAgentCodeEditsItem> {
	static readonly ITEM_HEIGHT = 22;

	getHeight(element: IAideAgentCodeEditsItem): number {
		return AideAgentCodeEditsListDelegate.ITEM_HEIGHT;
	}

	getTemplateId(element: IAideAgentCodeEditsItem): string {
		return AideAgentCodeEditsListRenderer.TEMPLATE_ID;
	}
}

interface IAideAgentCodeEditsListTemplate {
	templateDisposables: DisposableStore;
	label: IResourceLabel;
}

class AideAgentCodeEditsListRenderer implements IListRenderer<IAideAgentCodeEditsItem, IAideAgentCodeEditsListTemplate> {
	static TEMPLATE_ID = 'aideAgentCodeEditsListTemplate';
	readonly templateId: string = AideAgentCodeEditsListRenderer.TEMPLATE_ID;

	constructor(
		private labels: ResourceLabels,
		@IOpenerService private readonly openerService: IOpenerService,
		@ILabelService private readonly labelService: ILabelService
	) { }

	renderTemplate(container: HTMLElement): IAideAgentCodeEditsListTemplate {
		const templateDisposables = new DisposableStore();
		const label = templateDisposables.add(this.labels.create(container, { supportHighlights: true, supportIcons: true }));
		return { templateDisposables, label };
	}

	renderElement(element: IAideAgentCodeEditsItem, index: number, templateData: IAideAgentCodeEditsListTemplate, height: number | undefined): void {
		const { label } = templateData;

		label.element.style.display = 'flex';
		const { uri: resource, range } = element;
		let description: string | undefined;
		const descriptionCandidate = this.labelService.getUriLabel(dirname(resource), { relative: true });
		if (descriptionCandidate && descriptionCandidate !== '.') {
			description = descriptionCandidate;
		}

		label.setResource({
			resource,
			name: basenameOrAuthority(resource),
			description,
			range,
		});
		label.element.tabIndex = 0;
		label.element.style.cursor = 'pointer';

		templateData.templateDisposables.add(dom.addDisposableListener(label.element, dom.EventType.CLICK, async (e: MouseEvent) => {
			dom.EventHelper.stop(e, true);
			this.openerService.open(
				resource,
				{
					fromUserGesture: true,
					editorOptions: {
						selection: range,
					} as any
				});
		}));
	}

	disposeTemplate(templateData: IAideAgentCodeEditsListTemplate): void {
		templateData.templateDisposables.dispose();
	}
}
