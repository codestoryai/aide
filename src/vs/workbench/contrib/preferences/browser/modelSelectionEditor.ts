/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as DOM from 'vs/base/browser/dom';
import { ActionBar } from 'vs/base/browser/ui/actionbar/actionbar';
import { HighlightedLabel } from 'vs/base/browser/ui/highlightedlabel/highlightedLabel';
import { ISelectOptionItem, SelectBox } from 'vs/base/browser/ui/selectBox/selectBox';
import { ITableRenderer, ITableVirtualDelegate } from 'vs/base/browser/ui/table/table';
import { IAction } from 'vs/base/common/actions';
import { CancellationToken } from 'vs/base/common/cancellation';
import { ThemeIcon } from 'vs/base/common/themables';
import 'vs/css!./media/modelSelectionEditor';
import { localize } from 'vs/nls';
import { IAIModelSelectionService, ModelProviderConfig, ProviderType, humanReadableModelConfigKey, humanReadableProviderConfigKey, isDefaultProviderConfig, providerTypeValues } from 'vs/platform/aiModel/common/aiModels';
import { IContextViewService } from 'vs/platform/contextview/browser/contextView';
import { IEditorOptions } from 'vs/platform/editor/common/editor';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { WorkbenchTable } from 'vs/platform/list/browser/listService';
import { IStorageService } from 'vs/platform/storage/common/storage';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { defaultSelectBoxStyles } from 'vs/platform/theme/browser/defaultStyles';
import { IThemeService } from 'vs/platform/theme/common/themeService';
import { EditorPane } from 'vs/workbench/browser/parts/editor/editorPane';
import { IEditorOpenContext } from 'vs/workbench/common/editor';
import { EditModelConfigurationWidget, EditProviderConfigurationWidget, defaultModelIcon, invalidModelConfigIcon } from 'vs/workbench/contrib/preferences/browser/modelSelectionWidgets';
import { settingsEditIcon } from 'vs/workbench/contrib/preferences/browser/preferencesIcons';
import { IModelSelectionEditingService } from 'vs/workbench/services/aiModel/common/aiModelEditing';
import { ModelSelectionEditorInput } from 'vs/workbench/services/preferences/browser/modelSelectionEditorInput';
import { ModelSelectionEditorModel } from 'vs/workbench/services/preferences/browser/modelSelectionEditorModel';
import { IModelItem, IModelItemEntry, IProviderItemEntry, isModelItemConfigComplete, isProviderItemConfigComplete } from 'vs/workbench/services/preferences/common/preferences';

const $ = DOM.$;

export class ModelSelectionEditor extends EditorPane {
	static readonly ID: string = 'workbench.editor.modelSelectionEditor';

	private modelSelectionEditorModel: ModelSelectionEditorModel | null = null;

	private headerContainer!: HTMLElement;
	private modelsTableContainer!: HTMLElement;
	private providersTableTitle!: HTMLElement;
	private providersTableContainer!: HTMLElement;

	private fastModelSelect!: SelectBox;
	private slowModelSelect!: SelectBox;
	private modelsTable!: WorkbenchTable<IModelItemEntry>;
	private providersTable!: WorkbenchTable<IProviderItemEntry>;

	private modelConfigurationOverlayContainer!: HTMLElement;
	private editModelConfigurationWidget!: EditModelConfigurationWidget;
	private providerConfigurationOverlayContainer!: HTMLElement;
	private editProviderConfigurationWidget!: EditProviderConfigurationWidget;

	private modelTableEntries: IModelItemEntry[] = [];
	private providerTableEntries: IProviderItemEntry[] = [];

	private dimension: DOM.Dimension | null = null;

	constructor(
		@ITelemetryService telemetryService: ITelemetryService,
		@IThemeService themeService: IThemeService,
		@IStorageService storageService: IStorageService,
		@IAIModelSelectionService private readonly aiModelSelectionService: IAIModelSelectionService,
		@IModelSelectionEditingService private readonly modelSelectionEditingService: IModelSelectionEditingService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IContextViewService private readonly contextViewService: IContextViewService,
	) {
		super(ModelSelectionEditor.ID, telemetryService, themeService, storageService);

		this._register(this.aiModelSelectionService.onDidChangeModelSelection(() => {
			this.render();
		}));
	}

	protected createEditor(parent: HTMLElement): void {
		const modelSelectionEditorElement = DOM.append(parent, $('div', { class: 'model-selection-editor' }));

		this.createOverlayContainers(modelSelectionEditorElement);
		this.crateHeader(modelSelectionEditorElement);
		this.createBody(modelSelectionEditorElement);
	}

