/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { Emitter } from '../../../../../base/common/event.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { mock } from '../../../../../base/test/common/mock.js';
import { TestInstantiationService } from '../../../../../platform/instantiation/test/common/instantiationServiceMock.js';
import { NullLogService, ILogService } from '../../../../../platform/log/common/log.js';
import { ITerminalEditorService, ITerminalInstance, ITerminalService } from '../../../../contrib/terminal/browser/terminal.js';
import { TerminalLocation } from '../../../../../platform/terminal/common/terminal.js';
import { GroupsOrder, IEditorGroupsService } from '../../../../services/editor/common/editorGroupsService.js';
import { IOrchestratorService, IWorktreeEntry } from '../../../../services/orchestrator/common/orchestratorService.js';
import { URI } from '../../../../../base/common/uri.js';
import { OrchestratorTerminalContribution } from '../../browser/orchestratorTerminalContribution.js';

// --- Test helpers ---

function makeTerminalInstance(id: number): ITerminalInstance {
	return {
		instanceId: id,
		isDisposed: false,
		target: TerminalLocation.Editor,
		resource: URI.from({ scheme: 'vscode-terminal', path: `/terminal-${id}` }),
	} as unknown as ITerminalInstance;
}

function makeWorktree(path: string, branch?: string): IWorktreeEntry {
	return {
		name: branch ?? 'local',
		path,
		branch: branch ?? 'main',
		isActive: true,
	};
}

