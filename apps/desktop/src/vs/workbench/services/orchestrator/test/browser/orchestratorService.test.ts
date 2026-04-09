/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Workstreams Labs. All rights reserved.
 *  Licensed under the Elastic License 2.0 (ELv2). See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { IWorktreeEntry, WorktreeSessionState, VALID_TRANSITIONS } from '../../common/orchestratorService.js';
import { OrchestratorServiceImpl, validateWorktreeName, friendlyName } from '../../../../browser/parts/orchestrator/orchestratorService.js';
import { workbenchInstantiationService } from '../../../../test/browser/workbenchTestServices.js';
import { IGitWorktreeService, IGitWorktreeInfo, IDiffStats, IWorktreeMeta, parseWorktreeList } from '../../common/gitWorktreeService.js';
import { IWorkspaceEditingService } from '../../../../services/workspaces/common/workspaceEditing.js';
import { IEditorGroupsService, IEditorWorkingSet } from '../../../../services/editor/common/editorGroupsService.js';
import { IStorageService, StorageScope } from '../../../../../platform/storage/common/storage.js';

class MockGitWorktreeService implements IGitWorktreeService {
	declare readonly _serviceBrand: undefined;

	async isGitRepository(): Promise<boolean> { return true; }
	async initRepository(): Promise<void> { }
	async getCurrentBranch(): Promise<string> { return 'main'; }
	async getRemoteUrl(): Promise<string | undefined> { return undefined; }
	async listWorktrees(repoPath: string): Promise<IGitWorktreeInfo[]> {
		return [{ path: repoPath, branch: 'main', isBare: false }];
	}
	async listBranches(): Promise<string[]> { return ['main']; }
	async detectAgents(): Promise<string[]> { return ['claude']; }
	async addWorktree(repoPath: string, name: string): Promise<string> { return `${repoPath}/.workstreams/${name}/tree`; }
	async removeWorktree(): Promise<void> { }
	async getDiffStats(): Promise<IDiffStats> { return { filesChanged: 0, additions: 0, deletions: 0, defaultBranch: 'main' }; }
	async getPRInfo(): Promise<null> { return null; }
	async writeWorktreeMeta(): Promise<void> { }
	async readWorktreeMeta(): Promise<IWorktreeMeta | null> { return null; }
}