	private createOverlayContainers(parent: HTMLElement): void {
		this.modelConfigurationOverlayContainer = DOM.append(parent, $('.overlay-container'));
		this.modelConfigurationOverlayContainer.style.position = 'absolute';
		this.modelConfigurationOverlayContainer.style.zIndex = '40'; // has to greater than sash z-index which is 35
		this.editModelConfigurationWidget = this._register(this.instantiationService.createInstance(EditModelConfigurationWidget, this.modelConfigurationOverlayContainer));
		this.hideOverlayContainer('model');

		this.providerConfigurationOverlayContainer = DOM.append(parent, $('.overlay-container'));
		this.providerConfigurationOverlayContainer.style.position = 'absolute';
		this.providerConfigurationOverlayContainer.style.zIndex = '40'; // has to greater than sash z-index which is 35
		this.editProviderConfigurationWidget = this._register(this.instantiationService.createInstance(EditProviderConfigurationWidget, this.providerConfigurationOverlayContainer));
		this.hideOverlayContainer('provider');
	}

	private showOverlayContainer(type: 'model' | 'provider') {
		if (type === 'model') {
			this.modelConfigurationOverlayContainer.style.display = 'block';
		} else if (type === 'provider') {
			this.providerConfigurationOverlayContainer.style.display = 'block';
		}
	}

	private hideOverlayContainer(type: 'model' | 'provider') {
		if (type === 'model') {
			this.modelConfigurationOverlayContainer.style.display = 'none';
		} else if (type === 'provider') {
			this.providerConfigurationOverlayContainer.style.display = 'none';
		}
	}

	private crateHeader(parent: HTMLElement): void {
		this.headerContainer = DOM.append(parent, $('.model-selection-header'));

		const fastModelContainer = DOM.append(this.headerContainer, $('.model-select-dropdown'));
		DOM.append(fastModelContainer, $('span', undefined, 'Fast Model'));
		this.fastModelSelect = new SelectBox(<ISelectOptionItem[]>[], 0, this.contextViewService, defaultSelectBoxStyles, { ariaLabel: localize('fastModel', 'Fast Model'), useCustomDrawn: true });
		this.fastModelSelect.render(fastModelContainer);
		this._register(this.fastModelSelect.onDidSelect((e) => {
			this.setFastModel(e.selected);
		}));

		const slowModelContainer = DOM.append(this.headerContainer, $('.model-select-dropdown'));
		DOM.append(slowModelContainer, $('span', undefined, 'Slow Model'));
		this.slowModelSelect = new SelectBox(<ISelectOptionItem[]>[], 0, this.contextViewService, defaultSelectBoxStyles, { ariaLabel: localize('slowModel', 'Slow Model'), useCustomDrawn: true });
		this.slowModelSelect.render(slowModelContainer);
		this._register(this.slowModelSelect.onDidSelect((e) => {
			this.setSlowModel(e.selected);
		}));
	}

	private createBody(parent: HTMLElement): void {
		const bodyContainer = DOM.append(parent, $('div', { class: 'model-selection-body' }));
		this.createModelsTable(bodyContainer);
		this.createProvidersTable(bodyContainer);
	}

