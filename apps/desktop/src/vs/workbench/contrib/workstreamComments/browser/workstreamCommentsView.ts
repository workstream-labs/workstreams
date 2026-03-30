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
import { IOrchestratorService } from '../../../services/orchestrator/common/orchestratorService.js';
import { IGitHubCommentsService, IGitHubPRReviewThread } from '../../../services/workstreamComments/common/githubCommentsService.js';
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

	constructor(
		@IWorkstreamCommentService private readonly workstreamCommentService: IWorkstreamCommentService,
		@IOrchestratorService private readonly orchestratorService: IOrchestratorService,
		@IGitHubCommentsService private readonly githubCommentsService: IGitHubCommentsService,
	) {
		super();

		this._register(this.workstreamCommentService.onDidChangeComments(() => {
			this._onNeedRefresh.fire();
		}));

		this._register(this.orchestratorService.onDidChangeActiveWorktree(() => {
			this._onlineThreads = [];
			this._onlineFetchState = 'idle';
			this.githubCommentsService.refresh();
			this._onNeedRefresh.fire();
		}));

		this._register(this.githubCommentsService.onDidChangeComments(() => {
			this._onlineThreads = [];
			this._onlineFetchState = 'idle';
			this._onNeedRefresh.fire();
		}));
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
		// Check authentication first
		const isAuthed = await this.githubCommentsService.isAuthenticated();
		if (!isAuthed) {
			return [{
				handle: 'online/sign-in',
				label: { label: localize('comments.online.signIn', "Sign in to GitHub") },
				description: localize('comments.online.signIn.desc', "to view PR review comments"),
				collapsibleState: TreeItemCollapsibleState.None,
				themeIcon: Codicon.logIn,
				command: {
					id: 'workstreamComments.signInToGitHub',
					title: localize('comments.online.signIn', "Sign in to GitHub"),
				},
			}];
		}

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

		// Done but no threads
		if (this._onlineThreads.length === 0) {
			return [{
				handle: 'online/empty',
				label: { label: localize('comments.online.noPR', "No PR found for this branch") },
				collapsibleState: TreeItemCollapsibleState.None,
			}];
		}

		return this._onlineThreads.map(thread => {
			const commentCount = thread.comments.length;
			const firstComment = thread.comments[0];
			const fileName = basename(thread.path);
			const lineLabel = thread.line !== undefined ? `:${thread.line}` : '';
			const firstBody = firstComment?.body ?? '';
			const preview = firstBody.length > 50 ? firstBody.substring(0, 50) + '...' : firstBody;

			return {
				handle: `online/thread/${thread.id}`,
				label: { label: `${fileName}${lineLabel}` },
				description: preview,
				tooltip: `${thread.path}${lineLabel}${thread.isResolved ? ' (resolved)' : ''}\n\n${firstBody}`,
				collapsibleState: commentCount > 1
					? TreeItemCollapsibleState.Collapsed
					: TreeItemCollapsibleState.None,
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

		return thread.comments.map(c => {
			const truncatedBody = c.body.length > 60 ? c.body.substring(0, 60) + '...' : c.body;

			return {
				handle: `online/comment/${c.id}`,
				label: { label: `@${c.author.login}` },
				description: truncatedBody,
				tooltip: `@${c.author.login}\n${new Date(c.createdAt).toLocaleString()}\n\n${c.body}`,
				collapsibleState: TreeItemCollapsibleState.None,
				themeIcon: Codicon.account,
				contextValue: 'github-review-comment',
			};
		});
	}

	/**
	 * Called by the Refresh button to clear local + service caches so
	 * the next getChildren() re-fetches from GitHub.
	 */
	resetOnlineCache(): void {
		this._onlineThreads = [];
		this._onlineFetchState = 'idle';
		this.githubCommentsService.clearCaches();
	}

	private _fetchOnlineThreadsAsync(): void {
		const worktree = this.orchestratorService.activeWorktree;
		if (!worktree) {
			this._onlineFetchState = 'done';
			this._onNeedRefresh.fire();
			return;
		}

		const repos = this.orchestratorService.repositories;
		if (repos.length === 0) {
			this._onlineFetchState = 'done';
			this._onNeedRefresh.fire();
			return;
		}

		this.githubCommentsService.resolveContext(repos[0].path, worktree.branch).then(ctx => {
			if (!ctx) {
				this._onlineFetchState = 'done';
				this._onNeedRefresh.fire();
				return;
			}
			return this.githubCommentsService.getReviewThreads(ctx).then(threads => {
				this._onlineThreads = threads;
				this._onlineFetchState = 'done';
				this._onNeedRefresh.fire();
			});
		}).catch(() => {
			this._onlineFetchState = 'error';
			this._onNeedRefresh.fire();
		});
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