suite('OrchestratorService', () => {
	let service: OrchestratorServiceImpl;
	let savedWorkingSets: Map<string, IEditorWorkingSet>;
	let appliedWorkingSets: (IEditorWorkingSet | 'empty')[];
	let createService: () => OrchestratorServiceImpl;

	const ds = ensureNoDisposablesAreLeakedInTestSuite();

	setup(() => {
		const instantiationService = ds.add(workbenchInstantiationService(undefined, ds));
		instantiationService.stub(IGitWorktreeService, new MockGitWorktreeService());
		instantiationService.stub(IWorkspaceEditingService, { addFolders: async () => { }, updateFolders: async () => { } });

		// Set up working set tracking on the editor groups service mock
		savedWorkingSets = new Map();
		appliedWorkingSets = [];
		let nextId = 0;
		const editorGroupsService = instantiationService.get(IEditorGroupsService);
		editorGroupsService.saveWorkingSet = (name: string) => {
			const ws: IEditorWorkingSet = { id: `ws-${nextId++}`, name };
			savedWorkingSets.set(name, ws);
			return ws;
		};
		editorGroupsService.applyWorkingSet = async (workingSet: IEditorWorkingSet | 'empty') => {
			appliedWorkingSets.push(workingSet);
			return true;
		};

		createService = () => ds.add(instantiationService.createInstance(OrchestratorServiceImpl));
		service = createService();
	});

	test('starts with empty repositories', () => {
		assert.deepStrictEqual(service.repositories, []);
		assert.strictEqual(service.activeWorktree, undefined);
	});

	suite('addRepository', () => {
		test('adds a repository with discovered worktrees and fires event', async () => {
			let eventFired = false;
			ds.add(service.onDidChangeRepositories(() => { eventFired = true; }));

			await service.addRepository('/path/to/repo');

			assert.strictEqual(service.repositories.length, 1);
			assert.strictEqual(service.repositories[0].name, 'repo');
			assert.strictEqual(service.repositories[0].path, '/path/to/repo');
			assert.strictEqual(service.repositories[0].isCollapsed, false);
			assert.strictEqual(service.repositories[0].worktrees.length, 1);
			assert.strictEqual(service.repositories[0].worktrees[0].name, 'local');
			assert.strictEqual(service.repositories[0].worktrees[0].branch, 'main');
			assert.ok(eventFired);
		});

		test('auto-selects current branch worktree as active', async () => {
			await service.addRepository('/path/to/repo');

			assert.strictEqual(service.activeWorktree?.branch, 'main');
			assert.strictEqual(service.activeWorktree?.name, 'local');
		});

		test('derives repo name from path', async () => {
			await service.addRepository('/home/user/projects/my-awesome-app');

			assert.strictEqual(service.repositories[0].name, 'my-awesome-app');
		});

		test('does not add duplicate repositories', async () => {
			await service.addRepository('/path/to/repo');
			await service.addRepository('/path/to/repo');

			assert.strictEqual(service.repositories.length, 1);
		});
	});

	suite('removeRepository', () => {
		test('removes a repository and fires event', async () => {
			await service.addRepository('/path/to/repo-a');
			await service.addRepository('/path/to/repo-b');

			let eventFired = false;
			ds.add(service.onDidChangeRepositories(() => { eventFired = true; }));

			await service.removeRepository('/path/to/repo-a');

			assert.strictEqual(service.repositories.length, 1);
			assert.strictEqual(service.repositories[0].name, 'repo-b');
			assert.ok(eventFired);
		});

		test('clears active worktree if it belonged to removed repo', async () => {
			await service.addRepository('/path/to/repo');

			assert.ok(service.activeWorktree);

			await service.removeRepository('/path/to/repo');

			assert.strictEqual(service.activeWorktree, undefined);
		});
	});

	suite('toggleRepositoryCollapsed', () => {
		test('toggles collapsed state', async () => {
			await service.addRepository('/path/to/repo');

			assert.strictEqual(service.repositories[0].isCollapsed, false);

			service.toggleRepositoryCollapsed('/path/to/repo');
			assert.strictEqual(service.repositories[0].isCollapsed, true);

			service.toggleRepositoryCollapsed('/path/to/repo');
			assert.strictEqual(service.repositories[0].isCollapsed, false);
		});
	});

	suite('addWorktree', () => {
		test('adds worktree to the correct repository', async () => {
			await service.addRepository('/path/to/repo');
			await service.addWorktree('/path/to/repo', 'feature-login', 'Build login page');

			assert.strictEqual(service.repositories[0].worktrees.length, 2); // local + feature-login
			assert.strictEqual(service.repositories[0].worktrees[1].name, 'feature-login');
			assert.strictEqual(service.repositories[0].worktrees[1].branch, 'feature-login');
		});

		test('worktrees stay in their own repos', async () => {
			await service.addRepository('/path/to/repo-a');
			await service.addRepository('/path/to/repo-b');
			await service.addWorktree('/path/to/repo-a', 'wt-1', '');
			await service.addWorktree('/path/to/repo-b', 'wt-2', '');

			assert.strictEqual(service.repositories[0].worktrees.length, 2); // local + wt-1
			assert.strictEqual(service.repositories[0].worktrees[1].name, 'wt-1');
			assert.strictEqual(service.repositories[1].worktrees.length, 2); // local + wt-2
			assert.strictEqual(service.repositories[1].worktrees[1].name, 'wt-2');
		});
	});

	suite('removeWorktree', () => {
		test('removes worktree by branch name', async () => {
			await service.addRepository('/path/to/repo');
			await service.addWorktree('/path/to/repo', 'wt-a', '');

			await service.removeWorktree('/path/to/repo', 'wt-a');

			assert.strictEqual(service.repositories[0].worktrees.length, 1); // only local remains
			assert.strictEqual(service.repositories[0].worktrees[0].name, 'local');
		});

		test('clears active worktree if it was removed', async () => {
			await service.addRepository('/path/to/repo');
			await service.addWorktree('/path/to/repo', 'feature', '');
			await service.switchTo(service.repositories[0].worktrees[1]);

			await service.removeWorktree('/path/to/repo', 'feature');

			assert.strictEqual(service.activeWorktree, undefined);
		});
	});

	suite('switchTo', () => {
		test('sets active worktree and fires event', async () => {
			await service.addRepository('/path/to/repo');
			await service.addWorktree('/path/to/repo', 'feature', '');

			let activeEvent: IWorktreeEntry | undefined;
			ds.add(service.onDidChangeActiveWorktree((w: IWorktreeEntry) => { activeEvent = w; }));

			await service.switchTo(service.repositories[0].worktrees[1]);

			assert.strictEqual(service.activeWorktree?.name, 'feature');
			assert.strictEqual(activeEvent?.name, 'feature');
		});

		test('marks only selected worktree as active across all repos', async () => {
			await service.addRepository('/path/to/repo-a');
			await service.addRepository('/path/to/repo-b');

			await service.switchTo(service.repositories[0].worktrees[0]);
			assert.strictEqual(service.repositories[0].worktrees[0].isActive, true);
			assert.strictEqual(service.repositories[1].worktrees[0].isActive, false);

			await service.switchTo(service.repositories[1].worktrees[0]);
			assert.strictEqual(service.repositories[0].worktrees[0].isActive, false);
			assert.strictEqual(service.repositories[1].worktrees[0].isActive, true);
		});

		test('saves editor working set when switching away from a worktree', async () => {
			await service.addRepository('/path/to/repo');
			await service.addWorktree('/path/to/repo', 'feature', '');

			// Switch to feature — this switches away from local
			await service.switchTo(service.repositories[0].worktrees[1]);

			// The local worktree's state should have been saved
			assert.ok(savedWorkingSets.has('/path/to/repo'));
		});

		test('applies empty working set for first-time worktree (clean slate)', async () => {
			await service.addRepository('/path/to/repo');
			await service.addWorktree('/path/to/repo', 'feature', '');
			appliedWorkingSets.length = 0;

			// Switch to feature for the first time — no saved state
			await service.switchTo(service.repositories[0].worktrees[1]);

			assert.ok(appliedWorkingSets.some(ws => ws === 'empty'));
		});

		test('restores saved working set when switching back to a worktree', async () => {
			await service.addRepository('/path/to/repo');
			await service.addWorktree('/path/to/repo', 'feature', '');

			// Switch to feature (saves local state, applies empty for feature)
			await service.switchTo(service.repositories[0].worktrees[1]);
			appliedWorkingSets.length = 0;

			// Switch back to local — should restore its saved working set
			await service.switchTo(service.repositories[0].worktrees[0]);

			assert.strictEqual(appliedWorkingSets.length, 2);
			assert.strictEqual(appliedWorkingSets[0], 'empty');
			assert.notStrictEqual(appliedWorkingSets[1], 'empty');
			assert.strictEqual((appliedWorkingSets[1] as IEditorWorkingSet).name, '/path/to/repo');
		});
	});
});

