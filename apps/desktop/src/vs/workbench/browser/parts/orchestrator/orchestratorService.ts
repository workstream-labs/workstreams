/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { Emitter } from '../../../../base/common/event.js';
import { RunOnceScheduler } from '../../../../base/common/async.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { IOrchestratorService, IRepositoryEntry, IWorktreeEntry, WorktreeSessionState } from '../../../services/orchestrator/common/orchestratorService.js';
import { basename } from '../../../../base/common/path.js';
import { IFileDialogService } from '../../../../platform/dialogs/common/dialogs.js';
import { IQuickInputService } from '../../../../platform/quickinput/common/quickInput.js';
import { IGitWorktreeService, IDiffStats } from '../../../services/orchestrator/common/gitWorktreeService.js';
import { localize } from '../../../../nls.js';
import { IWorkspaceEditingService } from '../../../services/workspaces/common/workspaceEditing.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { URI } from '../../../../base/common/uri.js';
import { IEditorGroupsService, IEditorWorkingSet } from '../../../services/editor/common/editorGroupsService.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { INotificationService, Severity } from '../../../../platform/notification/common/notification.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { IProgressService, ProgressLocation } from '../../../../platform/progress/common/progress.js';
import { IHostService } from '../../../services/host/browser/host.js';
import { IFileService } from '../../../../platform/files/common/files.js';

const EMPTY_STATS: IDiffStats = { filesChanged: 0, additions: 0, deletions: 0 };

interface IPersistedRepositoryState {
	readonly path: string;
	readonly isCollapsed: boolean;
}

interface IPersistedOrchestratorState {
	readonly repositories: IPersistedRepositoryState[];
	readonly activeWorktreePath: string | undefined;
}

export class OrchestratorServiceImpl extends Disposable implements IOrchestratorService {

	static readonly STORAGE_KEY = 'orchestrator.repositoryState';

	declare readonly _serviceBrand: undefined;

	private _repositories: IRepositoryEntry[] = [];
	private _activeWorktree: IWorktreeEntry | undefined;

	private readonly _onDidChangeRepositories = this._register(new Emitter<void>());
	readonly onDidChangeRepositories = this._onDidChangeRepositories.event;

	private readonly _onDidChangeActiveWorktree = this._register(new Emitter<IWorktreeEntry>());
	readonly onDidChangeActiveWorktree = this._onDidChangeActiveWorktree.event;

	private readonly _onDidApplyWorktreeEditorState = this._register(new Emitter<IWorktreeEntry>());
	readonly onDidApplyWorktreeEditorState = this._onDidApplyWorktreeEditorState.event;

	private readonly _onDidRemoveWorktree = this._register(new Emitter<{ repoPath: string; worktreePath: string }>());
	readonly onDidRemoveWorktree = this._onDidRemoveWorktree.event;

	private readonly _onDidChangeSessionState = this._register(new Emitter<{ worktreePath: string; state: WorktreeSessionState }>());
	readonly onDidChangeSessionState = this._onDidChangeSessionState.event;

	private readonly _workingSetMap = new Map<string, IEditorWorkingSet>();
	private readonly _statsRefreshScheduler: RunOnceScheduler;
	private _statsRefreshInFlight = false;
	private _worktreeUris: URI[] = [];

	/**
	 * Resolves when the initial restore from persisted state is complete.
	 * Callers that need fully-populated repositories should await this.
	 */
	readonly whenReady: Promise<void>;

	pendingTerminalRestore: Promise<void> = Promise.resolve();

	get repositories(): readonly IRepositoryEntry[] { return this._repositories; }
	get activeWorktree(): IWorktreeEntry | undefined { return this._activeWorktree; }

