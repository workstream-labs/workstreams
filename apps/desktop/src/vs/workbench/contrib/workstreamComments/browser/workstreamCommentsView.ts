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

export const WORKSTREAM_COMMENTS_VIEW_ID = 'workbench.scm.workstreamComments';

const HANDLE_OFFLINE = 'offline';
const HANDLE_ONLINE = 'online';

export class WorkstreamCommentsTreeDataProvider extends Disposable implements ITreeViewDataProvider {

	private readonly _onNeedRefresh = this._register(new Emitter<void>());
	readonly onNeedRefresh = this._onNeedRefresh.event;

	/** Cached online threads for child lookups. */
	private _onlineThreads: IGitHubPRReviewThread[] = [];

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
			this.githubCommentsService.refresh();
			this._onNeedRefresh.fire();
		}));

		this._register(this.githubCommentsService.onDidChangeComments(() => {
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

		// Fetch online threads for count
		const onlineThreads = await this._fetchOnlineThreads();
		const unresolvedCount = onlineThreads.filter(t => !t.isResolved).length;

		return [
			{
				handle: HANDLE_OFFLINE,
				label: { label: localize('comments.offline', "Offline") },
				description: offlineCount > 0 ? `(${offlineCount})` : undefined,
				collapsibleState: TreeItemCollapsibleState.Collapsed,
				themeIcon: Codicon.comment,
			},
			{
				handle: HANDLE_ONLINE,
				label: { label: localize('comments.online', "Online") },
				description: onlineThreads.length > 0
					? unresolvedCount > 0
						? `(${unresolvedCount} unresolved)`
						: `(${onlineThreads.length})`
					: undefined,
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
			const sideLabel = c.side === 'old'
				? localize('comments.side.original', "original")
				: localize('comments.side.modified', "modified");
			const truncatedText = c.text.length > 60 ? c.text.substring(0, 60) + '...' : c.text;

			return {
				handle: `${HANDLE_OFFLINE}/${c.id}`,
				label: { label: `${c.filePath}:${c.line}` },
				description: truncatedText,
				tooltip: `${c.filePath}:${c.line} (${sideLabel})\n${c.text}`,
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

		const threads = await this._fetchOnlineThreads();
		if (threads.length === 0) {
			return [{
				handle: 'online/empty',
				label: { label: localize('comments.online.noPR', "No PR found for this branch") },
				collapsibleState: TreeItemCollapsibleState.None,
			}];
		}

		return threads.map(thread => {
			const commentCount = thread.comments.length;
			const firstComment = thread.comments[0];
			const preview = firstComment
				? firstComment.body.length > 50 ? firstComment.body.substring(0, 50) + '...' : firstComment.body
				: '';
			const resolvedPrefix = thread.isResolved
				? localize('comments.online.resolved', "[resolved] ")
				: '';
			const lineLabel = thread.line !== undefined ? `:${thread.line}` : '';

			return {
				handle: `online/thread/${thread.id}`,
				label: { label: `${resolvedPrefix}${thread.path}${lineLabel}` },
				description: commentCount > 1
					? localize('comments.online.threadCount', "{0} comments", commentCount)
					: preview,
				tooltip: `${thread.path}${lineLabel}\n${firstComment?.body ?? ''}`,
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
			const truncatedBody = c.body.length > 80 ? c.body.substring(0, 80) + '...' : c.body;

			return {
				handle: `online/comment/${c.id}`,
				label: { label: `@${c.author.login}` },
				description: truncatedBody,
				tooltip: `@${c.author.login} (${new Date(c.createdAt).toLocaleString()})\n\n${c.body}`,
				collapsibleState: TreeItemCollapsibleState.None,
				themeIcon: Codicon.comment,
				contextValue: 'github-review-comment',
			};
		});
	}

	private async _fetchOnlineThreads(): Promise<IGitHubPRReviewThread[]> {
		if (this._onlineThreads.length > 0) {
			return this._onlineThreads;
		}

		const worktree = this.orchestratorService.activeWorktree;
		if (!worktree) {
			return [];
		}

		const repos = this.orchestratorService.repositories;
		if (repos.length === 0) {
			return [];
		}

		const ctx = await this.githubCommentsService.resolveContext(repos[0].path, worktree.branch);
		if (!ctx) {
			return [];
		}

		this._onlineThreads = await this.githubCommentsService.getReviewThreads(ctx);
		return this._onlineThreads;
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

		this._register(dataProvider.onNeedRefresh(() => treeView.refresh()));

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
