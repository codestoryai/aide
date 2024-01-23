/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as dom from 'vs/base/browser/dom';
import { FastDomNode, createFastDomNode } from 'vs/base/browser/fastDomNode';
import { Button } from 'vs/base/browser/ui/button/button';
import { InputBox } from 'vs/base/browser/ui/inputbox/inputBox';
import { ISelectOptionItem, SelectBox } from 'vs/base/browser/ui/selectBox/selectBox';
import { Widget } from 'vs/base/browser/ui/widget';
import { Promises } from 'vs/base/common/async';
import { Codicon } from 'vs/base/common/codicons';
import { Emitter } from 'vs/base/common/event';
import { KeyCode } from 'vs/base/common/keyCodes';
import { ThemeIcon } from 'vs/base/common/themables';
import 'vs/css!./media/modelSelectionWidgets';
import * as nls from 'vs/nls';
import { ModelProviderConfig, areLanguageModelItemsEqual, areProviderConfigsEqual, humanReadableProviderConfigKey, providersSupportingModel } from 'vs/platform/aiModel/common/aiModels';
import { IContextViewService } from 'vs/platform/contextview/browser/contextView';
import { defaultButtonStyles, defaultInputBoxStyles, defaultSelectBoxStyles } from 'vs/platform/theme/browser/defaultStyles';
import { asCssVariable, editorWidgetForeground, widgetShadow } from 'vs/platform/theme/common/colorRegistry';
import { registerIcon } from 'vs/platform/theme/common/iconRegistry';
import { isDark } from 'vs/platform/theme/common/theme';
import { IThemeService } from 'vs/platform/theme/common/themeService';
import { COMMAND_CENTER_BORDER } from 'vs/workbench/common/theme';
import { IModelSelectionEditingService } from 'vs/workbench/services/aiModel/common/aiModelEditing';
import { ModelSelectionEditorModel } from 'vs/workbench/services/preferences/browser/modelSelectionEditorModel';
import { IModelItemEntry, IProviderItem, IProviderItemEntry } from 'vs/workbench/services/preferences/common/preferences';

export const defaultModelIcon = registerIcon('default-model-icon', Codicon.debugBreakpointDataUnverified, nls.localize('defaultModelIcon', 'Icon for the default model.'));
export const invalidModelConfigIcon = registerIcon('invalid-model-config-icon', Codicon.warning, nls.localize('invalidModelConfigIcon', 'Icon for the invalid model configuration.'));
export const editModelWidgetCloseIcon = registerIcon('edit-model-widget-close-icon', Codicon.close, nls.localize('edit-model-widget-close-icon', 'Icon for the close button in the edit model widget.'));

export class EditModelConfigurationWidget extends Widget {
	private static readonly WIDTH = 480;
	private static readonly HEIGHT = 300;

	private _domNode: FastDomNode<HTMLElement>;
	private _contentContainer: HTMLElement;

	private _isVisible: boolean = false;
	private initialModelItemEntry: IModelItemEntry | null = null;
	private modelItemEntry: IModelItemEntry | null = null;

	private readonly title: HTMLElement;
	private readonly modelName: HTMLElement;
	private readonly fieldsContainer: HTMLElement;
	private readonly providerValue: SelectBox;
	private readonly contextLengthValue: InputBox;
	private readonly temperatureValueLabel: HTMLElement;
	private readonly temperatureValue: InputBox;
	private readonly cancelButton: Button;
	private readonly saveButton: Button;

	private fieldItems: HTMLElement[] = [];
	private _onHide = this._register(new Emitter<void>());