	private createModelsTable(parent: HTMLElement): void {
		this.modelsTableContainer = DOM.append(parent, $('div', { class: 'table-container' }));
		DOM.append(this.modelsTableContainer, $('h2', undefined, 'Models'));
		this.modelsTable = this._register(this.instantiationService.createInstance(WorkbenchTable,
			'ModelSelectionEditor',
			this.modelsTableContainer,
			new ModelDelegate(),
			[
				{
					label: '',
					tooltip: '',
					weight: 0,
					minimumWidth: 40,
					maximumWidth: 40,
					templateId: ModelActionsColumnRenderer.TEMPLATE_ID,
					project(row: IModelItemEntry): IModelItemEntry { return row; },
				},
				{
					label: localize('name', "Name"),
					tooltip: '',
					weight: 0.3,
					templateId: ModelsColumnRenderer.TEMPLATE_ID,
					project(row: IModelItemEntry): IModelItemEntry { return row; }
				},
				{
					label: localize('configuration', "Configuration"),
					tooltip: '',
					weight: 0.5,
					templateId: ModelConfigurationColumnRenderer.TEMPLATE_ID,
					project(row: IModelItemEntry): IModelItemEntry { return row; }
				},
				{
					label: localize('provider', "Provider"),
					tooltip: '',
					weight: 0.2,
					templateId: ModelProvidersColumnRenderer.TEMPLATE_ID,
					project(row: IModelItemEntry): IModelItemEntry { return row; }
				}
			],
			[
				this.instantiationService.createInstance(ModelActionsColumnRenderer, this),
				this.instantiationService.createInstance(ModelsColumnRenderer),
				this.instantiationService.createInstance(ModelConfigurationColumnRenderer),
				this.instantiationService.createInstance(ModelProvidersColumnRenderer)
			],
			{
				identityProvider: { getId: (e: IModelItemEntry) => e.modelItem.key },
				horizontalScrolling: false,
				multipleSelectionSupport: false,
				setRowLineHeight: false,
				openOnSingleClick: false,
				supportDynamicHeights: true,
				transformOptimization: false,
			}
		)) as WorkbenchTable<IModelItemEntry>;

		this._register(this.modelsTable.onMouseOver(e => {
			if (e.element?.modelItem.provider) {
				const providerItemIndex = this.modelSelectionEditorModel?.providerItems
					.findIndex(provider => provider.providerItem.type === e.element?.modelItem.provider?.type);
				if (providerItemIndex !== undefined && providerItemIndex !== -1) {
					this.providersTable.setSelection([providerItemIndex]);
				}
			} else {
				this.providersTable.setSelection([]);
			}
		}));
		this._register(this.modelsTable.onMouseOut(e => {
			this.providersTable.setSelection([]);
		}));
		this._register(this.modelsTable.onDidOpen((e) => {
			if (e.browserEvent?.defaultPrevented) {
				return;
			}
			const activeModelEntry = this.activeModelEntry;
			if (activeModelEntry) {
				this.editModel(activeModelEntry);
			}
		}));

		DOM.append(this.modelsTableContainer);
	}

	private createProvidersTable(parent: HTMLElement): void {
		this.providersTableContainer = DOM.append(parent, $('div', { class: 'table-container' }));
		this.providersTableTitle = DOM.append(this.providersTableContainer, $('h2', undefined, 'Providers'));
		this.providersTable = this._register(this.instantiationService.createInstance(WorkbenchTable,
			'ModelSelectionEditor',
			this.providersTableContainer,
			new ProviderDelegate(),
			[
				{
					label: '',
					tooltip: '',
					weight: 0,
					minimumWidth: 40,
					maximumWidth: 40,
					templateId: ModelActionsColumnRenderer.TEMPLATE_ID,
					project(row: IModelItemEntry): IModelItemEntry { return row; }
				},
				{
					label: localize('name', "Name"),
					tooltip: '',
					weight: 0.3,
					templateId: ProviderColumnsRenderer.TEMPLATE_ID,
					project(row: IProviderItemEntry): IProviderItemEntry { return row; }
				},
				{
					label: localize('config', "Configuration"),
					tooltip: '',
					weight: 0.7,
					templateId: ProviderConfigColumnRenderer.TEMPLATE_ID,
					project(row: IProviderItemEntry): IProviderItemEntry { return row; }
				}
			],
			[
				this.instantiationService.createInstance(ProviderActionsColumnRenderer, this),
				this.instantiationService.createInstance(ProviderColumnsRenderer),
				this.instantiationService.createInstance(ProviderConfigColumnRenderer)
			],
			{
				identityProvider: { getId: (e: IProviderItemEntry) => e.providerItem.type },
				horizontalScrolling: false,
				multipleSelectionSupport: false,
				setRowLineHeight: false,
				openOnSingleClick: false,
				supportDynamicHeights: true,
				transformOptimization: false,
			}
		)) as WorkbenchTable<IProviderItemEntry>;

		this._register(this.providersTable.onDidOpen((e) => {
			if (e.browserEvent?.defaultPrevented) {
				return;
			}
			const activeProviderEntry = this.activeProviderEntry;
			if (activeProviderEntry && Object.keys(activeProviderEntry.providerItem).filter(key => key !== 'type' && key !== 'name').length > 0) {
				this.editProvider(activeProviderEntry);
			}
		}));

		DOM.append(this.providersTableContainer);
	}

	private async render(): Promise<void> {
		if (this.input) {
			const input: ModelSelectionEditorInput = this.input as ModelSelectionEditorInput;
			this.modelSelectionEditorModel = await input.resolve();
			await this.modelSelectionEditorModel.resolve();

			this.renderProviders();
			this.renderModels();
			this.layoutTables();
		}
	}