	constructor(
		@IFileDialogService private readonly fileDialogService: IFileDialogService,
		@IQuickInputService private readonly quickInputService: IQuickInputService,
		@IGitWorktreeService private readonly gitService: IGitWorktreeService,
		@IWorkspaceEditingService private readonly workspaceEditingService: IWorkspaceEditingService,
		@IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService,
		@IEditorGroupsService private readonly editorGroupsService: IEditorGroupsService,
		@ILogService private readonly logService: ILogService,
		@INotificationService private readonly notificationService: INotificationService,
		@IStorageService private readonly storageService: IStorageService,
		@IProgressService private readonly progressService: IProgressService,
		@IHostService private readonly hostService: IHostService,
		@IFileService private readonly fileService: IFileService,
	) {
		super();

		this._statsRefreshScheduler = this._register(new RunOnceScheduler(() => this._doRefreshDiffStats(), OrchestratorServiceImpl.STATS_DEBOUNCE_MS));

		// Keep URI cache in sync so onDidFilesChange doesn't allocate on every event
		this._register(this.onDidChangeRepositories(() => this._rebuildWorktreeUriCache()));

		// File added/deleted/edited on disk inside any known worktree
		this._register(this.fileService.onDidFilesChange(e => {
			for (const uri of this._worktreeUris) {
				if (e.affects(uri)) {
					this.scheduleDiffStatsRefresh();
					return;
				}
			}
		}));

		// Agent finishes work in any worktree (including background ones not watched by VS Code)
		this._register(this.onDidChangeSessionState(({ state }) => {
			if (state === WorktreeSessionState.Idle || state === WorktreeSessionState.Review) {
				this.scheduleDiffStatsRefresh();
			}
		}));

		// Window regains focus — catch external changes (git CLI, manual edits)
		this._register(this.hostService.onDidChangeFocus(focused => {
			if (focused) {
				this.scheduleDiffStatsRefresh();
			}
		}));

		this.whenReady = this.restoreState();
	}

	async pickAndAddRepository(): Promise<void> {
		const uris = await this.fileDialogService.showOpenDialog({
			title: localize('selectRepository', "Select Repository Folder"),
			canSelectFiles: false,
			canSelectFolders: true,
			canSelectMany: false,
		});

		if (uris && uris.length > 0) {
			await this.addRepository(uris[0].fsPath);
		}
	}

	async pickAndAddWorktree(repoPath: string): Promise<void> {
		const name = await this.quickInputService.input({
			title: localize('worktreeName', "New Worktree"),
			placeHolder: localize('worktreeNamePlaceholder', "Worktree name (becomes branch name)"),
			prompt: localize('worktreeNamePrompt', "Enter a name for the new worktree"),
			validateInput: async (value) => validateWorktreeName(value)
		});

		if (!name) {
			return;
		}

		await this.addWorktree(repoPath, name, '');
	}

	async addRepository(path: string): Promise<void> {
		if (this._repositories.some(r => r.path === path)) {
			return;
		}

		// Ensure it's a git repo; init if not
		const isGit = await this.gitService.isGitRepository(path);
		if (!isGit) {
			await this.gitService.initRepository(path);
		}

		// Get current branch and discover existing worktrees
		const currentBranch = await this.gitService.getCurrentBranch(path);
		const gitWorktrees = await this.gitService.listWorktrees(path);

		// Build worktree entries from discovered worktrees
		const nonBare = gitWorktrees.filter(w => !w.isBare);
		const worktrees: IWorktreeEntry[] = nonBare.map(wt => ({
			name: wt.branch === currentBranch ? 'local' : friendlyName(wt.branch),
			path: wt.path,
			branch: wt.branch,
			isActive: false,
		}));

		// If no worktrees found (fresh init), add the main worktree
		if (worktrees.length === 0) {
			worktrees.push({
				name: 'local',
				path,
				branch: currentBranch,
				isActive: false,
			});
		}

		// Populate diff stats in parallel
		const statsMap = await this.fetchStatsForRepo(path, worktrees);
		for (let i = 0; i < worktrees.length; i++) {
			const s = statsMap.get(worktrees[i].path) ?? EMPTY_STATS;
			worktrees[i] = { ...worktrees[i], ...s };
		}

		const entry: IRepositoryEntry = {
			name: basename(path),
			path,
			worktrees,
			isCollapsed: false,
		};
		this._repositories = [...this._repositories, entry];
		this._onDidChangeRepositories.fire();
		this.saveState();

		// Auto-select the current branch worktree
		const mainWorktree = entry.worktrees.find(w => w.branch === currentBranch);
		if (mainWorktree) {
			await this.switchTo(mainWorktree);
		}
	}

