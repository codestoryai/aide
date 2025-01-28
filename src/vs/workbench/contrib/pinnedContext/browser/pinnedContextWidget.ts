/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as dom from '../../../../base/browser/dom.js';
import { ActionBar } from '../../../../base/browser/ui/actionbar/actionbar.js';
import { Button } from '../../../../base/browser/ui/button/button.js';
import { IListRenderer, IListVirtualDelegate } from '../../../../base/browser/ui/list/list.js';
import { Action } from '../../../../base/common/actions.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { basename } from '../../../../base/common/path.js';
import { ThemeIcon } from '../../../../base/common/themables.js';
import { URI } from '../../../../base/common/uri.js';
import { localize } from '../../../../nls.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { FileKind } from '../../../../platform/files/common/files.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { IKeybindingService } from '../../../../platform/keybinding/common/keybinding.js';
import { WorkbenchList } from '../../../../platform/list/browser/listService.js';
import { IOpenerService } from '../../../../platform/opener/common/opener.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { IResourceLabel, ResourceLabels } from '../../../browser/labels.js';
import { IDisposableReference } from '../../aideAgent/browser/aideAgentContentParts/aideAgentCollections.js';
import { createFileIconThemableTreeContainerScope } from '../../files/browser/views/explorerView.js';
import { IPinnedContextService, MANAGE_PINNED_CONTEXT, PinnedContextItem } from '../common/pinnedContext.js';
import { ManagePinnedContext } from './actions/pinnedContextActions.js';
import './media/pinnedContext.css';

const ItemHeight = 22;

export class PinnedContextWidget extends Disposable {
	private isExpanded = false;

	private container: HTMLElement | undefined;
	get element(): HTMLElement | undefined {
		return this.container;
	}

	private $message!: HTMLDivElement;
	private $tree!: HTMLDivElement;
	private overviewButton!: Button;
	private tree!: WorkbenchList<PinnedContextItem>;
	private pinnedContextListPool: PinnedContextListPool;

	private _onDidChangeVisibility = this._register(new Emitter<boolean>());
	private _onDidChangeHeight = this._register(new Emitter<void>());
	get onDidChangeHeight(): Event<void> {
		return this._onDidChangeHeight.event;
	}

	constructor(
		@ICommandService private readonly commandService: ICommandService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IKeybindingService private readonly keybindingService: IKeybindingService,
		@IPinnedContextService private readonly pinnedContextService: IPinnedContextService,
	) {
		super();

		this.pinnedContextListPool = this._register(this.instantiationService.createInstance(PinnedContextListPool, this._onDidChangeVisibility.event));
		this._register(this.pinnedContextService.onDidChangePinnedContexts(() => this.refresh()));
	}

	private refresh(): void {
		const pinnedContexts = this.pinnedContextService.getPinnedContexts();
		this.updateTree(pinnedContexts);

		if (pinnedContexts.length === 0) {
			this.message = localize(
				'noPinnedContexts',
				"Pin files for the AI to cache and refer to for all its work. The best files to pin are those you're actively working on or referring to for the task at hand."
			);
		} else {
			this.message = undefined;
		}

		this.updateOverviewLabel();
		this._onDidChangeHeight.fire();
	}

	private updateTree(pinnedContexts: URI[]): void {
		if (this.tree) {
			const maxItemsShown = 6;
			const itemsShown = Math.min(pinnedContexts.length, maxItemsShown);
			const height = itemsShown * ItemHeight;
			this.tree.layout(height);
			this.tree.getHTMLElement().style.height = `${height}px`;
			this.tree.splice(0, this.tree.length, pinnedContexts.map(uri => ({ uri })));
		}
	}

	private _message: string | undefined;
	get message(): string | undefined {
		return this._message;
	}

	set message(message: string | undefined) {
		this._message = message;
		this.updateMessage();
	}

	private updateMessage(): void {
		if (this._message !== undefined) {
			this.showMessage(this._message);
		} else {
			this.hideMessage();
		}
	}

