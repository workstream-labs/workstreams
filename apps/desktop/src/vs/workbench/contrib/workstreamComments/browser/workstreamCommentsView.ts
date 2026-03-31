/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { Emitter } from '../../../../base/common/event.js';
import { localize, localize2 } from '../../../../nls.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { SyncDescriptor } from '../../../../platform/instantiation/common/descriptors.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { TreeView, TreeViewPane } from '../../../browser/parts/views/treeView.js';
import { Extensions, ITreeItem, ITreeViewDataProvider, ITreeViewDescriptor, IViewsRegistry, TreeItemCollapsibleState, ViewContainer } from '../../../common/views.js';
import { IWorkstreamCommentService } from '../../../services/workstreamComments/common/workstreamCommentService.js';
import { IOrchestratorService, IRepositoryEntry } from '../../../services/orchestrator/common/orchestratorService.js';
import { IGitHubCommentsService, IGitHubPRReviewThread, ResolveContextStatus } from '../../../services/workstreamComments/common/githubCommentsService.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { isCancellationError } from '../../../../base/common/errors.js';
import { basename } from '../../../../base/common/path.js';

export const WORKSTREAM_COMMENTS_VIEW_ID = 'workbench.scm.workstreamComments';

const HANDLE_OFFLINE = 'offline';
const HANDLE_ONLINE = 'online';

export class WorkstreamCommentsTreeDataProvider extends Disposable implements ITreeViewDataProvider {

	private readonly _onNeedRefresh = this._register(new Emitter<void>());
	readonly onNeedRefresh = this._onNeedRefresh.event;

	/** Cached online threads for child lookups. */
	private _onlineThreads: IGitHubPRReviewThread[] = [];
	private _onlineFetchState: 'idle' | 'loading' | 'done' | 'error' = 'idle';
	private _onlineResolveStatus: ResolveContextStatus | undefined;

	/** Guard to prevent concurrent fetches. */
	private _pendingFetch: Promise<void> | undefined;

	constructor(
		@IWorkstreamCommentService private readonly workstreamCommentService: IWorkstreamCommentService,
		@IOrchestratorService private readonly orchestratorService: IOrchestratorService,
		@IGitHubCommentsService private readonly githubCommentsService: IGitHubCommentsService,
		@ILogService private readonly logService: ILogService,
	) {
		super();

		this._register(this.workstreamCommentService.onDidChangeComments(() => {
			this._onNeedRefresh.fire();
		}));

		// Worktree switch is a two-phase process:
		//   Step 1: onDidChangeActiveWorktree — fires BEFORE workspace folder swap.
		//           Reset state (clear old worktree's data) but do NOT fetch yet —
		//           the extension host is about to restart and would cancel requests.
		//   Step 5: onDidApplyWorktreeEditorState — fires AFTER everything is settled.
		//           Now safe to fetch for the new worktree.
		let suppressGitHubChange = false;
		this._register(this.orchestratorService.onDidChangeActiveWorktree(() => {
			this.logService.info('[WorkstreamComments]', 'onDidChangeActiveWorktree — resetting state (fetch deferred until workspace settles)');
			this._resetOnlineState();
			suppressGitHubChange = true;
			this.githubCommentsService.refresh();
			suppressGitHubChange = false;
			this._onNeedRefresh.fire();
		}));

		this._register(this.orchestratorService.onDidApplyWorktreeEditorState(() => {
			this.logService.info('[WorkstreamComments]', 'onDidApplyWorktreeEditorState — workspace settled, starting fetch');
			if (this._onlineFetchState === 'idle') {
				this._onlineFetchState = 'loading';
				this._fetchOnlineThreadsAsync();
				this._onNeedRefresh.fire();
			}
		}));

		this._register(this.githubCommentsService.onDidChangeComments(() => {
			if (suppressGitHubChange) {
				return;
			}
			this.logService.info('[WorkstreamComments]', 'onDidChangeComments — resetting state');
			this._resetOnlineState();
			this._onNeedRefresh.fire();
		}));
	}

	/** Incremented on every reset to invalidate in-flight fetches. */
	private _fetchGeneration = 0;

	private _resetOnlineState(): void {
		this._onlineThreads = [];
		this._onlineFetchState = 'idle';
		this._onlineResolveStatus = undefined;
		this._pendingFetch = undefined;
		this._fetchGeneration++;
	}

