/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { VSBuffer } from 'vs/base/common/buffer';
import { localize } from 'vs/nls';
import { FileOperationError, FileOperationResult, IFileService } from 'vs/platform/files/common/files';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { ILogService } from 'vs/platform/log/common/log';
import { IUriIdentityService } from 'vs/platform/uriIdentity/common/uriIdentity';
import { IUserDataProfile, ProfileResourceType } from 'vs/platform/userDataProfile/common/userDataProfile';
import { API_OPEN_EDITOR_COMMAND_ID } from 'vs/workbench/browser/parts/editor/editorCommands';
import { ITreeItemCheckboxState, TreeItemCollapsibleState } from 'vs/workbench/common/views';
import { IProfileResource, IProfileResourceChildTreeItem, IProfileResourceInitializer, IProfileResourceTreeItem, IUserDataProfileService } from 'vs/workbench/services/userDataProfile/common/userDataProfile';

interface IModelSelectionResourceContent {
	modelSelection: string | null;
}

export class ModelSelectionResourceInitializer implements IProfileResourceInitializer {
	constructor(
		@IUserDataProfileService private readonly userDataProfileService: IUserDataProfileService,
		@IFileService private readonly fileService: IFileService,
		@ILogService private readonly logService: ILogService,
	) {
	}

	async initialize(content: string): Promise<void> {
		const modelSelectionContent: IModelSelectionResourceContent = JSON.parse(content);
		if (modelSelectionContent.modelSelection === null) {
			this.logService.info(`Initializing Profile: No model selections to apply...`);
			return;
		}
		await this.fileService.writeFile(this.userDataProfileService.currentProfile.modelSelectionResource, VSBuffer.fromString(modelSelectionContent.modelSelection));
	}
}

export class ModelSelectionResource implements IProfileResource {
	constructor(
		@IFileService private readonly fileService: IFileService,
		@ILogService private readonly logService: ILogService,
	) {
	}

	async getContent(profile: IUserDataProfile): Promise<string> {
		const modelSelectionContent = await this.getModelSelectionResourceContent(profile);
		return JSON.stringify(modelSelectionContent);
	}

	async getModelSelectionResourceContent(profile: IUserDataProfile): Promise<IModelSelectionResourceContent> {
		const modelSelection = await this.getModelSelectionContent(profile);
		return { modelSelection };
	}

	async apply(content: string, profile: IUserDataProfile): Promise<void> {
		const modelSelectionContent: IModelSelectionResourceContent = JSON.parse(content);
		if (modelSelectionContent.modelSelection === null) {
			this.logService.info(`Importing Profile (${profile.name}): No model selections to apply...`);
			return;
		}
		await this.fileService.writeFile(profile.modelSelectionResource, VSBuffer.fromString(modelSelectionContent.modelSelection));
	}

	private async getModelSelectionContent(profile: IUserDataProfile): Promise<string | null> {
		try {
			const content = await this.fileService.readFile(profile.modelSelectionResource);
			return content.value.toString();
		} catch (error) {
			// File not found
			if (error instanceof FileOperationError && error.fileOperationResult === FileOperationResult.FILE_NOT_FOUND) {
				return null;
			} else {
				throw error;
			}
		}
	}
}

export class ModelSelectionResourceTreeItem implements IProfileResourceTreeItem {

	readonly type = ProfileResourceType.ModelSelection;
	readonly handle = ProfileResourceType.ModelSelection;
	readonly label = { label: localize('modelSelection', "Model Selection") };
	readonly collapsibleState = TreeItemCollapsibleState.Expanded;
	checkbox: ITreeItemCheckboxState | undefined;

	constructor(
		private readonly profile: IUserDataProfile,
		@IUriIdentityService private readonly uriIdentityService: IUriIdentityService,
		@IInstantiationService private readonly instantiationService: IInstantiationService
	) { }

	isFromDefaultProfile(): boolean {
		return !this.profile.isDefault && !!this.profile.useDefaultFlags?.modelSelection;
	}

	async getChildren(): Promise<IProfileResourceChildTreeItem[]> {
		return [{
			handle: this.profile.modelSelectionResource.toString(),
			resourceUri: this.profile.modelSelectionResource,
			collapsibleState: TreeItemCollapsibleState.None,
			parent: this,
			accessibilityInformation: {
				label: this.uriIdentityService.extUri.basename(this.profile.modelSelectionResource)
			},
			command: {
				id: API_OPEN_EDITOR_COMMAND_ID,
				title: '',
				arguments: [this.profile.modelSelectionResource, undefined, undefined]
			}
		}];
	}

	async hasContent(): Promise<boolean> {
		const modelSelectionContent = await this.instantiationService.createInstance(ModelSelectionResource).getModelSelectionResourceContent(this.profile);
		return modelSelectionContent.modelSelection !== null;
	}

	async getContent(): Promise<string> {
		return this.instantiationService.createInstance(ModelSelectionResource).getContent(this.profile);
	}
}