	async removeRepository(repoPath: string): Promise<void> {
		const repo = this._repositories.find(r => r.path === repoPath);
		if (repo && this._activeWorktree && repo.worktrees.some(w => w.path === this._activeWorktree!.path)) {
			this._activeWorktree = undefined;
		}

		this._repositories = this._repositories.filter(r => r.path !== repoPath);
		this._onDidChangeRepositories.fire();
		this.saveState();
	}

	toggleRepositoryCollapsed(repoPath: string): void {
		this._repositories = this._repositories.map(r =>
			r.path === repoPath ? { ...r, isCollapsed: !r.isCollapsed } : r
		);
		this._onDidChangeRepositories.fire();
		this.saveState();
	}

	async addWorktree(repoPath: string, name: string, description: string): Promise<void> {
		// Create actual git worktree
		const worktreePath = await this.gitService.addWorktree(repoPath, name);

		const worktree: IWorktreeEntry = {
			name: friendlyName(name),
			path: worktreePath,
			branch: name,
			description,
			isActive: false,
		};

		this._repositories = this._repositories.map(r =>
			r.path === repoPath ? { ...r, worktrees: [...r.worktrees, worktree] } : r
		);
		this._onDidChangeRepositories.fire();
		this.saveState();
	}

	async removeWorktree(repoPath: string, branchName: string): Promise<void> {
		const repo = this._repositories.find(r => r.path === repoPath);
		const worktree = repo?.worktrees.find(w => w.branch === branchName);

		// Skip the main worktree — it is the repo root and cannot be removed
		if (worktree && worktree.path !== repoPath) {
			try {
				await this.gitService.removeWorktree(repoPath, worktree.path, worktree.branch);
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				this.notificationService.notify({
					severity: Severity.Error,
					message: localize('worktreeRemoveFailed', "Failed to remove worktree: {0}", message),
				});
				return;
			}
		}

		if (this._activeWorktree?.branch === branchName) {
			this._activeWorktree = undefined;
		}

		const worktreePath = worktree?.path;

		this._repositories = this._repositories.map(r =>
			r.path === repoPath
				? { ...r, worktrees: r.worktrees.filter(w => w.branch !== branchName) }
				: r
		);
		this._onDidChangeRepositories.fire();
		this.saveState();

		if (worktreePath) {
			this._onDidRemoveWorktree.fire({ repoPath, worktreePath });
		}
	}

	async switchTo(worktree: IWorktreeEntry): Promise<void> {
		const previousPath = this._activeWorktree?.path;
		this._activeWorktree = worktree;

		this._repositories = this._repositories.map(r => ({
			...r,
			worktrees: r.worktrees.map(w => ({
				...w,
				isActive: w.path === worktree.path
			}))
		}));
		this._onDidChangeRepositories.fire();
		this.saveState();

		if (previousPath !== worktree.path) {
			this.logService.trace(`[OrchestratorService] switchTo: "${previousPath}" → "${worktree.path}"`);

			/**
			 * Step 0: Wait for any in-flight phase-2 terminal restore to finish.
			 * showBackgroundTerminal's internal openEditor is async and not awaited,
			 * so its deferred tab creation can race with our saveWorkingSet if we
			 * don't wait here.
			 */
			await this.pendingTerminalRestore;

			/**
			 * Step 1: Fire worktree change — listeners background old terminals,
			 * removing terminal editor tabs from all groups.
			 */
			this._onDidChangeActiveWorktree.fire(worktree);

			/**
			 * Step 2: Save current editor state. Terminal tabs were removed in
			 * step 1, so the saved state is clean — no ghost terminal references.
			 * Empty groups left by backgrounded terminals are preserved so
			 * applyWorkingSet restores the exact grid layout (terminals will be
			 * placed back into those slots in phase 2).
			 */
			if (previousPath) {
				const workingSet = this.editorGroupsService.saveWorkingSet(previousPath);
				this._workingSetMap.set(previousPath, workingSet);
			}

			/**
			 * Step 3: Clear editors to a blank slate. Don't restore the
			 * target working set yet — diff editors would fail because the
			 * git extension still has the old worktree's repo.
			 */
			await this.editorGroupsService.applyWorkingSet('empty');

			/**
			 * Steps 4-5: Swap workspace folder and restore editors.
			 * Wrapped in a progress indicator so the user sees a loading
			 * state instead of a blank editor area.
			 */
			const savedSet = this._workingSetMap.get(worktree.path);
			await this.progressService.withProgress(
				{
					location: ProgressLocation.Window,
					title: localize('switchingWorktree', "Switching to {0}...", worktree.name),
				},
				async () => {
					// Step 4: Swap workspace folder — ext host restarts
					const folderData = { uri: URI.file(worktree.path) };
					const currentFolders = this.workspaceContextService.getWorkspace().folders;
					if (currentFolders.length === 0) {
						await this.workspaceEditingService.addFolders([folderData], true);
					} else {
						await this.workspaceEditingService.updateFolders(0, currentFolders.length, [folderData], true);
					}

					// Step 5: Wait for ext host to settle, then restore editors
					if (savedSet) {
						await new Promise(resolve => setTimeout(resolve, 1500));
						await this.editorGroupsService.applyWorkingSet(savedSet);
					}
				},
			);

			/**
			 * Step 6: Fire after folder swap — listeners show terminals for
			 * the new worktree.
			 */
			this._onDidApplyWorktreeEditorState.fire(worktree);
		} else {
			this._onDidChangeActiveWorktree.fire(worktree);
		}

		this.scheduleDiffStatsRefresh();
	}