	private renderModels(): void {
		if (this.modelSelectionEditorModel) {
			const modelItems = this.modelSelectionEditorModel.modelItems;

			const validModelItems = modelItems.filter(model => isModelItemConfigComplete(model.modelItem));
			this.fastModelSelect.setOptions(validModelItems.map(items => ({ text: items.modelItem.name }) as ISelectOptionItem));
			this.fastModelSelect.select(validModelItems.findIndex(items => items.modelItem.key === this.modelSelectionEditorModel?.fastModel.modelItem.key));
			this.slowModelSelect.setOptions(validModelItems.map(tems => ({ text: tems.modelItem.name }) as ISelectOptionItem));
			this.slowModelSelect.select(validModelItems.findIndex(items => items.modelItem.key === this.modelSelectionEditorModel?.slowModel.modelItem.key));

			this.modelTableEntries = modelItems;
			this.modelsTable.splice(0, this.modelsTable.length, this.modelTableEntries);
		}
	}

	private renderProviders(): void {
		if (this.modelSelectionEditorModel) {
			const providerItems = this.modelSelectionEditorModel.providerItems;

			this.providerTableEntries = providerItems;
			this.providersTable.splice(0, this.providersTable.length, providerItems);
		}
	}

	private layoutTables(): void {
		if (!this.dimension) {
			return;
		}

		const heightAdjustedForProvidersTable = 560;
		const modelsTableContainerHeight = this.dimension.height - (DOM.getDomNodePagePosition(this.headerContainer).height + heightAdjustedForProvidersTable);
		this.modelsTableContainer.style.height = `${modelsTableContainerHeight}px`;
		this.modelsTable.layout(modelsTableContainerHeight);

		this.providersTableTitle.style.paddingTop = '36px';
		this.providersTable.layout();
	}

	// Note: This is indeed the model name and not key. For some reason, SelectBox does not support setting a value.
	private async setSlowModel(modelName: string): Promise<void> {
		const modelKey = this.modelSelectionEditorModel?.modelItems.find(model => model.modelItem.name === modelName)?.modelItem.key;
		if (!modelKey) {
			return;
		}
		await this.modelSelectionEditingService.editModelSelection('slowModel', modelKey);
	}

	// Note: This is indeed the model name and not key. For some reason, SelectBox does not support setting a value.
	private async setFastModel(modelName: string): Promise<void> {
		const modelKey = this.modelSelectionEditorModel?.modelItems.find(model => model.modelItem.name === modelName)?.modelItem.key;
		if (!modelKey) {
			return;
		}
		await this.modelSelectionEditingService.editModelSelection('fastModel', modelKey);
	}

	override async setInput(input: ModelSelectionEditorInput, options: IEditorOptions | undefined, context: IEditorOpenContext, token: CancellationToken): Promise<void> {
		await super.setInput(input, options, context, token);
		return await this.render();
	}

	layout(dimension: DOM.Dimension): void {
		this.dimension = dimension;

		this.modelConfigurationOverlayContainer.style.width = dimension.width + 'px';
		this.modelConfigurationOverlayContainer.style.height = dimension.height + 'px';
		this.editModelConfigurationWidget.layout(this.dimension);

		this.providerConfigurationOverlayContainer.style.width = dimension.width + 'px';
		this.providerConfigurationOverlayContainer.style.height = dimension.height + 'px';
		this.editProviderConfigurationWidget.layout(this.dimension);

		this.layoutTables();
	}

	get activeModelEntry(): IModelItemEntry | null {
		const focusedElement = this.modelsTable.getFocusedElements()[0];
		return focusedElement ? <IModelItemEntry>focusedElement : null;
	}

	get activeProviderEntry(): IProviderItemEntry | null {
		const focusedElement = this.providersTable.getFocusedElements()[0];
		return focusedElement ? <IProviderItemEntry>focusedElement : null;
	}

	async editModel(modelItemEntry: IModelItemEntry): Promise<void> {
		this.selectModelEntry(modelItemEntry);
		this.showOverlayContainer('model');
		try {
			await this.editModelConfigurationWidget.edit(
				modelItemEntry,
				this.modelSelectionEditorModel?.providerItems.map(item => item.providerItem) ?? [modelItemEntry.modelItem.provider]
			);
		} catch (error) {
			console.error(error);
		} finally {
			this.hideOverlayContainer('model');
			this.selectModelEntry(modelItemEntry);
		}
	}

	async editProvider(providerItemEntry: IProviderItemEntry): Promise<void> {
		this.selectProviderEntry(providerItemEntry);
		this.showOverlayContainer('provider');
		try {
			await this.editProviderConfigurationWidget.edit(providerItemEntry);
		} catch (error) {
			console.error(error);
		} finally {
			this.hideOverlayContainer('provider');
			this.selectProviderEntry(providerItemEntry);
		}
	}

	private selectModelEntry(modelItemEntry: IModelItemEntry | number, focus: boolean = true): void {
		const index = typeof modelItemEntry === 'number' ? modelItemEntry : this.getIndexOfModel(modelItemEntry);
		if (index !== -1 && index < this.modelsTable.length) {
			if (focus) {
				this.modelsTable.domFocus();
				this.modelsTable.setFocus([index]);
			}
			this.modelsTable.setSelection([index]);
		}
	}

