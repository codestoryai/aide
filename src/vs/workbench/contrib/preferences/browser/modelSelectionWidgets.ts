/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as dom from '../../../../base/browser/dom.js';
import { FastDomNode, createFastDomNode } from '../../../../base/browser/fastDomNode.js';
import { Button } from '../../../../base/browser/ui/button/button.js';
import { InputBox } from '../../../../base/browser/ui/inputbox/inputBox.js';
import { ISelectOptionItem, SelectBox } from '../../../../base/browser/ui/selectBox/selectBox.js';
import { Widget } from '../../../../base/browser/ui/widget.js';
import { Promises } from '../../../../base/common/async.js';
import { CancellationTokenSource } from '../../../../base/common/cancellation.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { Emitter } from '../../../../base/common/event.js';
import { KeyCode } from '../../../../base/common/keyCodes.js';
import { equals } from '../../../../base/common/objects.js';
import { ThemeIcon } from '../../../../base/common/themables.js';
import * as nls from '../../../../nls.js';
import { IAIModelSelectionService, ModelProviderConfig, ProviderConfig, defaultModelSelectionSettings, humanReadableModelConfigKey, humanReadableProviderConfigKey, modelConfigKeyDescription } from '../../../../platform/aiModel/common/aiModels.js';
import { IContextViewService } from '../../../../platform/contextview/browser/contextView.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { defaultButtonStyles, defaultInputBoxStyles, defaultSelectBoxStyles } from '../../../../platform/theme/browser/defaultStyles.js';
import { asCssVariable, editorWidgetForeground, widgetShadow } from '../../../../platform/theme/common/colorRegistry.js';
import { registerIcon } from '../../../../platform/theme/common/iconRegistry.js';
import { isDark } from '../../../../platform/theme/common/theme.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { COMMAND_CENTER_BORDER } from '../../../common/theme.js';
import { checkIfDefaultModel } from '../../../services/aiModel/browser/aiModelService.js';
import { IModelSelectionEditingService } from '../../../services/aiModel/common/aiModelEditing.js';
import { ModelSelectionEditorModel } from '../../../services/preferences/browser/modelSelectionEditorModel.js';
import { IModelItemEntry, IProviderItem, IProviderItemEntry, isModelItemConfigComplete, isProviderItemConfigComplete } from '../../../services/preferences/common/preferences.js';
import './media/modelSelectionWidgets.css';

export const defaultModelIcon = registerIcon('default-model-icon', Codicon.debugBreakpointDataUnverified, nls.localize('defaultModelIcon', 'Icon for the default model.'));
export const invalidModelConfigIcon = registerIcon('invalid-model-config-icon', Codicon.warning, nls.localize('invalidModelConfigIcon', 'Icon for the invalid model configuration.'));
export const editModelWidgetCloseIcon = registerIcon('edit-model-widget-close-icon', Codicon.close, nls.localize('edit-model-widget-close-icon', 'Icon for the close button in the edit model widget.'));

export class EditModelConfigurationWidget extends Widget {
	private _domNode: FastDomNode<HTMLElement>;
	private _contentContainer!: HTMLElement;

	private _isVisible: boolean = false;
	private initialModelItemEntry: IModelItemEntry | null = null;
	private modelItemEntry: IModelItemEntry | null = null;

	private currentMode: 'edit' | 'add' = 'edit';

	private title!: HTMLElement;
	private modelName!: InputBox;
	private fieldsContainer!: HTMLElement;
	private providerValue!: SelectBox;
	private modelIdValue!: InputBox;
	private contextLengthValue!: InputBox;
	private temperatureValueLabel!: HTMLElement;
	private temperatureValue!: InputBox;
	private cancelButton!: Button;
	private saveButton!: Button;
	private messageArea!: HTMLElement;

	private fieldItems: HTMLElement[] = [];
	private _onHide = this._register(new Emitter<void>());

	private parentDimension: dom.Dimension | null = null;

