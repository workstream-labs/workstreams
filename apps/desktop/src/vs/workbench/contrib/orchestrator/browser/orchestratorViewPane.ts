/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Workstreams Labs. All rights reserved.
 *  Licensed under the Elastic License 2.0 (ELv2). See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import '../../../browser/parts/orchestrator/media/orchestratorPart.css';
import { $, append, addDisposableListener, EventType } from '../../../../base/browser/dom.js';
import { DisposableStore } from '../../../../base/common/lifecycle.js';
import { localize, localize2 } from '../../../../nls.js';
import { IContextMenuService } from '../../../../platform/contextview/browser/contextView.js';
import { IHoverService } from '../../../../platform/hover/browser/hover.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { IKeybindingService } from '../../../../platform/keybinding/common/keybinding.js';
import { IOpenerService } from '../../../../platform/opener/common/opener.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { IViewDescriptorService, IViewsRegistry, IViewContainersRegistry, Extensions as ViewExtensions, ViewContainerLocation } from '../../../common/views.js';
import { ViewPane, IViewPaneOptions } from '../../../browser/parts/views/viewPane.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { SyncDescriptor } from '../../../../platform/instantiation/common/descriptors.js';
import { ViewPaneContainer } from '../../../browser/parts/views/viewPaneContainer.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { IOrchestratorService, IRepositoryEntry, IWorktreeEntry, WorktreeSessionState } from '../../../services/orchestrator/common/orchestratorService.js';
import { ITerminalService } from '../../terminal/browser/terminal.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { VSBuffer } from '../../../../base/common/buffer.js';
import { URI } from '../../../../base/common/uri.js';
import { showAddWorktreeModal, agentsFromIds, DroppedImage, TERMINAL_AGENT_ID } from './addWorktreeModal.js';
import { showDeleteWorktreeModal } from './deleteWorktreeModal.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { IUpdate, IUpdateService, State, StateType } from '../../../../platform/update/common/update.js';

export const ORCHESTRATOR_VIEW_CONTAINER_ID = 'workbench.view.orchestrator';
export const ORCHESTRATOR_VIEW_ID = 'workbench.view.orchestrator.worktrees';

export class OrchestratorViewPane extends ViewPane {

	private static readonly FLIP_DURATION_MS = 250;
	private static readonly DISMISS_KEY = 'update/bannerDismissedTime';
	private static readonly DISMISS_COOLDOWN_MS = 24 * 60 * 60 * 1000; // 1 day

	private repoListElement: HTMLElement | undefined;
	private updateBannerElement: HTMLElement | undefined;
	private readonly renderDisposables = this._register(new DisposableStore());
	private readonly bannerDisposables = this._register(new DisposableStore());

	constructor(
		options: IViewPaneOptions,
		@IOrchestratorService private readonly orchestratorService: IOrchestratorService,
		@ITerminalService private readonly terminalService: ITerminalService,
		@IFileService private readonly fileService: IFileService,
		@IUpdateService private readonly updateService: IUpdateService,
		@IStorageService private readonly storageService: IStorageService,
		@IKeybindingService keybindingService: IKeybindingService,
		@IContextMenuService contextMenuService: IContextMenuService,
		@IConfigurationService configurationService: IConfigurationService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IViewDescriptorService viewDescriptorService: IViewDescriptorService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IOpenerService openerService: IOpenerService,
		@IThemeService themeService: IThemeService,
		@IHoverService hoverService: IHoverService,
	) {
		super(options, keybindingService, contextMenuService, configurationService, contextKeyService, viewDescriptorService, instantiationService, openerService, themeService, hoverService);
		this.headerVisible = false;
		this._register(this.orchestratorService.onDidChangeRepositories(() => this.renderContent()));
		this._register(this.orchestratorService.onDidChangeSessionState(() => this.renderContent()));
		this._register(this.updateService.onStateChange(state => this.onUpdateStateChange(state)));
	}

	protected override renderBody(container: HTMLElement): void {
		super.renderBody(container);
		container.classList.add('orchestrator-content');

		// Sticky header bar
		const headerBar = append(container, $('.orchestrator-header-bar'));
		const headerLeft = append(headerBar, $('.orchestrator-header-left'));
		const headerIcon = append(headerLeft, $('.codicon.codicon-project'));
		headerIcon.classList.add('orchestrator-header-icon');
		const headerTitle = append(headerLeft, $('.orchestrator-header-title'));
		headerTitle.textContent = localize('projects', "Projects");
		const addBtn = append(headerBar, $('.orchestrator-header-add.codicon.codicon-diff-added'));
		addBtn.title = localize('addRepository', "Add Repository");
		this._register(addDisposableListener(addBtn, EventType.CLICK, () => {
			this.orchestratorService.pickAndAddRepository();
		}));

		this.repoListElement = append(container, $('.repo-list'));

		this.renderContent();

		// Update banner — appended after repo-list so it pins to bottom of flex column
		this.onUpdateStateChange(this.updateService.state);

		// Copyright footer
		const footer = append(container, $('.orchestrator-footer'));
		footer.textContent = '\u00A9 Workstreams Labs';
	}

