/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Codicon } from '../../../../base/common/codicons.js';
import { MarkdownString } from '../../../../base/common/htmlContent.js';
import { getCodiconAriaLabel } from '../../../../base/common/iconLabels.js';
import { KeyChord, KeyCode, KeyMod } from '../../../../base/common/keyCodes.js';
import { Disposable, DisposableStore } from '../../../../base/common/lifecycle.js';
import { ThemeIcon } from '../../../../base/common/themables.js';
import * as nls from '../../../../nls.js';
import { Action2, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { IAIModelSelectionService, IModelProviders, ProviderConfig } from '../../../../platform/aiModel/common/aiModels.js';
import { KeybindingWeight } from '../../../../platform/keybinding/common/keybindingsRegistry.js';
import { IQuickInputService, IQuickPickItem, IQuickPickSeparator, QuickPickItem } from '../../../../platform/quickinput/common/quickInput.js';
import { IWorkbenchContribution } from '../../../common/contributions.js';
import { IModelSelectionEditingService } from '../../../services/aiModel/common/aiModelEditing.js';
import { getEditorModelItems } from '../../../services/preferences/browser/modelSelectionEditorModel.js';
import { isModelItemConfigComplete } from '../../../services/preferences/common/preferences.js';
import { IStatusbarEntry, IStatusbarEntryAccessor, StatusbarEntryKind } from '../../../services/statusbar/browser/statusbar.js';
import './media/modelSelectionIndicator.css';

export class ModelSelectionIndicator extends Disposable implements IWorkbenchContribution {
	static readonly SWITCH_MODEL_COMMAND_ID = 'workbench.action.modelSelection.switch';
	static readonly SWITCH_SLOW_MODEL_COMMAND_ID = 'workbench.action.modelSelection.switch.slow';

	private modelSelectionStatusEntry: IStatusbarEntryAccessor | undefined;

	constructor(
		@IQuickInputService private readonly quickInputService: IQuickInputService,
		@IAIModelSelectionService private readonly aiModelSelectionService: IAIModelSelectionService,
		@IModelSelectionEditingService private readonly modelSelectionEditingService: IModelSelectionEditingService,
	) {
		super();

		this._register(this.aiModelSelectionService.onDidChangeModelSelection(() => {
			this.renderModelSelectionStatusIndicator();
		}));

		this.registerActions();
		this.renderModelSelectionStatusIndicator();
	}

	private registerActions(): void {
		const category = { value: nls.localize('modelSelection.category', "Model Selection"), original: 'Model Selection' };

		const that = this;
		/*
		registerAction2(class extends Action2 {
			constructor() {
				super({
					id: ModelSelectionIndicator.SWITCH_MODEL_COMMAND_ID,
					category,
					title: nls.localize2('modelSelection.switch', "Switch Model"),
					f1: true,
					keybinding: {
						weight: KeybindingWeight.WorkbenchContrib,
						primary: KeyChord(KeyMod.CtrlCmd | KeyCode.KeyK, KeyMod.CtrlCmd | KeyCode.KeyM),
					}
				});
			}
			run = () => that.showModelSwitcher();
		});
		*/

		registerAction2(class extends Action2 {
			constructor() {
				super({
					id: ModelSelectionIndicator.SWITCH_MODEL_COMMAND_ID,
					category,
					title: nls.localize2('modelSelection.switch.slow', "Switch Model"),
					f1: true,
					keybinding: {
						weight: KeybindingWeight.WorkbenchContrib,
						primary: KeyChord(KeyMod.CtrlCmd | KeyCode.KeyK, KeyMod.CtrlCmd | KeyCode.KeyM),
					}
				});
			}
			run = () => that.showModelPicker('slowModel');
		});
	}

	private async renderModelSelectionStatusIndicator() {
		const modelSelection = await this.aiModelSelectionService.getModelSelectionSettings();
		const editorModelItems = getEditorModelItems(modelSelection);
		let text = '';
		let kind: StatusbarEntryKind = 'remote';
		if (isModelItemConfigComplete(editorModelItems.fastModel) && isModelItemConfigComplete(editorModelItems.slowModel)) {
			const slowModel = editorModelItems.slowModel.name;
			text = `$(debug-breakpoint-data-unverified) ${slowModel}`;
		} else {
			text = `$(error) Corrupt model configuration`;
			kind = 'error';
		}

		const tooltip = nls.localize('modelSelectionTooltipWithKeybinding', "Select language model");

		const properties: IStatusbarEntry = {
			name: nls.localize('modelSelection', "Model Selection"),
			kind,
			ariaLabel: getCodiconAriaLabel(text),
			text,
			tooltip,
			command: ModelSelectionIndicator.SWITCH_MODEL_COMMAND_ID
		};

		if (this.modelSelectionStatusEntry) {
			this.modelSelectionStatusEntry.update(properties);
		} else {
			// TODO(@ghostwriternr): Hide this from the status bar until we start using the model selection
			// this.modelSelectionStatusEntry = this.statusbarService.addEntry(properties, 'status.aiModelSelection', StatusbarAlignment.RIGHT, -Number.MAX_VALUE);
		}
	}

	/*
	private showModelSwitcher(): void {
		const quickPick = this.quickInputService.createQuickPick();
		quickPick.placeholder = nls.localize('modelSelectionPicker.placeholder', "Select model type");
		quickPick.title = nls.localize('modelSelectionPicker.title', "Select model type");
		quickPick.items = [
			{
				type: 'item',
				id: 'fastModel',
				// 4 spaces here to center the labels on the UI
				label: 'Copilot model    ',
				ariaLabel: 'Copilot model    ',
				tooltip: 'Copilot model'
			},
			{
				type: 'item',
				id: 'slowModel',
				label: 'Chat Model',
				ariaLabel: 'Chat Model',
				tooltip: 'Chat Model'
			}
		];
		quickPick.step = 1;
		quickPick.totalSteps = 2;
		quickPick.sortByLabel = false;
		quickPick.canSelectMany = false;
		this._register(quickPick.onDidAccept(() => {
			const item = quickPick.selectedItems[0];
			quickPick.hide();
			this.showModelPicker(item.id as 'fastModel' | 'slowModel');
		}));

		quickPick.show();
	}
	*/

	private async showModelPicker(type: 'fastModel' | 'slowModel'): Promise<void> {
		const computeItems = async (): Promise<QuickPickItem[]> => {
			const modelSelectionSettings = await this.aiModelSelectionService.getModelSelectionSettings();
			const editorModelItems = getEditorModelItems(modelSelectionSettings);

			const models = editorModelItems.modelItems
				.filter(model => isModelItemConfigComplete(model))
				.reduce((acc, model) => {
					acc[model.provider.type] = acc[model.provider.type] || [];
					acc[model.provider.type].push(model.key);
					return acc;
				}, {} as { [providerKey: string]: string[] });

			const items: QuickPickItem[] = Object.keys(models).map(providerKey => {
				const provider = modelSelectionSettings.providers[providerKey as keyof IModelProviders] as ProviderConfig;
				return [{
					type: 'separator',
					label: provider.name,
				} as IQuickPickSeparator,
				...models[providerKey].map(modelKey => {
					const model = modelSelectionSettings.models[modelKey as keyof typeof modelSelectionSettings.models];
					const provider = modelSelectionSettings.providers[model.provider.type as keyof IModelProviders] as ProviderConfig;

					const tooltip = new MarkdownString();
					tooltip.appendMarkdown(`### ${model.name}\n`);
					tooltip.appendMarkdown(`- **Provider**: ${provider.name}\n`);
					tooltip.appendMarkdown(`- **Context length**: ${model.contextLength}\n`);
					tooltip.appendMarkdown(`- **Temperature**: ${model.temperature}`);

					return {
						type: 'item',
						id: modelKey,
						label: model.name,
						ariaLabel: model.name,
						tooltip,
						iconClasses: ['model-selection-picker', modelSelectionSettings[type] === modelKey ? 'selected-model-icon' : 'model-icon'],
						buttons: [{
							iconClass: ThemeIcon.asClassName(Codicon.edit),
							tooltip: nls.localize('modelSelection.edit', "Edit"),
						}]
					} as IQuickPickItem;
				})];
			}).flat();
			return items;
		};

		const disposables = new DisposableStore();
		const quickPick = disposables.add(this.quickInputService.createQuickPick({ useSeparators: true }));
		// quickPick.placeholder = `Select ${type.replace('Model', '')} model`;
		// quickPick.title = `Select ${type.replace('Model', '')} model`;
		quickPick.placeholder = `Select model`;
		quickPick.title = `Select model`;
		quickPick.items = await computeItems();
		// quickPick.step = 2;
		// quickPick.totalSteps = 2;
		quickPick.sortByLabel = false;
		quickPick.canSelectMany = false;
		disposables.add(quickPick.onDidAccept(async () => {
			const item = quickPick.selectedItems[0];
			const modelKey = item.id as string;
			await this.modelSelectionEditingService.editModelSelection(type, modelKey);
			quickPick.hide();
			this.renderModelSelectionStatusIndicator();
		}));

		quickPick.show();
	}
}
