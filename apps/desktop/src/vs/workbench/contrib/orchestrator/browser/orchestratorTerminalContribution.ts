/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Workstreams Labs. All rights reserved.
 *  Licensed under the Elastic License 2.0 (ELv2). See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../base/common/uri.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { RunOnceScheduler } from '../../../../base/common/async.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { localize } from '../../../../nls.js';
import { TerminalLocation } from '../../../../platform/terminal/common/terminal.js';
import { TerminalCapability } from '../../../../platform/terminal/common/capabilities/capabilities.js';
import { INotificationService, Severity } from '../../../../platform/notification/common/notification.js';
import { AccessibilitySignal, IAccessibilitySignalService } from '../../../../platform/accessibilitySignal/browser/accessibilitySignalService.js';
import { ITerminalEditorService, ITerminalInstance, ITerminalService } from '../../../contrib/terminal/browser/terminal.js';
import { GroupsOrder, IEditorGroupsService } from '../../../services/editor/common/editorGroupsService.js';
import { IOrchestratorService, IWorktreeEntry, WorktreeSessionState } from '../../../services/orchestrator/common/orchestratorService.js';
import { IHookNotificationService } from '../../../services/orchestrator/common/hookNotificationService.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';

const TAG = '[OrchestratorTerminal]';

function describeInstance(inst: ITerminalInstance): string {
	return `id=${inst.instanceId} target=${inst.target === TerminalLocation.Editor ? 'Editor' : inst.target === TerminalLocation.Panel ? 'Panel' : inst.target} disposed=${inst.isDisposed}`;
}

interface ITerminalOwnership {
	readonly worktreeKey: string;
	/** Editor group index (GRID_APPEARANCE order) before backgrounding. */
	groupIndex: number;
	/** Tab index within the editor group before backgrounding. */
	tabIndex: number;
}

/**
 * Manages terminal visibility per worktree context using ownership tracking.
 *
 * Terminal lifecycle is split into two phases during worktree switches:
 *
 * **Phase 1** (`onDidChangeActiveWorktree`): Snapshots each terminal's editor
 * group position, then backgrounds all managed terminals. This runs BEFORE
 * `saveWorkingSet` so the saved state never contains terminal editor references
 * (preventing ghost blank terminals on restore). Empty groups left behind are
 * preserved so the grid layout is captured faithfully.
 *
 * **Phase 2** (`onDidApplyWorktreeEditorState`): Shows terminals for the new
 * worktree, placing each one back into the same editor group index it was in
 * before backgrounding. This runs AFTER `applyWorkingSet` restores the grid
 * layout (including empty slots where terminals were), so each terminal lands
 * in the correct position.
 */
export class OrchestratorTerminalContribution extends Disposable {

	static readonly ID = 'workbench.contrib.orchestratorTerminal';
	private static readonly OWNERSHIP_STORAGE_KEY = 'orchestrator.terminalOwnership';

	private _activeKey: string | undefined;
	private _ownershipRestored = false;

	/**
	 * Maps terminal instanceId → ownership info (worktree key + group position).
	 */
	private readonly _ownership = new Map<number, ITerminalOwnership>();

	/**
	 * Per-worktree snapshot of each group's active editor URI, captured in
	 * Phase 1 before backgrounding so Phase 2 can restore focus after
	 * terminal editors are re-shown.
	 * Key: worktreeKey, Value: Map<groupIndex, activeEditorResource>
	 */
	private readonly _savedActiveEditors = new Map<string, Map<number, URI>>();

	/**
	 * Heartbeat timers per worktree. If no hook event arrives within the
	 * timeout period while a worktree is in Working state, the state is
	 * reset to Idle as a crash-recovery fallback.
	 */
	private readonly _heartbeats = new Map<string, RunOnceScheduler>();
	private static readonly HEARTBEAT_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