	private renderContent(): void {
		if (!this.repoListElement) {
			return;
		}

		// FLIP step 1: snapshot old positions before clearing DOM
		const oldPositions = this.snapshotWorktreePositions();

		this.renderDisposables.clear();
		this.repoListElement.textContent = '';

		for (const repo of this.orchestratorService.repositories) {
			this.renderRepository(repo);
		}

		// FLIP step 2: animate items that moved
		this.animateFlip(oldPositions);
	}

	private renderRepository(repo: IRepositoryEntry): void {
		const repoSection = append(this.repoListElement!, $('.repo-section'));

		const header = append(repoSection, $('.repo-header'));
		const headerLeft = append(header, $('.repo-header-left'));

		const folderIcon = append(headerLeft, $('.repo-folder-icon.codicon'));
		folderIcon.classList.add(repo.isCollapsed ? 'codicon-folder' : 'codicon-folder-opened');

		const nameEl = append(headerLeft, $('.repo-name'));
		nameEl.textContent = repo.name;

		const headerRight = append(header, $('.repo-header-right'));

		const headerActions = append(headerRight, $('.repo-header-actions'));
		const addWorktreeBtn = append(headerActions, $('.repo-action.codicon.codicon-plus'));
		addWorktreeBtn.title = localize('addWorktree', "Add Worktree");
		const removeRepoBtn = append(headerActions, $('.repo-action.codicon.codicon-close'));
		removeRepoBtn.title = localize('removeRepo', "Remove Repository");

		const chevron = append(headerRight, $('.repo-chevron.codicon'));
		chevron.classList.add(repo.isCollapsed ? 'codicon-chevron-right' : 'codicon-chevron-down');

		this.renderDisposables.add(addDisposableListener(addWorktreeBtn, EventType.CLICK, e => {
			e.stopPropagation();
			this.showAddWorktreeModal(repo.path);
		}));

		this.renderDisposables.add(addDisposableListener(removeRepoBtn, EventType.CLICK, e => {
			e.stopPropagation();
			this.orchestratorService.removeRepository(repo.path);
		}));

		this.renderDisposables.add(addDisposableListener(header, EventType.CLICK, () => {
			this.orchestratorService.toggleRepositoryCollapsed(repo.path);
		}));

		if (!repo.isCollapsed) {
			const worktreeList = append(repoSection, $('.worktree-list'));
			const sorted = this.sortWorktrees(repo.worktrees, repo.path);
			for (const worktree of sorted) {
				this.renderWorktree(worktreeList, repo, worktree);
			}
		}
	}

