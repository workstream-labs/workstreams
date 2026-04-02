/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { Event } from '../../../../base/common/event.js';

export const enum WorktreeSessionState {
	Idle = 'idle',
	Working = 'working',
	Permission = 'permission',
	Review = 'review',
}

export interface IWorktreeEntry {
	readonly name: string;
	readonly path: string;
	readonly branch: string;
	readonly description?: string;
	readonly isActive: boolean;
	readonly sessionState?: WorktreeSessionState;
	readonly filesChanged?: number;
	readonly additions?: number;
	readonly deletions?: number;
}

export interface IRepositoryEntry {
	readonly name: string;
	readonly path: string;
	readonly worktrees: readonly IWorktreeEntry[];
	readonly isCollapsed: boolean;
}

export const IOrchestratorService = createDecorator<IOrchestratorService>('orchestratorService');

export interface IOrchestratorService {
	readonly _serviceBrand: undefined;

	readonly repositories: readonly IRepositoryEntry[];
	readonly activeWorktree: IWorktreeEntry | undefined;

	readonly onDidChangeRepositories: Event<void>;
	readonly onDidChangeActiveWorktree: Event<IWorktreeEntry>;
	readonly onDidApplyWorktreeEditorState: Event<IWorktreeEntry>;
	readonly onDidRemoveWorktree: Event<{ repoPath: string; worktreePath: string }>;

	/**
	 * Resolves when the initial restore from persisted state is complete.
	 */
	readonly whenReady: Promise<void>;

	/**
	 * Set by the terminal contribution to track its async phase-2 restore.
	 * switchTo awaits this before starting a new switch to prevent races.
	 */
	pendingTerminalRestore: Promise<void>;

	readonly onDidChangeSessionState: Event<{ worktreePath: string; state: WorktreeSessionState }>;

	setSessionState(worktreePath: string, state: WorktreeSessionState): void;
	pickAndAddRepository(): Promise<void>;
	pickAndAddWorktree(repoPath: string): Promise<void>;
	addRepository(path: string): Promise<void>;
	removeRepository(repoPath: string): Promise<void>;
	toggleRepositoryCollapsed(repoPath: string): void;

	addWorktree(repoPath: string, name: string, description: string): Promise<void>;
	removeWorktree(repoPath: string, branchName: string): Promise<void>;
	switchTo(worktree: IWorktreeEntry): Promise<void>;

	/**
	 * Schedule a debounced refresh of worktree state (branches, diff stats).
	 * Called by contributions that detect external changes (e.g. terminal commands).
	 */
	scheduleRefresh(): void;
}