	constructor(
		@IOrchestratorService private readonly _orchestratorService: IOrchestratorService,
		@ITerminalService private readonly _terminalService: ITerminalService,
		@ITerminalEditorService private readonly _terminalEditorService: ITerminalEditorService,
		@IEditorGroupsService private readonly _editorGroupsService: IEditorGroupsService,
		@ILogService private readonly _logService: ILogService,
		@IHookNotificationService private readonly _hookNotificationService: IHookNotificationService,
		@INotificationService private readonly _notificationService: INotificationService,
		@IAccessibilitySignalService private readonly _signalService: IAccessibilitySignalService,
		@IStorageService private readonly _storageService: IStorageService,
	) {
		super();

		this._logService.info(`${TAG} Contribution initialized`);

		/**
		 * Hook notification listener: receives Claude Code lifecycle events
		 * from the main-process HTTP server and updates session state.
		 */
		this._register(this._hookNotificationService.onDidReceiveNotification(event => {
			this._logService.trace(`${TAG} Hook event: ${event.eventType} for "${event.worktreePath}" | current state: ${this._findWorktreeSessionState(event.worktreePath) ?? 'undefined'}`);
			this._logService.info(`${TAG} Hook notification: ${event.eventType} for "${event.worktreePath}"`);

			const worktreeName = this._resolveWorktreeName(event.worktreePath);

			switch (event.eventType) {
				case 'Start': {
					this._orchestratorService.setSessionState(event.worktreePath, WorktreeSessionState.Working);
					this._resetHeartbeat(event.worktreePath);
					break;
				}
				case 'Stop': {
					this._cancelHeartbeat(event.worktreePath);

					// Don't clear Permission state on Stop events — permission
					// waits are indefinite. Claude Code fires Stop at end-of-turn,
					// which includes the turn where it asked for permission.
					const currentState = this._findWorktreeSessionState(event.worktreePath);
					if (currentState === WorktreeSessionState.Permission) {
						this._logService.info(`${TAG} Ignoring Stop event while in Permission state for "${event.worktreePath}"`);
						break;
					}

					const isActive = this._orchestratorService.activeWorktree?.path === event.worktreePath;
					const targetState = isActive ? WorktreeSessionState.Idle : WorktreeSessionState.Review;

					// Skip notification for self-transitions (duplicate Stop events)
					if (currentState === targetState) {
						this._logService.trace(`${TAG} Duplicate Stop for "${event.worktreePath}" (already ${currentState}) — skipping`);
						break;
					}

					const accepted = this._orchestratorService.setSessionState(
						event.worktreePath,
						targetState
					);

					if (accepted) {
						this._notificationService.notify({
							severity: Severity.Info,
							message: localize('worktreeCompleted', "{0} — completed turn", worktreeName),
						});
						this._signalService.playSignal(AccessibilitySignal.taskCompleted);
					}
					break;
				}
				case 'PermissionRequest': {
					this._cancelHeartbeat(event.worktreePath);
					const accepted = this._orchestratorService.setSessionState(event.worktreePath, WorktreeSessionState.Permission);
					if (accepted) {
						this._notificationService.notify({
							severity: Severity.Warning,
							message: localize('worktreePermission', "{0} — asking permission", worktreeName),
						});
						this._signalService.playSignal(AccessibilitySignal.errorAtPosition);
					}
					break;
				}
			}
		}));

		/**
		 * Phase 1: background only (before saveWorkingSet).
		 */
		this._register(this._orchestratorService.onDidChangeActiveWorktree(wt => this._onActiveWorktreeChanging(wt)));

		/**
		 * Phase 2: show terminals (after applyWorkingSet + folder swap).
		 * The promise is stored on the service so switchTo can await it
		 * before starting the next switch (prevents async race).
		 */
		this._register(this._orchestratorService.onDidApplyWorktreeEditorState(wt => {
			this._orchestratorService.pendingTerminalRestore = this._onWorktreeEditorStateApplied(wt);
		}));

		this._register(this._orchestratorService.onDidRemoveWorktree(e => this._onWorktreeRemoved(e.worktreePath)));

		/**
		 * Redirect panel terminals to editor and track ownership.
		 */
		this._logService.info(`${TAG} Contribution initialized`);

		this._register(this._terminalService.onDidCreateInstance(instance => {
			this._logService.info(`${TAG} onDidCreateInstance: ${describeInstance(instance)}`);
			if (instance.target === TerminalLocation.Panel) {
				this._terminalService.moveToEditor(instance);
				this._logService.trace(`${TAG} Moved panel terminal ${instance.instanceId} → editor`);
			}
			if (this._activeKey) {
				this._ownership.set(instance.instanceId, { worktreeKey: this._activeKey, groupIndex: 0, tabIndex: -1 });
				this._logService.trace(`${TAG} Claimed terminal ${instance.instanceId} → "${this._activeKey}"`);

				// Inject worktree path so Claude hooks can identify which
				// worktree this session belongs to.
				const worktreePath = this._findWorktreePath(this._activeKey);
				if (worktreePath) {
					const slc = instance.shellLaunchConfig;
					slc.env = { ...slc.env, WORKSTREAMS_WORKTREE_PATH: worktreePath };
				}
			} else {
				this._logService.trace(`${TAG} WARNING: no activeKey when terminal ${instance.instanceId} created — not claiming`);
			}
		}));

		/**
		 * Refresh orchestrator state (branches, diff stats) after terminal commands finish.
		 * Shell integration reports command completion; we hook into it so that
		 * `git checkout` (or any command that changes git state) updates the sidebar.
		 */
		this._register(this._terminalService.onDidCreateInstance(instance => {
			this._listenForCommandFinished(instance);
		}));

		/**
		 * Clean up ownership and listeners when terminals are disposed.
		 */
		this._register(this._terminalService.onDidDisposeInstance(instance => {
			const info = this._ownership.get(instance.instanceId);
			if (info) {
				this._logService.trace(`${TAG} onDidDisposeInstance: terminal ${instance.instanceId} owner="${info.worktreeKey}"`);
				this._logService.trace(`${TAG} onDidDisposeInstance: ${instance.instanceId} owner="${info.worktreeKey}" — removing from ownership`);
				this._ownership.delete(instance.instanceId);

				// If this was the last terminal for a worktree still in Working/Permission
				// state, reset to Idle — the session is gone and no more hook events will arrive.
				const hasOtherTerminals = [...this._ownership.values()].some(o => o.worktreeKey === info.worktreeKey);
				if (!hasOtherTerminals) {
					const worktreePath = this._findWorktreePath(info.worktreeKey);
					if (worktreePath) {
						const worktreeState = this._findWorktreeSessionState(worktreePath);
						if (worktreeState === WorktreeSessionState.Working || worktreeState === WorktreeSessionState.Permission) {
							this._logService.info(`${TAG} Last terminal for "${info.worktreeKey}" disposed while ${worktreeState} — resetting to Idle`);
							this._orchestratorService.setSessionState(worktreePath, WorktreeSessionState.Idle);
						}
					}
				}
			} else {
				this._logService.trace(`${TAG} onDidDisposeInstance: ${instance.instanceId} (unmanaged)`);
			}
			this._dumpState('after-dispose');
		}));

		/**
		 * Debug: log on instance changes.
		 */
		this._register(this._terminalService.onDidChangeInstances(() => {
			this._dumpState('onDidChangeInstances');
		}));
	}

