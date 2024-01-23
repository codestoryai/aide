/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Queue } from 'vs/base/common/async';
import * as json from 'vs/base/common/json';
import { setProperty } from 'vs/base/common/jsonEdit';
import { Edit } from 'vs/base/common/jsonFormatter';
import { Disposable, IReference } from 'vs/base/common/lifecycle';
import { EditOperation } from 'vs/editor/common/core/editOperation';
import { Range } from 'vs/editor/common/core/range';
import { Selection } from 'vs/editor/common/core/selection';
import { ITextModel } from 'vs/editor/common/model';
import { IResolvedTextEditorModel, ITextModelService } from 'vs/editor/common/services/resolverService';
import { localize } from 'vs/nls';
import { ILanguageModelItem, IModelProviders, IModelSelectionSettings, ProviderConfig, ProviderType, isLanguageModelItem, isModelProviderItem, isModelSelectionSettings, providerTypeValues } from 'vs/platform/aiModel/common/aiModels';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { IFileService } from 'vs/platform/files/common/files';
import { InstantiationType, registerSingleton } from 'vs/platform/instantiation/common/extensions';
import { createDecorator } from 'vs/platform/instantiation/common/instantiation';
import { ITextFileService } from 'vs/workbench/services/textfile/common/textfiles';
import { IUserDataProfileService } from 'vs/workbench/services/userDataProfile/common/userDataProfile';

type ModelType = 'slowModel' | 'fastModel';

export const IModelSelectionEditingService = createDecorator<IModelSelectionEditingService>('modelSelectionEditingService');
export interface IModelSelectionEditingService {
	readonly _serviceBrand: undefined;

	editModelSelection(type: ModelType, key: string): Promise<void>;

	addModelConfiguration(modelKey: string, newModelItem: ILanguageModelItem): Promise<void>;

	editModelConfiguration(modelKey: string, updateModelItem: ILanguageModelItem): Promise<void>;

	editProviderConfiguration(providerKey: string, providerItem: ProviderConfig): Promise<void>;

	cloneProviderConfiguration(existingProviderKey: string, newProviderKey: string): Promise<void>;
}

export class ModelSelectionEditingService extends Disposable implements IModelSelectionEditingService {
	public _serviceBrand: undefined;
	private queue: Queue<void>;

	constructor(
		@ITextModelService private readonly textModelResolverService: ITextModelService,
		@ITextFileService private readonly textFileService: ITextFileService,
		@IFileService private readonly fileService: IFileService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IUserDataProfileService private readonly userDataProfileService: IUserDataProfileService
	) {
		super();
		this.queue = new Queue<void>();
	}

	editModelSelection(type: ModelType, key: string): Promise<void> {
		return this.queue.queue(() => this.doEditModelSelection(type, key));
	}

	addModelConfiguration(modelKey: string, newModelItem: ILanguageModelItem): Promise<void> {
		return this.queue.queue(() => this.doEditModelConfiguration(modelKey, newModelItem, true));
	}

	editModelConfiguration(modelKey: string, updatedModelItem: ILanguageModelItem): Promise<void> {
		return this.queue.queue(() => this.doEditModelConfiguration(modelKey, updatedModelItem, false));
	}

	editProviderConfiguration(providerKey: string, providerItem: ProviderConfig): Promise<void> {
		return this.queue.queue(() => this.doEditProviderConfiguration(providerKey, providerItem));
	}

	cloneProviderConfiguration(existingProviderKey: string, newProviderKey: string): Promise<void> {
		return this.queue.queue(() => this.doCloneProviderConfiguration(existingProviderKey, newProviderKey));
	}

	private async doEditModelSelection(type: ModelType, key: string): Promise<void> {
		const reference = await this.resolveAndValidate();
		const textModel = reference.object.textEditorModel;
		const { tabSize, insertSpaces } = textModel.getOptions();
		const eol = textModel.getEOL();
		const edits = setProperty(textModel.getValue(), [type], key, { tabSize, insertSpaces, eol });
		if (edits.length > 0) {
			this.applyEditsToBuffer(edits[0], textModel);
		}
		try {
			await this.save();
		} finally {
			reference.dispose();
		}
	}

	private async doEditModelConfiguration(modelKey: string, modelItem: ILanguageModelItem, add: boolean): Promise<void> {
		const reference = await this.resolveAndValidate();
		const textModel = reference.object.textEditorModel;
		if (!isLanguageModelItem(modelItem)) {
			return;
		} else {
			this.updateModelConfiguration(modelKey, modelItem, textModel, add);
		}
		try {
			await this.save();
		} finally {
			reference.dispose();
		}
	}

	private async doEditProviderConfiguration(providerKey: string, providerItem: ProviderConfig): Promise<void> {
		const reference = await this.resolveAndValidate();
		const textModel = reference.object.textEditorModel;
		if (!isModelProviderItem(providerItem) || !providerTypeValues.includes(providerKey as ProviderType)) {
			return;
		} else {
			this.updateProviderConfiguration(providerKey, providerItem, textModel, false);
		}
		try {
			await this.save();
		} finally {
			reference.dispose();
		}
	}