	private getIndexOfModel(listEntry: IModelItemEntry): number {
		const index = this.modelTableEntries.indexOf(listEntry);
		if (index === -1) {
			for (let i = 0; i < this.modelTableEntries.length; i++) {
				if (this.modelTableEntries[i].modelItem.key === listEntry.modelItem.key) {
					return i;
				}
			}
		}
		return index;
	}

	private selectProviderEntry(providerItemEntry: IProviderItemEntry | number, focus: boolean = true): void {
		const index = typeof providerItemEntry === 'number' ? providerItemEntry : this.getIndexOfProvider(providerItemEntry);
		if (index !== -1 && index < this.providersTable.length) {
			if (focus) {
				this.providersTable.domFocus();
				this.providersTable.setFocus([index]);
			}
			this.providersTable.setSelection([index]);
		}
	}

	private getIndexOfProvider(listEntry: IProviderItemEntry): number {
		const index = this.providerTableEntries.indexOf(listEntry);
		if (index === -1) {
			for (let i = 0; i < this.providerTableEntries.length; i++) {
				if (this.providerTableEntries[i].providerItem.type === listEntry.providerItem.type) {
					return i;
				}
			}
		}
		return index;
	}
}

class ModelDelegate implements ITableVirtualDelegate<IModelItemEntry> {
	readonly headerRowHeight = 30;

	getHeight(element: IModelItemEntry): number {
		const topLevelKeyCount = Object.keys(element.modelItem).filter(key => key !== 'key' && key !== 'name' && key !== 'providerConfig').length;
		const providerConfigKeyCount = Object.keys(element.modelItem.providerConfig)
			.filter(
				providerConfigKey => providerConfigKey !== 'type'
					&& (element.modelItem.providerConfig.type !== 'azure-openai' || providerConfigKey !== 'deploymentID')
			).length;
		const keyCount = topLevelKeyCount + providerConfigKeyCount;
		return 36 + (keyCount > 0 ? ((keyCount - 1) * 16) : 0);
	}
}

class ProviderDelegate implements ITableVirtualDelegate<IProviderItemEntry> {
	readonly headerRowHeight = 30;

	getHeight(element: IProviderItemEntry): number {
		const keyCount = Object.keys(element.providerItem).filter(key => key !== 'type' && key !== 'name').length;
		const isProviderConfigComplete = isProviderItemConfigComplete(element.providerItem);
		return 48 + (keyCount > 0 ? ((keyCount - 1) * 16) : 0) + (isProviderConfigComplete ? 16 : 0);
	}
}

interface IModelActionsColumnTemplateData {
	readonly actionBar: ActionBar;
}

class ModelActionsColumnRenderer implements ITableRenderer<IModelItemEntry, IModelActionsColumnTemplateData> {

	static readonly TEMPLATE_ID = 'modelActions';

	readonly templateId: string = ModelActionsColumnRenderer.TEMPLATE_ID;

	constructor(
		private readonly modelSelectionEditor: ModelSelectionEditor
	) {
	}

	renderTemplate(container: HTMLElement): IModelActionsColumnTemplateData {
		const element = DOM.append(container, $('.actions'));
		const actionBar = new ActionBar(element, { animated: false });
		return { actionBar };
	}

	renderElement(modelSelectionItemEntry: IModelItemEntry, index: number, templateData: IModelActionsColumnTemplateData, height: number | undefined): void {
		templateData.actionBar.clear();
		const actions: IAction[] = [];
		actions.push(this.createEditAction(modelSelectionItemEntry));
		templateData.actionBar.push(actions, { icon: true });
	}

	private createEditAction(modelSelectionItemEntry: IModelItemEntry): IAction {
		return <IAction>{
			class: ThemeIcon.asClassName(settingsEditIcon),
			enabled: true,
			id: 'editModelSelection',
			tooltip: localize('editModel', "Edit Model"),
			run: () => this.modelSelectionEditor.editModel(modelSelectionItemEntry)
		};
	}

	disposeTemplate(templateData: IModelActionsColumnTemplateData): void {
		templateData.actionBar.dispose();
	}
}

interface IModelColumnTemplateData {
	modelColumn: HTMLElement;
	modelIcon: HTMLElement;
	modelLabelContainer: HTMLElement;
	modelLabel: HighlightedLabel;
	modelKey: HTMLElement;
}

class ModelsColumnRenderer implements ITableRenderer<IModelItemEntry, IModelColumnTemplateData> {
	static readonly TEMPLATE_ID = 'model';