	/**
	 * Dump full state for debugging.
	 */
	private _dumpState(context: string): void {
		const all = this._terminalService.instances;
		const fg = this._terminalService.foregroundInstances;
		const bgCount = all.length - fg.length;

		const owned = [...this._ownership.entries()].map(([id, info]) => {
			const inst = this._terminalService.getInstanceFromId(id);
			const isFg = inst ? fg.includes(inst) : false;
			const target = inst ? (inst.target === TerminalLocation.Editor ? 'E' : inst.target === TerminalLocation.Panel ? 'P' : '?') : 'GONE';
			const disposed = inst?.isDisposed ? ',DISPOSED' : '';
			return `${id}→${info.worktreeKey.split('/').pop()}(${isFg ? 'fg' : 'bg'},${target},g${info.groupIndex}${disposed})`;
		});

		this._logService.trace(
			`${TAG} [${context}] activeKey="${this._activeKey}" | total=${all.length} fg=${fg.length} bg=${bgCount} | ownership=[${owned.join(', ')}]`
		);
	}

	/**
	 * Listen for command completions on a terminal instance.
	 * If shell integration is already active, hooks immediately; otherwise
	 * waits for the CommandDetection capability to be added.
	 *
	 * Serves two purposes:
	 * 1. Refreshes git state (branches, diff stats) after terminal commands
	 * 2. Crash recovery: if the `claude` command exits while the worktree is
	 *    still in Working state, resets to Idle.
	 *    Permission state is NOT reset here — permission waits are indefinite
	 *    and shell integration can misfire during long pauses.
	 */
	private _listenForCommandFinished(instance: ITerminalInstance): void {
		const handleCommandFinished = () => {
			this._logService.trace(`${TAG} onCommandFinished: terminal ${instance.instanceId}`);
			this._orchestratorService.scheduleRefresh();

			// Crash recovery: if a command finished in a terminal whose
			// worktree is still in Working, the agent process has exited
			// (crashed, killed, or finished without a Stop hook).
			// Permission state is excluded — the user may take arbitrarily
			// long to respond, and shell integration can misdetect command
			// boundaries during idle periods.
			const info = this._ownership.get(instance.instanceId);
			if (info) {
				const worktreePath = this._findWorktreePath(info.worktreeKey);
				if (worktreePath) {
					const state = this._findWorktreeSessionState(worktreePath);
					if (state === WorktreeSessionState.Working) {
						const isActive = this._orchestratorService.activeWorktree?.path === worktreePath;
						this._logService.info(`${TAG} Command finished in terminal ${instance.instanceId} while ${state} — resetting to ${isActive ? 'Idle' : 'Review'}`);
						this._cancelHeartbeat(worktreePath);
						this._orchestratorService.setSessionState(
							worktreePath,
							isActive ? WorktreeSessionState.Idle : WorktreeSessionState.Review
						);
					}
				}
			}
		};

		const cap = instance.capabilities.get(TerminalCapability.CommandDetection);
		if (cap) {
			this._register(cap.onCommandFinished(handleCommandFinished));
			return;
		}
		const listener = instance.capabilities.onDidAddCapability(e => {
			if (e.id === TerminalCapability.CommandDetection) {
				this._register(e.capability.onCommandFinished(handleCommandFinished));
				listener.dispose();
			}
		});
		this._register(listener);
	}

