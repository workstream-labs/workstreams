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

export const WORKSTREAM_COMMENTS_VIEW_ID = 'workbench.scm.workstreamComments';

const HANDLE_OFFLINE = 'offline';
const HANDLE_ONLINE = 'online';
const HANDLE_ONLINE_PLACEHOLDER = 'online/placeholder';

export class WorkstreamCommentsTreeDataProvider extends Disposable implements ITreeViewDataProvider {

	private readonly _onNeedRefresh = this._register(new Emitter<void>());
	readonly onNeedRefresh = this._onNeedRefresh.event;

	constructor(
		@IWorkstreamCommentService private readonly workstreamCommentService: IWorkstreamCommentService,
		@IOrchestratorService private readonly orchestratorService: IOrchestratorService,
	) {
		super();

		this._register(this.workstreamCommentService.onDidChangeComments(() => {
			this._onNeedRefresh.fire();
		}));

		this._register(this.orchestratorService.onDidChangeActiveWorktree(() => {
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
			return this._getOnlinePlaceholder();
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

	private _getOnlinePlaceholder(): ITreeItem[] {
		return [{
			handle: HANDLE_ONLINE_PLACEHOLDER,
			label: { label: localize('comments.online.placeholder', "Coming soon...") },
			collapsibleState: TreeItemCollapsibleState.None,
		}];
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