	async getChildren(element?: ITreeItem): Promise<ITreeItem[]> {
		if (!element) {
			return this._getRootItems();
		}

		if (element.handle === HANDLE_OFFLINE) {
			return this._getOfflineComments();
		}

		if (element.handle === HANDLE_ONLINE) {
			return this._getOnlineThreads();
		}

		// Thread children: online/thread/<threadId>
		if (element.handle.startsWith('online/thread/')) {
			const threadId = element.handle.substring('online/thread/'.length);
			return this._getThreadComments(threadId);
		}

		return [];
	}

	private async _getRootItems(): Promise<ITreeItem[]> {
		const worktree = this.orchestratorService.activeWorktree;
		let offlineCount = 0;
		if (worktree) {
			const comments = await this.workstreamCommentService.getComments(worktree.name);
			offlineCount = comments.length;
		}

		// Use cached threads for the count — don't block on fetch here
		const resolvedCount = this._onlineThreads.filter(t => t.isResolved).length;
		const unresolvedCount = this._onlineThreads.filter(t => !t.isResolved).length;
		let onlineDescription: string | undefined;
		if (this._onlineFetchState === 'loading') {
			onlineDescription = localize('comments.online.loading', "fetching...");
		} else if (this._onlineThreads.length > 0) {
			const parts: string[] = [];
			if (resolvedCount > 0) {
				parts.push(`${resolvedCount} \u2713`);
			}
			if (unresolvedCount > 0) {
				parts.push(`${unresolvedCount} \u25CB`);
			}
			onlineDescription = parts.join('  ');
		}

		// Offline: N ○ (pending)
		const offlineDescription = offlineCount > 0 ? `${offlineCount} \u25CB` : undefined;

		return [
			{
				handle: HANDLE_OFFLINE,
				label: { label: localize('comments.offline', "Offline") },
				description: offlineDescription,
				collapsibleState: TreeItemCollapsibleState.Collapsed,
				themeIcon: Codicon.comment,
			},
			{
				handle: HANDLE_ONLINE,
				label: { label: localize('comments.online', "Online") },
				description: onlineDescription,
				collapsibleState: TreeItemCollapsibleState.Collapsed,
				themeIcon: Codicon.commentDiscussion,
			},
		];
	}

	private async _getOfflineComments(): Promise<ITreeItem[]> {
		const worktree = this.orchestratorService.activeWorktree;
		if (!worktree) {
			return [];
		}

		const comments = await this.workstreamCommentService.getComments(worktree.name);
		if (comments.length === 0) {
			return [];
		}

		return comments.map(c => {
			const fileName = basename(c.filePath);
			const sideLabel = c.side === 'old'
				? localize('comments.side.original', "original")
				: localize('comments.side.modified', "modified");
			const truncatedText = c.text.length > 50 ? c.text.substring(0, 50) + '...' : c.text;

			return {
				handle: `${HANDLE_OFFLINE}/${c.id}`,
				label: { label: `${fileName}:${c.line}` },
				description: truncatedText,
				tooltip: `${c.filePath}:${c.line} (${sideLabel})\n\n${c.text}`,
				collapsibleState: TreeItemCollapsibleState.None,
				themeIcon: Codicon.comment,
				contextValue: 'workstream-comment',
			};
		});
	}