	/**
	 * Find the group index (GRID_APPEARANCE order) containing the terminal.
	 * Returns 0 if not found.
	 */
	private _findGroupIndex(instance: ITerminalInstance): number {
		if (instance.target !== TerminalLocation.Editor) {
			return 0;
		}
		const groups = this._editorGroupsService.getGroups(GroupsOrder.GRID_APPEARANCE);
		for (let i = 0; i < groups.length; i++) {
			if (groups[i].findEditors(instance.resource).length > 0) {
				return i;
			}
		}
		return 0;
	}

	/**
	 * Find the tab index (position within the editor group's tab list)
	 * for a terminal. Returns -1 if not found.
	 */
	private _findTabIndex(instance: ITerminalInstance): number {
		if (instance.target !== TerminalLocation.Editor) {
			return -1;
		}
		const groups = this._editorGroupsService.getGroups(GroupsOrder.GRID_APPEARANCE);
		for (const group of groups) {
			const editors = group.findEditors(instance.resource);
			if (editors.length > 0) {
				return group.getIndexOfEditor(editors[0]);
			}
		}
		return -1;
	}

	/**
	 * Phase 1: Fires BEFORE saveWorkingSet/applyWorkingSet.
	 * Snapshots each terminal's group position, then backgrounds all managed
	 * terminals so their editor tabs are removed from groups. The empty groups
	 * are left in place so saveWorkingSet captures the exact grid layout.
	 */
	private _onActiveWorktreeChanging(worktree: IWorktreeEntry): void {
		this._restoreOwnership();

		const newKey = worktree.path.toLowerCase();

		if (this._activeKey === newKey) {
			this._logService.trace(`${TAG} Switch to same key "${newKey}" — no-op`);
			return;
		}

		const previousKey = this._activeKey;
		this._activeKey = newKey;

		this._logService.trace(`${TAG} ===== PHASE 1 (background): "${previousKey}" → "${newKey}" =====`);
		this._dumpState('phase1-start');

		for (const inst of this._terminalService.foregroundInstances) {
			this._logService.trace(`${TAG}   fg: ${describeInstance(inst)} owner=${this._ownership.get(inst.instanceId)?.worktreeKey ?? 'NONE'}`);
		}

		/**
		 * Claim any unclaimed foreground terminals for the previous worktree.
		 */
		if (previousKey) {
			for (const inst of this._terminalService.foregroundInstances) {
				if (!this._ownership.has(inst.instanceId)) {
					this._ownership.set(inst.instanceId, { worktreeKey: previousKey, groupIndex: 0, tabIndex: -1 });
					this._logService.trace(`${TAG} Adopted unclaimed terminal ${inst.instanceId} → "${previousKey}"`);
				}
			}
		}

		/**
		 * Snapshot the active editor per group for focus restoration in Phase 2.
		 */
		if (previousKey) {
			const activeEditors = new Map<number, URI>();
			const groups = this._editorGroupsService.getGroups(GroupsOrder.GRID_APPEARANCE);
			for (let i = 0; i < groups.length; i++) {
				const active = groups[i].activeEditor;
				if (active?.resource) {
					activeEditors.set(i, active.resource);
				}
			}
			this._savedActiveEditors.set(previousKey, activeEditors);
		}

		/**
		 * Snapshot group + tab positions BEFORE backgrounding (detach removes from group).
		 */
		for (const instance of this._terminalService.foregroundInstances) {
			const info = this._ownership.get(instance.instanceId);
			if (info) {
				info.groupIndex = this._findGroupIndex(instance);
				info.tabIndex = this._findTabIndex(instance);
				this._logService.trace(`${TAG} Snapshotted terminal ${instance.instanceId} → groupIndex=${info.groupIndex} tabIndex=${info.tabIndex}`);
			}
		}

		/**
		 * Background ALL managed foreground terminals (previous + strays).
		 * This removes their editor tabs so saveWorkingSet captures clean state.
		 * Set forcePersist so the pty process survives window reload and the
		 * terminal service includes it in the persisted background layout.
		 */
		for (const instance of [...this._terminalService.foregroundInstances]) {
			if (this._ownership.has(instance.instanceId)) {
				const current = this._terminalService.getInstanceFromId(instance.instanceId);
				if (current && !current.isDisposed) {
					current.shellLaunchConfig.forcePersist = true;
					this._logService.trace(`${TAG} Backgrounding ${current.instanceId}: ${describeInstance(current)}`);
					this._terminalService.moveToBackground(current);
					this._logService.trace(`${TAG} Backgrounded ${current.instanceId} OK`);
				} else {
					this._logService.trace(`${TAG} SKIP background ${instance.instanceId}: current=${!!current} isDisposed=${current?.isDisposed}`);
				}
			}
		}

		this._persistOwnership();
		this._dumpState('phase1-done');
	}

