/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';
import * as electron from 'electron';
import { CancellationToken } from '../../../base/common/cancellation.js';
import { streamToBuffer } from '../../../base/common/buffer.js';
import { IConfigurationService } from '../../configuration/common/configuration.js';
import { IEnvironmentMainService } from '../../environment/electron-main/environmentMainService.js';
import { ILifecycleMainService, IRelaunchHandler, IRelaunchOptions } from '../../lifecycle/electron-main/lifecycleMainService.js';
import { ILogService } from '../../log/common/log.js';
import { IProductService } from '../../product/common/productService.js';
import { asJson, IRequestService } from '../../request/common/request.js';
import { IApplicationStorageMainService } from '../../storage/electron-main/storageMainService.js';
import { ITelemetryService } from '../../telemetry/common/telemetry.js';
import { AvailableForDownload, IUpdate, State, StateType, UpdateType } from '../common/update.js';
import { IMeteredConnectionService } from '../../meteredConnection/common/meteredConnection.js';
import { AbstractUpdateService, IUpdateURLOptions } from './abstractUpdateService.js';
import { Promises } from '../../../base/node/pfs.js';

/**
 * Update service for Workstreams that checks GitHub Releases for new versions
 * and performs in-place updates without requiring code signing.
 *
 * Flow:
 * 1. Polls GitHub Releases API → finds update → AvailableForDownload
 * 2. Downloads the .zip to a staging directory → Downloading → Downloaded
 * 3. Extracts the .app bundle → Ready
 * 4. On restart: spawns a helper script that swaps the .app and relaunches
 */
export class WorkstreamsUpdateService extends AbstractUpdateService implements IRelaunchHandler {

	private stagedUpdatePath: string | undefined;

	constructor(
		@ILifecycleMainService lifecycleMainService: ILifecycleMainService,
		@IConfigurationService configurationService: IConfigurationService,
		@ITelemetryService telemetryService: ITelemetryService,
		@IEnvironmentMainService environmentMainService: IEnvironmentMainService,
		@IRequestService requestService: IRequestService,
		@ILogService logService: ILogService,
		@IProductService productService: IProductService,
		@IApplicationStorageMainService applicationStorageMainService: IApplicationStorageMainService,
		@IMeteredConnectionService meteredConnectionService: IMeteredConnectionService,
	) {
		super(lifecycleMainService, configurationService, environmentMainService, requestService, logService, productService, telemetryService, applicationStorageMainService, meteredConnectionService, false);

		lifecycleMainService.setRelaunchHandler(this);
	}

	handleRelaunch(options?: IRelaunchOptions): boolean {
		if (options?.addArgs || options?.removeArgs) {
			return false;
		}

		if (this.state.type !== StateType.Ready) {
			return false;
		}

		this.logService.trace('workstreams-update#handleRelaunch(): applying update on relaunch');
		this.doQuitAndInstall();
		return true;
	}

	protected buildUpdateFeedUrl(quality: string, _commit: string, _options?: IUpdateURLOptions): string | undefined {
		const baseUrl = this.productService.updateUrl;
		if (!baseUrl) {
			return undefined;
		}
		return `${baseUrl}/releases/latest`;
	}

	protected doCheckForUpdates(explicit: boolean): void {
		if (!this.quality) {
			return;
		}

		this.setState(State.CheckingForUpdates(explicit));

		const url = this.buildUpdateFeedUrl(this.quality, this.productService.commit!);
		if (!url) {
			this.setState(State.Idle(UpdateType.Archive));
			return;
		}

		this.checkGitHubRelease(url, explicit);
	}

