/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, MutableDisposable } from '../../../../base/common/lifecycle.js';
import { URI } from '../../../../base/common/uri.js';
import { registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { ICommentService } from '../../comments/browser/commentService.js';
import { IWorkstreamCommentService } from '../../../services/workstreamComments/common/workstreamCommentService.js';
import { WorkstreamCommentServiceImpl } from '../../../services/workstreamComments/browser/workstreamCommentServiceImpl.js';
import { IOrchestratorService } from '../../../services/orchestrator/common/orchestratorService.js';
import { WorkstreamCommentController } from './workstreamCommentController.js';

// Ensure the service singleton is registered (side-effect import)
import '../../../services/workstreamComments/browser/workstreamCommentServiceImpl.js';

class WorkstreamCommentsContribution extends Disposable {

	static readonly ID = 'workbench.contrib.workstreamComments';

	private readonly _controller = this._register(new MutableDisposable<WorkstreamCommentController>());

	constructor(
		@ICommentService private readonly commentService: ICommentService,
		@IWorkstreamCommentService private readonly workstreamCommentService: IWorkstreamCommentService,
		@IOrchestratorService private readonly orchestratorService: IOrchestratorService,
	) {
		super();

		// Wait for orchestrator to be ready, then initialize
		this.orchestratorService.whenReady.then(() => this._initialize());
	}

	private _initialize(): void {
		// Set the base path from the first repository (the main repo root)
		this._updateBasePath();

		// Create the comment controller
		this._controller.value = new WorkstreamCommentController(
			this.commentService,
			this.workstreamCommentService,
			this.orchestratorService,
		);

		// Update base path when active worktree changes
		this._register(this.orchestratorService.onDidChangeActiveWorktree(() => {
			this._updateBasePath();
		}));

		// Update base path when repositories change
		this._register(this.orchestratorService.onDidChangeRepositories(() => {
			this._updateBasePath();
		}));
	}

	private _updateBasePath(): void {
		// Use the first repo's path as the base for comment storage
		const repos = this.orchestratorService.repositories;
		if (repos.length > 0) {
			const commentService = this.workstreamCommentService as WorkstreamCommentServiceImpl;
			commentService.setBasePath(URI.file(repos[0].path));
		}
	}
}

registerWorkbenchContribution2(
	WorkstreamCommentsContribution.ID,
	WorkstreamCommentsContribution,
	WorkbenchPhase.AfterRestored,
);