	private async doCloneProviderConfiguration(existingProviderKey: string, newProviderKey: string): Promise<void> {
		const reference = await this.resolveAndValidate();
		const textModel = reference.object.textEditorModel;
		const userModelSelectionConfiguration = <IModelSelectionSettings>json.parse(textModel.getValue());
		if (providerTypeValues.includes(existingProviderKey as ProviderType) && userModelSelectionConfiguration.providers[existingProviderKey as keyof IModelProviders]) {
			const existingProviderItem = userModelSelectionConfiguration.providers[existingProviderKey as keyof IModelProviders] as ProviderConfig;
			this.updateProviderConfiguration(newProviderKey, existingProviderItem, textModel, true);
		}
		try {
			await this.save();
		} finally {
			reference.dispose();
		}
	}

	private save(): Promise<any> {
		return this.textFileService.save(this.userDataProfileService.currentProfile.modelSelectionResource);
	}

	private updateModelConfiguration(modelKey: string, modelItem: ILanguageModelItem, textModel: ITextModel, add: boolean): void {
		const { tabSize, insertSpaces } = textModel.getOptions();
		const eol = textModel.getEOL();
		if (add) {
			const edits = setProperty(textModel.getValue(), ['models', modelKey], modelItem, { tabSize, insertSpaces, eol });
			if (edits.length > 0) {
				this.applyEditsToBuffer(edits[0], textModel);
			}
		} else {
			this.applyEditsToBuffer(setProperty(textModel.getValue(), ['models', modelKey], modelItem, { tabSize, insertSpaces, eol })[0], textModel);
		}
	}

	private updateProviderConfiguration(providerKey: string, providerItem: ProviderConfig, textModel: ITextModel, add: boolean): void {
		const { tabSize, insertSpaces } = textModel.getOptions();
		const eol = textModel.getEOL();
		if (add) {
			const edits = setProperty(textModel.getValue(), ['providers', providerKey], providerItem, { tabSize, insertSpaces, eol });
			if (edits.length > 0) {
				this.applyEditsToBuffer(edits[0], textModel);
			}
		} else {
			this.applyEditsToBuffer(setProperty(textModel.getValue(), ['providers', providerKey], providerItem, { tabSize, insertSpaces, eol })[0], textModel);
		}
	}

	private applyEditsToBuffer(edit: Edit, model: ITextModel): void {
		const startPosition = model.getPositionAt(edit.offset);
		const endPosition = model.getPositionAt(edit.offset + edit.length);
		const range = new Range(startPosition.lineNumber, startPosition.column, endPosition.lineNumber, endPosition.column);
		const currentText = model.getValueInRange(range);
		const editOperation = currentText ? EditOperation.replace(range, edit.content) : EditOperation.insert(startPosition, edit.content);
		model.pushEditOperations([new Selection(startPosition.lineNumber, startPosition.column, startPosition.lineNumber, startPosition.column)], [editOperation], () => []);
	}

	private resolveModelReference(): Promise<IReference<IResolvedTextEditorModel>> {
		return this.fileService.exists(this.userDataProfileService.currentProfile.modelSelectionResource)
			.then(exists => {
				let EOL = this.configurationService.getValue<{ eol: string }>('files', { overrideIdentifier: 'json' })['eol'];
				if (EOL === 'auto') {
					EOL = '\n';
				}
				const result: Promise<any> = exists ? Promise.resolve(null) : this.textFileService.write(this.userDataProfileService.currentProfile.modelSelectionResource, this.getEmptyContent(EOL), { encoding: 'utf8' });
				return result.then(() => this.textModelResolverService.createModelReference(this.userDataProfileService.currentProfile.modelSelectionResource));
			});
	}

	private resolveAndValidate(): Promise<IReference<IResolvedTextEditorModel>> {

		// Target cannot be dirty if not writing into buffer
		if (this.textFileService.isDirty(this.userDataProfileService.currentProfile.modelSelectionResource)) {
			return Promise.reject(new Error(localize('errorModelSelectionFileDirty', "Unable to write because model selection file configuration file has unsaved changes. Please save it first and then try again.")));
		}

		return this.resolveModelReference()
			.then(reference => {
				const model = reference.object.textEditorModel;
				const EOL = model.getEOL();
				if (model.getValue()) {
					const parsed = this.parse(model);
					if (parsed.parseErrors.length) {
						reference.dispose();
						return Promise.reject<any>(new Error(localize('parseErrors', "Unable to write to the model selection configuration file. Please open it to correct errors/warnings in the file and try again.")));
					}
					if (parsed.result) {
						if (!isModelSelectionSettings(parsed.result)) {
							reference.dispose();
							return Promise.reject<any>(new Error(localize('errorInvalidConfiguration', "Unable to write to the model selection configuration file. Please open it to correct errors/warnings in the file and try again.")));
						}
					} else {
						const content = EOL + '{}';
						this.applyEditsToBuffer({ content, length: content.length, offset: model.getValue().length }, model);
					}
				} else {
					const content = this.getEmptyContent(EOL);
					this.applyEditsToBuffer({ content, length: content.length, offset: 0 }, model);
				}
				return reference;
			});
	}

	private parse(model: ITextModel): { result: IModelSelectionSettings; parseErrors: json.ParseError[] } {
		const parseErrors: json.ParseError[] = [];
		const result = json.parse(model.getValue(), parseErrors, { allowTrailingComma: true, allowEmptyContent: true });
		return { result, parseErrors };
	}

	private getEmptyContent(EOL: string): string {
		return '// ' + localize('emptyModelSelectionHeader', "Place your model selections in this file to override the defaults") + EOL + '{}';
	}
}

registerSingleton(IModelSelectionEditingService, ModelSelectionEditingService, InstantiationType.Delayed);
