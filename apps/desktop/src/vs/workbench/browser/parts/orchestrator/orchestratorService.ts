/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Workstreams Labs. All rights reserved.
 *  Licensed under the Elastic License 2.0 (ELv2). See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/


import { Disposable } from '../../../../base/common/lifecycle.js';
import { Emitter } from '../../../../base/common/event.js';
import { RunOnceScheduler } from '../../../../base/common/async.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { IOrchestratorService, IRepositoryEntry, IWorktreeEntry, WorktreeSessionState, VALID_TRANSITIONS } from '../../../services/orchestrator/common/orchestratorService.js';
import { basename } from '../../../../base/common/path.js';
import { IDialogService, IFileDialogService } from '../../../../platform/dialogs/common/dialogs.js';
import { IQuickInputService } from '../../../../platform/quickinput/common/quickInput.js';
import { IGitWorktreeService, IGitWorktreeInfo, IDiffStats, IPRInfo, IWorktreeMeta } from '../../../services/orchestrator/common/gitWorktreeService.js';
import { MarkdownString } from '../../../../base/common/htmlContent.js';
import { localize } from '../../../../nls.js';
import { IWorkspaceEditingService } from '../../../services/workspaces/common/workspaceEditing.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { URI } from '../../../../base/common/uri.js';
import { IEditorGroupsService, IEditorWorkingSet } from '../../../services/editor/common/editorGroupsService.js';
import { WebviewInput } from '../../../contrib/webviewPanel/browser/webviewEditorInput.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { INotificationService, Severity } from '../../../../platform/notification/common/notification.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { IHostService } from '../../../services/host/browser/host.js';
import { IFileService } from '../../../../platform/files/common/files.js';

const EMPTY_STATS: IDiffStats = { filesChanged: 0, additions: 0, deletions: 0, defaultBranch: 'main' };

const DEFAULT_AGENT_COMMANDS: ReadonlyMap<string, string> = new Map([
	['claude', 'claude'],
	['codex', 'codex'],
	['aider', 'aider'],
]);

interface IPersistedWorktreeState {
	readonly branch: string;
	readonly name: string;
	readonly description?: string;
	readonly baseBranch?: string;
}

interface IPersistedRepositoryState {
	readonly path: string;
	readonly isCollapsed: boolean;
	readonly worktrees?: IPersistedWorktreeState[];
}

interface IPersistedOrchestratorState {
	readonly repositories: IPersistedRepositoryState[];
	readonly activeWorktreePath: string | undefined;
}

export class OrchestratorServiceImpl extends Disposable implements IOrchestratorService {

	static readonly STORAGE_KEY = 'orchestrator.repositoryState';
	static readonly AGENT_COMMANDS_KEY = 'orchestrator.agentCommands';
	static readonly WORKING_SET_MAP_KEY = 'orchestrator.workingSetMap';
	private static readonly REFRESH_DEBOUNCE_MS = 2000;
	private static readonly REFRESH_REQUEUE_MS = 5000;
	private static readonly ERROR_EDITOR_ID = 'workbench.editors.errorEditor';
	private static readonly RETRY_DELAY_MS = 500;
	private static readonly MAX_RETRIES = 3;

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

	/**
	 * Authoritative source of truth for session state, separate from
	 * `_repositories`. This map is never affected by async operations
	 * that recreate worktree entries (_doRefreshGitState, switchTo, etc.).
	 */
	private readonly _sessionStates = new Map<string, WorktreeSessionState>();