	private showMessage(message: string): void {
		if (!this.$message) {
			return;
		}
		this.$message.classList.remove('hide');
		this.resetMessageElement();

		this.$message.textContent = message;
	}

	private hideMessage(): void {
		this.resetMessageElement();
		this.$message.classList.add('hide');
	}

	private resetMessageElement(): void {
		dom.clearNode(this.$message);
	}

	render(parent: HTMLElement): void {
		const container = this.container = dom.append(parent, dom.$('.pinned-context-widget'));

		/* Header area */
		const header = dom.append(container, dom.$('.pinned-context-header'));
		const label = dom.append(header, dom.$('.pinned-context-label'));
		// Icon
		const icon = dom.$('.pinned-context-icon');
		icon.classList.add(...ThemeIcon.asClassNameArray(Codicon.pinnedDirty));
		icon.style.height = '16px';
		label.appendChild(icon);
		// Title
		const manageKbShortcut = this.keybindingService.lookupKeybinding(ManagePinnedContext.ID);
		const buttonTitle = manageKbShortcut ? localize('managePinnedContextsKb', "Pinned Context ({0})", manageKbShortcut.getLabel()) : localize('managePinnedContextsNoKb', "Pinned Context");
		const title = dom.$('.pinned-context-title');
		title.textContent = buttonTitle;
		label.appendChild(title);
		// Edit button
		const buttonContainer = dom.append(label, dom.$('.pinned-context-edit-button'));
		const editButton = this._register(new Button(buttonContainer, {
			buttonBackground: undefined,
			buttonBorder: undefined,
			buttonForeground: undefined,
			buttonHoverBackground: undefined,
			buttonSecondaryBackground: undefined,
			buttonSecondaryForeground: undefined,
			buttonSecondaryHoverBackground: undefined,
			buttonSeparator: undefined,
			title: 'Edit pinned context'
		}));
		editButton.label = localize('editPinnedContexts', "Edit");
		editButton.onDidClick(() => {
			this.commandService.executeCommand(MANAGE_PINNED_CONTEXT);
		});

		const overview = dom.append(header, dom.$('.pinned-context-overview'));
		const overviewButton = this.overviewButton = this._register(new Button(overview, {
			buttonBackground: undefined,
			buttonBorder: undefined,
			buttonForeground: undefined,
			buttonHoverBackground: undefined,
			buttonSecondaryBackground: undefined,
			buttonSecondaryForeground: undefined,
			buttonSecondaryHoverBackground: undefined,
			buttonSeparator: undefined,
			title: 'View pinned context',
			supportIcons: true
		}));
		this.updateOverviewLabel();

		/* Details area */
		const details = dom.append(container, dom.$('.pinned-context-details'));
		details.style.display = 'none';

		this.$message = dom.append(details, dom.$('.message'));
		this.$message.classList.add('pinned-context-subtle');

		this.$tree = dom.append(details, dom.$('.pinned-context-tree'));
		const ref = this._register(this.pinnedContextListPool.get());
		const list = this.tree = ref.object;
		this.$tree.appendChild(list.getHTMLElement().parentElement!);

		this._register(overviewButton.onDidClick(() => {
			this.isExpanded = !this.isExpanded;
			details.style.display = this.isExpanded ? 'block' : 'none';
			if (this.isExpanded && this.tree.length > 0) {
				this.tree.setSelection([0]);
			}

			this.updateOverviewLabel();
			this._onDidChangeHeight.fire();
		}));

		this.refresh();
	}

	private updateOverviewLabel(): void {
		const itemCount = this.tree?.length ?? 0;
		const chevron = this.isExpanded ? '$(chevron-up)' : '$(chevron-down)';
		this.overviewButton.label = localize('pinnedContextsOverview', "{0} {1} {2}", chevron, itemCount, itemCount === 1 ? 'item' : 'items');
	}
}

class PinnedContextListPool extends Disposable {
	private readonly pool: WorkbenchList<PinnedContextItem>[] = [];
	private inUse = new Set<WorkbenchList<PinnedContextItem>>();