	constructor(
		parent: HTMLElement | null,
		@IContextViewService private readonly contextViewService: IContextViewService,
		@IThemeService private readonly _themeService: IThemeService,
		@IModelSelectionEditingService private readonly modelSelectionEditingService: IModelSelectionEditingService
	) {
		super();

		this._domNode = createFastDomNode(document.createElement('div'));
		this._domNode.setDisplay('none');
		this._domNode.setClassName('edit-model-widget');
		this._domNode.setWidth(EditModelConfigurationWidget.WIDTH);
		this._domNode.setHeight(EditModelConfigurationWidget.HEIGHT);
		this.onkeydown(this._domNode.domNode, (e) => {
			if (e.equals(KeyCode.Escape)) {
				this.hide();
			} else if (e.equals(KeyCode.Enter)) {
				this.save();
			}
		});

		this._contentContainer = dom.append(this._domNode.domNode, dom.$('.edit-model-widget-content'));
		const header = dom.append(this._contentContainer, dom.$('.edit-model-widget-header'));

		this.title = dom.append(header, dom.$('.message'));
		const closeIcon = dom.append(header, dom.$(`.close-icon${ThemeIcon.asCSSSelector(editModelWidgetCloseIcon)}}`));
		closeIcon.title = nls.localize('editModelConfiguration.close', "Close");
		this._register(dom.addDisposableListener(closeIcon, dom.EventType.CLICK, () => this.hide()));

		const body = dom.append(this._contentContainer, dom.$('.edit-model-widget-body'));
		const modelNameContainer = dom.append(body, dom.$('.edit-model-widget-model-name-container'));
		dom.append(modelNameContainer, dom.$(`.model-icon${ThemeIcon.asCSSSelector(defaultModelIcon)}}`));
		this.modelName = dom.append(modelNameContainer, dom.$('.edit-model-widget-model-name'));

		this.fieldsContainer = dom.append(body, dom.$('.edit-model-widget-grid'));

		const providerLabelContainer = dom.append(this.fieldsContainer, dom.$('.edit-model-widget-provider-label-container'));
		dom.append(providerLabelContainer, dom.$('span', undefined, nls.localize('editModelConfiguration.provider', "Provider")));
		dom.append(providerLabelContainer, dom.$('span.subtitle', undefined, nls.localize('editModelConfiguration.providerKey', "provider")));
		const providerSelectContainer = dom.append(this.fieldsContainer, dom.$('.edit-model-widget-provider-select-container'));
		this.providerValue = new SelectBox(<ISelectOptionItem[]>[], 0, this.contextViewService, defaultSelectBoxStyles, { ariaLabel: nls.localize('editModelConfiguration.providerValue', "Provider"), useCustomDrawn: true });
		this.providerValue.render(providerSelectContainer);

		const contextLengthLabelContainer = dom.append(this.fieldsContainer, dom.$('.edit-model-widget-context-length-label-container'));
		dom.append(contextLengthLabelContainer, dom.$('span', undefined, nls.localize('editModelConfiguration.contextLength', "Context length")));
		dom.append(contextLengthLabelContainer, dom.$('span.subtitle', undefined, nls.localize('editModelConfiguration.contextLengthKey', "contextLength")));
		this.contextLengthValue = this._register(new InputBox(this.fieldsContainer, this.contextViewService, { inputBoxStyles: defaultInputBoxStyles, type: 'number' }));
		this.contextLengthValue.element.classList.add('edit-model-widget-context-length');

		const temperatureLabelContainer = dom.append(this.fieldsContainer, dom.$('.edit-model-widget-temperature-label-container'));
		dom.append(temperatureLabelContainer, dom.$('span', undefined, nls.localize('editModelConfiguration.temperature', "Temperature")));
		dom.append(temperatureLabelContainer, dom.$('span.subtitle', undefined, nls.localize('editModelConfiguration.temperatureKey', "temperature")));
		const temperatureValueContainer = dom.append(this.fieldsContainer, dom.$('.edit-model-widget-temperature-container'));
		this.temperatureValueLabel = dom.append(temperatureValueContainer, dom.$('span'));
		this.temperatureValueLabel.style.textAlign = 'right';
		this.temperatureValue = this._register(new InputBox(temperatureValueContainer, this.contextViewService, { inputBoxStyles: defaultInputBoxStyles, type: 'range' }));
		this.temperatureValue.element.classList.add('edit-model-widget-temperature');
		this.temperatureValue.inputElement.min = '0';
		this.temperatureValue.inputElement.max = '2';
		this.temperatureValue.inputElement.step = '0.1';

		// Add save and cancel buttons
		const footerContainer = dom.append(this._contentContainer, dom.$('.edit-model-widget-footer'));
		this.cancelButton = this._register(new Button(footerContainer, {
			...defaultButtonStyles,
			title: nls.localize('editModelConfiguration.cancel', "Cancel"),
			secondary: true
		}));
		this.cancelButton.label = nls.localize('editModelConfiguration.cancel', "Cancel");
		this._register(this.cancelButton.onDidClick(() => this.hide()));

		this.saveButton = this._register(new Button(footerContainer, {
			...defaultButtonStyles,
			title: nls.localize('editModelConfiguration.save', "Save")
		}));
		this.saveButton.label = nls.localize('editModelConfiguration.save', "Save");
		this.saveButton.enabled = false;
		this._register(this.saveButton.onDidClick(async () => await this.save()));

		this.updateStyles();
		this._register(this._themeService.onDidColorThemeChange(() => {
			this.updateStyles();
		}));

		if (parent) {
			dom.append(parent, this._domNode.domNode);
		}
	}

