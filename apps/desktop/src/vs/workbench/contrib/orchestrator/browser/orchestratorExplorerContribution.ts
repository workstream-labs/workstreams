/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Workstreams Labs. All rights reserved.
 *  Licensed under the Elastic License 2.0 (ELv2). See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { IAsyncDataTreeViewState } from '../../../../base/browser/ui/tree/asyncDataTree.js';
import { IOrchestratorService, IWorktreeEntry } from '../../../services/orchestrator/common/orchestratorService.js';
import { IExplorerService } from '../../files/browser/files.js';
import { registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';

/**
 * Persists the file explorer's tree view state (expanded folders, scroll
 * position, focus, selection) per worktree so switching away and back
 * restores the tree exactly as the user left it.
 *
 * Follows the same contribution pattern as OrchestratorTerminalContribution:
 * listens to orchestrator events and coordinates explorer state externally,
 * without modifying explorer code beyond minimal IExplorerView hooks.
 */
export class OrchestratorExplorerContribution extends Disposable {

	static readonly ID = 'workbench.contrib.orchestratorExplorer';

	private readonly _viewStateCache = new Map<string, IAsyncDataTreeViewState>();
	private _trackedWorktreePath: string | undefined;

	constructor(
		@IOrchestratorService private readonly _orchestratorService: IOrchestratorService,
		@IExplorerService private readonly _explorerService: IExplorerService,
	) {
		super();

		this._trackedWorktreePath = this._orchestratorService.activeWorktree?.path;

		this._register(this._orchestratorService.onDidChangeActiveWorktree(wt => this._onActiveWorktreeChanging(wt)));
		this._register(this._orchestratorService.onDidRemoveWorktree(({ worktreePath }) => {
			this._viewStateCache.delete(worktreePath);
		}));
	}

	private _onActiveWorktreeChanging(newWorktree: IWorktreeEntry): void {
		// Save current tree state for the worktree we're leaving
		if (this._trackedWorktreePath) {
			const currentState = this._explorerService.getTreeViewState();
			if (currentState) {
				this._viewStateCache.set(this._trackedWorktreePath, currentState);
			}
		}

		// Queue cached state for the worktree we're entering.
		// setTreeInput (triggered by the folder swap that follows) will
		// consume this instead of reading stale cross-worktree state.
		const cachedState = this._viewStateCache.get(newWorktree.path);
		if (cachedState) {
			this._explorerService.setPendingTreeViewState(cachedState);
		}

		this._trackedWorktreePath = newWorktree.path;
	}
}

registerWorkbenchContribution2(OrchestratorExplorerContribution.ID, OrchestratorExplorerContribution, WorkbenchPhase.AfterRestored);
