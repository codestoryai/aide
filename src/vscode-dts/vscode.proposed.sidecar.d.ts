/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

declare module 'vscode' {
	export enum SidecarRunningStatus {
		Unavailable = 0,
		Starting = 1,
		Restarting = 2,
		Connecting = 3,
		Connected = 4,
	}

	export type SidecarDownloadStatus = {
		downloading: boolean;
		update: boolean;
	};

	export namespace sidecar {
		export const onDidTriggerSidecarRestart: Event<void>;
		export function setVersion(version: string): void;
		export function setRunningStatus(status: SidecarRunningStatus): void;
		export function setDownloadStatus(status: SidecarDownloadStatus): void;
	}
}