	private updateStyles(): void {
		this._domNode.domNode.style.color = asCssVariable(editorWidgetForeground);
		this._domNode.domNode.style.border = `0.5px solid ${asCssVariable(COMMAND_CENTER_BORDER)}`;
		this._domNode.domNode.style.boxShadow = `0 0 8px 2px ${asCssVariable(widgetShadow)}`;
		this._domNode.domNode.style.backdropFilter = isDark(this._themeService.getColorTheme().type)
			? 'blur(20px) saturate(190%) contrast(70%) brightness(80%)' : 'blur(25px) saturate(190%) contrast(50%) brightness(130%)';
	}

	edit(entry: IModelItemEntry, providerItems: IProviderItem[]): Promise<null> {
		return Promises.withAsyncBody<null>(async (resolve) => {
			if (!this._isVisible) {
				this._isVisible = true;
				this._domNode.setDisplay('block');
				this.initialModelItemEntry = entry;
				this.modelItemEntry = entry;

				this.title.textContent = `Edit ${entry.modelItem.key}`;
				this.modelName.textContent = entry.modelItem.name;

				const supportedProviders = providersSupportingModel(entry.modelItem.key);
				const validProviders = providerItems.filter(providerItem => supportedProviders.includes(providerItem.type));
				this.providerValue.setOptions(validProviders.map(providerItem => ({ text: providerItem.name })));
				this.providerValue.select(validProviders.findIndex(provider => provider.name === entry.modelItem.provider.name));
				this._register(this.providerValue.onDidSelect((e) => {
					const provider = validProviders[e.index];
					this.updateModelItemEntry({
						...this.modelItemEntry!,
						modelItem: {
							...this.modelItemEntry!.modelItem,
							provider: provider,
							providerConfig: {
								type: provider.type,
								...(provider.type === 'azure-openai' ? { deploymentID: '' } : {})
							} as ModelProviderConfig
						}
					});
					this.renderProviderConfigFields(this.modelItemEntry!);
				}));

				this.renderProviderConfigFields(entry);

				this.focus();
			}
			const disposable = this._onHide.event(() => {
				disposable.dispose();
				resolve(null);
			});
		});
	}

