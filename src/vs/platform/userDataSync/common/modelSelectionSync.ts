/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { isNonEmptyArray } from '../../../base/common/arrays.js';
import { VSBuffer } from '../../../base/common/buffer.js';
import { CancellationToken } from '../../../base/common/cancellation.js';
import { parse } from '../../../base/common/json.js';
import { isUndefined } from '../../../base/common/types.js';
import { URI } from '../../../base/common/uri.js';
import { localize } from '../../../nls.js';
import { IConfigurationService } from '../../configuration/common/configuration.js';
import { IEnvironmentService } from '../../environment/common/environment.js';
import { FileOperationError, FileOperationResult, IFileService } from '../../files/common/files.js';
import { ILogService } from '../../log/common/log.js';
import { IStorageService } from '../../storage/common/storage.js';
import { ITelemetryService } from '../../telemetry/common/telemetry.js';
import { IUriIdentityService } from '../../uriIdentity/common/uriIdentity.js';
import { IUserDataProfile, IUserDataProfilesService } from '../../userDataProfile/common/userDataProfile.js';
import { AbstractInitializer, AbstractJsonFileSynchroniser, IAcceptResult, IFileResourcePreview, IMergeResult } from './abstractSynchronizer.js';
import { merge } from './modelSelectionMerge.js';
import { Change, IRemoteUserData, IUserDataSyncConfiguration, IUserDataSyncEnablementService, IUserDataSynchroniser, IUserDataSyncLocalStoreService, IUserDataSyncLogService, IUserDataSyncStoreService, IUserDataSyncUtilService, SyncResource, USER_DATA_SYNC_SCHEME, UserDataSyncError, UserDataSyncErrorCode } from './userDataSync.js';

interface ISyncContent {
	modelSelection?: string;
}

interface IModelSelectionResourcePreview extends IFileResourcePreview {
	previewResult: IMergeResult;
}

export function getModelSelectionContentFromSyncContent(syncContent: string, logService: ILogService): string | null {
	try {
		const parsed = <ISyncContent>JSON.parse(syncContent);
		return isUndefined(parsed.modelSelection) ? null : parsed.modelSelection;
	} catch (e) {
		logService.error(e);
		return null;
	}
}

export class ModelSelectionSynchronizer extends AbstractJsonFileSynchroniser implements IUserDataSynchroniser {
	protected readonly version: number = 1;
	private readonly previewResource: URI = this.extUri.joinPath(this.syncPreviewFolder, 'modelSelection.json');
	private readonly baseResource: URI = this.previewResource.with({ scheme: USER_DATA_SYNC_SCHEME, authority: 'base' });
	private readonly localResource: URI = this.previewResource.with({ scheme: USER_DATA_SYNC_SCHEME, authority: 'local' });
	private readonly remoteResource: URI = this.previewResource.with({ scheme: USER_DATA_SYNC_SCHEME, authority: 'remote' });
	private readonly acceptedResource: URI = this.previewResource.with({ scheme: USER_DATA_SYNC_SCHEME, authority: 'accepted' });

	constructor(
		profile: IUserDataProfile,
		collection: string | undefined,
		@IUserDataSyncStoreService userDataSyncStoreService: IUserDataSyncStoreService,
		@IUserDataSyncLocalStoreService userDataSyncLocalStoreService: IUserDataSyncLocalStoreService,
		@IUserDataSyncLogService logService: IUserDataSyncLogService,
		@IConfigurationService configurationService: IConfigurationService,
		@IUserDataSyncEnablementService userDataSyncEnablementService: IUserDataSyncEnablementService,
		@IFileService fileService: IFileService,
		@IEnvironmentService environmentService: IEnvironmentService,
		@IStorageService storageService: IStorageService,
		@IUserDataSyncUtilService userDataSyncUtilService: IUserDataSyncUtilService,
		@ITelemetryService telemetryService: ITelemetryService,
		@IUriIdentityService uriIdentityService: IUriIdentityService,
	) {
		super(profile.modelSelectionResource, { syncResource: SyncResource.ModelSelection, profile }, collection, fileService, environmentService, storageService, userDataSyncStoreService, userDataSyncLocalStoreService, userDataSyncEnablementService, telemetryService, logService, userDataSyncUtilService, configurationService, uriIdentityService);
	}

