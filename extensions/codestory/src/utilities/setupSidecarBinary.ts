/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as cp from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { gt } from 'semver';
import * as vscode from 'vscode';
import { downloadSidecarZip } from './gcpBucket';
import { killProcessOnPort } from './killPort';
import { sidecarURL, sidecarUseSelfRun } from './sidecarUrl';
import { unzip } from './unzip';

const updateBaseURL = `https://aide-updates.codestory.ai/api/update/sidecar`;

function getPaths(extensionBasePath: string) {
	const zipDestination = path.join(extensionBasePath, 'sidecar_zip.zip');
	const extractedDestination = path.join(extensionBasePath, 'sidecar_bin');
	const webserverPath = path.join(extractedDestination, 'target', 'release', os.platform() === 'win32' ? 'webserver.exe' : 'webserver');

	return { zipDestination, extractedDestination, webserverPath };
}

function getSidecarPort(): number {
	const url = sidecarURL();
	return parseInt(url.split(':').at(-1) ?? '42424');
}

// Add function to detect WSL environment
async function isWSLEnvironment(): Promise<boolean> {
	if (os.platform() !== 'win32') {
		return false;
	}

	try {
		const content = await vscode.workspace.fs.readFile(vscode.Uri.file('/proc/version'));
		return content.toString().toLowerCase().includes('microsoft');
	} catch {
		return false;
	}
}

let wslTunnel: vscode.Tunnel | undefined;
let isRestarting: boolean = false;

async function getHealthCheckURL(): Promise<string> {
	if (await isWSLEnvironment() && wslTunnel) {
		const localAddress = typeof wslTunnel.localAddress === 'string'
			? wslTunnel.localAddress
			: `${wslTunnel.localAddress.host}:${wslTunnel.localAddress.port}`;
		return `http://${localAddress}/api/health`;
	}
	return `${sidecarURL()}/api/health`;
}

async function healthCheck(): Promise<boolean> {
	try {
		const healthCheckURL = await getHealthCheckURL();
		const response = await fetch(healthCheckURL);
		const isHealthy = response.status === 200;
		vscode.sidecar.setRunningStatus(vscode.SidecarRunningStatus.Connected);
		return isHealthy;
	} catch (e) {
		console.error('Health check failed with error:', e);
		return false;
	}
}

type VersionAPIResponse = {
	version_hash: string;
	package_version?: string; // Optional for backward compatibility with older versions of sidecar that didn't have this
};

async function versionCheck(): Promise<VersionAPIResponse | undefined> {
	try {
		const response = await fetch(`${sidecarURL()}/api/version`);
		if (response.status === 200) {
			const versionData = await response.json() as VersionAPIResponse;
			vscode.sidecar.setVersion(versionData.package_version ?? 'unknown');
			return versionData;
		} else {
			return undefined;
		}
	} catch (e) {
		console.error(e);
		return undefined;
	}
}

type UpdateAPIResponse = {
	version_hash: string;
	package_version: string;
	timestamp: string;
};

async function fetchSidecarWithProgress(
	zipDestination: string,
	version: string = 'latest'
) {
	try {
		console.log('Downloading sidecar binary, version: ' + version);
		vscode.sidecar.setDownloadStatus({ downloading: true, update: version !== 'latest' });
		try {
			await downloadSidecarZip(zipDestination, version);
		} catch (error) {
			console.error('Failed to download sidecar binary:', error);
			throw new Error(`Failed to download sidecar binary: ${error.message}`);
		}
		vscode.sidecar.setDownloadStatus({ downloading: false, update: version !== 'latest' });
	} catch (error) {
		vscode.sidecar.setDownloadStatus({ downloading: false, update: version !== 'latest' });
		throw error; // Re-throw to be handled by caller
	}
}

async function checkForUpdates(zipDestination: string) {
	const currentVersionResponse = await versionCheck();
	if (!currentVersionResponse) {
		console.log('Unable to check sidecar version');
		return;
	} else if (!currentVersionResponse.package_version) {
		console.log('Current sidecar version is unknown. Likely an old version, fetching the latest');
		await fetchSidecarWithProgress(zipDestination);
		return;
	}

	const platform = process.platform;
	const architecture = process.arch;
	const updateURL = `${updateBaseURL}/${platform}-${architecture}`;
	const response = await fetch(updateURL);
	if (response.status === 200) {
		const data = await response.json() as UpdateAPIResponse;
		if (gt(data.package_version, currentVersionResponse.package_version)) {
			console.log(`New sidecar version available: ${data.package_version}`);
			await fetchSidecarWithProgress(zipDestination, data.package_version);
		} else {
			console.log(`Current sidecar version is up to date: ${currentVersionResponse.package_version}`);
			return;
		}
	} else {
		console.error('Failed to check for updates');
		return;
	}
}