	constructor(
		private readonly onDidChangeVisibility: Event<boolean>,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IThemeService private readonly themeService: IThemeService,
	) {
		super();
	}

	get(): IDisposableReference<WorkbenchList<PinnedContextItem>> {
		let list: WorkbenchList<PinnedContextItem>;
		if (this.pool.length > 0) {
			list = this.pool.pop()!;
		} else {
			list = this.createList();
		}
		this.inUse.add(list);

		let stale = false;
		return {
			object: list,
			isStale: () => stale,
			dispose: () => {
				stale = true;
				this.inUse.delete(list);
				this.pool.push(list);
			}
		};
	}

	private createList(): WorkbenchList<PinnedContextItem> {
		const resourceLabels = this._register(this.instantiationService.createInstance(ResourceLabels, { onDidChangeVisibility: this.onDidChangeVisibility }));

		const container = dom.$('.pinned-context-list');
		this._register(createFileIconThemableTreeContainerScope(container, this.themeService));

		const list = this.instantiationService.createInstance(
			WorkbenchList<PinnedContextItem>,
			'PinnedContextList',
			container,
			new PinnedContextListDelegate(),
			[this.instantiationService.createInstance(PinnedContextListRenderer, resourceLabels)],
			{
				multipleSelectionSupport: false,
				identityProvider: { getId: (item: PinnedContextItem) => item.uri.toString() },
				keyboardNavigationLabelProvider: { getKeyboardNavigationLabel: (item: PinnedContextItem) => basename(item.uri.path) },
				accessibilityProvider: {
					getAriaLabel: (item: PinnedContextItem) => basename(item.uri.path),
					getWidgetAriaLabel: () => localize('pinnedContextList', "Pinned Context List")
				}
			}
		);

		return list;
	}
}

class PinnedContextListDelegate implements IListVirtualDelegate<PinnedContextItem> {
	getHeight(): number {
		return ItemHeight;
	}

	getTemplateId(): string {
		return 'pinnedContextItem';
	}
}

interface IPinnedContextItemTemplateData {
	resourceLabel: IResourceLabel;
	actionBar: ActionBar;
}

class PinnedContextListRenderer implements IListRenderer<PinnedContextItem, IPinnedContextItemTemplateData> {
	static readonly TEMPLATE_ID = 'pinnedContextItem';
	readonly templateId: string = PinnedContextListRenderer.TEMPLATE_ID;

	constructor(
		private readonly labels: ResourceLabels,
		@IOpenerService private readonly openerService: IOpenerService,
		@IPinnedContextService private readonly pinnedContextService: IPinnedContextService,
	) { }

	renderTemplate(container: HTMLElement): IPinnedContextItemTemplateData {
		const resourceLabel = this.labels.create(container, { supportHighlights: true });
		const actionBarContainer = dom.append(container, dom.$('.actions'));
		const actionBar = new ActionBar(actionBarContainer, {});

		return { resourceLabel, actionBar };
	}

	renderElement(element: PinnedContextItem, index: number, templateData: IPinnedContextItemTemplateData, height: number | undefined): void {
		const uri = element.uri;
		const label = basename(uri.path);

		templateData.resourceLabel.setResource({ resource: uri, name: label }, {
			fileKind: FileKind.FILE,
			hideIcon: false,
			fileDecorations: { colors: true, badges: true },
		});
		templateData.resourceLabel.element.onclick = () => {
			this.openerService.open(uri, { editorOptions: { pinned: false } });
		};

		templateData.actionBar.clear();
		templateData.actionBar.push(new Action('remove', localize('remove', "Remove"), ThemeIcon.asClassName(Codicon.close), true, () => {
			this.pinnedContextService.removeContext(uri);
		}), { icon: true, label: false });
	}

	disposeTemplate(templateData: IPinnedContextItemTemplateData): void {
		templateData.resourceLabel.dispose();
		templateData.actionBar.dispose();
	}
}