	constructor(
		parent: HTMLElement | null,
		@IContextViewService private readonly contextViewService: IContextViewService,
		@IThemeService private readonly _themeService: IThemeService,
		@IModelSelectionEditingService private readonly modelSelectionEditingService: IModelSelectionEditingService,
		@IAIModelSelectionService private readonly aiModelSelectionService: IAIModelSelectionService,
		@IInstantiationService private readonly instantiationService: IInstantiationService
	) {
		super();

		this._domNode = createFastDomNode(document.createElement('div'));
		this._domNode.setDisplay('none');
		this._domNode.setClassName('edit-model-widget');
		this.onkeydown(this._domNode.domNode, (e) => {
			if (e.equals(KeyCode.Escape)) {
				this.hide();
			} else if (e.equals(KeyCode.Enter)) {
				this.save();
			}
		});

		this.render();
		this.updateStyles();
		this._register(this._themeService.onDidColorThemeChange(() => {
			this.updateStyles();
		}));

		if (parent) {
			dom.append(parent, this._domNode.domNode);
		}
	}

	private render() {
		this._contentContainer = dom.append(this._domNode.domNode, dom.$('.edit-model-widget-content'));
		const header = dom.append(this._contentContainer, dom.$('.edit-model-widget-header'));

		this.title = dom.append(header, dom.$('.message'));
		const closeIcon = dom.append(header, dom.$(`.close-icon${ThemeIcon.asCSSSelector(editModelWidgetCloseIcon)}}`));
		closeIcon.title = nls.localize('editModelConfiguration.close', "Close");
		this._register(dom.addDisposableListener(closeIcon, dom.EventType.CLICK, () => this.hide()));

		const body = dom.append(this._contentContainer, dom.$('.edit-model-widget-body'));
		const modelNameContainer = dom.append(body, dom.$('.edit-model-widget-model-name-container'));
		dom.append(modelNameContainer, dom.$(`.model-icon${ThemeIcon.asCSSSelector(defaultModelIcon)}}`));
		this.modelName = this._register(new InputBox(modelNameContainer, this.contextViewService, { inputBoxStyles: { ...defaultInputBoxStyles, inputBackground: undefined, inputBorder: 'transparent' } }));
		this._register(this.modelName.onDidChange((e) => {
			this.updateModelItemEntry({
				...this.modelItemEntry!,
				modelItem: {
					...this.modelItemEntry!.modelItem,
					name: e
				}
			});
		}));
		this.modelName.setPlaceHolder(nls.localize('editModelConfiguration.modelNamePlaceholder', "Enter a human-readable name for the model"));
		this.modelName.element.style.width = '100%';
		this.modelName.element.classList.add('edit-model-widget-model-name');

		this.fieldsContainer = dom.append(body, dom.$('.edit-model-widget-grid'));

		const providerLabelContainer = dom.append(this.fieldsContainer, dom.$('.edit-model-widget-provider-label-container'));
		dom.append(providerLabelContainer, dom.$('span', undefined, nls.localize('editModelConfiguration.provider', "Provider")));
		dom.append(providerLabelContainer, dom.$('span.subtitle', undefined, modelConfigKeyDescription['provider']));
		const providerSelectContainer = dom.append(this.fieldsContainer, dom.$('.edit-model-widget-provider-select-container'));
		this.providerValue = new SelectBox(<ISelectOptionItem[]>[], 0, this.contextViewService, defaultSelectBoxStyles, { ariaLabel: nls.localize('editModelConfiguration.providerValue', "Provider"), useCustomDrawn: true });
		this.providerValue.render(providerSelectContainer);

		const modelIdLabelContainer = dom.append(this.fieldsContainer, dom.$('.edit-model-widget-model-id-container'));
		dom.append(modelIdLabelContainer, dom.$('span', undefined, nls.localize('editModelConfiguration.modelId', "Model ID")));
		dom.append(modelIdLabelContainer, dom.$('span.subtitle', undefined, modelConfigKeyDescription['modelId']));
		this.modelIdValue = this._register(new InputBox(this.fieldsContainer, this.contextViewService, { inputBoxStyles: defaultInputBoxStyles }));
		this.modelIdValue.element.classList.add('edit-model-widget-model-id');

		const contextLengthLabelContainer = dom.append(this.fieldsContainer, dom.$('.edit-model-widget-context-length-label-container'));
		dom.append(contextLengthLabelContainer, dom.$('span', undefined, nls.localize('editModelConfiguration.contextLength', "Context length")));
		dom.append(contextLengthLabelContainer, dom.$('span.subtitle', undefined, modelConfigKeyDescription['contextLength']));
		this.contextLengthValue = this._register(new InputBox(this.fieldsContainer, this.contextViewService, { inputBoxStyles: defaultInputBoxStyles, type: 'number' }));
		this.contextLengthValue.element.classList.add('edit-model-widget-context-length');

		const temperatureLabelContainer = dom.append(this.fieldsContainer, dom.$('.edit-model-widget-temperature-label-container'));
		dom.append(temperatureLabelContainer, dom.$('span', undefined, nls.localize('editModelConfiguration.temperature', "Temperature")));
		dom.append(temperatureLabelContainer, dom.$('span.subtitle', undefined, modelConfigKeyDescription['temperature']));
		const temperatureValueContainer = dom.append(this.fieldsContainer, dom.$('.edit-model-widget-temperature-container'));
		this.temperatureValueLabel = dom.append(temperatureValueContainer, dom.$('span'));
		this.temperatureValueLabel.style.textAlign = 'right';
		this.temperatureValue = this._register(new InputBox(temperatureValueContainer, this.contextViewService, { inputBoxStyles: defaultInputBoxStyles, type: 'range' }));
		this.temperatureValue.element.classList.add('edit-model-widget-temperature');
		this.temperatureValue.inputElement.min = '0';
		this.temperatureValue.inputElement.max = '2';
		this.temperatureValue.inputElement.step = '0.1';

		// Validation messages aside
		this.messageArea = dom.append(this._contentContainer, dom.$('aside.validation-messages-aside'));

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
		this._register(this.saveButton.onDidClick(async () => await this.save()));

		this.layout();
	}