	setSessionState(worktreePath: string, state: WorktreeSessionState): void {
		this._repositories = this._repositories.map(r => ({
			...r,
			worktrees: r.worktrees.map(w =>
				w.path === worktreePath ? { ...w, sessionState: state } : w
			)
		}));
		this._onDidChangeRepositories.fire();
		this._onDidChangeSessionState.fire({ worktreePath, state });
	}

	//#region Diff stats

	private _rebuildWorktreeUriCache(): void {
		this._worktreeUris = [];
		for (const repo of this._repositories) {
			for (const wt of repo.worktrees) {
				if (wt.path !== repo.path) {
					this._worktreeUris.push(URI.file(wt.path));
				}
			}
		}
	}

	private scheduleDiffStatsRefresh(): void {
		this._statsRefreshScheduler.schedule();
	}

	private static readonly STATS_DEBOUNCE_MS = 2000;
	private static readonly STATS_REQUEUE_MS = 5000;

	private async _doRefreshDiffStats(): Promise<void> {
		if (this._statsRefreshInFlight) {
			this._statsRefreshScheduler.schedule(OrchestratorServiceImpl.STATS_REQUEUE_MS);
			return;
		}
		this._statsRefreshInFlight = true;
		try {
			let changed = false;
			const updated = await Promise.all(this._repositories.map(async repo => {
				const statsMap = await this.fetchStatsForRepo(repo.path, repo.worktrees);
				const worktrees = repo.worktrees.map(wt => {
					const s = statsMap.get(wt.path) ?? EMPTY_STATS;
					if (wt.additions !== s.additions || wt.deletions !== s.deletions || wt.filesChanged !== s.filesChanged) {
						changed = true;
						return { ...wt, filesChanged: s.filesChanged, additions: s.additions, deletions: s.deletions };
					}
					return wt;
				});
				return { ...repo, worktrees };
			}));
			if (changed) {
				this._repositories = updated;
				this._onDidChangeRepositories.fire();
			}
		} finally {
			this._statsRefreshInFlight = false;
		}
	}

	private async fetchStatsForRepo(repoPath: string, worktrees: readonly IWorktreeEntry[]): Promise<Map<string, IDiffStats>> {
		const results = await Promise.all(
			worktrees.map(wt => wt.path === repoPath
				? Promise.resolve(EMPTY_STATS)
				: this.gitService.getDiffStats(repoPath, wt.path).catch(() => EMPTY_STATS))
		);
		const map = new Map<string, IDiffStats>();
		worktrees.forEach((wt, i) => map.set(wt.path, results[i]));
		return map;
	}

	//#endregion