suite('OrchestratorTerminalContribution', () => {
	const store = new DisposableStore();

	let onDidChangeActiveWorktree: Emitter<IWorktreeEntry>;
	let onDidApplyWorktreeEditorState: Emitter<IWorktreeEntry>;
	let onDidRemoveWorktree: Emitter<{ repoPath: string; worktreePath: string }>;
	let onDidCreateInstance: Emitter<ITerminalInstance>;
	let onDidDisposeInstance: Emitter<ITerminalInstance>;

	// Terminal service tracking
	let terminalInstances: Map<number, ITerminalInstance>;
	let backgroundedInstances: Set<number>;
	let moveToBackgroundCalls: number[];
	let showBackgroundCalls: number[];
	let disposedInstances: ITerminalInstance[];
	let groupLocked: boolean;

	/** Simulate creating a terminal (adds to instances + fires event) */
	function createTerminal(id: number): ITerminalInstance {
		const inst = makeTerminalInstance(id);
		terminalInstances.set(id, inst);
		onDidCreateInstance.fire(inst);
		return inst;
	}

	/** Simulate a full worktree switch (phase 1 + phase 2) */
	function switchToWorktree(wt: IWorktreeEntry): void {
		onDidChangeActiveWorktree.fire(wt);
		onDidApplyWorktreeEditorState.fire(wt);
	}

	setup(() => {
		terminalInstances = new Map();
		backgroundedInstances = new Set();
		moveToBackgroundCalls = [];
		showBackgroundCalls = [];
		disposedInstances = [];
		groupLocked = false;

		const instantiationService = store.add(new TestInstantiationService());

		onDidChangeActiveWorktree = store.add(new Emitter<IWorktreeEntry>());
		onDidApplyWorktreeEditorState = store.add(new Emitter<IWorktreeEntry>());
		onDidRemoveWorktree = store.add(new Emitter<{ repoPath: string; worktreePath: string }>());
		onDidCreateInstance = store.add(new Emitter<ITerminalInstance>());
		onDidDisposeInstance = store.add(new Emitter<ITerminalInstance>());

		instantiationService.stub(ILogService, new NullLogService());

		instantiationService.stub(IOrchestratorService, new class extends mock<IOrchestratorService>() {
			override onDidChangeActiveWorktree = onDidChangeActiveWorktree.event;
			override onDidApplyWorktreeEditorState = onDidApplyWorktreeEditorState.event;
			override onDidRemoveWorktree = onDidRemoveWorktree.event;
		});

		instantiationService.stub(ITerminalService, new class extends mock<ITerminalService>() {
			override onDidCreateInstance = onDidCreateInstance.event;
			override onDidDisposeInstance = onDidDisposeInstance.event;
			override get instances(): readonly ITerminalInstance[] {
				return [...terminalInstances.values()];
			}
			override get foregroundInstances(): readonly ITerminalInstance[] {
				return [...terminalInstances.values()].filter(i => !backgroundedInstances.has(i.instanceId));
			}
			override getInstanceFromId(id: number): ITerminalInstance | undefined {
				return terminalInstances.get(id);
			}
			override moveToBackground(instance: ITerminalInstance): void {
				backgroundedInstances.add(instance.instanceId);
				moveToBackgroundCalls.push(instance.instanceId);
			}
			override async showBackgroundTerminal(instance: ITerminalInstance): Promise<void> {
				backgroundedInstances.delete(instance.instanceId);
				showBackgroundCalls.push(instance.instanceId);
			}
			override onDidChangeInstances = store.add(new Emitter<void>()).event;
			override setActiveInstance(_instance: ITerminalInstance): void { }
			override async safeDisposeTerminal(instance: ITerminalInstance): Promise<void> {
				disposedInstances.push(instance);
				terminalInstances.delete(instance.instanceId);
				backgroundedInstances.delete(instance.instanceId);
			}
		});

		const mockGroup = {
			id: 1,
			get isLocked() { return groupLocked; },
			lock(locked: boolean) { groupLocked = locked; },
			get isEmpty() { return false; },
			findEditors(_resource: URI) { return []; },
		};
		instantiationService.stub(ITerminalEditorService, new class extends mock<ITerminalEditorService>() {
			override async openEditor(_instance: ITerminalInstance): Promise<void> { /* no-op in tests */ }
		});

		let activeGroupRef = mockGroup;
		instantiationService.stub(IEditorGroupsService, new class extends mock<IEditorGroupsService>() {
			override get activeGroup(): any { return activeGroupRef; }
			override get count(): number { return 1; }
			override getGroups(_order?: GroupsOrder): any[] { return [mockGroup]; }
			override activateGroup(group: any): any { activeGroupRef = typeof group === 'number' ? mockGroup : group; return activeGroupRef; }
			override removeGroup(_group: any): void { /* no-op in tests */ }
		});

		/* contribution = */ store.add(instantiationService.createInstance(OrchestratorTerminalContribution));
	});

	teardown(() => {
		store.clear();
	});

	ensureNoDisposablesAreLeakedInTestSuite();

	// --- Ownership tracking ---

	test('new terminal created during worktree A is owned by A', () => {
		onDidChangeActiveWorktree.fire(makeWorktree('/repo/wt-a'));
		const t1 = createTerminal(1);

		// Switch to wt-b — t1 should be backgrounded (owned by A)
		onDidChangeActiveWorktree.fire(makeWorktree('/repo/wt-b'));

		assert.ok(moveToBackgroundCalls.includes(t1.instanceId), 'terminal created in wt-a should be backgrounded on switch');
	});

	test('terminals created in different worktrees are tracked separately', () => {
		switchToWorktree(makeWorktree('/repo/wt-a'));
		createTerminal(1); // owned by wt-a

		switchToWorktree(makeWorktree('/repo/wt-b'));
		createTerminal(2); // owned by wt-b

		// Switch to wt-a — t2 should be backgrounded, t1 shown
		moveToBackgroundCalls = [];
		showBackgroundCalls = [];
		switchToWorktree(makeWorktree('/repo/wt-a'));

		assert.ok(moveToBackgroundCalls.includes(2), 'wt-b terminal should be backgrounded');
		assert.ok(showBackgroundCalls.includes(1), 'wt-a terminal should be shown');
	});

	test('adopts unclaimed foreground terminals when switching away', () => {
		// Pre-existing terminal (created before any worktree activation)
		const t1 = makeTerminalInstance(1);
		terminalInstances.set(1, t1);

		// Activate wt-a — t1 is foreground, unclaimed
		onDidChangeActiveWorktree.fire(makeWorktree('/repo/wt-a'));

		// Switch to wt-b — t1 should be adopted by wt-a and backgrounded
		onDidChangeActiveWorktree.fire(makeWorktree('/repo/wt-b'));

		assert.ok(moveToBackgroundCalls.includes(1), 'pre-existing terminal should be adopted by wt-a and backgrounded');
	});

	// --- Basic visibility ---

	test('backgrounds terminals when switching away from a worktree', () => {
		onDidChangeActiveWorktree.fire(makeWorktree('/repo/wt-a'));
		createTerminal(1);

		onDidChangeActiveWorktree.fire(makeWorktree('/repo/wt-b'));

		assert.ok(moveToBackgroundCalls.includes(1));
	});

	test('shows background terminals when switching to their worktree', () => {
		switchToWorktree(makeWorktree('/repo/wt-a'));
		createTerminal(1);

		switchToWorktree(makeWorktree('/repo/wt-b'));
		createTerminal(2);

		// Switch back to wt-a
		moveToBackgroundCalls = [];
		showBackgroundCalls = [];
		switchToWorktree(makeWorktree('/repo/wt-a'));

		assert.ok(showBackgroundCalls.includes(1), 'terminal for wt-a should be shown');
		assert.ok(moveToBackgroundCalls.includes(2), 'terminal for wt-b should be backgrounded');
	});

	test('does nothing when switching to the same worktree path', () => {
		onDidChangeActiveWorktree.fire(makeWorktree('/repo/wt-a'));
		createTerminal(1);

		moveToBackgroundCalls = [];
		showBackgroundCalls = [];
		onDidChangeActiveWorktree.fire(makeWorktree('/repo/wt-a'));

		assert.strictEqual(moveToBackgroundCalls.length, 0);
		assert.strictEqual(showBackgroundCalls.length, 0);
	});

	test('handles case-insensitive worktree paths', () => {
		onDidChangeActiveWorktree.fire(makeWorktree('/Repo/WT-A'));
		createTerminal(1);

		// Same path, different case — should be no-op
		moveToBackgroundCalls = [];
		onDidChangeActiveWorktree.fire(makeWorktree('/repo/wt-a'));

		assert.strictEqual(moveToBackgroundCalls.length, 0, 'same path different case should be no-op');
	});

	test('handles multiple terminals for the same worktree', () => {
		onDidChangeActiveWorktree.fire(makeWorktree('/repo/wt-a'));
		createTerminal(1);
		createTerminal(2);

		onDidChangeActiveWorktree.fire(makeWorktree('/repo/wt-b'));

		assert.ok(moveToBackgroundCalls.includes(1));
		assert.ok(moveToBackgroundCalls.includes(2));
	});

	// --- Worktree deletion ---

	test('disposes all terminals owned by a removed worktree', () => {
		switchToWorktree(makeWorktree('/repo/wt-a'));
		createTerminal(1);
		createTerminal(2);

		switchToWorktree(makeWorktree('/repo/wt-b'));
		createTerminal(3);

		onDidRemoveWorktree.fire({ repoPath: '/repo', worktreePath: '/repo/wt-a' });

		assert.strictEqual(disposedInstances.length, 2);
		assert.ok(disposedInstances.some(i => i.instanceId === 1));
		assert.ok(disposedInstances.some(i => i.instanceId === 2));
		assert.ok(terminalInstances.has(3), 'terminal for wt-b should be untouched');
	});

	test('disposes backgrounded terminals when worktree is removed', () => {
		onDidChangeActiveWorktree.fire(makeWorktree('/repo/wt-a'));
		createTerminal(1);

		// Background it by switching away
		onDidChangeActiveWorktree.fire(makeWorktree('/repo/wt-b'));
		assert.ok(backgroundedInstances.has(1));

		onDidRemoveWorktree.fire({ repoPath: '/repo', worktreePath: '/repo/wt-a' });

		assert.strictEqual(disposedInstances.length, 1);
	});

	// --- Round-trip ---

	test('full round-trip: processes survive switch away and back', () => {
		switchToWorktree(makeWorktree('/repo/wt-a'));
		createTerminal(1);

		switchToWorktree(makeWorktree('/repo/wt-b'));
		createTerminal(2);

		// t1 backgrounded, t2 visible
		assert.ok(backgroundedInstances.has(1));
		assert.ok(!backgroundedInstances.has(2));

		// Switch back to wt-a
		switchToWorktree(makeWorktree('/repo/wt-a'));

		// t1 visible again, t2 backgrounded
		assert.ok(!backgroundedInstances.has(1), 'wt-a terminal should be restored');
		assert.ok(backgroundedInstances.has(2), 'wt-b terminal should be backgrounded');

		// Neither was disposed
		assert.strictEqual(disposedInstances.length, 0);
	});

	// --- Two-phase sequencing ---

	test('phase 1 only backgrounds, phase 2 shows', () => {
		switchToWorktree(makeWorktree('/repo/wt-a'));
		createTerminal(1);

		switchToWorktree(makeWorktree('/repo/wt-b'));
		createTerminal(2);

		// Reset tracking
		moveToBackgroundCalls = [];
		showBackgroundCalls = [];

		// Phase 1 only: backgrounds wt-b terminals, does NOT show wt-a terminals
		onDidChangeActiveWorktree.fire(makeWorktree('/repo/wt-a'));

		assert.ok(moveToBackgroundCalls.includes(2), 'phase 1 should background wt-b terminal');
		assert.strictEqual(showBackgroundCalls.length, 0, 'phase 1 should not show any terminals');

		// Phase 2: shows wt-a terminals
		onDidApplyWorktreeEditorState.fire(makeWorktree('/repo/wt-a'));

		assert.ok(showBackgroundCalls.includes(1), 'phase 2 should show wt-a terminal');
	});

	test('phase 2 unlocks auto-locked group between terminals', async () => {
		switchToWorktree(makeWorktree('/repo/wt-a'));
		createTerminal(1);
		createTerminal(2);

		// Switch away to background both, then switch back
		switchToWorktree(makeWorktree('/repo/wt-b'));

		// Simulate auto-lock before switching back
		groupLocked = true;

		// Phase 1 for wt-a (sets activeKey = wt-a, backgrounds wt-b terminals)
		onDidChangeActiveWorktree.fire(makeWorktree('/repo/wt-a'));
		// Phase 2 for wt-a (shows wt-a terminals — should unlock group)
		onDidApplyWorktreeEditorState.fire(makeWorktree('/repo/wt-a'));

		// Let the async handler complete
		await new Promise(r => setTimeout(r, 0));
		assert.strictEqual(groupLocked, false, 'group should be unlocked after showing terminals');
	});

	test('rapid switch aborts stale phase 2', async () => {
		// Create 3 terminals across 3 worktrees
		switchToWorktree(makeWorktree('/repo/wt-a'));
		createTerminal(1);
		switchToWorktree(makeWorktree('/repo/wt-b'));
		createTerminal(2);
		switchToWorktree(makeWorktree('/repo/wt-c'));
		createTerminal(3);

		showBackgroundCalls = [];

		// Rapid switch: fire phase 1 for wt-a, then immediately phase 1 for wt-b
		// (before phase 2 for wt-a has a chance to run)
		onDidChangeActiveWorktree.fire(makeWorktree('/repo/wt-a'));
		onDidChangeActiveWorktree.fire(makeWorktree('/repo/wt-b'));

		// Fire the stale phase 2 for wt-a — generation has advanced, should abort
		onDidApplyWorktreeEditorState.fire(makeWorktree('/repo/wt-a'));

		await new Promise(r => setTimeout(r, 0));

		// Terminal 1 should NOT have been shown (stale generation)
		assert.ok(!showBackgroundCalls.includes(1), 'stale phase 2 should not show wt-a terminals');
	});

	// --- Cleanup on dispose ---

	test('onDidDisposeInstance cleans up ownership', () => {
		onDidChangeActiveWorktree.fire(makeWorktree('/repo/wt-a'));
		createTerminal(1);

		// Simulate terminal being disposed externally
		onDidDisposeInstance.fire(terminalInstances.get(1)!);
		terminalInstances.delete(1);

		// Switch away — should not crash trying to background disposed terminal
		onDidChangeActiveWorktree.fire(makeWorktree('/repo/wt-b'));

		assert.strictEqual(moveToBackgroundCalls.length, 0, 'should not try to background disposed terminal');
	});
});