	/**
	 * Phase 2: Fires AFTER applyWorkingSet + workspace folder swap.
	 * Shows terminals for the new worktree, placing each one into its
	 * original editor group position. The grid layout was restored by
	 * applyWorkingSet (including empty groups where terminals were),
	 * so group indices map to the same visual positions.
	 */
	private async _onWorktreeEditorStateApplied(worktree: IWorktreeEntry): Promise<void> {
		const newKey = worktree.path.toLowerCase();

		/**
		 * Rapid-switching guard: abort if a newer phase 1 changed the active key.
		 */
		if (this._activeKey !== newKey) {
			this._logService.trace(`${TAG} Aborting phase 2 for "${newKey}": activeKey already moved to "${this._activeKey}"`);
			return;
		}

		/**
		 * Collect background terminals owned by the new worktree.
		 */
		const toShow: { instance: ITerminalInstance; groupIndex: number; tabIndex: number }[] = [];
		for (const instance of [...this._terminalService.instances]) {
			const isFg = this._terminalService.foregroundInstances.includes(instance);
			const info = this._ownership.get(instance.instanceId);
			if (!isFg && info?.worktreeKey === newKey) {
				const current = this._terminalService.getInstanceFromId(instance.instanceId);
				if (current && !current.isDisposed) {
					toShow.push({ instance: current, groupIndex: info.groupIndex, tabIndex: info.tabIndex });
				}
			} else if (!isFg && info) {
				this._logService.trace(`${TAG} Not showing bg terminal ${instance.instanceId}: owner="${info.worktreeKey}" wanted="${newKey}"`);
			}
		}

		this._logService.trace(`${TAG} ===== PHASE 2 (show): "${newKey}" toShow=${toShow.length} =====`);

		const groups = this._editorGroupsService.getGroups(GroupsOrder.GRID_APPEARANCE);

		for (const { instance, groupIndex } of toShow) {
			/**
			 * Re-check guard before each async show (another switch could start mid-loop).
			 */
			if (this._activeKey !== newKey) {
				this._logService.trace(`${TAG} Aborting phase 2 mid-show: activeKey changed to "${this._activeKey}"`);
				return;
			}

			/**
			 * Force panel terminals back to editor — they may have been
			 * dragged to the panel by the user but we always restore
			 * into the editor area.
			 */
			if (instance.target === TerminalLocation.Panel) {
				instance.target = TerminalLocation.Editor;
				this._logService.trace(`${TAG} Forced terminal ${instance.instanceId} target Panel → Editor`);
			}

			/**
			 * showBackgroundTerminal does cleanup (removes from background pool).
			 * Then we re-open in the exact target group by ID since
			 * showBackgroundTerminal uses ACTIVE_GROUP which isn't reliable.
			 */
			const targetGroup = groups[groupIndex] ?? groups[0];
			const targetGroupId = targetGroup?.id;

			this._logService.trace(`${TAG} Showing ${instance.instanceId}: ${describeInstance(instance)} → groupIndex=${groupIndex} groupId=${targetGroupId}`);
			await this._terminalService.showBackgroundTerminal(instance);

			if (targetGroupId !== undefined) {
				await this._terminalEditorService.openEditor(instance, { viewColumn: targetGroupId });
				this._logService.trace(`${TAG} Moved terminal ${instance.instanceId} to group ${targetGroupId}`);
			}

			/**
			 * Terminal editors auto-lock their group (workbench.editor.autoLockGroups).
			 * Unlock so the next terminal targeting the same group opens as a
			 * tab instead of creating a new side split.
			 */
			if (targetGroup && targetGroup.isLocked) {
				targetGroup.lock(false);
				this._logService.trace(`${TAG} Unlocked auto-locked group ${targetGroupId}`);
			}
		}

		/**
		 * Reorder terminal tabs to their original positions within each group.
		 * After showBackgroundTerminal + openEditor, terminals are appended
		 * at the end. Move each one to its saved tabIndex to restore the
		 * original interleaved order (e.g. [E1, T1, T2, E2] not [E1, E2, T1, T2]).
		 */
		const groupsAfter = this._editorGroupsService.getGroups(GroupsOrder.GRID_APPEARANCE);
		const terminalsByGroup = new Map<number, { instance: ITerminalInstance; tabIndex: number }[]>();
		for (const { instance, groupIndex, tabIndex } of toShow) {
			if (tabIndex < 0) { continue; }
			let list = terminalsByGroup.get(groupIndex);
			if (!list) {
				list = [];
				terminalsByGroup.set(groupIndex, list);
			}
			list.push({ instance, tabIndex });
		}

		for (const [groupIndex, terminals] of terminalsByGroup) {
			const group = groupsAfter[groupIndex] ?? groupsAfter[0];
			if (!group) { continue; }
			// Sort by tabIndex ascending so earlier moves don't shift later targets
			terminals.sort((a, b) => a.tabIndex - b.tabIndex);
			for (const { instance, tabIndex } of terminals) {
				const editors = group.findEditors(instance.resource);
				if (editors.length > 0) {
					const targetIdx = Math.min(tabIndex, group.editors.length - 1);
					group.moveEditor(editors[0], group, { index: targetIdx });
					this._logService.trace(`${TAG} Reordered terminal ${instance.instanceId} → tabIndex=${targetIdx}`);
				}
			}
		}

		/**
		 * Restore per-group active editor focus. Phase 1 saved which editor
		 * was active in each group before terminals were backgrounded.
		 * After terminals are re-shown, the last openEditor call will have
		 * stolen focus — restore it to the original active editor.
		 */
		const savedActive = this._savedActiveEditors.get(newKey);
		if (savedActive) {
			for (const [groupIndex, activeResource] of savedActive) {
				const group = groupsAfter[groupIndex] ?? groupsAfter[0];
				if (!group) { continue; }
				const editors = group.findEditors(activeResource);
				if (editors.length > 0) {
					await group.openEditor(editors[0], { preserveFocus: true });
					this._logService.trace(`${TAG} Restored active editor in group ${groupIndex}: ${activeResource.path}`);
				}
			}
			this._savedActiveEditors.delete(newKey);
		}

		this._dumpState('phase2-done');
		this._logService.trace(`${TAG} ===== PHASE 2 DONE: showed=${toShow.length} fg=${this._terminalService.foregroundInstances.length} =====`);
	}