	private updateStyles(): void {
		this._domNode.domNode.style.color = asCssVariable(editorWidgetForeground);
		this._domNode.domNode.style.border = `0.5px solid ${asCssVariable(COMMAND_CENTER_BORDER)}`;
		this._domNode.domNode.style.boxShadow = `0 0 8px 2px ${asCssVariable(widgetShadow)}`;
		this._domNode.domNode.style.backdropFilter = isDark(this._themeService.getColorTheme().type)
			? 'blur(20px) saturate(190%) contrast(70%) brightness(80%)' : 'blur(25px) saturate(190%) contrast(50%) brightness(130%)';
	}

	add(providerItems: IProviderItem[]): Promise<null> {
		const defaultModelItemEntry: IModelItemEntry = {
			modelItem: {
				key: '',
				name: '',
				contextLength: 128000,
				temperature: 0.2,
				providerConfig: { type: 'open-router' },
				provider: providerItems.find(providerItem => providerItem.name === 'Open Router')!
			}
		};

		return Promises.withAsyncBody<null>(async (resolve) => {
			this.currentMode = 'add';
			if (!this._isVisible) {
				this._isVisible = true;
				this._domNode.setDisplay('block');
				this.initialModelItemEntry = defaultModelItemEntry;
				this.modelItemEntry = defaultModelItemEntry;

				this.title.textContent = 'Configure model';
				this.modelName.value = defaultModelItemEntry.modelItem.name;

				const validProviders = providerItems.filter(providerItem => providerItem.name !== 'CodeStory');
				this.registerProviders(validProviders, 'Open Router');

				this.renderProviderConfigFields(defaultModelItemEntry);
				this.focus();
			}
			const disposable = this._onHide.event(() => {
				disposable.dispose();
				resolve(null);
			});
		});
	}