suite('persistence', () => {
	let createService: () => OrchestratorServiceImpl;
	let storageService: IStorageService;

	const ds = ensureNoDisposablesAreLeakedInTestSuite();

	setup(() => {
		const instantiationService = ds.add(workbenchInstantiationService(undefined, ds));
		instantiationService.stub(IGitWorktreeService, new MockGitWorktreeService());
		instantiationService.stub(IWorkspaceEditingService, { addFolders: async () => { }, updateFolders: async () => { } });
		storageService = instantiationService.get(IStorageService);

		const editorGroupsService = instantiationService.get(IEditorGroupsService);
		let nextId = 0;
		editorGroupsService.saveWorkingSet = (name: string) => {
			return { id: `ws-${nextId++}`, name };
		};
		editorGroupsService.applyWorkingSet = async () => true;

		createService = () => ds.add(instantiationService.createInstance(OrchestratorServiceImpl));
	});

	test('persists repositories to storage after addRepository', async () => {
		const svc = createService();
		await svc.whenReady;
		await svc.addRepository('/path/to/repo');

		const raw = storageService.get(OrchestratorServiceImpl.STORAGE_KEY, StorageScope.APPLICATION);
		assert.ok(raw);
		const state = JSON.parse(raw);
		assert.strictEqual(state.repositories.length, 1);
		assert.strictEqual(state.repositories[0].path, '/path/to/repo');
		assert.strictEqual(state.repositories[0].isCollapsed, false);
	});

	test('restores repositories from storage on new service instance', async () => {
		const svc1 = createService();
		await svc1.whenReady;
		await svc1.addRepository('/path/to/repo-a');
		await svc1.addRepository('/path/to/repo-b');
		svc1.toggleRepositoryCollapsed('/path/to/repo-b');

		// Create a new service that reads from the same storage
		const svc2 = createService();
		await svc2.whenReady;

		assert.strictEqual(svc2.repositories.length, 2);
		assert.strictEqual(svc2.repositories[0].path, '/path/to/repo-a');
		assert.strictEqual(svc2.repositories[0].isCollapsed, false);
		assert.strictEqual(svc2.repositories[1].path, '/path/to/repo-b');
		assert.strictEqual(svc2.repositories[1].isCollapsed, true);
	});

	test('restores active worktree selection', async () => {
		const svc1 = createService();
		await svc1.whenReady;
		await svc1.addRepository('/path/to/repo');

		// active worktree is auto-selected to main/local
		assert.strictEqual(svc1.activeWorktree?.path, '/path/to/repo');

		const svc2 = createService();
		await svc2.whenReady;

		assert.strictEqual(svc2.activeWorktree?.path, '/path/to/repo');
	});

	test('clears removed repos from storage', async () => {
		const svc1 = createService();
		await svc1.whenReady;
		await svc1.addRepository('/path/to/repo-a');
		await svc1.addRepository('/path/to/repo-b');
		await svc1.removeRepository('/path/to/repo-a');

		const svc2 = createService();
		await svc2.whenReady;

		assert.strictEqual(svc2.repositories.length, 1);
		assert.strictEqual(svc2.repositories[0].path, '/path/to/repo-b');
	});

	test('skips non-git paths during restore', async () => {
		// Seed storage with a repo path
		const svc1 = createService();
		await svc1.whenReady;
		await svc1.addRepository('/path/to/repo');

		// Now swap mock to report path as non-git
		const fakeGit = new MockGitWorktreeService();
		fakeGit.isGitRepository = async () => false;
		const instantiationService = ds.add(workbenchInstantiationService(undefined, ds));
		instantiationService.stub(IGitWorktreeService, fakeGit);
		instantiationService.stub(IWorkspaceEditingService, { addFolders: async () => { }, updateFolders: async () => { } });

		// Copy over the storage state
		const raw = storageService.get(OrchestratorServiceImpl.STORAGE_KEY, StorageScope.APPLICATION);
		const svc2StorageService = instantiationService.get(IStorageService);
		svc2StorageService.store(OrchestratorServiceImpl.STORAGE_KEY, raw!, StorageScope.APPLICATION, 1 /* MACHINE */);

		const editorGroupsService = instantiationService.get(IEditorGroupsService);
		editorGroupsService.saveWorkingSet = (name: string) => ({ id: name, name });
		editorGroupsService.applyWorkingSet = async () => true;

		const svc2 = ds.add(instantiationService.createInstance(OrchestratorServiceImpl));
		await svc2.whenReady;

		assert.strictEqual(svc2.repositories.length, 0);
	});

	test('handles corrupted storage gracefully', async () => {
		storageService.store(OrchestratorServiceImpl.STORAGE_KEY, '{invalid json', StorageScope.APPLICATION, 1 /* MACHINE */);

		const svc = createService();
		await svc.whenReady;

		assert.strictEqual(svc.repositories.length, 0);
	});
});