	private renderProviderConfigFields(entry: IModelItemEntry): void {
		this.resetFieldItems();

		this.contextLengthValue.value = entry.modelItem.contextLength.toString();
		this._register(this.contextLengthValue.onDidChange((e) => {
			this.updateModelItemEntry({
				...this.modelItemEntry!,
				modelItem: {
					...this.modelItemEntry!.modelItem,
					contextLength: +e
				}
			});
		}));

		this.temperatureValueLabel.textContent = entry.modelItem.temperature.toString();
		this.temperatureValue.value = entry.modelItem.temperature.toString();
		this._register(this.temperatureValue.onDidChange((e) => {
			this.updateModelItemEntry({
				...this.modelItemEntry!,
				modelItem: {
					...this.modelItemEntry!.modelItem,
					temperature: +e
				}
			});
			this.temperatureValueLabel.textContent = e;
		}));

		Object.keys(entry.modelItem.providerConfig).filter(key => key !== 'type').forEach(key => {
			const fieldLabelContainer = dom.append(this.fieldsContainer, dom.$('.edit-model-widget-field-label-container'));
			this.fieldItems.push(fieldLabelContainer);
			dom.append(fieldLabelContainer, dom.$('span', undefined, humanReadableProviderConfigKey[key] ?? key));
			dom.append(fieldLabelContainer, dom.$('span.subtitle', undefined, key));
			const fieldValueContainer = dom.append(this.fieldsContainer, dom.$('.edit-model-widget-field-value-container'));
			this.fieldItems.push(fieldValueContainer);
			const fieldValue = new InputBox(fieldValueContainer, this.contextViewService, { inputBoxStyles: defaultInputBoxStyles });
			fieldValue.element.classList.add('edit-model-widget-field-value');
			fieldValue.value = entry.modelItem.providerConfig[key as keyof ModelProviderConfig].toString();
			this._register(fieldValue.onDidChange((e) => {
				this.updateModelItemEntry({
					modelItem: {
						...this.modelItemEntry!.modelItem,
						providerConfig: {
							...this.modelItemEntry!.modelItem.providerConfig,
							[key]: e
						}
					}
				});
			}));
		});

		const newRows = Object.keys(entry.modelItem.providerConfig).filter(key => key !== 'type').length;
		this._domNode.setHeight(EditModelConfigurationWidget.HEIGHT + newRows * 48);

		// Move all items with index > 5 between the provider and context length fields
		const gridItems = this.fieldsContainer.querySelectorAll('.edit-model-widget-grid > *');
		for (let i = 6; i < gridItems.length; i++) {
			this.fieldsContainer.insertBefore(gridItems[i], gridItems[2]);
		}

	}

	private resetFieldItems(): void {
		this.fieldItems.forEach((fieldItem) => {
			dom.reset(fieldItem, '');
			fieldItem.remove();
		});
		this.fieldItems = [];
	}

	layout(layout: dom.Dimension): void {
		const top = Math.round((layout.height - EditModelConfigurationWidget.HEIGHT) / 3);
		this._domNode.setTop(top);

		const left = Math.round((layout.width - EditModelConfigurationWidget.WIDTH) / 2);
		this._domNode.setLeft(left);
	}

	private updateModelItemEntry(updatedModelItemEntry: IModelItemEntry): void {
		this.modelItemEntry = updatedModelItemEntry;
		if (this.modelItemEntry) {
			const initialModelItem = ModelSelectionEditorModel.getLanguageModelItem(this.initialModelItemEntry!);
			const updatedModelItem = ModelSelectionEditorModel.getLanguageModelItem(this.modelItemEntry);
			if (areLanguageModelItemsEqual(initialModelItem, updatedModelItem)) {
				this.saveButton.enabled = false;
			} else {
				this.saveButton.enabled = true;
			}
		}
	}

	private focus(): void {
		this.providerValue.focus();
	}

	private hide(): void {
		this._domNode.setDisplay('none');
		this.resetFieldItems();
		this._isVisible = false;
		this._onHide.fire();
	}

	private async save(): Promise<void> {
		if (this.modelItemEntry) {
			const initialModelItem = ModelSelectionEditorModel.getLanguageModelItem(this.initialModelItemEntry!);
			const updatedModelItem = ModelSelectionEditorModel.getLanguageModelItem(this.modelItemEntry);
			if (areLanguageModelItemsEqual(initialModelItem, updatedModelItem)) {
				return;
			}

			await this.modelSelectionEditingService.editModelConfiguration(this.modelItemEntry.modelItem.key, {
				name: this.modelItemEntry.modelItem.name,
				contextLength: this.modelItemEntry.modelItem.contextLength,
				temperature: this.modelItemEntry.modelItem.temperature,
				provider: {
					type: this.modelItemEntry.modelItem.providerConfig.type,
					...(this.modelItemEntry.modelItem.providerConfig.type === 'azure-openai' ? { deploymentID: this.modelItemEntry.modelItem.providerConfig.deploymentID } : {})
				} as ModelProviderConfig
			});
			this.hide();
		}
	}
}

type EditableProviderItemEntry = { providerItem: { -readonly [P in keyof IProviderItem]: IProviderItem[P] } } | null;
export class EditProviderConfigurationWidget extends Widget {
	private static readonly WIDTH = 480;
	private static readonly HEIGHT = 140;