	readonly templateId: string = ModelsColumnRenderer.TEMPLATE_ID;

	renderTemplate(container: HTMLElement): IModelColumnTemplateData {
		const modelColumn = DOM.append(container, $('.model'));
		const modelIcon = DOM.append(modelColumn, $('.model-icon'));
		const modelLabelContainer = DOM.append(modelColumn, $('.model-label-container'));
		const modelLabel = new HighlightedLabel(modelLabelContainer);
		const modelKey = DOM.append(modelLabelContainer, $('span'));
		return { modelColumn, modelIcon, modelLabelContainer, modelLabel, modelKey };
	}

	renderElement(modelItemEntry: IModelItemEntry, index: number, templateData: IModelColumnTemplateData): void {
		const modelItem = modelItemEntry.modelItem;
		templateData.modelColumn.title = modelItem.name;
		templateData.modelKey.innerText = modelItem.key;

		templateData.modelIcon.classList.remove(...ThemeIcon.asClassNameArray(defaultModelIcon));
		templateData.modelIcon.classList.remove(...ThemeIcon.asClassNameArray(invalidModelConfigIcon));
		const isProviderConfigComplete = isModelItemConfigComplete(modelItem);
		if (isProviderConfigComplete) {
			templateData.modelIcon.classList.add(...ThemeIcon.asClassNameArray(defaultModelIcon));
		} else {
			templateData.modelIcon.classList.add(...ThemeIcon.asClassNameArray(invalidModelConfigIcon));
		}

		if (modelItem.name) {
			templateData.modelLabelContainer.classList.remove('hide');
			templateData.modelLabel.set(modelItem.name, []);
		} else {
			templateData.modelLabelContainer.classList.add('hide');
			templateData.modelLabel.set(undefined);
		}
	}

	disposeTemplate(templateData: IModelColumnTemplateData): void { }
}

interface IModelProviderColumnTemplateData {
	modelProviderColumn: HTMLElement;
	providerLabelContainer: HTMLElement;
	providerLabel: HighlightedLabel;
}

class ModelProvidersColumnRenderer implements ITableRenderer<IModelItemEntry, IModelProviderColumnTemplateData> {
	static readonly TEMPLATE_ID = 'modelProvider';

	readonly templateId: string = ModelProvidersColumnRenderer.TEMPLATE_ID;

	renderTemplate(container: HTMLElement): IModelProviderColumnTemplateData {
		const modelProviderColumn = DOM.append(container, $('.model-provider'));
		const providerLabelContainer = DOM.append(modelProviderColumn, $('.model-provider-label'));
		const providerLabel = new HighlightedLabel(providerLabelContainer);
		return { modelProviderColumn, providerLabelContainer, providerLabel };
	}

	renderElement(modelItemEntry: IModelItemEntry, index: number, templateData: IModelProviderColumnTemplateData): void {
		const modelItem = modelItemEntry.modelItem;
		templateData.modelProviderColumn.title = modelItem.name;

		if (modelItem.provider) {
			templateData.providerLabelContainer.classList.remove('hide');
			templateData.providerLabel.set(modelItem.provider.name, []);
		} else {
			templateData.providerLabelContainer.classList.add('hide');
			templateData.providerLabel.set(undefined);
		}
	}

	disposeTemplate(templateData: IModelProviderColumnTemplateData): void { }
}

interface IModelConfigurationColumnTemplateData {
	modelConfigurationColumn: HTMLElement;
	modelConfigurationContainer: HTMLElement;
}

class ModelConfigurationColumnRenderer implements ITableRenderer<IModelItemEntry, IModelConfigurationColumnTemplateData> {
	static readonly TEMPLATE_ID = 'modelConfiguration';

	readonly templateId: string = ModelConfigurationColumnRenderer.TEMPLATE_ID;

	renderTemplate(container: HTMLElement): IModelConfigurationColumnTemplateData {
		const modelConfigurationColumn = DOM.append(container, $('.provider-config'));
		const modelConfigurationContainer = DOM.append(modelConfigurationColumn, $('.provider-config-container'));
		return { modelConfigurationColumn, modelConfigurationContainer };
	}