suite('validateWorktreeName', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	test('accepts valid branch names', () => {
		assert.strictEqual(validateWorktreeName('feature-login'), undefined);
		assert.strictEqual(validateWorktreeName('fix/auth-bug'), undefined);
		assert.strictEqual(validateWorktreeName('my_branch'), undefined);
		assert.strictEqual(validateWorktreeName('v2.0-rc1'), undefined);
		assert.strictEqual(validateWorktreeName('UPPERCASE'), undefined);
		assert.strictEqual(validateWorktreeName('a'), undefined);
	});

	test('rejects empty or whitespace', () => {
		assert.ok(validateWorktreeName(''));
		assert.ok(validateWorktreeName('   '));
	});

	test('rejects names with spaces', () => {
		assert.ok(validateWorktreeName('my branch'));
		assert.ok(validateWorktreeName('feature login'));
	});

	test('rejects names with ~, ^, :, or backslash', () => {
		assert.ok(validateWorktreeName('feat~1'));
		assert.ok(validateWorktreeName('HEAD^2'));
		assert.ok(validateWorktreeName('foo:bar'));
		assert.ok(validateWorktreeName('foo\\bar'));
	});

	test('rejects names with double dots', () => {
		assert.ok(validateWorktreeName('foo..bar'));
	});

	test('rejects names with @{', () => {
		assert.ok(validateWorktreeName('@{upstream}'));
		assert.ok(validateWorktreeName('branch@{0}'));
	});

	test('rejects names ending with .lock', () => {
		assert.ok(validateWorktreeName('branch.lock'));
		assert.ok(validateWorktreeName('refs.lock'));
	});

	test('rejects names starting or ending with dot', () => {
		assert.ok(validateWorktreeName('.hidden'));
		assert.ok(validateWorktreeName('trailing.'));
	});

	test('rejects names with control characters', () => {
		assert.ok(validateWorktreeName('foo\x00bar'));
		assert.ok(validateWorktreeName('foo\x1fbar'));
		assert.ok(validateWorktreeName('foo\x7fbar'));
	});
});