	private _domNode: FastDomNode<HTMLElement>;
	private _contentContainer: HTMLElement;

	private _isVisible: boolean = false;
	private initialProviderItemEntry: IProviderItemEntry | null = null;
	private providerItemEntry: EditableProviderItemEntry = null;

	private readonly title: HTMLElement;
	private readonly providerName: HTMLElement;
	private readonly fieldsContainer: HTMLElement;
	private readonly cancelButton: Button;
	private readonly saveButton: Button;

	private _onHide = this._register(new Emitter<void>());

	constructor(
		parent: HTMLElement | null,
		@IContextViewService private readonly contextViewService: IContextViewService,
		@IThemeService private readonly _themeService: IThemeService,
		@IModelSelectionEditingService private readonly modelSelectionEditingService: IModelSelectionEditingService
	) {
		super();

		this._domNode = createFastDomNode(document.createElement('div'));
		this._domNode.setDisplay('none');
		this._domNode.setClassName('edit-model-widget');
		this._domNode.setWidth(EditProviderConfigurationWidget.WIDTH);
		this._domNode.setHeight(EditProviderConfigurationWidget.HEIGHT);
		this.onkeydown(this._domNode.domNode, (e) => {
			if (e.equals(KeyCode.Escape)) {
				this.hide();
			} else if (e.equals(KeyCode.Enter)) {
				this.save();
			}
		});

		this._contentContainer = dom.append(this._domNode.domNode, dom.$('.edit-model-widget-content'));
		const header = dom.append(this._contentContainer, dom.$('.edit-model-widget-header'));

		this.title = dom.append(header, dom.$('.message'));
		const closeIcon = dom.append(header, dom.$(`.close-icon${ThemeIcon.asCSSSelector(editModelWidgetCloseIcon)}}`));
		closeIcon.title = nls.localize('editModelConfiguration.close', "Close");
		this._register(dom.addDisposableListener(closeIcon, dom.EventType.CLICK, () => this.hide()));

		const body = dom.append(this._contentContainer, dom.$('.edit-model-widget-body'));
		const providerNameContainer = dom.append(body, dom.$('.edit-model-widget-model-name-container'));
		dom.append(providerNameContainer, dom.$(`.provider-icon${ThemeIcon.asCSSSelector(defaultModelIcon)}}`));
		this.providerName = dom.append(providerNameContainer, dom.$('.edit-model-widget-model-name'));

		this.fieldsContainer = dom.append(body, dom.$('.edit-model-widget-grid'));

		// Add save and cancel buttons
		const footerContainer = dom.append(this._contentContainer, dom.$('.edit-model-widget-footer'));
		this.cancelButton = this._register(new Button(footerContainer, {
			...defaultButtonStyles,
			title: nls.localize('editModelConfiguration.cancel', "Cancel"),
			secondary: true
		}));
		this.cancelButton.label = nls.localize('editModelConfiguration.cancel', "Cancel");
		this._register(this.cancelButton.onDidClick(() => this.hide()));

		this.saveButton = this._register(new Button(footerContainer, {
			...defaultButtonStyles,
			title: nls.localize('editModelConfiguration.save', "Save")
		}));
		this.saveButton.label = nls.localize('editModelConfiguration.save', "Save");
		this.saveButton.enabled = false;
		this._register(this.saveButton.onDidClick(async () => await this.save()));

		this.updateStyles();
		this._register(this._themeService.onDidColorThemeChange(() => {
			this.updateStyles();
		}));

		if (parent) {
			dom.append(parent, this._domNode.domNode);
		}
	}

	private updateStyles(): void {
		this._domNode.domNode.style.color = asCssVariable(editorWidgetForeground);
		this._domNode.domNode.style.border = `0.5px solid ${asCssVariable(COMMAND_CENTER_BORDER)}`;
		this._domNode.domNode.style.boxShadow = `0 0 8px 2px ${asCssVariable(widgetShadow)}`;
		this._domNode.domNode.style.backdropFilter = isDark(this._themeService.getColorTheme().type)
			? 'blur(20px) saturate(190%) contrast(70%) brightness(80%)' : 'blur(25px) saturate(190%) contrast(50%) brightness(130%)';
	}

