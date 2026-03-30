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
import { ICodeEditorService } from '../../../../editor/browser/services/codeEditorService.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { ITerminalService } from '../../terminal/browser/terminal.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { WorkstreamCommentController } from './workstreamCommentController.js';
import { Action2, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { localize, localize2 } from '../../../../nls.js';
import { IQuickInputService, IQuickPickItem } from '../../../../platform/quickinput/common/quickInput.js';
import { IWorkstreamComment } from '../../../services/workstreamComments/common/workstreamCommentService.js';

// Ensure the service singleton is registered (side-effect import)
import '../../../services/workstreamComments/browser/workstreamCommentServiceImpl.js';

class WorkstreamCommentsContribution extends Disposable {

	static readonly ID = 'workbench.contrib.workstreamComments';

	private readonly _controller = this._register(new MutableDisposable<WorkstreamCommentController>());

	constructor(
		@ICommentService private readonly commentService: ICommentService,
		@IWorkstreamCommentService private readonly workstreamCommentService: IWorkstreamCommentService,
		@IOrchestratorService private readonly orchestratorService: IOrchestratorService,
		@ICodeEditorService private readonly codeEditorService: ICodeEditorService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@INotificationService _notificationService: INotificationService,
		@ILogService private readonly logService: ILogService,
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
			this.codeEditorService,
			this.configurationService,
			this.logService,
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

// --- "Send Comments to Claude" action ---

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'workstreamComments.sendToClaude',
			title: localize2("sendCommentsToClaude", "Workstream: Send Review Comments to Claude"),
			f1: true,
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const orchestratorService = accessor.get(IOrchestratorService);
		const commentService = accessor.get(IWorkstreamCommentService);
		const terminalService = accessor.get(ITerminalService);
		const notificationService = accessor.get(INotificationService);
		const quickInputService = accessor.get(IQuickInputService);

		const worktree = orchestratorService.activeWorktree;
		if (!worktree) {
			notificationService.warn(localize("sendComments.noWorktree", "No active worktree"));
			return;
		}

		const comments = await commentService.getComments(worktree.name);
		if (comments.length === 0) {
			notificationService.info(localize("sendComments.noComments", "No review comments to send"));
			return;
		}

		// Show picker with all comments, pre-selected
		interface CommentPickItem extends IQuickPickItem {
			comment: IWorkstreamComment;
		}

		const items: CommentPickItem[] = comments.map((c, i) => {
			const sideLabel = c.side === 'old'
				? localize("sendComments.side.original", "original")
				: localize("sendComments.side.modified", "modified");
			return {
				label: `${i + 1}. ${c.filePath}:${c.line} (${sideLabel})`,
				description: c.text.length > 80 ? c.text.substring(0, 80) + '...' : c.text,
				detail: c.text.length > 80 ? c.text : undefined,
				picked: true,
				comment: c,
			};
		});

		const picked = await new Promise<CommentPickItem[] | undefined>(resolve => {
			const picker = quickInputService.createQuickPick<CommentPickItem>();
			picker.items = items;
			picker.selectedItems = items;
			picker.canSelectMany = true;
			picker.title = localize("sendComments.title", "Send Review Comments to Claude ({0} total)", comments.length);
			picker.placeholder = localize("sendComments.placeholder", "Uncheck comments you don't want to send");
			picker.ok = true;
			picker.customButton = true;
			picker.customLabel = localize("sendComments.sendAll", "Send All");

			picker.onDidAccept(() => {
				resolve([...picker.selectedItems]);
				picker.dispose();
			});
			picker.onDidCustom(() => {
				resolve([...items]);
				picker.dispose();
			});
			picker.onDidHide(() => {
				resolve(undefined);
				picker.dispose();
			});

			picker.show();
		});

		if (!picked || picked.length === 0) {
			return;
		}

		// Create a new terminal, start Claude, and send comments
		const terminal = await terminalService.createTerminal({});
		await terminalService.revealActiveTerminal();

		// Start Claude Code session, then send comments after it initializes
		terminal.sendText('claude', true);
		await new Promise(resolve => setTimeout(resolve, 2000));

		// Format selected comments as prompt
		const lines: string[] = [
			localize("sendComments.prompt.header", "I have the following review comments on the changes in this worktree. Please address each one:") + '\n',
		];
		for (let i = 0; i < picked.length; i++) {
			const c = picked[i].comment;
			const sideLabel = c.side === 'old' ? 'original' : 'modified';
			lines.push(`${i + 1}. **${c.filePath}:${c.line}** (${sideLabel})`);
			lines.push(`   ${c.text}\n`);
		}
		lines.push(localize("sendComments.prompt.footer", "Fix each issue in the current working tree. Use the file paths and line numbers to locate the code."));

		terminal.sendText(lines.join('\n'), true);

		// Delete sent comments
		for (const item of picked) {
			await commentService.deleteComment(worktree.name, item.comment.id);
		}

		// Focus the terminal so user sees Claude acting on the comments
		await terminalService.revealActiveTerminal();

		notificationService.info(localize("sendComments.sent", "Sent {0} comment(s) to Claude and cleared them", picked.length));
	}
});