	private async checkGitHubRelease(url: string, explicit: boolean): Promise<void> {
		try {
			this.logService.trace('workstreams-update#checkGitHubRelease', { url });

			const context = await this.requestService.request(
				{
					url,
					headers: {
						'Accept': 'application/vnd.github+json',
						'User-Agent': `Workstreams/${this.productService.version}`,
					},
					callSite: 'workstreamsUpdateService.checkGitHubRelease',
				},
				CancellationToken.None
			);

			if (context.res.statusCode !== 200) {
				this.logService.info('workstreams-update#checkGitHubRelease - non-200 response', context.res.statusCode);
				this.setState(State.Idle(UpdateType.Archive, explicit ? 'Failed to check for updates' : undefined));
				return;
			}

			interface IGitHubRelease {
				tag_name: string;
				html_url: string;
				body?: string;
				assets: Array<{
					name: string;
					browser_download_url: string;
				}>;
			}

			const release = await asJson<IGitHubRelease>(context);
			if (!release) {
				this.logService.info('workstreams-update#checkGitHubRelease - empty response');
				this.setState(State.Idle(UpdateType.Archive, undefined, explicit || undefined));
				return;
			}

			// Find the update manifest for our architecture
			const arch = process.arch === 'x64' ? 'x64' : 'arm64';
			const manifestAsset = release.assets.find(a => a.name === `update-manifest-${arch}.json`);

			if (!manifestAsset) {
				this.logService.info('workstreams-update#checkGitHubRelease - no manifest for arch', arch);
				this.setState(State.Idle(UpdateType.Archive, undefined, explicit || undefined));
				return;
			}

			// Fetch the manifest
			const manifestContext = await this.requestService.request(
				{
					url: manifestAsset.browser_download_url,
					headers: {
						'Accept': 'application/octet-stream',
						'User-Agent': `Workstreams/${this.productService.version}`,
					},
					callSite: 'workstreamsUpdateService.fetchManifest',
				},
				CancellationToken.None
			);

			const manifest = await asJson<IUpdate>(manifestContext);
			if (!manifest || !manifest.version || !manifest.productVersion) {
				this.logService.info('workstreams-update#checkGitHubRelease - invalid manifest');
				this.setState(State.Idle(UpdateType.Archive, undefined, explicit || undefined));
				return;
			}

			// Compare commit hashes
			if (manifest.version === this.productService.commit) {
				this.logService.info('workstreams-update#checkGitHubRelease - already up to date');
				this.setState(State.Idle(UpdateType.Archive, undefined, explicit || undefined));
				return;
			}

			this.logService.info('workstreams-update#checkGitHubRelease - update available', {
				current: this.productService.commit,
				new: manifest.version,
				productVersion: manifest.productVersion,
			});

			const update: IUpdate = {
				version: manifest.version,
				productVersion: manifest.productVersion,
				timestamp: manifest.timestamp,
				url: manifest.url,
				sha256hash: manifest.sha256hash,
				changelogUrl: release.html_url,
			};

			this.setState(State.AvailableForDownload(update));
		} catch (err) {
			this.logService.error('workstreams-update#checkGitHubRelease - error', err);
			this.setState(State.Idle(UpdateType.Archive, explicit ? String(err) : undefined));
		}
	}

	protected override async doDownloadUpdate(state: AvailableForDownload): Promise<void> {
		const update = state.update;

		if (!update.url) {
			this.logService.error('workstreams-update#doDownloadUpdate - no download URL');
			this.setState(State.Idle(UpdateType.Archive, 'No download URL'));
			return;
		}

		this.setState(State.Downloading(update, true, false));

		try {
			const stagingDir = path.join(electron.app.getPath('userData'), 'updates');
			await fs.promises.mkdir(stagingDir, { recursive: true });

			const zipPath = path.join(stagingDir, 'update.zip');
			const extractDir = path.join(stagingDir, 'extracted');

			// Clean previous staging
			await Promises.rm(zipPath).catch(() => { /* ignore */ });
			await Promises.rm(extractDir).catch(() => { /* ignore */ });

			// Download the zip
			this.logService.info('workstreams-update#doDownloadUpdate - downloading', update.url);

			const context = await this.requestService.request(
				{
					url: update.url,
					headers: { 'User-Agent': `Workstreams/${this.productService.version}` },
					callSite: 'workstreamsUpdateService.downloadZip',
				},
				CancellationToken.None
			);

			if (context.res.statusCode !== 200) {
				throw new Error(`Download failed with status ${context.res.statusCode}`);
			}

			const buffer = await streamToBuffer(context.stream);
			await fs.promises.writeFile(zipPath, buffer.buffer);

			this.logService.info('workstreams-update#doDownloadUpdate - download complete, extracting');
			this.setState(State.Downloaded(update, true, false));

			// Extract the zip
			await fs.promises.mkdir(extractDir, { recursive: true });
			await this.extractZip(zipPath, extractDir);

			// Verify the extracted .app exists
			const extractedAppPath = path.join(extractDir, 'Workstreams.app');
			const exists = await Promises.exists(extractedAppPath);
			if (!exists) {
				throw new Error('Extracted update does not contain Workstreams.app');
			}

			this.stagedUpdatePath = extractedAppPath;

			// Clean up the zip
			await Promises.rm(zipPath).catch(() => { /* ignore */ });

			this.logService.info('workstreams-update#doDownloadUpdate - update staged at', extractedAppPath);
			this.setState(State.Ready(update, true, false));

		} catch (err) {
			this.logService.error('workstreams-update#doDownloadUpdate - failed', err);
			this.setState(State.Idle(UpdateType.Archive, String(err)));
		}
	}

