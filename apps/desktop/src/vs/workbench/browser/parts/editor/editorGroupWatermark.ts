/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, append, clearNode, h, addDisposableListener, EventType } from '../../../../base/browser/dom.js';
import { Disposable, DisposableStore } from '../../../../base/common/lifecycle.js';
import { localize } from '../../../../nls.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IStorageService } from '../../../../platform/storage/common/storage.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { IOrchestratorService } from '../../../services/orchestrator/common/orchestratorService.js';

export class EditorGroupWatermark extends Disposable {

	private static readonly SETTINGS_KEY = 'workbench.tips.enabled';

	private readonly watermarkContainer: HTMLElement;
	private readonly transientDisposables = this._register(new DisposableStore());

	private enabled = false;

	constructor(
		container: HTMLElement,
		@IWorkspaceContextService private readonly contextService: IWorkspaceContextService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IStorageService _storageService: IStorageService,
		@IOrchestratorService private readonly orchestratorService: IOrchestratorService,
	) {
		super();

		const elements = h('.editor-group-watermark', [
			h('.watermark-container@watermarkContainer'),
		]);

		append(container, elements.root);
		this.watermarkContainer = elements.watermarkContainer;

		this.registerListeners();
		this.render();
	}

	private registerListeners(): void {
		this._register(this.configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration(EditorGroupWatermark.SETTINGS_KEY)) {
				this.render();
			}
		}));

		this._register(this.contextService.onDidChangeWorkbenchState(() => this.render()));
		this._register(this.orchestratorService.onDidChangeRepositories(() => this.render()));
	}

	private render(): void {
		this.enabled = this.configurationService.getValue<boolean>(EditorGroupWatermark.SETTINGS_KEY);

		clearNode(this.watermarkContainer);
		this.transientDisposables.clear();

		if (!this.enabled) {
			return;
		}

		// Title
		const title = append(this.watermarkContainer, $('.ws-watermark-title'));
		title.textContent = 'workstreams';

		// Divider
		append(this.watermarkContainer, $('.ws-watermark-divider'));

		const hasRepos = this.orchestratorService.repositories.length > 0;

		if (hasRepos) {
			// Has repos — show a subtle hint
			const hint = append(this.watermarkContainer, $('.ws-watermark-hint'));
			hint.textContent = localize('watermark.selectWorktree', "Select a worktree from the sidebar to begin");
		} else {
			// No repos — show onboarding actions
			const subtitle = append(this.watermarkContainer, $('.ws-watermark-subtitle'));
			subtitle.textContent = localize('watermark.getStarted', "Parallel workspaces, one repo");

			const actions = append(this.watermarkContainer, $('.ws-watermark-actions'));

			// + Add Repository
			const addRepoBtn = append(actions, $('.ws-watermark-action'));
			const addRepoIcon = append(addRepoBtn, $('span.codicon.codicon-add'));
			addRepoIcon.setAttribute('aria-hidden', 'true');
			const addRepoLabel = append(addRepoBtn, $('span'));
			addRepoLabel.textContent = localize('watermark.addRepository', "Add Repository");

			this.transientDisposables.add(addDisposableListener(addRepoBtn, EventType.CLICK, () => {
				this.orchestratorService.pickAndAddRepository();
			}));

			// Subtle help text
			const help = append(this.watermarkContainer, $('.ws-watermark-help'));
			help.textContent = localize('watermark.helpText', "Add a git repository to create and switch between worktrees");
		}
	}
}
