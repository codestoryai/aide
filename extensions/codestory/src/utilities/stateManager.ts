/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { ExtensionContext } from 'vscode';
import { CheckpointState, DocumentsState, ChangesState, HealthState, HealthStatus } from '../types';

const isEmpty = (value: Record<string, any>) => {
	return Object.keys(value).length === 0;
};

export const stateManager = (context: ExtensionContext) => {
	const getCheckpoint = (): CheckpointState => {
		const checkPointState = context.workspaceState.get<CheckpointState>('checkpoint');
		if (!checkPointState || isEmpty(checkPointState)) {
			return {
				timestamp: new Date(),
			};
		}
		return {
			timestamp: new Date(checkPointState.timestamp),
		};
	};

	const setCheckpoint = async (checkpoint: Date) => {
		await context.workspaceState.update('checkpoint', {
			timestamp: checkpoint.toLocaleString('en-US'),
		});
	};

	const getDocuments = (): DocumentsState => {
		const documents = context.workspaceState.get<DocumentsState>('documents');
		if (!documents || isEmpty(documents)) {
			return {};
		}
		return documents;
	};

	const updateDocuments = async (key: string, value: string) => {
		const documents = getDocuments();
		documents[key] = value;
		await context.workspaceState.update('documents', documents);
	};

	const getChanges = (): ChangesState => {
		const changes = context.workspaceState.get<ChangesState>('changes');
		if (!changes || isEmpty(changes)) {
			return { changes: '' };
		}
		return changes;
	};

	const appendChanges = async (diff: string) => {
		const currentChanges = getChanges();
		const changes = { changes: currentChanges.changes + '\n' + diff };
		await context.workspaceState.update('changes', changes);
	};

	const getHealth = async (): Promise<HealthState> => {
		const health = context.workspaceState.get<HealthState>('anton_health');
		if (!health || isEmpty(health)) {
			return { status: 'UNAVAILABLE' };
		}
		return health;
	};

	const setHealth = async (status: HealthStatus) => {
		await context.workspaceState.update('anton_health', { status });
	};

	return {
		getCheckpoint,
		setCheckpoint,
		getDocuments,
		updateDocuments,
		getChanges,
		appendChanges,
		getHealth,
		setHealth,
	};
};