	private extractZip(zipPath: string, targetDir: string): Promise<void> {
		return new Promise((resolve, reject) => {
			const proc = spawn('unzip', ['-o', '-q', zipPath, '-d', targetDir], { stdio: 'ignore' });
			proc.on('error', reject);
			proc.on('close', code => {
				if (code === 0) {
					resolve();
				} else {
					reject(new Error(`unzip exited with code ${code}`));
				}
			});
		});
	}

	protected override doQuitAndInstall(): void {
		if (!this.stagedUpdatePath) {
			this.logService.error('workstreams-update#doQuitAndInstall - no staged update');
			return;
		}

		const currentAppPath = this.resolveCurrentAppPath();
		if (!currentAppPath) {
			this.logService.error('workstreams-update#doQuitAndInstall - could not resolve current app path');
			return;
		}

		this.logService.info('workstreams-update#doQuitAndInstall', {
			current: currentAppPath,
			staged: this.stagedUpdatePath,
		});

		// Spawn a helper script that:
		// 1. Waits for this process to exit
		// 2. Replaces the current .app with the staged one
		// 3. Relaunches the new app
		const script = [
			'#!/bin/bash',
			`CURRENT_APP="${currentAppPath}"`,
			`STAGED_APP="${this.stagedUpdatePath}"`,
			// Wait for the current process to exit
			`while kill -0 ${process.pid} 2>/dev/null; do sleep 0.1; done`,
			// Back up the current app (in case something goes wrong)
			`BACKUP_APP="${currentAppPath}.backup"`,
			`rm -rf "$BACKUP_APP"`,
			`mv "$CURRENT_APP" "$BACKUP_APP"`,
			// Move the staged app into place
			`mv "$STAGED_APP" "$CURRENT_APP"`,
			// Relaunch
			`open "$CURRENT_APP"`,
			// Clean up backup after successful launch
			`sleep 3`,
			`rm -rf "$BACKUP_APP"`,
			// Clean up the extracted directory
			`rm -rf "$(dirname "$STAGED_APP")"`,
		].join('\n');

		const scriptPath = path.join(electron.app.getPath('userData'), 'updates', 'apply-update.sh');

		// Write and execute the script synchronously before quitting
		fs.writeFileSync(scriptPath, script, { mode: 0o755 });

		spawn('bash', [scriptPath], {
			detached: true,
			stdio: 'ignore',
		}).unref();

		// Quit the app — the script will take over
		electron.app.quit();
	}

	private resolveCurrentAppPath(): string | undefined {
		// process.execPath is like:
		// /Applications/Workstreams.app/Contents/MacOS/Electron
		// We need: /Applications/Workstreams.app
		const execPath = process.execPath;
		const contentsIdx = execPath.indexOf('.app/Contents/');
		if (contentsIdx === -1) {
			return undefined;
		}
		return execPath.substring(0, contentsIdx + '.app'.length);
	}
}
