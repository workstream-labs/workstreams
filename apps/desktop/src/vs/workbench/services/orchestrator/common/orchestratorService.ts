/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Workstreams Labs. All rights reserved.
 *  Licensed under the Elastic License 2.0 (ELv2). See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { Event } from '../../../../base/common/event.js';

export const enum WorktreeSessionState {
	Idle = 'idle',
	Working = 'working',
	Permission = 'permission',
	Review = 'review',
}

/**
 * Valid state transitions for worktree sessions.
 * Used by `setSessionState` to reject stale or invalid events.
 *
 * Self-transitions (e.g., Working → Working) are handled as no-ops
 * in the implementation and do not need to appear here.
 */
export const VALID_TRANSITIONS = new Map<WorktreeSessionState | undefined, Set<WorktreeSessionState>>([
	[undefined, new Set<WorktreeSessionState>([WorktreeSessionState.Idle, WorktreeSessionState.Working])],
	[WorktreeSessionState.Idle, new Set<WorktreeSessionState>([WorktreeSessionState.Working])],
	[WorktreeSessionState.Working, new Set<WorktreeSessionState>([WorktreeSessionState.Idle, WorktreeSessionState.Permission, WorktreeSessionState.Review])],
	[WorktreeSessionState.Permission, new Set<WorktreeSessionState>([WorktreeSessionState.Working, WorktreeSessionState.Idle])],
	[WorktreeSessionState.Review, new Set<WorktreeSessionState>([WorktreeSessionState.Working, WorktreeSessionState.Idle])],
]);

export interface IWorktreeEntry {
	readonly name: string;
	readonly path: string;
	readonly branch: string;
	readonly baseBranch?: string;
	readonly description?: string;
	readonly isActive: boolean;
	readonly sessionState?: WorktreeSessionState;
	readonly filesChanged?: number;
	readonly additions?: number;
	readonly deletions?: number;
	readonly defaultBranch?: string;
	readonly prLoaded?: boolean;
	readonly prNumber?: number;
	readonly prState?: 'open' | 'draft' | 'merged' | 'closed';
	readonly prMergeable?: 'mergeable' | 'conflicting' | 'unknown';
	readonly prUrl?: string;
	/** True while the git worktree is still being created on disk. */
	readonly provisioning?: boolean;
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

	/**
	 * Update the session state for a worktree. Returns `true` if the
	 * transition was accepted, `false` if it was rejected (invalid or
	 * no-op self-transition).
	 */
	setSessionState(worktreePath: string, state: WorktreeSessionState): boolean;

	/**
	 * Read the current session state for a worktree directly from the
	 * authoritative state map (not from the worktree entry, which may
	 * be stale after async operations).
	 */
	getSessionState(worktreePath: string): WorktreeSessionState | undefined;
	pickAndAddRepository(): Promise<void>;
	pickAndAddWorktree(repoPath: string): Promise<void>;
	addRepository(path: string): Promise<void>;
	removeRepository(repoPath: string): Promise<void>;
	toggleRepositoryCollapsed(repoPath: string): void;

	addWorktree(repoPath: string, name: string, description: string, baseBranch?: string, displayName?: string): Promise<void>;
	removeWorktree(repoPath: string, branchName: string): Promise<void>;
	switchTo(worktree: IWorktreeEntry): Promise<void>;
	getCurrentBranch(repoPath: string): Promise<string>;
	listBranches(repoPath: string): Promise<string[]>;
	detectAgents(): Promise<string[]>;

	/**
	 * Get the stored startup command for an agent. Defaults to the agent id.
	 */
	getAgentCommand(agentId: string): string;

	/**
	 * Persist a custom startup command for an agent.
	 */
	setAgentCommand(agentId: string, command: string): void;

	/**
	 * Schedule a debounced refresh of worktree state (branches, diff stats).
	 * Called by contributions that detect external changes (e.g. terminal commands).
	 */
	scheduleRefresh(): void;
}