async function unzipSidecarArchive(
	zipDestination: string,
	extractedDestination: string,
	webserverPath: string,
) {
	// Early return if zip file doesn't exist
	if (!fs.existsSync(zipDestination)) {
		console.log('No sidecar binary zip found at: ' + zipDestination);
		return;
	}

	console.log('Unzipping sidecar binary from ' + zipDestination + ' to ' + extractedDestination);
	try {
		await unzip(zipDestination, extractedDestination);

		// Set executable permissions for the binary
		if (fs.existsSync(webserverPath)) {
			try {
				if (process.platform !== 'win32') {
					console.log('Updating permissions for the webserver binary');
					// For Unix-like systems (Linux and macOS)
					fs.chmodSync(webserverPath, 0o755);
				} else {
					// On Windows, files are executable by default if they have the .exe extension
					// No additional permissions needed
				}
			} catch (error) {
				console.warn('Failed to set executable permissions:', error);
				// Don't fail the extraction if chmod fails
			}
		}

		// Only delete the zip file after successful extraction
		console.log('Deleting zip file from ' + zipDestination);
		try {
			fs.unlinkSync(zipDestination);
		} catch (error) {
			console.warn('Failed to delete zip file:', error);
			// Non-fatal error, continue execution
		}
	} catch (error) {
		console.error('Failed to extract sidecar binary:', error);
		throw new Error(`Failed to extract sidecar binary: ${error.message}`);
	}
}

async function retryHealthCheck(maxAttempts: number = 15, intervalMs: number = 1000): Promise<boolean> {
	console.log(`Starting health check retries (max ${maxAttempts} attempts, ${intervalMs}ms interval)`);
	vscode.sidecar.setRunningStatus(vscode.SidecarRunningStatus.Connecting);
	for (let attempt = 1; attempt <= maxAttempts; attempt++) {
		console.log(`Health check attempt ${attempt}/${maxAttempts}`);
		const isHealthy = await healthCheck();
		if (isHealthy) {
			console.log('Health check succeeded on attempt', attempt);
			return true;
		}
		if (attempt < maxAttempts) {
			console.log(`Waiting ${intervalMs}ms before next attempt...`);
			await new Promise(resolve => setTimeout(resolve, intervalMs));
		}
	}
	console.error('Health check failed after', maxAttempts, 'attempts');
	return false;
}

async function bringSidecarUp(webserverPath: string) {
	console.log('Starting sidecar binary at path:', webserverPath);
	try {
		const process = cp.spawn(webserverPath, [], {
			stdio: 'pipe',
			detached: true
		});

		process.stdout?.on('data', (data) => {
			console.log(`[Sidecar] ${data.toString().trim()}`);
		});

		process.stderr?.on('data', (data) => {
			console.error(`[Sidecar Error] ${data.toString().trim()}`);
		});

		process.on('error', (error) => {
			console.error('Sidecar process error:', {
				name: error.name,
				message: error.message,
				stack: error.stack
			});
			vscode.sidecar.setRunningStatus(vscode.SidecarRunningStatus.Unavailable);
			throw error;
		});

		process.on('exit', (code, signal) => {
			console.log('Sidecar process exited:', { code, signal });
			vscode.sidecar.setRunningStatus(vscode.SidecarRunningStatus.Unavailable);
		});

		if (await isWSLEnvironment()) {
			console.log('WSL environment detected, setting up tunnel...');
			try {
				const port = getSidecarPort();
				wslTunnel = await vscode.workspace.openTunnel({
					remoteAddress: { port, host: 'localhost' },
					localAddressPort: port
				});
				console.log('WSL tunnel created:', {
					localAddress: wslTunnel.localAddress,
					remoteAddress: wslTunnel.remoteAddress
				});
			} catch (error) {
				console.error('WSL tunnel creation failed:', error);
				throw error;
			}
		}
	} catch (error) {
		console.error('Sidecar binary startup failed:', {
			error,
			path: webserverPath,
			exists: fs.existsSync(webserverPath),
			permissions: fs.statSync(webserverPath).mode
		});
		throw new Error('Failed to start sidecar binary. Please check logs for details.');
	}

	console.log('Waiting for sidecar to become healthy...');
	vscode.sidecar.setRunningStatus(vscode.SidecarRunningStatus.Connecting);
	const hc = await retryHealthCheck();
	if (!hc) {
		console.error('Sidecar failed to become healthy after startup');
		vscode.sidecar.setRunningStatus(vscode.SidecarRunningStatus.Unavailable);
		throw new Error('Sidecar binary failed to start after multiple attempts');
	}

	vscode.sidecar.setRunningStatus(vscode.SidecarRunningStatus.Connected);
	console.log('Sidecar binary startup completed successfully');
}

export async function startSidecarBinary(webserverPath: string) {
	console.log('Running sidecar binary');
	vscode.sidecar.setRunningStatus(vscode.SidecarRunningStatus.Starting);
	try {
		await bringSidecarUp(webserverPath);
	} catch (error) {
		console.error('Failed to run sidecar binary:', error);
		vscode.sidecar.setRunningStatus(vscode.SidecarRunningStatus.Unavailable);
		return;
	}

	// Trigger version check to send the sidecar version to the editor
	versionCheck();
}