suite('parseWorktreeList', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	test('parses single worktree', () => {
		const output = [
			'worktree /Users/dev/my-repo',
			'HEAD abc1234',
			'branch refs/heads/main',
			''
		].join('\n');

		assert.deepStrictEqual(parseWorktreeList(output), [
			{ path: '/Users/dev/my-repo', branch: 'main', isBare: false }
		]);
	});

	test('parses multiple worktrees', () => {
		const output = [
			'worktree /Users/dev/my-repo',
			'HEAD abc1234',
			'branch refs/heads/main',
			'',
			'worktree /Users/dev/my-repo/.workstreams/feature/tree',
			'HEAD def5678',
			'branch refs/heads/feature',
			''
		].join('\n');

		const result = parseWorktreeList(output);
		assert.strictEqual(result.length, 2);
		assert.strictEqual(result[0].branch, 'main');
		assert.strictEqual(result[1].path, '/Users/dev/my-repo/.workstreams/feature/tree');
		assert.strictEqual(result[1].branch, 'feature');
	});

	test('handles bare worktree', () => {
		const output = [
			'worktree /Users/dev/my-repo.git',
			'bare',
			''
		].join('\n');

		assert.deepStrictEqual(parseWorktreeList(output), [
			{ path: '/Users/dev/my-repo.git', branch: 'HEAD', isBare: true }
		]);
	});

	test('handles detached HEAD', () => {
		const output = [
			'worktree /Users/dev/my-repo',
			'HEAD abc1234',
			'detached',
			''
		].join('\n');

		assert.deepStrictEqual(parseWorktreeList(output), [
			{ path: '/Users/dev/my-repo', branch: 'HEAD', isBare: false }
		]);
	});

	test('returns empty array for empty output', () => {
		assert.deepStrictEqual(parseWorktreeList(''), []);
	});

	test('strips refs/heads/ prefix from branch', () => {
		const output = [
			'worktree /path',
			'branch refs/heads/feature/deep-nested',
			''
		].join('\n');

		assert.strictEqual(parseWorktreeList(output)[0].branch, 'feature/deep-nested');
	});
});

suite('friendlyName', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	test('extracts last segment after slash and replaces hyphens with spaces', () => {
		assert.strictEqual(friendlyName('feat/dark-mode'), 'dark mode');
		assert.strictEqual(friendlyName('fix/auth-bug'), 'auth bug');
		assert.strictEqual(friendlyName('agent/code-correction-123'), 'code correction 123');
	});

	test('handles deeply nested paths', () => {
		assert.strictEqual(friendlyName('ws/fix/status-on-claude'), 'status on claude');
	});

	test('returns with hyphens replaced when no slash', () => {
		assert.strictEqual(friendlyName('tmux-integration'), 'tmux integration');
		assert.strictEqual(friendlyName('main'), 'main');
	});
});