	private async _getOnlineThreads(): Promise<ITreeItem[]> {
		// If we haven't started fetching yet, kick off background fetch and show loading
		if (this._onlineFetchState === 'idle') {
			this._onlineFetchState = 'loading';
			this._onNeedRefresh.fire(); // refresh root to show "fetching..." description
			this._fetchOnlineThreadsAsync();
			return [{
				handle: 'online/loading',
				label: { label: localize('comments.online.fetching', "Fetching PR review comments...") },
				collapsibleState: TreeItemCollapsibleState.None,
				themeIcon: Codicon.loading,
			}];
		}

		// Still loading
		if (this._onlineFetchState === 'loading') {
			return [{
				handle: 'online/loading',
				label: { label: localize('comments.online.fetching', "Fetching PR review comments...") },
				collapsibleState: TreeItemCollapsibleState.None,
				themeIcon: Codicon.loading,
			}];
		}

		// Fetch failed
		if (this._onlineFetchState === 'error') {
			return [{
				handle: 'online/error',
				label: { label: localize('comments.online.error', "Failed to fetch PR comments") },
				description: localize('comments.online.error.retry', "click refresh to retry"),
				collapsibleState: TreeItemCollapsibleState.None,
				themeIcon: Codicon.error,
			}];
		}

		// Done but no threads
		if (this._onlineThreads.length === 0) {
			switch (this._onlineResolveStatus) {
				case ResolveContextStatus.Found:
					return [{
						handle: 'online/empty',
						label: { label: localize('comments.online.noComments', "No comments on this PR") },
						collapsibleState: TreeItemCollapsibleState.None,
					}];
				case ResolveContextStatus.NoAccess:
					return [{
						handle: 'online/no-access',
						label: { label: localize('comments.online.noAccess', "Add a GitHub account with access to this repo") },
						collapsibleState: TreeItemCollapsibleState.None,
						themeIcon: Codicon.logIn,
						command: {
							id: 'workstreamComments.signInToGitHub',
							title: localize('comments.online.signIn', "Sign in to GitHub"),
						},
					}];
				case ResolveContextStatus.NoPR:
					return [{
						handle: 'online/empty',
						label: { label: localize('comments.online.noPR', "No open PR for this branch") },
						collapsibleState: TreeItemCollapsibleState.None,
					}];
				case ResolveContextStatus.NotGitHub:
					return [{
						handle: 'online/empty',
						label: { label: localize('comments.online.notGitHub', "Not a GitHub repository") },
						collapsibleState: TreeItemCollapsibleState.None,
					}];
				default:
					return [];
			}
		}

		// Unresolved first, then resolved
		const sorted = [...this._onlineThreads].sort((a, b) => {
			if (a.isResolved !== b.isResolved) {
				return a.isResolved ? 1 : -1;
			}
			return 0;
		});

		return sorted.map(thread => {
			const commentCount = thread.comments.length;
			const fileName = basename(thread.path);
			const lineLabel = thread.line !== undefined ? `:${thread.line}` : '';

			return {
				handle: `online/thread/${thread.id}`,
				label: { label: `${fileName}${lineLabel}` },
				description: `${commentCount} \u25AC`,
				tooltip: thread.path + lineLabel,
				collapsibleState: TreeItemCollapsibleState.Collapsed,
				themeIcon: thread.isResolved ? Codicon.check : Codicon.commentDiscussion,
				contextValue: 'github-review-thread',
			};
		});
	}

	private _getThreadComments(threadId: string): ITreeItem[] {
		const thread = this._onlineThreads.find(t => t.id === threadId);
		if (!thread) {
			return [];
		}

		const items: ITreeItem[] = [];
		for (const c of thread.comments) {
			// Author + date header
			items.push({
				handle: `online/comment/${c.id}/header`,
				label: { label: `@${c.author.login}` },
				description: new Date(c.createdAt).toLocaleString(),
				collapsibleState: TreeItemCollapsibleState.None,
				themeIcon: Codicon.account,
				contextValue: 'github-review-comment',
			});
			// Body lines — each line as its own tree item so full text is visible
			const lines = c.body.split('\n').filter(l => l.trim().length > 0);
			for (let i = 0; i < lines.length; i++) {
				items.push({
					handle: `online/comment/${c.id}/line/${i}`,
					label: { label: lines[i] },
					collapsibleState: TreeItemCollapsibleState.None,
				});
			}
		}
		return items;
	}

	/**
	 * Called by the Refresh button to clear local + service caches so
	 * the next getChildren() re-fetches from GitHub.
	 */
	resetOnlineCache(): void {
		this._resetOnlineState();
		this.githubCommentsService.clearCaches();
	}

	private _findRepoForWorktree(worktreePath: string): IRepositoryEntry | undefined {
		const repos = this.orchestratorService.repositories;
		// Find the repo whose worktrees include the active worktree
		for (const repo of repos) {
			if (repo.worktrees.some(wt => wt.path === worktreePath)) {
				return repo;
			}
		}
		// Fallback: if only one repo, use it
		if (repos.length === 1) {
			return repos[0];
		}
		return undefined;
	}

	private _fetchOnlineThreadsAsync(): void {
		// Deduplicate: if a fetch is already in progress, skip
		if (this._pendingFetch) {
			return;
		}
		this._pendingFetch = this._doFetchOnlineThreads().finally(() => {
			this._pendingFetch = undefined;
		});
	}