	/**
	 * Resolves a friendly worktree display name from its path.
	 */
	private _resolveWorktreeName(worktreePath: string): string {
		for (const repo of this._orchestratorService.repositories) {
			for (const wt of repo.worktrees) {
				if (wt.path === worktreePath) {
					return wt.name;
				}
			}
		}
		// Fallback: last path segment
		return worktreePath.split('/').pop() || worktreePath;
	}

	/**
	 * Resolves the original worktree path from a lowercase ownership key.
	 */
	private _findWorktreePath(worktreeKey: string): string | undefined {
		for (const repo of this._orchestratorService.repositories) {
			for (const wt of repo.worktrees) {
				if (wt.path.toLowerCase() === worktreeKey) {
					return wt.path;
				}
			}
		}
		return undefined;
	}

	/**
	 * Returns the current session state for a worktree from the
	 * authoritative state map on the orchestrator service.
	 */
	private _findWorktreeSessionState(worktreePath: string): WorktreeSessionState | undefined {
		return this._orchestratorService.getSessionState(worktreePath);
	}

	/**
	 * Resets or creates a heartbeat timer for a worktree.
	 * If no hook event arrives within the timeout while the worktree
	 * is in Working state, the heartbeat fires and resets to Idle.
	 */
	private _resetHeartbeat(worktreePath: string): void {
		let scheduler = this._heartbeats.get(worktreePath);
		if (!scheduler) {
			scheduler = new RunOnceScheduler(() => {
				const state = this._findWorktreeSessionState(worktreePath);
				if (state === WorktreeSessionState.Working) {
					this._logService.trace(`${TAG} Heartbeat timeout: "${worktreePath}" state=${state} → Idle`);
					this._logService.warn(`${TAG} Heartbeat timeout for "${worktreePath}" — resetting to Idle`);
					this._orchestratorService.setSessionState(worktreePath, WorktreeSessionState.Idle);
					const worktreeName = this._resolveWorktreeName(worktreePath);
					this._notificationService.notify({
						severity: Severity.Warning,
						message: localize('worktreeHeartbeatTimeout', "{0} — session may have stopped", worktreeName),
					});
				}
			}, OrchestratorTerminalContribution.HEARTBEAT_TIMEOUT_MS);
			this._heartbeats.set(worktreePath, scheduler);
			this._register(scheduler);
		}
		scheduler.schedule();
	}