suite('setSessionState validation', () => {
	let service: OrchestratorServiceImpl;

	const ds = ensureNoDisposablesAreLeakedInTestSuite();

	setup(async () => {
		const instantiationService = ds.add(workbenchInstantiationService(undefined, ds));
		instantiationService.stub(IGitWorktreeService, new MockGitWorktreeService());
		instantiationService.stub(IWorkspaceEditingService, { addFolders: async () => { }, updateFolders: async () => { } });

		const editorGroupsService = instantiationService.get(IEditorGroupsService);
		let nextId = 0;
		editorGroupsService.saveWorkingSet = (name: string) => ({ id: `ws-${nextId++}`, name });
		editorGroupsService.applyWorkingSet = async () => true;

		service = ds.add(instantiationService.createInstance(OrchestratorServiceImpl));
		await service.whenReady;
		await service.addRepository('/path/to/repo');
	});

	test('accepts valid transition: undefined → Working', () => {
		const result = service.setSessionState('/path/to/repo', WorktreeSessionState.Working);
		assert.strictEqual(result, true);
	});

	test('accepts valid transition: Working → Idle', () => {
		service.setSessionState('/path/to/repo', WorktreeSessionState.Working);

		const result = service.setSessionState('/path/to/repo', WorktreeSessionState.Idle);
		assert.strictEqual(result, true);
	});

	test('accepts valid transition: Working → Permission', () => {
		service.setSessionState('/path/to/repo', WorktreeSessionState.Working);

		const result = service.setSessionState('/path/to/repo', WorktreeSessionState.Permission);
		assert.strictEqual(result, true);
	});

	test('accepts valid transition: Working → Review', () => {
		service.setSessionState('/path/to/repo', WorktreeSessionState.Working);

		const result = service.setSessionState('/path/to/repo', WorktreeSessionState.Review);
		assert.strictEqual(result, true);
	});

	test('accepts valid transition: Permission → Working', () => {
		service.setSessionState('/path/to/repo', WorktreeSessionState.Working);
		service.setSessionState('/path/to/repo', WorktreeSessionState.Permission);

		const result = service.setSessionState('/path/to/repo', WorktreeSessionState.Working);
		assert.strictEqual(result, true);
	});

	test('accepts valid transition: Review → Working', () => {
		service.setSessionState('/path/to/repo', WorktreeSessionState.Working);
		service.setSessionState('/path/to/repo', WorktreeSessionState.Review);

		const result = service.setSessionState('/path/to/repo', WorktreeSessionState.Working);
		assert.strictEqual(result, true);
	});

	test('rejects invalid transition: Idle → Review', () => {
		service.setSessionState('/path/to/repo', WorktreeSessionState.Working);
		service.setSessionState('/path/to/repo', WorktreeSessionState.Idle);

		const result = service.setSessionState('/path/to/repo', WorktreeSessionState.Review);
		assert.strictEqual(result, false);
	});

	test('rejects invalid transition: Idle → Permission', () => {
		service.setSessionState('/path/to/repo', WorktreeSessionState.Working);
		service.setSessionState('/path/to/repo', WorktreeSessionState.Idle);

		const result = service.setSessionState('/path/to/repo', WorktreeSessionState.Permission);
		assert.strictEqual(result, false);
	});

	test('self-transition Working → Working returns true (no-op)', () => {
		service.setSessionState('/path/to/repo', WorktreeSessionState.Working);

		let eventFired = false;
		ds.add(service.onDidChangeSessionState(() => { eventFired = true; }));

		const result = service.setSessionState('/path/to/repo', WorktreeSessionState.Working);
		assert.strictEqual(result, true);
		assert.strictEqual(eventFired, false, 'self-transition should not fire event');
	});

	test('VALID_TRANSITIONS covers all enum values', () => {
		const allStates = [
			WorktreeSessionState.Idle,
			WorktreeSessionState.Working,
			WorktreeSessionState.Permission,
			WorktreeSessionState.Review,
		];

		for (const state of allStates) {
			assert.ok(VALID_TRANSITIONS.has(state), `VALID_TRANSITIONS should have entry for ${state}`);
		}
		assert.ok(VALID_TRANSITIONS.has(undefined), 'VALID_TRANSITIONS should have entry for undefined');
	});
});
