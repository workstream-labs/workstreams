/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
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

export const ORCHESTRATOR_VIEW_CONTAINER_ID = 'workbench.view.orchestrator';
export const ORCHESTRATOR_VIEW_ID = 'workbench.view.orchestrator.worktrees';

export class OrchestratorViewPane extends ViewPane {

	private repoListElement: HTMLElement | undefined;
	private readonly renderDisposables = this._register(new DisposableStore());

	constructor(
		options: IViewPaneOptions,
		@IOrchestratorService private readonly orchestratorService: IOrchestratorService,
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
	}

	protected override renderBody(container: HTMLElement): void {
		super.renderBody(container);
		container.classList.add('orchestrator-content');
		container.style.flex = '1';
		container.style.height = '100%';
		container.style.minHeight = '0';

		// Sticky header bar
		const headerBar = append(container, $('.orchestrator-header-bar'));
		const headerTitle = append(headerBar, $('.orchestrator-header-title'));
		headerTitle.textContent = localize('projects', "Projects");
		const addBtn = append(headerBar, $('.orchestrator-header-add.codicon.codicon-diff-added'));
		addBtn.title = localize('addRepository', "Add Repository");
		this._register(addDisposableListener(addBtn, EventType.CLICK, () => {
			this.orchestratorService.pickAndAddRepository();
		}));

		this.repoListElement = append(container, $('.repo-list'));

		this.renderContent();
	}

	private renderContent(): void {
		if (!this.repoListElement) {
			return;
		}

		this.renderDisposables.clear();
		this.repoListElement.textContent = '';

		for (const repo of this.orchestratorService.repositories) {
			this.renderRepository(repo);
		}
	}

	private renderRepository(repo: IRepositoryEntry): void {
		const repoSection = append(this.repoListElement!, $('.repo-section'));

		const header = append(repoSection, $('.repo-header'));
		const headerLeft = append(header, $('.repo-header-left'));

		const chevron = append(headerLeft, $('.repo-chevron.codicon'));
		chevron.classList.add(repo.isCollapsed ? 'codicon-chevron-right' : 'codicon-chevron-down');

		const avatar = append(headerLeft, $('.repo-avatar'));
		avatar.textContent = repo.name.charAt(0).toUpperCase();

		const nameEl = append(headerLeft, $('.repo-name'));
		nameEl.textContent = repo.name;

		const countEl = append(headerLeft, $('.repo-count'));
		countEl.textContent = `(${repo.worktrees.length})`;

		const headerActions = append(header, $('.repo-header-actions'));

		const addWorktreeBtn = append(headerActions, $('.repo-action.codicon.codicon-plus'));
		addWorktreeBtn.title = localize('addWorktree', "Add Worktree");

		const removeRepoBtn = append(headerActions, $('.repo-action.codicon.codicon-trash'));
		removeRepoBtn.title = localize('removeRepo', "Remove Repository");

		this.renderDisposables.add(addDisposableListener(addWorktreeBtn, EventType.CLICK, e => {
			e.stopPropagation();
			this.orchestratorService.pickAndAddWorktree(repo.path);
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
			for (const worktree of repo.worktrees) {
				this.renderWorktree(worktreeList, repo, worktree);
			}
		}
	}

	private renderWorktree(container: HTMLElement, repo: IRepositoryEntry, worktree: IWorktreeEntry): void {
		const item = append(container, $('.worktree-item'));
		if (worktree.isActive) {
			item.classList.add('active');
		}

		append(item, $('.worktree-connector'));
		const iconEl = append(item, $('.worktree-icon'));
		this.applySessionStateIcon(iconEl, worktree);

		const info = append(item, $('.worktree-info'));
		const nameEl = append(info, $('.worktree-name'));
		nameEl.textContent = worktree.name;
		const branchEl = append(info, $('.worktree-branch'));
		branchEl.textContent = worktree.branch;

		const isMainWorktree = worktree.path === repo.path;
		if (!isMainWorktree) {
			const deleteBtn = append(item, $('.worktree-delete.codicon.codicon-trash'));
			deleteBtn.title = localize('deleteWorktree', "Delete Worktree");
			this.renderDisposables.add(addDisposableListener(deleteBtn, EventType.CLICK, e => {
				e.stopPropagation();
				this.orchestratorService.removeWorktree(repo.path, worktree.branch);
			}));
		}

		this.renderDisposables.add(addDisposableListener(item, EventType.CLICK, () => {
			this.orchestratorService.switchTo(worktree);
		}));
	}

	private static readonly BRAILLE_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
	private static readonly BRAILLE_INTERVAL_MS = 80;

	private applySessionStateIcon(el: HTMLElement, worktree: IWorktreeEntry): void {
		el.className = 'worktree-icon';
		switch (worktree.sessionState) {
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
			case WorktreeSessionState.Review:
				el.classList.add('codicon', 'codicon-check', 'state-done');
				break;
			default:
				el.classList.add('codicon', 'codicon-worktree');
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