	protected async generateSyncPreview(remoteUserData: IRemoteUserData, lastSyncUserData: IRemoteUserData | null, isRemoteDataFromCurrentMachine: boolean, userDataSyncConfiguration: IUserDataSyncConfiguration): Promise<IModelSelectionResourcePreview[]> {
		const remoteContent = remoteUserData.syncData ? getModelSelectionContentFromSyncContent(remoteUserData.syncData.content, this.logService) : null;

		// Use remote data as last sync data if last sync data does not exist and remote data is from same machine
		lastSyncUserData = lastSyncUserData === null && isRemoteDataFromCurrentMachine ? remoteUserData : lastSyncUserData;
		const lastSyncContent: string | null = lastSyncUserData ? this.getModelSelectionContentFromLastSyncUserData(lastSyncUserData) : null;

		// Get file content last to get the latest
		const fileContent = await this.getLocalFileContent();
		const formattingOptions = await this.getFormattingOptions();

		let mergedContent: string | null = null;
		let hasLocalChanged: boolean = false;
		let hasRemoteChanged: boolean = false;
		let hasConflicts: boolean = false;

		if (remoteContent) {
			let localContent: string = fileContent ? fileContent.value.toString() : '[]';
			localContent = localContent || '[]';
			if (this.hasErrors(localContent, true)) {
				throw new UserDataSyncError(localize('errorInvalidSettings', "Unable to sync model selection because the content in the file is not valid. Please open the file and correct it."), UserDataSyncErrorCode.LocalInvalidContent, this.resource);
			}

			if (!lastSyncContent // First time sync
				|| lastSyncContent !== localContent // Local has forwarded
				|| lastSyncContent !== remoteContent // Remote has forwarded
			) {
				this.logService.trace(`${this.syncResourceLogLabel}: Merging remote model selection with local model selection...`);
				const result = await merge(localContent, remoteContent, lastSyncContent, formattingOptions, this.userDataSyncUtilService);
				// Sync only if there are changes
				if (result.hasChanges) {
					mergedContent = result.mergeContent;
					hasConflicts = result.hasConflicts;
					hasLocalChanged = hasConflicts || result.mergeContent !== localContent;
					hasRemoteChanged = hasConflicts || result.mergeContent !== remoteContent;
				}
			}
		}

		// First time syncing to remote
		else if (fileContent) {
			this.logService.trace(`${this.syncResourceLogLabel}: Remote model selection does not exist. Synchronizing model selection for the first time.`);
			mergedContent = fileContent.value.toString();
			hasLocalChanged = true;
		}

		const previewResult: IMergeResult = {
			content: hasConflicts ? lastSyncContent : mergedContent,
			localChange: hasLocalChanged ? fileContent ? Change.Modified : Change.Added : Change.None,
			remoteChange: hasRemoteChanged ? Change.Modified : Change.None,
			hasConflicts
		};

		const localContent = fileContent ? fileContent.value.toString() : null;
		return [{
			fileContent,

			baseResource: this.baseResource,
			baseContent: lastSyncContent,

			localResource: this.localResource,
			localContent,
			localChange: previewResult.localChange,

			remoteResource: this.remoteResource,
			remoteContent,
			remoteChange: previewResult.remoteChange,

			previewResource: this.previewResource,
			previewResult,
			acceptedResource: this.acceptedResource,
		}];
	}

	private getModelSelectionContentFromLastSyncUserData(lastSyncUserData: IRemoteUserData): string | null {
		if (!lastSyncUserData.syncData) {
			return null;
		}

		return getModelSelectionContentFromSyncContent(lastSyncUserData.syncData.content, this.logService);
	}

	protected async hasRemoteChanged(lastSyncUserData: IRemoteUserData): Promise<boolean> {
		const lastSyncContent = this.getModelSelectionContentFromLastSyncUserData(lastSyncUserData);
		if (lastSyncContent === null) {
			return true;
		}

		const fileContent = await this.getLocalFileContent();
		const localContent: string = fileContent ? fileContent.value.toString() : '';
		const formattingOptions = await this.getFormattingOptions();
		const result = await merge(localContent || '{}', lastSyncContent, lastSyncContent, formattingOptions, this.userDataSyncUtilService);
		return result.hasConflicts || result.mergeContent !== lastSyncContent;
	}

	protected async getMergeResult(resourcePreview: IModelSelectionResourcePreview, token: CancellationToken): Promise<IMergeResult> {
		return resourcePreview.previewResult;
	}

	protected async getAcceptResult(resourcePreview: IModelSelectionResourcePreview, resource: URI, content: string | null | undefined, token: CancellationToken): Promise<IAcceptResult> {
		/* Accept local resource */
		if (this.extUri.isEqual(resource, this.localResource)) {
			return {
				content: resourcePreview.fileContent ? resourcePreview.fileContent.value.toString() : null,
				localChange: Change.None,
				remoteChange: Change.Modified,
			};
		}

		/* Accept remote resource */
		if (this.extUri.isEqual(resource, this.remoteResource)) {
			return {
				content: resourcePreview.remoteContent,
				localChange: Change.Modified,
				remoteChange: Change.None,
			};
		}

		/* Accept preview resource */
		if (this.extUri.isEqual(resource, this.previewResource)) {
			if (content === undefined) {
				return {
					content: resourcePreview.previewResult.content,
					localChange: resourcePreview.previewResult.localChange,
					remoteChange: resourcePreview.previewResult.remoteChange,
				};
			} else {
				return {
					content,
					localChange: Change.Modified,
					remoteChange: Change.Modified,
				};
			}
		}

		throw new Error(`Invalid Resource: ${resource.toString()}`);
	}