	/**
	 * Cancels the heartbeat timer for a worktree.
	 */
	private _cancelHeartbeat(worktreePath: string): void {
		const scheduler = this._heartbeats.get(worktreePath);
		if (scheduler) {
			scheduler.cancel();
		}
	}

	private _onWorktreeRemoved(worktreePath: string): void {
		const key = worktreePath.toLowerCase();
		this._logService.trace(`${TAG} Worktree removed: "${key}"`);
		this._cancelHeartbeat(worktreePath);
		for (const instance of [...this._terminalService.instances]) {
			if (this._ownership.get(instance.instanceId)?.worktreeKey === key) {
				const current = this._terminalService.getInstanceFromId(instance.instanceId);
				if (current && !current.isDisposed) {
					this._logService.trace(`${TAG} Disposing terminal ${current.instanceId} (removed worktree)`);
					this._terminalService.safeDisposeTerminal(current);
					this._ownership.delete(instance.instanceId);
				}
			}
		}
		this._persistOwnership();
	}

	/**
	 * Persist the ownership map to workspace storage keyed by
	 * persistentProcessId so it survives window reload.
	 */
	private _persistOwnership(): void {
		const entries: { pid: number; key: string; gi: number; ti: number }[] = [];
		for (const [instanceId, info] of this._ownership) {
			const inst = this._terminalService.getInstanceFromId(instanceId);
			if (inst?.persistentProcessId !== undefined) {
				entries.push({
					pid: inst.persistentProcessId,
					key: info.worktreeKey,
					gi: info.groupIndex,
					ti: info.tabIndex,
				});
			}
		}
		this._storageService.store(
			OrchestratorTerminalContribution.OWNERSHIP_STORAGE_KEY,
			JSON.stringify(entries),
			StorageScope.WORKSPACE,
			StorageTarget.MACHINE,
		);
		this._logService.trace(`${TAG} Persisted ownership: ${entries.length} entries`);
	}