async function killSidecar() {
	const port = getSidecarPort();
	try {
		console.log('Attempting to kill sidecar process on port:', port);
		vscode.sidecar.setRunningStatus(vscode.SidecarRunningStatus.Restarting);
		await killProcessOnPort(port);
		console.log('Successfully killed process on port:', port);

		if (wslTunnel) {
			console.log('Cleaning up WSL tunnel...');
			await wslTunnel.dispose();
			wslTunnel = undefined;
			console.log('WSL tunnel cleaned up');
		}
	} catch (error) {
		console.warn('Error during sidecar shutdown:', error);
		vscode.sidecar.setRunningStatus(vscode.SidecarRunningStatus.Unavailable);
		return;
	}
}

export async function restartSidecarBinary(extensionBasePath: string) {
	isRestarting = true;  // Set flag before restart
	const { zipDestination, extractedDestination, webserverPath } = getPaths(extensionBasePath);

	console.log('Initiating sidecar binary restart...');
	await killSidecar();

	vscode.sidecar.setRunningStatus(vscode.SidecarRunningStatus.Starting);
	console.log('Starting new sidecar process...');

	// If restarting with an available update, then unzip the update file
	await unzipSidecarArchive(zipDestination, extractedDestination, webserverPath);

	vscode.sidecar.setDownloadStatus({ downloading: false, update: false });
	await startSidecarBinary(webserverPath);
	console.log('Sidecar restart completed');
	isRestarting = false;  // Reset flag after restart
}

export async function setupSidecar(extensionBasePath: string): Promise<vscode.Disposable> {
	const { zipDestination, extractedDestination, webserverPath } = getPaths(extensionBasePath);

	// If user is self-managing sidecar, only do health checks
	if (sidecarUseSelfRun()) {
		console.log('User is self-managing sidecar binary, skipping automated setup');
		const hc = await healthCheck();
		if (!hc) {
			console.log('Sidecar health check failed');
			vscode.sidecar.setRunningStatus(vscode.SidecarRunningStatus.Unavailable);
			vscode.window.showWarningMessage('Sidecar is not running. Please start the sidecar binary manually as configured.');
		}

		// Set up recurring health check every 5 seconds
		const healthCheckInterval = setInterval(async () => {
			const isHealthy = await healthCheck();
			if (!isHealthy) {
				console.log('Sidecar health check failed');
				vscode.sidecar.setRunningStatus(vscode.SidecarRunningStatus.Unavailable);
			} else {
				versionCheck();
			}
		}, 5000);

		return vscode.Disposable.from({ dispose: () => clearInterval(healthCheckInterval) });
	}

	// Regular automated setup flow
	if (!fs.existsSync(webserverPath)) {
		vscode.sidecar.setRunningStatus(vscode.SidecarRunningStatus.Starting);
		try {
			await fetchSidecarWithProgress(zipDestination);
			await unzipSidecarArchive(zipDestination, extractedDestination, webserverPath);
		} catch (error) {
			console.error('Failed to set up sidecar binary:', error);
			vscode.sidecar.setRunningStatus(vscode.SidecarRunningStatus.Unavailable);
			throw error;
		}
	}

	const hc = await healthCheck();
	if (!hc) {
		await startSidecarBinary(webserverPath);
	}

	// Asynchronously check for updates
	checkForUpdates(zipDestination);

	// Set up recurring health check every 5 seconds to recover sidecar
	const healthCheckInterval = setInterval(async () => {
		// Skip health check if we're in the middle of a restart
		if (isRestarting) {
			console.log('Skipping health check during restart...');
			return;
		}

		const isHealthy = await healthCheck();
		if (isHealthy) {
			versionCheck();
		} else {
			console.log('Health check failed, attempting recovery...');
			// Set to Connecting first to indicate we're trying to reconnect
			vscode.sidecar.setRunningStatus(vscode.SidecarRunningStatus.Connecting);

			// First try: Attempt to restart using existing binary
			try {
				console.log('Attempting to restart sidecar with existing binary...');
				await restartSidecarBinary(extensionBasePath);
				const recoveryCheck = await retryHealthCheck(3, 1000);
				if (recoveryCheck) {
					console.log('Successfully recovered sidecar using existing binary');
					return;
				}
			} catch (error) {
				console.log('Failed to restart with existing binary:', error);
			}

			// Second try: Binary might be missing, try fresh download and start
			try {
				console.log('Attempting fresh download and start...');
				// Kill any existing process first
				await killSidecar();

				// Fresh download and start
				await fetchSidecarWithProgress(zipDestination);
				await startSidecarBinary(webserverPath);

				const freshStartCheck = await retryHealthCheck(3, 1000);
				if (freshStartCheck) {
					console.log('Successfully recovered sidecar with fresh download');
					return;
				}
			} catch (error) {
				console.error('Failed to recover sidecar after fresh download:', error);
			}

			// If we get here, all recovery attempts failed
			console.error('All recovery attempts failed');
			vscode.sidecar.setRunningStatus(vscode.SidecarRunningStatus.Unavailable);
			vscode.window.showErrorMessage('Failed to recover sidecar after multiple attempts. Please try restarting Aide.');
		}
	}, 5000);

	// Clean up interval when extension is deactivated
	return vscode.Disposable.from({ dispose: () => clearInterval(healthCheckInterval) });
}
