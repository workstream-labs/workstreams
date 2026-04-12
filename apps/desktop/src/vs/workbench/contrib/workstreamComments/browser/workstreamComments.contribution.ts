/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Workstreams Labs. All rights reserved.
 *  Licensed under the Elastic License 2.0 (ELv2). See LICENSE.txt in the project root for license information.
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
import { IGitHubCommentsService, ResolveContextStatus } from '../../../services/workstreamComments/common/githubCommentsService.js';
import { IGitWorktreeService } from '../../../services/orchestrator/common/gitWorktreeService.js';
import { basename } from '../../../../base/common/path.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { Extensions as ViewContainerExtensions, IViewContainersRegistry } from '../../../common/views.js';
import { ISCMService, VIEWLET_ID } from '../../scm/common/scm.js';
import { WorkstreamCommentsViewRegistration } from './workstreamCommentsView.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';

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
		@IGitWorktreeService private readonly gitWorktreeService: IGitWorktreeService,
		@ICodeEditorService private readonly codeEditorService: ICodeEditorService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@INotificationService _notificationService: INotificationService,
		@ILogService private readonly logService: ILogService,
		@ISCMService private readonly scmService: ISCMService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
	) {
		super();

		// Wait for orchestrator to be ready, then initialize
		this.orchestratorService.whenReady.then(() => this._initialize());
	}

	private async _initialize(): Promise<void> {
		// Set the base path from the first repository's workstreams directory
		await this._updateBasePath();

		// Create the comment controller
		this._controller.value = new WorkstreamCommentController(
			this.commentService,
			this.workstreamCommentService,
			this.orchestratorService,
			this.codeEditorService,
			this.configurationService,
			this.logService,
			this.scmService,
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

	private async _updateBasePath(): Promise<void> {
		const repos = this.orchestratorService.repositories;
		if (repos.length > 0) {
			const wsDir = await this.gitWorktreeService.getWorkstreamsDir(repos[0].path);
			const commentService = this.workstreamCommentService as WorkstreamCommentServiceImpl;
			commentService.setBasePath(URI.file(wsDir));
		}
	}
}

registerWorkbenchContribution2(
	WorkstreamCommentsContribution.ID,
	WorkstreamCommentsContribution,
	WorkbenchPhase.AfterRestored,
);

// --- "Open Comment" action (click-to-navigate from tree view) ---

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'workstreamComments.openComment',
			title: localize2("openComment", "Open Comment in Editor"),
			f1: false,
		});
	}

	async run(_accessor: ServicesAccessor, worktreePath: string, filePath: string, line: number, side: string): Promise<void> {
		const editorService = _accessor.get(IEditorService);
		const modifiedUri = URI.file(`${worktreePath}/${filePath}`);

		// Build a git: URI for the HEAD version (original side of the diff)
		const originalUri = modifiedUri.with({
			scheme: 'git',
			path: modifiedUri.path,
			query: JSON.stringify({ path: modifiedUri.fsPath, ref: 'HEAD' }),
		});

		await editorService.openEditor({
			original: { resource: originalUri },
			modified: { resource: modifiedUri },
			label: `${basename(filePath)} (Working Tree)`,
			options: {
				selection: { startLineNumber: line, startColumn: 1 },
				revealIfOpened: true,
				pinned: false,
			},
		});
	}
});

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

		// Find the repo that owns this worktree
		const repos = orchestratorService.repositories;
		let repoPath: string | undefined;
		for (const repo of repos) {
			if (repo.worktrees.some(wt => wt.path === worktree.path)) {
				repoPath = repo.path;
				break;
			}
		}
		if (!repoPath && repos.length === 1) {
			repoPath = repos[0].path;
		}

		interface OnlineThread {
			filePath: string;
			line: number;
			resolved: boolean;
			comments: { author: string; text: string }[];
			createdAt: string;
		}

		let onlineThreads: OnlineThread[] = [];
		if (repoPath) {
			const result = await githubCommentsService.resolveContext(repoPath, worktree.branch);
			if (result.status === ResolveContextStatus.Found) {
				const threads = await githubCommentsService.getReviewThreads(result.context);
				for (const thread of threads) {
					if (thread.comments.length === 0) {
						continue;
					}
					onlineThreads.push({
						filePath: thread.path,
						line: thread.line ?? 0,
						resolved: thread.isResolved,
						comments: thread.comments.map(c => ({ author: c.author.login, text: c.body })),
						createdAt: thread.comments[0].createdAt,
					});
				}
			}
		}

		const unresolvedOnline = onlineThreads.filter(t => !t.resolved).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
		const resolvedOnline = onlineThreads.filter(t => t.resolved).sort((a, b) => a.createdAt.localeCompare(b.createdAt));

		const totalCount = offlineComments.length + onlineThreads.length;
		if (totalCount === 0) {
			notificationService.info(localize("sendComments.noComments", "No review comments to send"));
			return;
		}

		// Build unified picker items: offline → online unresolved → online resolved
		type PickSource = 'offline' | 'online';
		interface CommentPickItem extends IQuickPickItem {
			source: PickSource;
			offlineComment?: IWorkstreamComment;
			onlineThread?: OnlineThread;
		}

		const items: CommentPickItem[] = [];
		const selectedItems: CommentPickItem[] = [];

		for (const c of offlineComments) {
			const fileName = basename(c.filePath);
			const sideLabel = c.side === 'old' ? 'original' : 'modified';
			const item: CommentPickItem = {
				label: `$(comment) ${fileName}:${c.line}`,
				description: `offline \u00B7 ${sideLabel}`,
				detail: `    ${c.text}`,
				picked: true,
				source: 'offline',
				offlineComment: c,
			};
			items.push(item);
			selectedItems.push(item);
		}

		for (const t of unresolvedOnline) {
			const fileName = basename(t.filePath);
			const firstAuthor = t.comments[0].author;
			const preview = t.comments.map(c => `@${c.author}: ${c.text}`).join(' → ');
			const item: CommentPickItem = {
				label: `$(comment-discussion) ${fileName}:${t.line}`,
				description: `online \u00B7 @${firstAuthor}${t.comments.length > 1 ? ` +${t.comments.length - 1}` : ''}`,
				detail: `    ${preview}`,
				picked: true,
				source: 'online',
				onlineThread: t,
			};
			items.push(item);
			selectedItems.push(item);
		}

		for (const t of resolvedOnline) {
			const fileName = basename(t.filePath);
			const firstAuthor = t.comments[0].author;
			const preview = t.comments.map(c => `@${c.author}: ${c.text}`).join(' → ');
			const item: CommentPickItem = {
				label: `$(comment-discussion) ${fileName}:${t.line}`,
				description: `online \u00B7 @${firstAuthor}${t.comments.length > 1 ? ` +${t.comments.length - 1}` : ''} \u00B7 resolved`,
				detail: `    ${preview}`,
				picked: false,
				source: 'online',
				onlineThread: t,
			};
			items.push(item);
		}

		const picked = await new Promise<CommentPickItem[] | undefined>(resolve => {
			const picker = quickInputService.createQuickPick<CommentPickItem>();
			picker.items = items;
			picker.selectedItems = selectedItems;
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
		terminal.sendText(orchestratorService.getAgentCommand('claude'), true);
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
			} else if (item.source === 'online' && item.onlineThread) {
				const t = item.onlineThread;
				lines.push(`${i + 1}. **${t.filePath}:${t.line}** (GitHub PR)`);
				for (const c of t.comments) {
					lines.push(`   @${c.author}: ${c.text}`);
				}
				lines.push('');
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
		const orchestratorService = accessor.get(IOrchestratorService);
		const gitWorktreeService = accessor.get(IGitWorktreeService);
		const notificationService = accessor.get(INotificationService);

		// Determine the current repo so the new session gets linked to it
		let owner: string | undefined;
		let repo: string | undefined;
		const worktree = orchestratorService.activeWorktree;
		if (worktree) {
			const repos = orchestratorService.repositories;
			const matchedRepo = repos.find(r => r.worktrees.some(wt => wt.path === worktree.path)) ?? (repos.length === 1 ? repos[0] : undefined);
			if (matchedRepo) {
				const remoteUrl = await gitWorktreeService.getRemoteUrl(matchedRepo.path);
				const match = remoteUrl?.match(/github\.com[/:]([^/]+)\/([^/.]+?)(?:\.git)?$/i);
				if (match) {
					owner = match[1];
					repo = match[2];
				}
			}
		}

		const success = await githubCommentsService.signIn(owner, repo);
		if (success) {
			notificationService.info(localize("signIn.success", "Signed in to GitHub. Fetching PR review comments..."));
		} else {
			notificationService.warn(localize("signIn.failed", "GitHub sign-in was cancelled or failed"));
		}
	}
});