	protected async applyResult(remoteUserData: IRemoteUserData, lastSyncUserData: IRemoteUserData | null, resourcePreviews: [IModelSelectionResourcePreview, IAcceptResult][], force: boolean): Promise<void> {
		const { fileContent } = resourcePreviews[0][0];
		let { content, localChange, remoteChange } = resourcePreviews[0][1];

		if (localChange === Change.None && remoteChange === Change.None) {
			this.logService.info(`${this.syncResourceLogLabel}: No changes found during synchronizing model selection.`);
		}

		if (content !== null) {
			content = content.trim();
			content = content || '[]';
			if (this.hasErrors(content, true)) {
				throw new UserDataSyncError(localize('errorInvalidSettings', "Unable to sync model selection because the content in the file is not valid. Please open the file and correct it."), UserDataSyncErrorCode.LocalInvalidContent, this.resource);
			}
		}

		if (localChange !== Change.None) {
			this.logService.trace(`${this.syncResourceLogLabel}: Updating local model selection...`);
			if (fileContent) {
				await this.backupLocal(this.toSyncContent(fileContent.value.toString()));
			}
			await this.updateLocalFileContent(content || '[]', fileContent, force);
			this.logService.info(`${this.syncResourceLogLabel}: Updated local model selection`);
		}

		if (remoteChange !== Change.None) {
			this.logService.trace(`${this.syncResourceLogLabel}: Updating remote model selection...`);
			const remoteContents = this.toSyncContent(content || '[]', remoteUserData.syncData?.content);
			remoteUserData = await this.updateRemoteUserData(remoteContents, force ? null : remoteUserData.ref);
			this.logService.info(`${this.syncResourceLogLabel}: Updated remote model selection`);
		}

		// Delete the preview
		try {
			await this.fileService.del(this.previewResource);
		} catch (e) { /* ignore */ }

		if (lastSyncUserData?.ref !== remoteUserData.ref) {
			this.logService.trace(`${this.syncResourceLogLabel}: Updating last synchronized model selections...`);
			await this.updateLastSyncUserData(remoteUserData);
			this.logService.info(`${this.syncResourceLogLabel}: Updated last synchronized model selections`);
		}

	}

	async hasLocalData(): Promise<boolean> {
		try {
			const localFileContent = await this.getLocalFileContent();
			if (localFileContent) {
				const modelSelection = parse(localFileContent.value.toString());
				if (isNonEmptyArray(modelSelection)) {
					return true;
				}
			}
		} catch (error) {
			if ((<FileOperationError>error).fileOperationResult !== FileOperationResult.FILE_NOT_FOUND) {
				return true;
			}
		}
		return false;
	}

	async resolveContent(uri: URI): Promise<string | null> {
		if (this.extUri.isEqual(this.remoteResource, uri)
			|| this.extUri.isEqual(this.baseResource, uri)
			|| this.extUri.isEqual(this.localResource, uri)
			|| this.extUri.isEqual(this.acceptedResource, uri)
		) {
			return this.resolvePreviewContent(uri);
		}
		return null;
	}

	private toSyncContent(modelSelectionContent: string, syncContent?: string): string {
		let parsed: ISyncContent = {};
		try {
			parsed = JSON.parse(syncContent || '{}');
		} catch (e) {
			this.logService.error(e);
		}
		parsed.modelSelection = modelSelectionContent;
		return JSON.stringify(parsed);
	}
}

export class ModelSelectionInitializer extends AbstractInitializer {
	constructor(
		@IFileService fileService: IFileService,
		@IUserDataProfilesService userDataProfilesService: IUserDataProfilesService,
		@IEnvironmentService environmentService: IEnvironmentService,
		@IUserDataSyncLogService logService: IUserDataSyncLogService,
		@IStorageService storageService: IStorageService,
		@IUriIdentityService uriIdentityService: IUriIdentityService,
	) {
		super(SyncResource.ModelSelection, userDataProfilesService, environmentService, logService, fileService, storageService, uriIdentityService);
	}

	protected async doInitialize(remoteUserData: IRemoteUserData): Promise<void> {
		const modelSelectionContent = remoteUserData.syncData ? this.getModelSelectionContentFromSyncContent(remoteUserData.syncData.content) : null;
		if (!modelSelectionContent) {
			this.logService.info('Skipping synchronizing model selection as there is no content to synchronize.');
			return;
		}

		const isEmpty = await this.isEmpty();
		if (!isEmpty) {
			this.logService.info('Skipping synchronizing model selection because local model selection exists.');
			return;
		}

		await this.fileService.writeFile(this.userDataProfilesService.defaultProfile.modelSelectionResource, VSBuffer.fromString(modelSelectionContent));

		await this.updateLastSyncUserData(remoteUserData);
	}

	private async isEmpty(): Promise<boolean> {
		try {
			const modelSelectionContent = await this.fileService.readFile(this.userDataProfilesService.defaultProfile.modelSelectionResource);
			const modelSelection = parse(modelSelectionContent.value.toString());
			return !Object.keys(modelSelection).length;
		} catch (e) {
			return (<FileOperationError>e).fileOperationResult === FileOperationResult.FILE_NOT_FOUND;
		}
	}

	private getModelSelectionContentFromSyncContent(syncContent: string): string | null {
		try {
			return getModelSelectionContentFromSyncContent(syncContent, this.logService);
		} catch (e) {
			this.logService.error(e);
			return null;
		}
	}
}