	private renderWorktree(container: HTMLElement, repo: IRepositoryEntry, worktree: IWorktreeEntry): void {
		const item = append(container, $('.worktree-item'));
		item.dataset.worktreePath = worktree.path;
		if (worktree.isActive) {
			item.classList.add('active');
		}
		if (worktree.provisioning) {
			item.classList.add('provisioning');
		}

		const isMainWorktree = worktree.path === repo.path;
		const iconEl = append(item, $('.worktree-icon'));
		this.applySessionStateIcon(iconEl, worktree);

		const info = append(item, $('.worktree-info'));

		// Row 1: name ... [+N -N] / [delete] on hover
		const nameRow = append(info, $('.worktree-name-row'));
		const nameEl = append(nameRow, $('.worktree-name'));
		nameEl.textContent = worktree.name;

		const rightSlot = append(nameRow, $('.worktree-name-right'));

		if (!isMainWorktree && !worktree.provisioning) {
			const deleteBtn = append(rightSlot, $('.worktree-delete.icon-delete-svg'));
			deleteBtn.title = localize('deleteWorktree', "Delete Worktree");
			this.renderDisposables.add(addDisposableListener(deleteBtn, EventType.CLICK, e => {
				e.stopPropagation();
				showDeleteWorktreeModal({
					name: worktree.name,
					branch: worktree.branch,
					filesChanged: worktree.filesChanged,
					additions: worktree.additions,
					deletions: worktree.deletions,
					defaultBranch: worktree.defaultBranch ?? 'main',
				}).then(confirmed => {
					if (confirmed) {
						this.orchestratorService.removeWorktree(repo.path, worktree.branch);
					}
				});
			}));
		}

		if (!worktree.provisioning) {
			const hasStats = (worktree.additions ?? 0) > 0 || (worktree.deletions ?? 0) > 0;
			if (hasStats) {
				const statsEl = append(rightSlot, $('.worktree-diff-stats'));
				if (worktree.additions) {
					const addEl = append(statsEl, $('.diff-stat-add'));
					addEl.textContent = `+${worktree.additions}`;
				}
				if (worktree.deletions) {
					const delEl = append(statsEl, $('.diff-stat-del'));
					delEl.textContent = `-${worktree.deletions}`;
				}
			}
		}

		// Row 2: branch ... [· Archive] for merged PRs
		const branchRow = append(info, $('.worktree-branch-row'));
		const branchEl = append(branchRow, $('.worktree-branch'));
		branchEl.textContent = worktree.branch;

		if (worktree.prState === 'merged' && !isMainWorktree && !worktree.provisioning) {
			const separator = append(branchRow, $('.worktree-archive-separator'));
			separator.textContent = '\u00B7';
			const archiveBtn = append(branchRow, $('.worktree-archive-btn'));
			append(archiveBtn, $('span.codicon.codicon-archive'));
			const archiveLabel = append(archiveBtn, $('span'));
			archiveLabel.textContent = localize('archive', "Archive");
			this.renderDisposables.add(addDisposableListener(archiveBtn, EventType.CLICK, e => {
				e.stopPropagation();
				this.orchestratorService.removeWorktree(repo.path, worktree.branch);
			}));
		}

		if (!worktree.provisioning) {
			this.renderDisposables.add(addDisposableListener(item, EventType.CLICK, () => {
				this.orchestratorService.switchTo(worktree);
			}));
		}
	}

	private onUpdateStateChange(state: State): void {
		const container = this.repoListElement?.parentElement;
		if (!container) {
			return;
		}

		if (state.type === StateType.Ready && !this.isDismissCooldownActive()) {
			this.showUpdateBanner(container, state.update);
		} else {
			this.hideUpdateBanner();
		}
	}

	private isDismissCooldownActive(): boolean {
		const raw = this.storageService.get(OrchestratorViewPane.DISMISS_KEY, StorageScope.APPLICATION);
		if (!raw) {
			return false;
		}
		return (Date.now() - parseInt(raw, 10)) < OrchestratorViewPane.DISMISS_COOLDOWN_MS;
	}

	private showUpdateBanner(container: HTMLElement, update: IUpdate | undefined): void {
		this.hideUpdateBanner();

		const banner = append(container, $('.update-banner'));

		// Dismiss button (top-right)
		const dismissBtn = append(banner, $('button.update-banner-dismiss'));
		dismissBtn.setAttribute('aria-label', localize('dismiss', "Dismiss"));
		const dismissIcon = append(dismissBtn, $('span.codicon.codicon-close'));
		dismissIcon.setAttribute('aria-hidden', 'true');
		this.bannerDisposables.add(addDisposableListener(dismissBtn, EventType.CLICK, () => {
			this.storageService.store(
				OrchestratorViewPane.DISMISS_KEY,
				String(Date.now()),
				StorageScope.APPLICATION,
				StorageTarget.MACHINE
			);
			this.hideUpdateBanner();
		}));

		// Description text
		const description = append(banner, $('.update-banner-description'));
		const version = update?.productVersion ? `v${update.productVersion}` : 'A new version';
		description.textContent = localize('readyToUpdateDesc', "{0} is available. Restart to update.", version);

		// Actions row
		const actions = append(banner, $('.update-banner-actions'));

		const restartBtn = append(actions, $('button.update-banner-btn.action'));
		restartBtn.textContent = localize('restart', "Restart");
		this.bannerDisposables.add(addDisposableListener(restartBtn, EventType.CLICK, () => {
			this.updateService.quitAndInstall();
		}));

		if (update?.changelogUrl) {
			const changelogBtn = append(actions, $('button.update-banner-btn.link'));
			changelogBtn.textContent = localize('changelog', "Changelog \u2192");
			this.bannerDisposables.add(addDisposableListener(changelogBtn, EventType.CLICK, () => {
				this.openerService.open(URI.parse(update.changelogUrl!));
			}));
		}

		this.updateBannerElement = banner;
	}