	private saveState(): void {
		const state: IPersistedOrchestratorState = {
			repositories: this._repositories.map(r => ({
				path: r.path,
				isCollapsed: r.isCollapsed,
			})),
			activeWorktreePath: this._activeWorktree?.path,
		};
		this.storageService.store(
			OrchestratorServiceImpl.STORAGE_KEY,
			JSON.stringify(state),
			StorageScope.APPLICATION,
			StorageTarget.MACHINE
		);
	}

	private async restoreState(): Promise<void> {
		const raw = this.storageService.get(OrchestratorServiceImpl.STORAGE_KEY, StorageScope.APPLICATION);
		if (!raw) {
			return;
		}

		let persisted: IPersistedOrchestratorState;
		try {
			persisted = JSON.parse(raw);
		} catch {
			this.logService.warn('[OrchestratorService] Failed to parse persisted state, ignoring.');
			return;
		}

		if (!Array.isArray(persisted.repositories) || persisted.repositories.length === 0) {
			return;
		}

		// Restore each repository by rediscovering worktrees from git
		for (const saved of persisted.repositories) {
			try {
				const isGit = await this.gitService.isGitRepository(saved.path);
				if (!isGit) {
					this.logService.trace(`[OrchestratorService] Skipping non-git path during restore: "${saved.path}"`);
					continue;
				}

				const currentBranch = await this.gitService.getCurrentBranch(saved.path);
				const gitWorktrees = await this.gitService.listWorktrees(saved.path);

				const nonBare = gitWorktrees.filter(w => !w.isBare);
				const worktrees: IWorktreeEntry[] = nonBare.map(wt => ({
					name: wt.branch === currentBranch ? 'local' : friendlyName(wt.branch),
					path: wt.path,
					branch: wt.branch,
					isActive: false,
				}));

				if (worktrees.length === 0) {
					worktrees.push({
						name: 'local',
						path: saved.path,
						branch: currentBranch,
						isActive: false,
					});
				}

				const statsMap = await this.fetchStatsForRepo(saved.path, worktrees);
				for (let i = 0; i < worktrees.length; i++) {
					const s = statsMap.get(worktrees[i].path) ?? EMPTY_STATS;
					worktrees[i] = { ...worktrees[i], ...s };
				}

				this._repositories.push({
					name: basename(saved.path),
					path: saved.path,
					worktrees,
					isCollapsed: saved.isCollapsed,
				});
			} catch (err) {
				this.logService.warn(`[OrchestratorService] Failed to restore repository "${saved.path}":`, err);
			}
		}

		if (this._repositories.length > 0) {
			this._onDidChangeRepositories.fire();
		}

		// Restore active worktree selection
		if (persisted.activeWorktreePath) {
			for (const repo of this._repositories) {
				const match = repo.worktrees.find(w => w.path === persisted.activeWorktreePath);
				if (match) {
					await this.switchTo(match);
					break;
				}
			}
		}
	}
}

export function friendlyName(branch: string): string {
	const lastSegment = branch.split('/').pop() || branch;
	return lastSegment.replace(/-/g, ' ');
}

export function validateWorktreeName(value: string): string | undefined {
	if (!value.trim()) {
		return localize('worktreeNameRequired', "Name is required");
	}
	if (/\s/.test(value)) {
		return localize('worktreeNameNoSpaces', "Name cannot contain spaces");
	}
	if (/[~^:\\/]/.test(value)) {
		return localize('worktreeNameNoSpecial', "Name cannot contain ~, ^, :, \\, or /");
	}
	if (/\.\./.test(value)) {
		return localize('worktreeNameNoDots', "Name cannot contain '..'");
	}
	if (/@\{/.test(value)) {
		return localize('worktreeNameNoReflog', "Name cannot contain '@{brace}'");
	}
	if (/\.lock$/.test(value)) {
		return localize('worktreeNameNoLock', "Name cannot end with '.lock'");
	}
	if (/^\./.test(value) || /\.$/.test(value)) {
		return localize('worktreeNameNoDotEdge', "Name cannot start or end with '.'");
	}
	if (/[\x00-\x1f\x7f]/.test(value)) {
		return localize('worktreeNameNoControl', "Name cannot contain control characters");
	}
	return undefined;
}

registerSingleton(IOrchestratorService, OrchestratorServiceImpl, InstantiationType.Eager);
