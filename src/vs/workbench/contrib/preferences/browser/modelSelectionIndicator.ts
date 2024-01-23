/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Codicon } from 'vs/base/common/codicons';
import { MarkdownString } from 'vs/base/common/htmlContent';
import { getCodiconAriaLabel } from 'vs/base/common/iconLabels';
import { KeyChord, KeyCode, KeyMod } from 'vs/base/common/keyCodes';
import { Disposable } from 'vs/base/common/lifecycle';
import { ThemeIcon } from 'vs/base/common/themables';
import 'vs/css!./media/ModelSelectionIndicator';
import * as nls from 'vs/nls';
import { Action2, registerAction2 } from 'vs/platform/actions/common/actions';
import { IAIModelSelectionService, IModelProviders, ProviderConfig } from 'vs/platform/aiModel/common/aiModels';
import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';
import { KeybindingWeight } from 'vs/platform/keybinding/common/keybindingsRegistry';
import { IQuickInputService, IQuickPickItem, IQuickPickSeparator, QuickPickItem } from 'vs/platform/quickinput/common/quickInput';
import { IWorkbenchContribution } from 'vs/workbench/common/contributions';
import { IModelSelectionEditingService } from 'vs/workbench/services/aiModel/common/aiModelEditing';
import { getEditorModelItems } from 'vs/workbench/services/preferences/browser/modelSelectionEditorModel';
import { isModelItemConfigComplete } from 'vs/workbench/services/preferences/common/preferences';
import { IStatusbarEntry, IStatusbarEntryAccessor, IStatusbarService, StatusbarAlignment, StatusbarEntryKind } from 'vs/workbench/services/statusbar/browser/statusbar';

export class ModelSelectionIndicator extends Disposable implements IWorkbenchContribution {
	private static readonly SWITCH_MODEL_COMMAND_ID = 'workbench.action.modelSelection.switch';

	private modelSelectionStatusEntry: IStatusbarEntryAccessor | undefined;

	constructor(
		@IStatusbarService private readonly statusbarService: IStatusbarService,
		@IQuickInputService private readonly quickInputService: IQuickInputService,
		@IKeybindingService private readonly keybindingService: IKeybindingService,
		@IAIModelSelectionService private readonly aiModelSelectionService: IAIModelSelectionService,
		@IModelSelectionEditingService private readonly modelSelectionEditingService: IModelSelectionEditingService
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
		registerAction2(class extends Action2 {
			constructor() {
				super({
					id: ModelSelectionIndicator.SWITCH_MODEL_COMMAND_ID,
					category,
					title: { value: nls.localize('modelSelection.switch', "Switch Model"), original: 'Switch Model' },
					f1: true,
					keybinding: {
						weight: KeybindingWeight.WorkbenchContrib,
						primary: KeyChord(KeyMod.CtrlCmd | KeyCode.KeyK, KeyMod.CtrlCmd | KeyCode.KeyM),
					}
				});
			}
			run = () => that.showModelSwitcher();
		});
	}

	private async renderModelSelectionStatusIndicator() {
		const modelSelection = await this.aiModelSelectionService.getModelSelectionSettings();
		const editorModelItems = getEditorModelItems(modelSelection);
		let text = '';
		let kind: StatusbarEntryKind = 'remote';
		if (isModelItemConfigComplete(editorModelItems.fastModel) && isModelItemConfigComplete(editorModelItems.slowModel)) {
			const fastModel = editorModelItems.fastModel.name;
			const slowModel = editorModelItems.slowModel.name;
			text = `$(debug-breakpoint-data-unverified) ${fastModel} / ${slowModel}`;
		} else {
			text = `$(error) Corrupt model configuration`;
			kind = 'error';
		}

		const keybindinLabel = this.keybindingService.lookupKeybinding(ModelSelectionIndicator.SWITCH_MODEL_COMMAND_ID)?.getLabel();
		const tooltip = nls.localize('modelSelectionTooltipWithKeybinding', "Select language model ({0})", keybindinLabel);

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
			this.modelSelectionStatusEntry = this.statusbarService.addEntry(properties, 'status.aiModelSelection', StatusbarAlignment.RIGHT, -Number.MAX_VALUE);
		}
	}

	private showModelSwitcher(): void {
		const quickPick = this.quickInputService.createQuickPick();
		quickPick.placeholder = nls.localize('modelSelectionPicker.placeholder', "Select model type");
		quickPick.title = nls.localize('modelSelectionPicker.title', "Select model type");
		quickPick.items = [
			{
				type: 'item',
				id: 'fastModel',
				label: 'Fast',
				ariaLabel: 'Fast',
				tooltip: 'Fast model'
			},
			{
				type: 'item',
				id: 'slowModel',
				label: 'Slow',
				ariaLabel: 'Slow',
				tooltip: 'Slow model'
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

		const quickPick = this.quickInputService.createQuickPick();
		quickPick.placeholder = `Select ${type.replace('Model', '')} model`;
		quickPick.title = `Select ${type.replace('Model', '')} model`;
		quickPick.items = await computeItems();
		quickPick.step = 2;
		quickPick.totalSteps = 2;
		quickPick.sortByLabel = false;
		quickPick.canSelectMany = false;
		this._register(quickPick.onDidAccept(async () => {
			const item = quickPick.selectedItems[0];
			const modelKey = item.id as string;
			await this.modelSelectionEditingService.editModelSelection(type, modelKey);
			quickPick.hide();
			this.renderModelSelectionStatusIndicator();
		}));

		quickPick.show();
	}
}