	renderElement(modelItemEntry: IModelItemEntry, index: number, templateData: IModelConfigurationColumnTemplateData): void {
		const modelItem = modelItemEntry.modelItem;
		templateData.modelConfigurationColumn.title = modelItem.name;

		const configKeys = Object.keys(modelItem)
			.filter(key => key !== 'key' && key !== 'name' && key !== 'provider');
		if (configKeys.length > 0) {
			configKeys.forEach(key => {
				const configItem = DOM.append(templateData.modelConfigurationContainer, $('.provider-config-item'));
				if (key === 'providerConfig') {
					Object.keys(modelItem.providerConfig)
						.filter(providerConfigKey => providerConfigKey !== 'type' && (modelItem.providerConfig.type !== 'azure-openai' || providerConfigKey !== 'deploymentID'))
						.forEach(providerConfigKey => {
							const providerConfigValue = modelItem.providerConfig[providerConfigKey as keyof ModelProviderConfig];
							DOM.append(configItem, $('span.provider-config-key', undefined, `${humanReadableModelConfigKey[providerConfigKey]}: `));
							DOM.append(configItem, $(`span.provider-config-value${providerConfigValue.length > 0 ? '' : '.incomplete'}`, undefined, `${providerConfigValue.length > 0 ? providerConfigValue : 'Not set'}`));
						});
				} else {
					DOM.append(configItem, $('span.provider-config-key', undefined, `${humanReadableModelConfigKey[key]}: `));
					DOM.append(configItem, $('span.provider-config-value', undefined, `${modelItem[key as keyof typeof modelItem]}`));
				}
			});
		} else {
			const configItem = DOM.append(templateData.modelConfigurationContainer, $('.provider-config-item'));
			const emptyConfigMessage = this.getEmptyConfigurationMessage(modelItem);
			const className = emptyConfigMessage.complete ? 'provider-config-complete' : 'provider-config-incomplete';
			DOM.append(configItem, $(`span.${className}`, undefined, emptyConfigMessage.message));
		}
	}

	disposeElement(element: IModelItemEntry, index: number, templateData: IModelConfigurationColumnTemplateData, height: number | undefined): void {
		DOM.reset(templateData.modelConfigurationContainer);
	}

	disposeTemplate(templateData: IModelConfigurationColumnTemplateData): void { }

	private getEmptyConfigurationMessage(modelItem: IModelItem): { message: string; complete: boolean } {
		if (!modelItem.provider) {
			return { message: localize('noProvider', "No provider selected"), complete: false };
		}

		if (isDefaultProviderConfig(modelItem.provider.type, modelItem.provider)) {
			return { message: localize('defaultConfig', "Default configuration"), complete: true };
		}

		const incompleteFields = Object.keys(modelItem.providerConfig).filter(
			key => (modelItem.providerConfig[key as keyof typeof modelItem.providerConfig] as any) === ''
				|| (modelItem.providerConfig[key as keyof typeof modelItem.providerConfig] as any) === undefined
		);
		if (incompleteFields.length > 0) {
			return { message: localize('incompleteConfig', "Incomplete configuration"), complete: false };
		}

		return { message: localize('completeConfig', "Complete configuration"), complete: true };
	}
}

interface IProviderActionsColumnTemplateData {
	readonly actionBar: ActionBar;
}

class ProviderActionsColumnRenderer implements ITableRenderer<IProviderItemEntry, IProviderActionsColumnTemplateData> {

	static readonly TEMPLATE_ID = 'providerActions';

	readonly templateId: string = ModelActionsColumnRenderer.TEMPLATE_ID;

	constructor(
		private readonly modelSelectionEditor: ModelSelectionEditor
	) {
	}

	renderTemplate(container: HTMLElement): IProviderActionsColumnTemplateData {
		const element = DOM.append(container, $('.actions'));
		const actionBar = new ActionBar(element, { animated: false });
		return { actionBar };
	}

	renderElement(providerSelectionItemEntry: IProviderItemEntry, index: number, templateData: IProviderActionsColumnTemplateData, height: number | undefined): void {
		templateData.actionBar.clear();
		if (Object.keys(providerSelectionItemEntry.providerItem).filter(key => key !== 'type' && key !== 'name').length === 0) {
			return;
		}

		const actions: IAction[] = [];
		actions.push(this.createEditAction(providerSelectionItemEntry));
		templateData.actionBar.push(actions, { icon: true });
	}

	private createEditAction(providerSelectionItemEntry: IProviderItemEntry): IAction {
		return <IAction>{
			class: ThemeIcon.asClassName(settingsEditIcon),
			enabled: true,
			id: 'editProviderSelection',
			tooltip: localize('editProvider', "Edit Provider"),
			run: () => this.modelSelectionEditor.editProvider(providerSelectionItemEntry)
		};
	}

	disposeTemplate(templateData: IProviderActionsColumnTemplateData): void {
		templateData.actionBar.dispose();
	}
}

interface IProviderColumnTemplateData {
	providerColumn: HTMLElement;
	providerLogo: HTMLElement;
	providerLabelContainer: HTMLElement;
	providerLabel: HighlightedLabel;
	providerKey: HTMLElement;
}