	private hideUpdateBanner(): void {
		this.bannerDisposables.clear();
		if (this.updateBannerElement) {
			this.updateBannerElement.remove();
			this.updateBannerElement = undefined;
		}
	}

	private async showAddWorktreeModal(repoPath: string): Promise<void> {
		const [branches, activeBranch, detectedIds] = await Promise.all([
			this.orchestratorService.listBranches(repoPath),
			this.orchestratorService.getCurrentBranch(repoPath).catch(() => ''),
			this.orchestratorService.detectAgents(),
		]);
		const currentBranch = (activeBranch && branches.includes(activeBranch)) ? activeBranch : branches[0];
		const agents = agentsFromIds([...detectedIds, TERMINAL_AGENT_ID]);

		const agentCommands: Record<string, string> = {};
		for (const id of [...detectedIds, TERMINAL_AGENT_ID]) {
			agentCommands[id] = this.orchestratorService.getAgentCommand(id);
		}

		const result = await showAddWorktreeModal({
			branches,
			agents,
			defaultBranch: currentBranch,
			defaultAgent: agents.length > 0 ? agents[0].id : '',
			agentCommands,
			onAgentCommandChange: (agentId, command) => {
				this.orchestratorService.setAgentCommand(agentId, command);
			},
			onSubmit: async (r) => {
				await this.orchestratorService.addWorktree(repoPath, r.name, r.prompt, r.baseBranch, r.featureName);
			},
		});

		if (result) {
			const repo = this.orchestratorService.repositories.find(r => r.path === repoPath);
			const newWorktree = repo?.worktrees.find(w => w.branch === result.name);
			if (newWorktree) {
				// Save dropped images into worktree and build prompt with image references
				const imagePaths = await this.saveDroppedImages(newWorktree.path, result.images);
				const prompt = this.buildPromptWithImages(result.prompt, imagePaths);

				// switchTo swaps the workspace folder, so terminals open in the worktree directory
				await this.orchestratorService.switchTo(newWorktree);

				const terminal = await this.terminalService.createTerminal();
				await this.terminalService.revealActiveTerminal();

				if (result.agent !== TERMINAL_AGENT_ID) {
					const command = this.orchestratorService.getAgentCommand(result.agent);
					terminal.sendText(command, true);

					await new Promise(resolve => setTimeout(resolve, 2000));
					terminal.sendText(prompt, true);
				}
			}
		}
	}

	private async saveDroppedImages(worktreePath: string, images: DroppedImage[]): Promise<string[]> {
		if (images.length === 0) {
			return [];
		}

		const imagesDir = URI.joinPath(URI.file(worktreePath), '..', 'images');
		await this.fileService.createFolder(imagesDir);

		const paths: string[] = [];
		for (const image of images) {
			const filePath = URI.joinPath(imagesDir, image.name);
			await this.fileService.writeFile(filePath, VSBuffer.wrap(image.data));
			paths.push(filePath.fsPath);
		}
		return paths;
	}

	private buildPromptWithImages(prompt: string, imagePaths: string[]): string {
		if (imagePaths.length === 0) {
			return prompt || '';
		}

		const parts: string[] = [];
		if (prompt) {
			parts.push(prompt);
		}
		parts.push('');
		parts.push('Reference images:');
		for (const p of imagePaths) {
			parts.push(p);
		}
		return parts.join('\n');
	}

	//#region Sorting

	private sortWorktrees(worktrees: readonly IWorktreeEntry[], repoPath: string): IWorktreeEntry[] {
		return [...worktrees].sort((a, b) =>
			this.getWorktreeSortPriority(a, repoPath) - this.getWorktreeSortPriority(b, repoPath)
		);
	}

	private getWorktreeSortPriority(worktree: IWorktreeEntry, repoPath: string): number {
		// Main/local worktree always first
		if (worktree.path === repoPath) {
			return 0;
		}
		const sessionState = this.orchestratorService.getSessionState(worktree.path);
		// Needs attention — agent waiting for user input
		if (sessionState === WorktreeSessionState.Permission) {
			return 1;
		}
		// Running — agent actively working
		if (sessionState === WorktreeSessionState.Working) {
			return 2;
		}
		// Merged PRs — bottom, ready to archive
		if (worktree.prState === 'merged') {
			return 5;
		}
		// Has changes — branches with work
		if ((worktree.additions ?? 0) > 0 || (worktree.deletions ?? 0) > 0) {
			return 3;
		}
		// Idle / no changes
		return 4;
	}

	//#endregion

	//#region FLIP animation