	edit(entry: IModelItemEntry, providerItems: IProviderItem[]): Promise<null> {
		return Promises.withAsyncBody<null>(async (resolve) => {
			this.currentMode = 'edit';
			if (!this._isVisible) {
				this._isVisible = true;
				this._domNode.setDisplay('block');
				this.initialModelItemEntry = entry;
				this.modelItemEntry = entry;

				this.title.textContent = 'Configure model';
				this.modelName.value = entry.modelItem.name;

				this.registerProviders(providerItems, entry.modelItem.provider.name);

				this.renderProviderConfigFields(entry);
				this.focus();
			}
			const disposable = this._onHide.event(() => {
				disposable.dispose();
				resolve(null);
			});
		});
	}

	private registerProviders(providers: IProviderItem[], defaultProviderName: ProviderConfig['name']): void {
		this.providerValue.setOptions(providers.map(providerItem => {
			const isProviderConfigComplete = isProviderItemConfigComplete(providerItem);
			return {
				text: providerItem.name,
				decoratorRight: isProviderConfigComplete ? '' : 'Not configured',
				isDisabled: !isProviderConfigComplete
			};
		}));
		this.providerValue.select(providers.findIndex(provider => provider.name === defaultProviderName));
		this._register(this.providerValue.onDidSelect((e) => {
			const provider = providers[e.index];
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
	}

	private renderProviderConfigFields(entry: IModelItemEntry): void {
		this.resetFieldItems();

		this.modelIdValue.value = entry.modelItem.key;
		this._register(this.modelIdValue.onDidChange((e) => {
			this.updateModelItemEntry({
				...this.modelItemEntry!,
				modelItem: {
					...this.modelItemEntry!.modelItem,
					key: e
				}
			});
		}));

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
			dom.append(fieldLabelContainer, dom.$('span', undefined, humanReadableModelConfigKey[key] ?? key));
			dom.append(fieldLabelContainer, dom.$('span.subtitle', undefined, modelConfigKeyDescription[key] ?? key));
			const fieldValueContainer = dom.append(this.fieldsContainer, dom.$('.edit-model-widget-field-value-container'));
			this.fieldItems.push(fieldValueContainer);
			const fieldValue = new InputBox(fieldValueContainer, this.contextViewService, { inputBoxStyles: defaultInputBoxStyles });
			fieldValue.element.classList.add('edit-model-widget-field-value');
			fieldValue.value = entry.modelItem.providerConfig[key as keyof ModelProviderConfig]?.toString() ?? '';
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

		// Move all items with index > 7 between the provider and context length fields
		const gridItems = this.fieldsContainer.querySelectorAll('.edit-model-widget-grid > *');
		for (let i = 8; i < gridItems.length; i++) {
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

	layout(dimensions?: dom.Dimension | null): void {
		const parentDimensions = this.parentDimension = dimensions ?? this.parentDimension;
		if (!parentDimensions) {
			return;
		}

		const top = Math.round((parentDimensions.height - this._domNode.domNode.offsetHeight) / 3);
		this._domNode.setTop(top);

		const left = Math.round((parentDimensions.width - this._domNode.domNode.offsetWidth) / 2);
		this._domNode.setLeft(left);
	}

	private updateModelItemEntry(updatedModelItemEntry: IModelItemEntry): void {
		this.modelItemEntry = updatedModelItemEntry;
		if (this.modelItemEntry) {
			const initialModelItem = this.initialModelItemEntry!;
			const updatedModelItem = this.modelItemEntry;
			if (equals(initialModelItem, updatedModelItem)) {
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
		this.saveButton.enabled = true;
		this._onHide.fire();
	}

	private async save(): Promise<void> {
		this.saveButton.enabled = false;
		if (this.modelItemEntry) {
			const initialModelItem = this.initialModelItemEntry!.modelItem;
			const updatedModelItem = this.modelItemEntry.modelItem;

			const isProviderComplete = isProviderItemConfigComplete(updatedModelItem.provider);
			if (!isProviderComplete) {
				this.messageArea.textContent = nls.localize('editModelConfiguration.incompleteProviderConfiguration', "The provider configuration for {0} is incomplete. Please complete the provider configuration.", updatedModelItem.provider.name);
				this.saveButton.enabled = true;
				return;
			}

			const isComplete = isModelItemConfigComplete(updatedModelItem);
			if (!isComplete) {
				this.messageArea.textContent = nls.localize('editModelConfiguration.incompleteConfiguration', "The configuration is incomplete. Please complete the configuration.");
				this.saveButton.enabled = true;
				return;
			}
			const isDefaultModelId = checkIfDefaultModel(updatedModelItem.key);
			if (isDefaultModelId) {
				const takenDefaultModel = defaultModelSelectionSettings.models[updatedModelItem.key];
				this.messageArea.textContent = nls.localize('editModelConfiguration.cantEditDefaultModel', "You can't edit a default model. Please use \"{0}\" as provided in the model list.", takenDefaultModel.name);
				this.saveButton.enabled = true;
				return;
			}

			const [isModelIdTaken, takenModel] = await this.aiModelSelectionService.checkIfModelIdIsTaken(updatedModelItem.key);

			if (isModelIdTaken && takenModel.name !== initialModelItem.name) {
				this.messageArea.textContent = nls.localize('editModelConfiguration.modelIdTaken', "The model id is already taken, refer to the existing model \"{0}\" to edit it.", takenModel.name);
				this.saveButton.enabled = true;
				return;
			}
			const modelSelectionSettings = await this.aiModelSelectionService.getValidatedModelSelectionSettings();
			const cancellationTokenSource = this._register(this.instantiationService.createInstance(CancellationTokenSource));

			const previousSlowModel = modelSelectionSettings.slowModel;
			// Temporarily set as active model
			await this.modelSelectionEditingService.editModelSelection('slowModel', updatedModelItem.key);
			// Check if it's valid
			const configValidation = await this.aiModelSelectionService.validateModelConfiguration(modelSelectionSettings, cancellationTokenSource.token);
			// Reset the previous slow model
			await this.modelSelectionEditingService.editModelSelection('slowModel', previousSlowModel);

			if (!configValidation.valid) {
				this.messageArea.textContent = nls.localize('editModelConfiguration.modelConfigError', "There is an issue with your \`modelSelection.json\`: \"{0}\"", configValidation.error || 'Invalid configuration');
				this.saveButton.enabled = true;
				return;
			}

			if (equals(initialModelItem, updatedModelItem)) {
				return this.hide();
			}

			const lmItem = {
				name: updatedModelItem.name,
				contextLength: updatedModelItem.contextLength,
				temperature: updatedModelItem.temperature,
				provider: {
					type: updatedModelItem.providerConfig.type,
					...(updatedModelItem.providerConfig.type === 'azure-openai' ? { deploymentID: updatedModelItem.providerConfig.deploymentID } : {})
				} as ModelProviderConfig
			};

			if (this.currentMode === 'add') {
				await this.modelSelectionEditingService.addModelConfiguration(updatedModelItem.key, lmItem);
			} else if (initialModelItem.key !== updatedModelItem.key) {
				await this.modelSelectionEditingService.updateModelConfigurationKey(initialModelItem.key, updatedModelItem.key);
				await this.modelSelectionEditingService.editModelConfiguration(updatedModelItem.key, lmItem);
			} else {
				await this.modelSelectionEditingService.editModelConfiguration(updatedModelItem.key, lmItem);
			}
			// Set new edited model as active one if all goes well
			// Temporarily set as active model
			await this.modelSelectionEditingService.editModelSelection('slowModel', updatedModelItem.key);

			this.saveButton.enabled = true;
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
			title: nls.localize('editProviderConfiguration.save', "Save")
		}));
		this.saveButton.label = nls.localize('editProviderConfiguration.save', "Save");
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
			if (equals(initialProviderConfig, updatedProviderConfig)) {
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
			if (equals(initialProviderConfig, updatedProviderConfig)) {
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