	edit(entry: IProviderItemEntry): Promise<null> {
		return Promises.withAsyncBody<null>(async (resolve) => {
			if (!this._isVisible) {
				this._isVisible = true;
				this._domNode.setDisplay('block');
				this.initialProviderItemEntry = entry;
				this.providerItemEntry = entry;
				this._domNode.setHeight(EditProviderConfigurationWidget.HEIGHT + Object.keys(entry.providerItem).filter(key => key !== 'type' && key !== 'name').length * 52);

				this.title.textContent = `Edit ${entry.providerItem.type}`;
				this.providerName.textContent = entry.providerItem.name;

				Object.keys(entry.providerItem).filter(key => key !== 'type' && key !== 'name').forEach(key => {
					const fieldLabelContainer = dom.append(this.fieldsContainer, dom.$('.edit-model-widget-field-label-container'));
					dom.append(fieldLabelContainer, dom.$('span', undefined, humanReadableProviderConfigKey[key] ?? key));
					dom.append(fieldLabelContainer, dom.$('span.subtitle', undefined, key));
					const fieldValueContainer = dom.append(this.fieldsContainer, dom.$('.edit-model-widget-field-value-container'));
					const fieldValue = new InputBox(fieldValueContainer, this.contextViewService, { inputBoxStyles: defaultInputBoxStyles });
					fieldValue.element.classList.add('edit-model-widget-field-value');
					fieldValue.value = entry.providerItem[key as keyof IProviderItem].toString();
					this._register(fieldValue.onDidChange((e) => {
						this.updateProviderItemEntry({
							...this.providerItemEntry!,
							providerItem: {
								...this.providerItemEntry!.providerItem,
								[key]: e
							}
						});
					}));
				});

				this.focus();
			}
			const disposable = this._onHide.event(() => {
				disposable.dispose();
				resolve(null);
			});
		});
	}

	layout(layout: dom.Dimension): void {
		const top = Math.round((layout.height - EditProviderConfigurationWidget.HEIGHT) / 3);
		this._domNode.setTop(top);

		const left = Math.round((layout.width - EditProviderConfigurationWidget.WIDTH) / 2);
		this._domNode.setLeft(left);
	}

	private updateProviderItemEntry(updatedProviderItemEntry: EditableProviderItemEntry): void {
		this.providerItemEntry = updatedProviderItemEntry;
		if (this.providerItemEntry) {
			const initialProviderConfig = ModelSelectionEditorModel.getProviderConfig(this.initialProviderItemEntry!);
			const updatedProviderConfig = ModelSelectionEditorModel.getProviderConfig(updatedProviderItemEntry as IProviderItemEntry);
			if (areProviderConfigsEqual(initialProviderConfig, updatedProviderConfig)) {
				this.saveButton.enabled = false;
			} else {
				this.saveButton.enabled = true;
			}
		}
	}

	private focus(): void {
		const firstInputBox = this.fieldsContainer.querySelector('input');
		if (firstInputBox) {
			firstInputBox.focus();
		}
	}

	private hide(): void {
		this._domNode.setDisplay('none');
		this._isVisible = false;
		dom.reset(this.fieldsContainer);
		this._onHide.fire();
	}

	private async save(): Promise<void> {
		if (this.providerItemEntry) {
			const initialProviderConfig = ModelSelectionEditorModel.getProviderConfig(this.initialProviderItemEntry!);
			const updatedProviderConfig = ModelSelectionEditorModel.getProviderConfig(this.providerItemEntry as IProviderItemEntry);
			if (areProviderConfigsEqual(initialProviderConfig, updatedProviderConfig)) {
				return;
			}

			await this.modelSelectionEditingService.editProviderConfiguration(this.providerItemEntry.providerItem.type, {
				name: this.providerItemEntry.providerItem.name,
				...Object.keys(this.providerItemEntry.providerItem).filter(key => key !== 'type' && key !== 'name').reduce((obj, key) => {
					obj[key] = this.providerItemEntry!.providerItem[key as keyof IProviderItem];
					return obj;
				}, {} as { [key: string]: string })
			} as IProviderItem);
			this.hide();
		}
	}
}