	private readonly _workingSetMap = new Map<string, IEditorWorkingSet>();
	private readonly _refreshScheduler: RunOnceScheduler;
	private readonly _editorRetryScheduler: RunOnceScheduler;
	private _refreshInFlight = false;
	private _editorRetryCount = 0;
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
		@IDialogService private readonly dialogService: IDialogService,
		@IFileDialogService private readonly fileDialogService: IFileDialogService,
		@IQuickInputService private readonly quickInputService: IQuickInputService,
		@IGitWorktreeService private readonly gitService: IGitWorktreeService,
		@IWorkspaceEditingService private readonly workspaceEditingService: IWorkspaceEditingService,
		@IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService,
		@IEditorGroupsService private readonly editorGroupsService: IEditorGroupsService,
		@ILogService private readonly logService: ILogService,
		@INotificationService private readonly notificationService: INotificationService,
		@IStorageService private readonly storageService: IStorageService,
		@IHostService private readonly hostService: IHostService,
		@IFileService private readonly fileService: IFileService,
	) {
		super();

		this._refreshScheduler = this._register(new RunOnceScheduler(() => this._doRefreshGitState(), OrchestratorServiceImpl.REFRESH_DEBOUNCE_MS));
		this._editorRetryScheduler = this._register(new RunOnceScheduler(() => this._doRetryFailedEditors(), OrchestratorServiceImpl.RETRY_DELAY_MS));

		// Keep URI cache in sync so onDidFilesChange doesn't allocate on every event
		this._register(this.onDidChangeRepositories(() => this._rebuildWorktreeUriCache()));

		// File added/deleted/edited on disk inside any known worktree
		this._register(this.fileService.onDidFilesChange(e => {
			for (const uri of this._worktreeUris) {
				if (e.affects(uri)) {
					this.scheduleRefresh();
					return;
				}
			}
		}));

		// Agent finishes work in any worktree (including background ones not watched by VS Code)
		this._register(this.onDidChangeSessionState(({ state }) => {
			if (state === WorktreeSessionState.Idle || state === WorktreeSessionState.Review) {
				this.scheduleRefresh();
			}
		}));

		// Window regains focus — catch external changes (git CLI, manual edits)
		this._register(this.hostService.onDidChangeFocus(focused => {
			if (focused) {
				this.scheduleRefresh();
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
		const worktrees = await this._buildWorktreeEntries(path, gitWorktrees, currentBranch);

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

	async getCurrentBranch(repoPath: string): Promise<string> {
		return this.gitService.getCurrentBranch(repoPath);
	}

	async listBranches(repoPath: string): Promise<string[]> {
		return this.gitService.listBranches(repoPath);
	}

	async detectAgents(): Promise<string[]> {
		return this.gitService.detectAgents();
	}

	getAgentCommand(agentId: string): string {
		const raw = this.storageService.get(OrchestratorServiceImpl.AGENT_COMMANDS_KEY, StorageScope.APPLICATION);
		if (raw) {
			try {
				const commands: Record<string, string> = JSON.parse(raw);
				if (commands[agentId]) {
					return commands[agentId];
				}
			} catch { /* ignore */ }
		}
		return DEFAULT_AGENT_COMMANDS.get(agentId) ?? agentId;
	}

	setAgentCommand(agentId: string, command: string): void {
		let commands: Record<string, string> = {};
		const raw = this.storageService.get(OrchestratorServiceImpl.AGENT_COMMANDS_KEY, StorageScope.APPLICATION);
		if (raw) {
			try {
				commands = JSON.parse(raw);
			} catch (e) {
				this.logService.warn('[OrchestratorService] Failed to parse agent commands from storage:', e);
			}
		}
		commands[agentId] = command;
		this.storageService.store(
			OrchestratorServiceImpl.AGENT_COMMANDS_KEY,
			JSON.stringify(commands),
			StorageScope.APPLICATION,
			StorageTarget.MACHINE
		);
	}

	async addWorktree(repoPath: string, name: string, description: string, baseBranch?: string, displayName?: string): Promise<void> {
		const featureName = displayName || name;

		// Immediately insert a provisioning placeholder so the UI shows feedback
		const provisioning: IWorktreeEntry = {
			name: featureName,
			path: '',
			branch: name,
			baseBranch,
			description,
			isActive: false,
			provisioning: true,
		};

		this._repositories = this._repositories.map(r =>
			r.path === repoPath ? { ...r, worktrees: [...r.worktrees, provisioning] } : r
		);
		this._onDidChangeRepositories.fire();

		// Create actual git worktree (the slow part)
		let worktreePath: string;
		try {
			worktreePath = await this.gitService.addWorktree(repoPath, name, baseBranch);
		} catch (err) {
			// Remove the provisioning entry on failure
			this._repositories = this._repositories.map(r =>
				r.path === repoPath
					? { ...r, worktrees: r.worktrees.filter(w => !(w.branch === name && w.provisioning)) }
					: r
			);
			this._onDidChangeRepositories.fire();
			throw err;
		}

		const worktree: IWorktreeEntry = {
			name: featureName,
			path: worktreePath,
			branch: name,
			baseBranch,
			description,
			isActive: false,
		};

		// Persist identity alongside the worktree so it survives app state resets
		const meta: IWorktreeMeta = {
			name: featureName,
			branch: name,
			baseBranch,
			description,
			createdAt: new Date().toISOString(),
		};
		this.gitService.writeWorktreeMeta(repoPath, name, meta).catch(err => {
			this.logService.warn('[OrchestratorService] Failed to write worktree meta:', err);
		});

		// Replace the provisioning entry with the real one
		this._repositories = this._repositories.map(r =>
			r.path === repoPath
				? { ...r, worktrees: r.worktrees.map(w => w.branch === name && w.provisioning ? worktree : w) }
				: r
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
				const raw = err instanceof Error ? err.message : String(err);
				const fatalMatch = raw.match(/fatal:\s*(.+)/i);
				const reason = fatalMatch ? fatalMatch[1].trim() : raw;
				const { confirmed } = await this.dialogService.confirm({
					type: Severity.Warning,
					message: localize('worktreeRemoveFailed', "Failed to remove worktree"),
					detail: reason,
					primaryButton: localize('forceDelete', "Force Delete"),
					custom: {
						markdownDetails: [{
							markdown: new MarkdownString(localize('worktreeRemoveForcePrompt', "Do you want to force delete this worktree? This will discard any uncommitted changes.")),
						}],
					},
				});
				if (!confirmed) {
					return;
				}
				try {
					await this.gitService.removeWorktree(repoPath, worktree.path, worktree.branch, true);
				} catch (forceErr) {
					const forceMessage = forceErr instanceof Error ? forceErr.message : String(forceErr);
					this.notificationService.notify({
						severity: Severity.Error,
						message: localize('worktreeForceRemoveFailed', "Failed to force remove worktree: {0}", forceMessage),
					});
					return;
				}
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
			const removedWs = this._workingSetMap.get(worktreePath);
			if (removedWs) {
				this.editorGroupsService.deleteWorkingSet(removedWs);
				this._workingSetMap.delete(worktreePath);
				this._persistWorkingSetMap();
			}
			this._onDidRemoveWorktree.fire({ repoPath, worktreePath });
		}
	}

	async switchTo(worktree: IWorktreeEntry): Promise<void> {
		this._editorRetryCount = 0;
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
			 * Step 1b: Close webview tabs (e.g. markdown preview) that cannot
			 * survive a workspace-root change. Their serialisers fail to
			 * deserialise after the folder swap, producing "An error occurred
			 * while loading view" placeholders.
			 */
			for (const group of this.editorGroupsService.groups) {
				const webviews = group.editors.filter(e => e instanceof WebviewInput);
				if (webviews.length) {
					await group.closeEditors(webviews);
				}
			}

			/**
			 * Step 2: Save current editor state. Terminal tabs were removed in
			 * step 1, so the saved state is clean — no ghost terminal references.
			 * Empty groups left by backgrounded terminals are preserved so
			 * applyWorkingSet restores the exact grid layout (terminals will be
			 * placed back into those slots in phase 2).
			 */
			if (previousPath) {
				// Delete stale working set before creating a fresh one so dead
				// snapshots don't accumulate across sessions.
				const existing = this._workingSetMap.get(previousPath);
				if (existing) {
					this.editorGroupsService.deleteWorkingSet(existing);
				}
				const workingSet = this.editorGroupsService.saveWorkingSet(previousPath);
				this._workingSetMap.set(previousPath, workingSet);
				this._persistWorkingSetMap();
			}

			/**
			 * Step 3: Clear editors to a blank slate. Don't restore the
			 * target working set yet — diff editors would fail because the
			 * git extension still has the old worktree's repo.
			 */
			await this.editorGroupsService.applyWorkingSet('empty');

			// Step 4: Swap workspace folder
			const folderData = { uri: URI.file(worktree.path) };
			const currentFolders = this.workspaceContextService.getWorkspace().folders;
			if (currentFolders.length === 0) {
				await this.workspaceEditingService.addFolders([folderData], true);
			} else {
				await this.workspaceEditingService.updateFolders(0, currentFolders.length, [folderData], true);
			}

			// Step 5: Restore editors
			const savedSet = this._workingSetMap.get(worktree.path);
			if (savedSet) {
				await this.editorGroupsService.applyWorkingSet(savedSet);
			}

			/**
			 * Step 6: Fire after folder swap — listeners show terminals for
			 * the new worktree.
			 */
			this._onDidApplyWorktreeEditorState.fire(worktree);

			// Step 7: Auto-retry editors that failed during restoration.
			// The folder swap triggers an extension host restart (10 ms
			// scheduler in WorkspaceChangeExtHostRelauncher). Editors that
			// depend on extension-provided services (e.g. diff editors via
			// the git extension) may hit a "Canceled" error while the host
			// is restarting. Once the restart completes the editors open
			// fine — so retry any error placeholders after a brief delay.
			this.retryFailedEditors();
		} else {
			this._onDidChangeActiveWorktree.fire(worktree);
		}

		this.scheduleRefresh();
	}

	private retryFailedEditors(): void {
		this._editorRetryScheduler.schedule();
	}

	private async _doRetryFailedEditors(): Promise<void> {
		let retried = false;
		for (const group of this.editorGroupsService.groups) {
			if (group.activeEditorPane?.getId() === OrchestratorServiceImpl.ERROR_EDITOR_ID && group.activeEditor) {
				this.logService.info(`[OrchestratorService] Auto-retrying failed editor: ${group.activeEditor.getName()}`);
				try {
					await group.openEditor(group.activeEditor);
				} catch (err) {
					this.logService.trace(`[OrchestratorService] Retry failed (InstantiationService may have been disposed), will retry: ${err}`);
				}
				retried = true;
			}
		}

		if (retried && this._editorRetryCount < OrchestratorServiceImpl.MAX_RETRIES) {
			const stillFailing = this.editorGroupsService.groups.some(
				g => g.activeEditorPane?.getId() === OrchestratorServiceImpl.ERROR_EDITOR_ID
			);
			if (stillFailing) {
				this._editorRetryCount++;
				this._editorRetryScheduler.schedule();
				return;
			}
		}
		this._editorRetryCount = 0;
	}

	setSessionState(worktreePath: string, state: WorktreeSessionState): boolean {
		const current = this._sessionStates.get(worktreePath);

		// Self-transition: already in the target state — no-op
		if (current === state) {
			return true;
		}

		// Validate against the transition table
		const allowed = VALID_TRANSITIONS.get(current);
		if (allowed && !allowed.has(state)) {
			this.logService.warn(`[OrchestratorService] Invalid transition ${current ?? 'undefined'} → ${state} for "${worktreePath}" — ignoring`);
			return false;
		}

		// Update the authoritative map
		this._sessionStates.set(worktreePath, state);

		// Mirror onto _repositories for rendering
		this._repositories = this._repositories.map(r => ({
			...r,
			worktrees: r.worktrees.map(w =>
				w.path === worktreePath ? { ...w, sessionState: state } : w
			)
		}));
		this._onDidChangeRepositories.fire();
		this._onDidChangeSessionState.fire({ worktreePath, state });
		return true;
	}

	getSessionState(worktreePath: string): WorktreeSessionState | undefined {
		return this._sessionStates.get(worktreePath);
	}

	/**
	 * Builds worktree entries from git-discovered worktrees, merging persisted
	 * state and on-disk meta. Shared between addRepository and restoreState.
	 */
	private async _buildWorktreeEntries(
		repoPath: string,
		gitWorktrees: IGitWorktreeInfo[],
		currentBranch: string,
		savedWorktrees?: Map<string, IPersistedWorktreeState>,
		activeWorktreePath?: string,
	): Promise<IWorktreeEntry[]> {
		const nonBare = gitWorktrees.filter(w => !w.isBare);

		const metaResults = await Promise.all(
			nonBare.map(wt => savedWorktrees?.has(wt.branch)
				? Promise.resolve(null)
				: this.gitService.readWorktreeMeta(repoPath, wt.branch).catch(() => null))
		);

		const worktrees: IWorktreeEntry[] = nonBare.map((wt, i) => {
			const saved = savedWorktrees?.get(wt.branch);
			const diskMeta = metaResults[i];
			return {
				name: wt.path === repoPath ? 'local' : (saved?.name ?? diskMeta?.name ?? friendlyName(wt.branch)),
				path: wt.path,
				branch: wt.branch,
				baseBranch: saved?.baseBranch ?? diskMeta?.baseBranch,
				description: saved?.description ?? diskMeta?.description,
				isActive: activeWorktreePath ? wt.path === activeWorktreePath : false,
			};
		});

		if (worktrees.length === 0) {
			worktrees.push({
				name: 'local',
				path: repoPath,
				branch: currentBranch,
				isActive: activeWorktreePath ? repoPath === activeWorktreePath : false,
			});
		}

		const statsMap = await this._fetchDiffStats(repoPath, worktrees);
		return worktrees.map(wt => {
			const s = statsMap.get(wt.path) ?? EMPTY_STATS;
			return { ...wt, ...s };
		});
	}

	//#region Diff stats

	private _rebuildWorktreeUriCache(): void {
		this._worktreeUris = [];
		for (const repo of this._repositories) {
			for (const wt of repo.worktrees) {
				if (wt.path && wt.path !== repo.path) {
					this._worktreeUris.push(URI.file(wt.path));
				}
			}
		}
	}

	scheduleRefresh(): void {
		this._refreshScheduler.schedule();
	}

	private async _doRefreshGitState(): Promise<void> {
		if (this._refreshInFlight) {
			this._refreshScheduler.schedule(OrchestratorServiceImpl.REFRESH_REQUEUE_MS);
			return;
		}
		this._refreshInFlight = true;
		try {
			// Fetch data in parallel. The results are Maps keyed by worktree
			// path — safe to apply to whatever _repositories looks like after
			// the await (worktrees may have been added or removed mid-flight).
			const fetched = await Promise.all(this._repositories.map(async repo => ({
				repoPath: repo.path,
				...(await Promise.all([
					this._fetchDiffStats(repo.path, repo.worktrees),
					this._fetchBranches(repo.worktrees),
					this._fetchPRInfo(repo.path, repo.worktrees),
				]).then(([statsMap, branchMap, prMap]) => ({ statsMap, branchMap, prMap }))),
			})));
			const dataByRepo = new Map(fetched.map(r => [r.repoPath, r]));

			// Apply to CURRENT _repositories — deleted worktrees are gone,
			// new ones simply have no data yet and keep defaults.
			let changed = false;
			this._repositories = this._repositories.map(repo => {
				const data = dataByRepo.get(repo.path);
				if (!data) {
					return repo;
				}
				const worktrees = repo.worktrees.map(wt => {
					const s = data.statsMap.get(wt.path) ?? EMPTY_STATS;
					const branch = data.branchMap.get(wt.path) ?? wt.branch;
					const pr = data.prMap.get(wt.path) ?? null;
					if (wt.additions !== s.additions || wt.deletions !== s.deletions || wt.filesChanged !== s.filesChanged || wt.branch !== branch
						|| wt.prNumber !== pr?.number || wt.prState !== pr?.state || wt.prMergeable !== pr?.mergeable || !wt.prLoaded) {
						changed = true;
						const liveState = this._sessionStates.get(wt.path);
						const merged: IWorktreeEntry = { ...wt, filesChanged: s.filesChanged, additions: s.additions, deletions: s.deletions, defaultBranch: s.defaultBranch, branch, prLoaded: true, prNumber: pr?.number, prState: pr?.state, prMergeable: pr?.mergeable, prUrl: pr?.url };
						return liveState !== undefined ? { ...merged, sessionState: liveState } : merged;
					}
					return wt;
				});
				return { ...repo, worktrees };
			});
			if (changed) {
				this._onDidChangeRepositories.fire();
			}
		} finally {
			this._refreshInFlight = false;
		}
	}

	private async _fetchDiffStats(repoPath: string, worktrees: readonly IWorktreeEntry[]): Promise<Map<string, IDiffStats>> {
		const results = await Promise.all(
			worktrees.map(wt => wt.path === repoPath
				? Promise.resolve(EMPTY_STATS)
				: this.gitService.getDiffStats(repoPath, wt.path).catch(() => EMPTY_STATS))
		);
		const map = new Map<string, IDiffStats>();
		worktrees.forEach((wt, i) => map.set(wt.path, results[i]));
		return map;
	}

	private async _fetchBranches(worktrees: readonly IWorktreeEntry[]): Promise<Map<string, string>> {
		const results = await Promise.all(
			worktrees.map(wt => this.gitService.getCurrentBranch(wt.path).catch(() => wt.branch))
		);
		const map = new Map<string, string>();
		worktrees.forEach((wt, i) => map.set(wt.path, results[i]));
		return map;
	}

	private async _fetchPRInfo(repoPath: string, worktrees: readonly IWorktreeEntry[]): Promise<Map<string, IPRInfo | null>> {
		const results = await Promise.all(
			worktrees.map(wt => this.gitService.getPRInfo(repoPath, wt.branch).catch(() => null))
		);
		const map = new Map<string, IPRInfo | null>();
		worktrees.forEach((wt, i) => map.set(wt.path, results[i]));
		return map;
	}

	//#endregion

	private _persistWorkingSetMap(): void {
		const entries = Array.from(this._workingSetMap.entries())
			.map(([path, ws]) => ({ path, id: ws.id, name: ws.name }));
		this.storageService.store(
			OrchestratorServiceImpl.WORKING_SET_MAP_KEY,
			JSON.stringify(entries),
			StorageScope.WORKSPACE,
			StorageTarget.MACHINE
		);
	}

	private saveState(): void {
		const state: IPersistedOrchestratorState = {
			repositories: this._repositories.map(r => ({
				path: r.path,
				isCollapsed: r.isCollapsed,
				worktrees: r.worktrees.map(wt => ({
					branch: wt.branch,
					name: wt.name,
					description: wt.description,
					baseBranch: wt.baseBranch,
				})),
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

				const savedWorktreeMap = new Map<string, IPersistedWorktreeState>();
				if (saved.worktrees) {
					for (const sw of saved.worktrees) {
						savedWorktreeMap.set(sw.branch, sw);
					}
				}

				const worktrees = await this._buildWorktreeEntries(
					saved.path, gitWorktrees, currentBranch, savedWorktreeMap, persisted.activeWorktreePath
				);

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

		// Restore working set map (path → {id, name}).
		// The actual layout states live in editorParts under StorageScope.WORKSPACE
		// and are already loaded by the time we get here. We only need to rebuild
		// the in-memory path→id index so switchTo() can call applyWorkingSet().
		const rawMap = this.storageService.get(OrchestratorServiceImpl.WORKING_SET_MAP_KEY, StorageScope.WORKSPACE);
		if (rawMap) {
			try {
				const entries = JSON.parse(rawMap) as { path: string; id: string; name: string }[];
				const validIds = new Set(this.editorGroupsService.getWorkingSets().map(ws => ws.id));
				for (const entry of entries) {
					if (validIds.has(entry.id)) {
						this._workingSetMap.set(entry.path, { id: entry.id, name: entry.name });
					}
				}
				this.logService.trace(`[OrchestratorService] Restored working set map: ${this._workingSetMap.size} entries`);
			} catch {
				this.logService.warn('[OrchestratorService] Failed to parse working set map, ignoring.');
			}
		}

		/*
		 * Restore active worktree selection directly — skip switchTo() because
		 * VS Code's own editor and terminal persistence already restored the
		 * active worktree's state. The full switch flow would wipe editors via
		 * applyWorkingSet('empty') with nothing to restore (only inactive
		 * worktrees have saved working sets), and redundantly re-save state,
		 * re-fire repository changes, and re-trigger a git refresh.
		 */
		if (persisted.activeWorktreePath) {
			for (const repo of this._repositories) {
				const match = repo.worktrees.find(w => w.path === persisted.activeWorktreePath);
				if (match) {
					this._activeWorktree = match;
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
	if (/[~^:\\]/.test(value)) {
		return localize('worktreeNameNoSpecial', "Name cannot contain ~, ^, :, or \\");
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
	if (/^[./]/.test(value) || /\.$/.test(value) || /\/\.|\/\//.test(value)) {
		return localize('worktreeNameNoDotEdge', "Name cannot start with '.' or '/', contain '/.', or have consecutive '/'");
	}
	if (/[\x00-\x1f\x7f]/.test(value)) {
		return localize('worktreeNameNoControl', "Name cannot contain control characters");
	}
	return undefined;
}

registerSingleton(IOrchestratorService, OrchestratorServiceImpl, InstantiationType.Eager);