	private async _doFetchOnlineThreads(): Promise<void> {
		const generation = this._fetchGeneration;
		const worktree = this.orchestratorService.activeWorktree;
		if (!worktree) {
			this._onlineFetchState = 'done';
			this._onNeedRefresh.fire();
			return;
		}

		const repo = this._findRepoForWorktree(worktree.path);
		if (!repo) {
			this.logService.warn('[WorkstreamComments]', `No repo found for worktree "${worktree.name}" (path: ${worktree.path})`);
			this._onlineFetchState = 'done';
			this._onNeedRefresh.fire();
			return;
		}

		this.logService.info('[WorkstreamComments]', `Resolving PR context for repo="${repo.name}" (${repo.path}), branch="${worktree.branch}"`);

		try {
			const result = await this.githubCommentsService.resolveContext(repo.path, worktree.branch);
			if (this._fetchGeneration !== generation) {
				this.logService.info('[WorkstreamComments]', `Discarding stale resolveContext result (gen ${generation} → ${this._fetchGeneration})`);
				return;
			}
			this._onlineResolveStatus = result.status;
			if (result.status !== ResolveContextStatus.Found) {
				this.logService.info('[WorkstreamComments]', `resolveContext returned ${result.status} for branch "${worktree.branch}" in ${repo.name}`);
				this._onlineFetchState = 'done';
				this._onNeedRefresh.fire();
				return;
			}
			const ctx = result.context;
			this.logService.info('[WorkstreamComments]', `Found PR #${ctx.prNumber} for ${ctx.owner}/${ctx.repo}`);
			const threads = await this.githubCommentsService.getReviewThreads(ctx);
			if (this._fetchGeneration !== generation) {
				this.logService.info('[WorkstreamComments]', `Discarding stale getReviewThreads result (gen ${generation} → ${this._fetchGeneration})`);
				return;
			}
			this._onlineThreads = threads;
			this._onlineFetchState = 'done';
			this._onNeedRefresh.fire();
		} catch (err) {
			if (this._fetchGeneration !== generation) {
				return;
			}
			if (isCancellationError(err)) {
				this.logService.info('[WorkstreamComments]', `Fetch canceled (gen ${generation}) — setting idle for retry`);
				this._onlineFetchState = 'idle';
				return;
			}
			this.logService.warn('[WorkstreamComments]', `Failed to fetch online comments:`, err);
			this._onlineFetchState = 'error';
			this._onNeedRefresh.fire();
		}
	}
}

export class WorkstreamCommentsViewRegistration extends Disposable {

	constructor(
		container: ViewContainer,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
	) {
		super();
		this._registerView(container);
	}

	private _registerView(container: ViewContainer): void {
		const treeView = this.instantiationService.createInstance(
			TreeView,
			WORKSTREAM_COMMENTS_VIEW_ID,
			localize('workstreamComments.title', "Comments"),
		);
		treeView.showRefreshAction = true;

		const dataProvider = this.instantiationService.createInstance(WorkstreamCommentsTreeDataProvider);
		treeView.dataProvider = dataProvider;
		this._register(dataProvider);

		// Save original refresh before overriding
		const originalRefresh = treeView.refresh.bind(treeView);

		// Internal refreshes (from data provider) bypass cache reset
		this._register(dataProvider.onNeedRefresh(() => originalRefresh()));

		// Override: only the Refresh button (which calls treeView.refresh directly) clears caches
		treeView.refresh = function (elements?: readonly ITreeItem[]) {
			if (!elements) {
				dataProvider.resetOnlineCache();
			}
			return originalRefresh(elements);
		};

		const viewsRegistry = Registry.as<IViewsRegistry>(Extensions.ViewsRegistry);
		// eslint-disable-next-line local/code-no-dangerous-type-assertions
		viewsRegistry.registerViews([<ITreeViewDescriptor>{
			id: WORKSTREAM_COMMENTS_VIEW_ID,
			name: localize2('workstreamComments', "Comments"),
			ctorDescriptor: new SyncDescriptor(TreeViewPane),
			treeView,
			canToggleVisibility: true,
			canMoveView: true,
			weight: 20,
			order: 3,
			collapsed: true,
		}], container);
	}
}