	/**
	 * Restore the ownership map once after reload by matching persisted
	 * persistentProcessIds to revived terminal instances.
	 */
	private _restoreOwnership(): void {
		if (this._ownershipRestored) {
			return;
		}
		this._ownershipRestored = true;

		const raw = this._storageService.get(OrchestratorTerminalContribution.OWNERSHIP_STORAGE_KEY, StorageScope.WORKSPACE);
		if (!raw) {
			return;
		}

		try {
			const entries = JSON.parse(raw) as { pid: number; key: string; gi: number; ti: number }[];

			const pidToInstance = new Map<number, ITerminalInstance>();
			for (const inst of this._terminalService.instances) {
				if (inst.persistentProcessId !== undefined) {
					pidToInstance.set(inst.persistentProcessId, inst);
				}
			}

			for (const entry of entries) {
				const inst = pidToInstance.get(entry.pid);
				if (inst && !inst.isDisposed) {
					this._ownership.set(inst.instanceId, {
						worktreeKey: entry.key,
						groupIndex: entry.gi,
						tabIndex: entry.ti,
					});
					this._logService.trace(`${TAG} Restored ownership: terminal ${inst.instanceId} (pid=${entry.pid}) → "${entry.key}"`);
				}
			}

			this._logService.info(`${TAG} Restored ${this._ownership.size} terminal ownership entries`);
		} catch {
			this._logService.warn(`${TAG} Failed to parse persisted terminal ownership, ignoring.`);
		}
	}
}

registerWorkbenchContribution2(OrchestratorTerminalContribution.ID, OrchestratorTerminalContribution, WorkbenchPhase.AfterRestored);
