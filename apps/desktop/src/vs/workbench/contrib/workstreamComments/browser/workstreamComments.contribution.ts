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
import { IInstantiationService, ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { localize, localize2 } from '../../../../nls.js';
import { IQuickInputService, IQuickPickItem } from '../../../../platform/quickinput/common/quickInput.js';
import { IWorkstreamComment } from '../../../services/workstreamComments/common/workstreamCommentService.js';
import { IGitHubCommentsService } from '../../../services/workstreamComments/common/githubCommentsService.js';
import { basename } from '../../../../base/common/path.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { Extensions as ViewContainerExtensions, IViewContainersRegistry } from '../../../common/views.js';
import { VIEWLET_ID } from '../../scm/common/scm.js';
import { WorkstreamCommentsViewRegistration } from './workstreamCommentsView.js';

// Ensure the service singletons are registered (side-effect imports)
import '../../../services/workstreamComments/browser/workstreamCommentServiceImpl.js';
import '../../../services/workstreamComments/browser/githubCommentsServiceImpl.js';

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
		@IInstantiationService private readonly instantiationService: IInstantiationService,
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

		// Register the Comments tree view in the SCM sidebar
		this._initializeView();
	}

	private _initializeView(): void {
		const scmContainer = Registry.as<IViewContainersRegistry>(
			ViewContainerExtensions.ViewContainersRegistry
		).get(VIEWLET_ID);

		if (scmContainer) {
			this._register(this.instantiationService.createInstance(
				WorkstreamCommentsViewRegistration,
				scmContainer,
			));
		}
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
		const githubCommentsService = accessor.get(IGitHubCommentsService);
		const terminalService = accessor.get(ITerminalService);
		const notificationService = accessor.get(INotificationService);
		const quickInputService = accessor.get(IQuickInputService);

		const worktree = orchestratorService.activeWorktree;
		if (!worktree) {
			notificationService.warn(localize("sendComments.noWorktree", "No active worktree"));
			return;
		}

		// Fetch both offline and online comments
		const offlineComments = await commentService.getComments(worktree.name);

		const repos = orchestratorService.repositories;
		const repoPath = repos.length > 0 ? repos[0].path : undefined;
		let onlineComments: Array<{ filePath: string; line: number; author: string; text: string }> = [];
		if (repoPath) {
			const ctx = await githubCommentsService.resolveContext(repoPath, worktree.branch);
			if (ctx) {
				const threads = await githubCommentsService.getReviewThreads(ctx);
				for (const thread of threads) {
					if (thread.isResolved) {
						continue;
					}
					for (const c of thread.comments) {
						onlineComments.push({
							filePath: c.path ?? thread.path,
							line: c.line ?? thread.line ?? 0,
							author: c.author.login,
							text: c.body,
						});
					}
				}
			}
		}

		const totalCount = offlineComments.length + onlineComments.length;
		if (totalCount === 0) {
			notificationService.info(localize("sendComments.noComments", "No review comments to send"));
			return;
		}

		// Build unified picker items
		type PickSource = 'offline' | 'online';
		interface CommentPickItem extends IQuickPickItem {
			source: PickSource;
			offlineComment?: IWorkstreamComment;
			onlineComment?: { filePath: string; line: number; author: string; text: string };
		}

		const items: CommentPickItem[] = [];

		for (const c of offlineComments) {
			const fileName = basename(c.filePath);
			const sideLabel = c.side === 'old' ? 'original' : 'modified';
			items.push({
				label: `$(comment) ${fileName}:${c.line}`,
				description: `offline \u00B7 ${sideLabel}`,
				detail: `    ${c.text}`,
				picked: true,
				source: 'offline',
				offlineComment: c,
			});
		}

		for (const c of onlineComments) {
			const fileName = basename(c.filePath);
			items.push({
				label: `$(comment-discussion) ${fileName}:${c.line}`,
				description: `online \u00B7 @${c.author}`,
				detail: `    ${c.text}`,
				picked: true,
				source: 'online',
				onlineComment: c,
			});
		}

		const picked = await new Promise<CommentPickItem[] | undefined>(resolve => {
			const picker = quickInputService.createQuickPick<CommentPickItem>();
			picker.items = items;
			picker.selectedItems = items;
			picker.canSelectMany = true;
			picker.title = localize("sendComments.title", "Send Review Comments to Claude ({0} total)", totalCount);
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
			const item = picked[i];
			if (item.source === 'offline' && item.offlineComment) {
				const c = item.offlineComment;
				const sideLabel = c.side === 'old' ? 'original' : 'modified';
				lines.push(`${i + 1}. **${c.filePath}:${c.line}** (${sideLabel})`);
				lines.push(`   ${c.text}\n`);
			} else if (item.source === 'online' && item.onlineComment) {
				const c = item.onlineComment;
				lines.push(`${i + 1}. **${c.filePath}:${c.line}** (GitHub PR, @${c.author})`);
				lines.push(`   ${c.text}\n`);
			}
		}
		lines.push(localize("sendComments.prompt.footer", "Fix each issue in the current working tree. Use the file paths and line numbers to locate the code."));

		terminal.sendText(lines.join('\n'), true);

		// Delete only offline comments (online comments stay on GitHub)
		for (const item of picked) {
			if (item.source === 'offline' && item.offlineComment) {
				await commentService.deleteComment(worktree.name, item.offlineComment.id);
			}
		}

		// Focus the terminal so user sees Claude acting on the comments
		await terminalService.revealActiveTerminal();

		const offlineSent = picked.filter(i => i.source === 'offline').length;
		const onlineSent = picked.filter(i => i.source === 'online').length;
		notificationService.info(localize("sendComments.sent.combined", "Sent {0} comment(s) to Claude ({1} offline, {2} from GitHub PR)", picked.length, offlineSent, onlineSent));
	}
});

// --- "Sign in to GitHub" action ---

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'workstreamComments.signInToGitHub',
			title: localize2("signInToGitHub", "Workstream: Sign in to GitHub"),
			f1: true,
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const githubCommentsService = accessor.get(IGitHubCommentsService);
		const notificationService = accessor.get(INotificationService);

		const success = await githubCommentsService.signIn();
		if (success) {
			notificationService.info(localize("signIn.success", "Signed in to GitHub. Fetching PR review comments..."));
		} else {
			notificationService.warn(localize("signIn.failed", "GitHub sign-in was cancelled or failed"));
		}
	}
});
