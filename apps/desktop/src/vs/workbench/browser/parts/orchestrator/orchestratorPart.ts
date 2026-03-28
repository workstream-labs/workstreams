/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import './media/orchestratorPart.css';
import { Part } from '../../part.js';
import { Parts, IWorkbenchLayoutService } from '../../../services/layout/browser/layoutService.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { IStorageService } from '../../../../platform/storage/common/storage.js';
import { $, append, addDisposableListener, EventType } from '../../../../base/browser/dom.js';
import { Emitter } from '../../../../base/common/event.js';
import { DisposableStore } from '../../../../base/common/lifecycle.js';
import { localize } from '../../../../nls.js';
import { IRepositoryEntry, IWorktreeEntry, WorktreeSessionState } from '../../../services/orchestrator/common/orchestratorService.js';

export class OrchestratorPart extends Part {

	static readonly ORCHESTRATOR_WIDTH = 220;

	//#region IView

	readonly minimumWidth: number = OrchestratorPart.ORCHESTRATOR_WIDTH;
	readonly maximumWidth: number = OrchestratorPart.ORCHESTRATOR_WIDTH;
	readonly minimumHeight: number = 0;
	readonly maximumHeight: number = Number.POSITIVE_INFINITY;

	//#endregion

	private contentElement: HTMLElement | undefined;
	private repoListElement: HTMLElement | undefined;
	private repositories: IRepositoryEntry[] = [];
	private readonly renderDisposables = this._register(new DisposableStore());

	private readonly _onDidSelectWorktree = this._register(new Emitter<IWorktreeEntry>());
	readonly onDidSelectWorktree = this._onDidSelectWorktree.event;

	private readonly _onDidRequestAddRepository = this._register(new Emitter<void>());
	readonly onDidRequestAddRepository = this._onDidRequestAddRepository.event;

	private readonly _onDidRequestAddWorktree = this._register(new Emitter<IRepositoryEntry>());
	readonly onDidRequestAddWorktree = this._onDidRequestAddWorktree.event;

	private readonly _onDidRequestDeleteWorktree = this._register(new Emitter<{ repo: IRepositoryEntry; worktree: IWorktreeEntry }>());
	readonly onDidRequestDeleteWorktree = this._onDidRequestDeleteWorktree.event;

	private readonly _onDidRequestRemoveRepository = this._register(new Emitter<IRepositoryEntry>());
	readonly onDidRequestRemoveRepository = this._onDidRequestRemoveRepository.event;

	private readonly _onDidToggleCollapse = this._register(new Emitter<IRepositoryEntry>());
	readonly onDidToggleCollapse = this._onDidToggleCollapse.event;

	constructor(
		@IWorkbenchLayoutService layoutService: IWorkbenchLayoutService,
		@IThemeService themeService: IThemeService,
		@IStorageService storageService: IStorageService,
	) {
		super(Parts.ORCHESTRATOR_PART, { hasTitle: false }, themeService, storageService, layoutService);
	}

	protected override createContentArea(parent: HTMLElement): HTMLElement {
		this.element = parent;

		this.contentElement = append(parent, $('.orchestrator-content'));
		this.repoListElement = append(this.contentElement, $('.repo-list'));

		// Footer
		const footer = append(parent, $('.orchestrator-footer'));
		const addButton = append(footer, $('.add-repo-button'));
		addButton.textContent = localize('addRepository', "+ Add Repository");
		this._register(addDisposableListener(addButton, EventType.CLICK, () => {
			this._onDidRequestAddRepository.fire();
		}));

		this.render();

		return this.contentElement;
	}

	setRepositories(repositories: IRepositoryEntry[]): void {
		this.repositories = repositories;
		this.render();
	}

	private render(): void {
		if (!this.repoListElement) {
			return;
		}

		this.renderDisposables.clear();
		this.repoListElement.textContent = '';

		for (const repo of this.repositories) {
			const repoSection = append(this.repoListElement, $('.repo-section'));

			// Repo header
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
				this._onDidRequestAddWorktree.fire(repo);
			}));

			this.renderDisposables.add(addDisposableListener(removeRepoBtn, EventType.CLICK, e => {
				e.stopPropagation();
				this._onDidRequestRemoveRepository.fire(repo);
			}));

			this.renderDisposables.add(addDisposableListener(header, EventType.CLICK, () => {
				this._onDidToggleCollapse.fire(repo);
			}));

			// Worktree list (hidden if collapsed)
			if (!repo.isCollapsed) {
				const worktreeList = append(repoSection, $('.worktree-list'));

				for (const worktree of repo.worktrees) {
					const item = append(worktreeList, $('.worktree-item'));
					if (worktree.isActive) {
						item.classList.add('active');
					}

					append(item, $('.worktree-connector'));
					const iconEl = append(item, $('.worktree-icon'));
					this._applySessionStateIcon(iconEl, worktree);

					const info = append(item, $('.worktree-info'));

					const nameEl2 = append(info, $('.worktree-name'));
					nameEl2.textContent = worktree.name;

					const branchEl = append(info, $('.worktree-branch'));
					branchEl.textContent = worktree.branch;

					const isMainWorktree = worktree.path === repo.path;
					if (!isMainWorktree) {
						const deleteBtn = append(item, $('.worktree-delete.codicon.codicon-trash'));
						deleteBtn.title = localize('deleteWorktree', "Delete Worktree");

						this.renderDisposables.add(addDisposableListener(deleteBtn, EventType.CLICK, e => {
							e.stopPropagation();
							this._onDidRequestDeleteWorktree.fire({ repo, worktree });
						}));
					}

					this.renderDisposables.add(addDisposableListener(item, EventType.CLICK, () => {
						this._onDidSelectWorktree.fire(worktree);
					}));
				}
			}
		}
	}

	private static readonly BRAILLE_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
	private static readonly BRAILLE_INTERVAL_MS = 80;

	private _applySessionStateIcon(el: HTMLElement, worktree: IWorktreeEntry): void {
		el.className = 'worktree-icon';

		switch (worktree.sessionState) {
			case WorktreeSessionState.Running: {
				el.classList.add('state-running', 'braille-spinner');
				let frame = 0;
				el.textContent = OrchestratorPart.BRAILLE_FRAMES[0];
				const interval = setInterval(() => {
					frame = (frame + 1) % OrchestratorPart.BRAILLE_FRAMES.length;
					el.textContent = OrchestratorPart.BRAILLE_FRAMES[frame];
				}, OrchestratorPart.BRAILLE_INTERVAL_MS);
				this.renderDisposables.add({ dispose: () => clearInterval(interval) });
				break;
			}
			case WorktreeSessionState.Waiting:
				el.classList.add('codicon', 'codicon-debug-pause', 'state-waiting');
				break;
			case WorktreeSessionState.Done:
				el.classList.add('codicon', 'codicon-check', 'state-done');
				break;
			case WorktreeSessionState.Error:
				el.classList.add('codicon', 'codicon-warning', 'state-error');
				break;
			default:
				el.classList.add('codicon', 'codicon-git-branch');
				break;
		}
	}

	override toJSON(): object {
		return {
			type: Parts.ORCHESTRATOR_PART
		};
	}
}
