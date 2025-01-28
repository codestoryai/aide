/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { VSBuffer } from '../../../../base/common/buffer.js';
import { localize } from '../../../../nls.js';
import { IFileService, FileOperationError, FileOperationResult } from '../../../../platform/files/common/files.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IUriIdentityService } from '../../../../platform/uriIdentity/common/uriIdentity.js';
import { IUserDataProfile, ProfileResourceType } from '../../../../platform/userDataProfile/common/userDataProfile.js';
import { API_OPEN_EDITOR_COMMAND_ID } from '../../../browser/parts/editor/editorCommands.js';
import { ITreeItemCheckboxState, TreeItemCollapsibleState } from '../../../common/views.js';
import { IProfileResourceInitializer, IUserDataProfileService, IProfileResource, IProfileResourceTreeItem, IProfileResourceChildTreeItem } from '../common/userDataProfile.js';

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