class ProviderColumnsRenderer implements ITableRenderer<IProviderItemEntry, IProviderColumnTemplateData> {
	static readonly TEMPLATE_ID = 'provider';

	readonly templateId: string = ProviderColumnsRenderer.TEMPLATE_ID;

	renderTemplate(container: HTMLElement): IProviderColumnTemplateData {
		const providerColumn = DOM.append(container, $('.provider'));
		const providerLogo = DOM.append(providerColumn, $('.provider-logo'));
		const providerLabelContainer = DOM.append(providerColumn, $('.provider-label'));
		const providerLabel = new HighlightedLabel(providerLabelContainer);
		const providerKey = DOM.append(providerLabelContainer, $('span'));
		return { providerColumn, providerLogo, providerLabelContainer, providerLabel, providerKey };
	}

	renderElement(providerItemEntry: IProviderItemEntry, index: number, templateData: IProviderColumnTemplateData): void {
		const providerItem = providerItemEntry.providerItem;
		templateData.providerColumn.title = providerItem.name;
		templateData.providerKey.innerText = providerItem.type;

		if (providerTypeValues.includes(providerItem.type)) {
			templateData.providerLabelContainer.classList.remove('hide');
			templateData.providerLogo.classList.add(providerItem.type);
			templateData.providerLabel.set(providerItem.name, []);
		} else {
			templateData.providerLabelContainer.classList.remove(providerItem.type);
			templateData.providerLabelContainer.classList.add('hide');
			templateData.providerLabel.set(undefined);
		}
	}

	disposeTemplate(templateData: IProviderColumnTemplateData): void { }
}

interface IProviderConfigColumnTemplateData {
	providerConfigColumn: HTMLElement;
	providerConfigContainer: HTMLElement;
}

class ProviderConfigColumnRenderer implements ITableRenderer<IProviderItemEntry, IProviderConfigColumnTemplateData> {
	static readonly TEMPLATE_ID = 'providerConfig';

	readonly templateId: string = ProviderConfigColumnRenderer.TEMPLATE_ID;

	renderTemplate(container: HTMLElement): IProviderConfigColumnTemplateData {
		const providerConfigColumn = DOM.append(container, $('.provider-config'));
		const providerConfigContainer = DOM.append(providerConfigColumn, $('.provider-config-container'));
		return { providerConfigColumn, providerConfigContainer };
	}

	renderElement(providerItemEntry: IProviderItemEntry, index: number, templateData: IProviderConfigColumnTemplateData): void {
		const providerItem = providerItemEntry.providerItem;
		templateData.providerConfigColumn.title = providerItem.name;

		const configKeys = Object.keys(providerItem).filter(key => key !== 'type' && key !== 'name' && (providerItem[key as keyof typeof providerItem] as any) !== '');
		if (configKeys.length > 0) {
			if (isProviderItemConfigComplete(providerItem)) {
				const configItem = DOM.append(templateData.providerConfigContainer, $('.provider-config-item'));
				DOM.append(configItem, $(`span.provider-config-complete`, undefined, 'Configuration complete'));
			}
			configKeys.forEach(key => {
				const configItem = DOM.append(templateData.providerConfigContainer, $('.provider-config-item'));
				DOM.append(configItem, $('span.provider-config-key', undefined, `${humanReadableProviderConfigKey[key]}: `));
				DOM.append(configItem, $('span.provider-config-value', undefined, `${providerItem[key as keyof typeof providerItem]}`));
			});
		} else {
			const configItem = DOM.append(templateData.providerConfigContainer, $('.provider-config-item'));
			const emptyConfigMessage = this.getEmptyConfigurationMessage(providerItem.type);
			const className = emptyConfigMessage.complete ? 'provider-config-complete' : 'provider-config-incomplete';
			DOM.append(configItem, $(`span.${className}`, undefined, emptyConfigMessage.message));
		}
	}

	disposeElement(element: IProviderItemEntry, index: number, templateData: IProviderConfigColumnTemplateData, height: number | undefined): void {
		DOM.reset(templateData.providerConfigContainer);
	}

	disposeTemplate(templateData: IProviderConfigColumnTemplateData): void { }

	private getEmptyConfigurationMessage(providerType: ProviderType): { message: string; complete: boolean } {
		if (providerType === 'azure-openai' || providerType === 'openai-default' || providerType === 'togetherai') {
			return { message: 'Configuration incomplete', complete: false };
		} else if (providerType === 'codestory' || providerType === 'ollama') {
			return { message: 'No configuration required', complete: true };
		}
		return { message: 'No configuration options', complete: true };
	}
}