	private snapshotWorktreePositions(): Map<string, DOMRect> {
		const positions = new Map<string, DOMRect>();
		if (!this.repoListElement) {
			return positions;
		}
		for (const el of this.repoListElement.querySelectorAll<HTMLElement>('.worktree-item[data-worktree-path]')) {
			const wtPath = el.dataset.worktreePath;
			if (wtPath) {
				positions.set(wtPath, el.getBoundingClientRect());
			}
		}
		return positions;
	}

	private animateFlip(oldPositions: Map<string, DOMRect>): void {
		if (oldPositions.size === 0 || !this.repoListElement) {
			return;
		}

		const items = this.repoListElement.querySelectorAll<HTMLElement>('.worktree-item[data-worktree-path]');
		for (const el of items) {
			const wtPath = el.dataset.worktreePath;
			if (!wtPath) {
				continue;
			}

			const oldRect = oldPositions.get(wtPath);
			if (!oldRect) {
				continue; // new item — no animation
			}

			const newRect = el.getBoundingClientRect();
			const deltaY = oldRect.top - newRect.top;

			if (Math.abs(deltaY) < 1) {
				continue; // didn't move
			}

			// Invert: place at old position
			el.style.transform = `translateY(${deltaY}px)`;
			el.style.transition = 'none';

			// Force layout so the invert is applied before the play
			el.offsetHeight; // eslint-disable-line no-unused-expressions

			// Play: animate to new position
			el.style.transition = `transform ${OrchestratorViewPane.FLIP_DURATION_MS}ms ease`;
			el.style.transform = '';
		}
	}

	//#endregion

	private static readonly BRAILLE_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
	private static readonly BRAILLE_INTERVAL_MS = 80;

	private applySessionStateIcon(el: HTMLElement, worktree: IWorktreeEntry): void {
		el.className = 'worktree-icon';

		if (worktree.provisioning) {
			el.classList.add('codicon', 'codicon-loading', 'state-provisioning');
			return;
		}

		// Read session state from the authoritative map, not from the
		// worktree entry which may be stale after async _repositories mutations.
		const sessionState = this.orchestratorService.getSessionState(worktree.path);
		switch (sessionState) {
			case WorktreeSessionState.Working: {
				el.classList.add('state-running', 'braille-spinner');
				let frame = 0;
				el.textContent = OrchestratorViewPane.BRAILLE_FRAMES[0];
				const interval = setInterval(() => {
					frame = (frame + 1) % OrchestratorViewPane.BRAILLE_FRAMES.length;
					el.textContent = OrchestratorViewPane.BRAILLE_FRAMES[frame];
				}, OrchestratorViewPane.BRAILLE_INTERVAL_MS);
				this.renderDisposables.add({ dispose: () => clearInterval(interval) });
				break;
			}
			case WorktreeSessionState.Permission:
				el.classList.add('codicon', 'codicon-stop-circle', 'state-waiting');
				break;
			default:
				if (!worktree.prLoaded) {
					el.classList.add('icon-git-branch-svg', 'state-loading');
				} else if (worktree.prState === 'draft') {
					el.classList.add('icon-git-pr-draft-svg');
				} else if (worktree.prState === 'open') {
					el.classList.add('icon-git-pr-svg');
				} else if (worktree.prState === 'merged') {
					el.classList.add('icon-git-merge-svg');
				} else if (worktree.prState === 'closed') {
					el.classList.add('icon-git-pr-close-svg');
				} else {
					el.classList.add('icon-git-branch-svg');
				}
				break;
		}
	}

}

// --- Registration ---

const viewContainer = Registry.as<IViewContainersRegistry>(ViewExtensions.ViewContainersRegistry).registerViewContainer(
	{
		id: ORCHESTRATOR_VIEW_CONTAINER_ID,
		title: localize2('orchestrator', "Orchestrator"),
		ctorDescriptor: new SyncDescriptor(ViewPaneContainer, [ORCHESTRATOR_VIEW_CONTAINER_ID, { mergeViewWithContainerWhenSingleView: true }]),
		icon: Codicon.gitBranch,
		order: 1,
		hideIfEmpty: false,
	},
	ViewContainerLocation.AuxiliaryBar,
	{ isDefault: true }
);

Registry.as<IViewsRegistry>(ViewExtensions.ViewsRegistry).registerViews(
	[{
		id: ORCHESTRATOR_VIEW_ID,
		name: localize2('orchestrator', "Orchestrator"),
		containerIcon: Codicon.gitBranch,
		ctorDescriptor: new SyncDescriptor(OrchestratorViewPane),
		canToggleVisibility: false,
		canMoveView: false,
		order: 1,
	}],
	viewContainer
);

