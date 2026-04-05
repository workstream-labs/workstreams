/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import * as cp from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { promisify } from 'util';
import { GitWorktreeMainService, parseNumstat } from '../../electron-main/gitWorktreeMainService.js';

const execFile = promisify(cp.execFile);
const writeFile = promisify(fs.writeFile);
const mkdir = promisify(fs.mkdir);
const mkdtemp = promisify(fs.mkdtemp);
const rm = promisify(fs.rm);

/**
 * Helper to run git commands in a directory.
 */
async function git(cwd: string, ...args: string[]): Promise<string> {
	const { stdout } = await execFile('git', args, { cwd });
	return stdout.trim();
}

/**
 * Creates a temp git repo with an initial commit on main.
 * Returns the repo path.
 */
async function createTempRepo(): Promise<string> {
	const repoPath = await mkdtemp(path.join(os.tmpdir(), 'ws-test-'));
	await git(repoPath, 'init', '-b', 'main');
	await git(repoPath, 'config', 'user.email', 'test@test.com');
	await git(repoPath, 'config', 'user.name', 'Test');
	await writeFile(path.join(repoPath, 'README.md'), '# Test\n');
	await git(repoPath, 'add', '.');
	await git(repoPath, 'commit', '-m', 'initial commit');
	return repoPath;
}

suite('parseNumstat', () => {

	test('parses standard numstat output', () => {
		const result = parseNumstat('10\t2\tsrc/app.ts\n3\t0\tsrc/utils.ts\n');
		assert.strictEqual(result.size, 2);
		assert.deepStrictEqual(result.get('src/app.ts'), { add: 10, del: 2 });
		assert.deepStrictEqual(result.get('src/utils.ts'), { add: 3, del: 0 });
	});

	test('handles binary files (shown as - -)', () => {
		const result = parseNumstat('-\t-\timage.png\n5\t1\treadme.md\n');
		assert.strictEqual(result.size, 2);
		assert.deepStrictEqual(result.get('image.png'), { add: 0, del: 0 });
		assert.deepStrictEqual(result.get('readme.md'), { add: 5, del: 1 });
	});

	test('handles empty output', () => {
		assert.strictEqual(parseNumstat('').size, 0);
		assert.strictEqual(parseNumstat('\n').size, 0);
		assert.strictEqual(parseNumstat('  ').size, 0);
	});

	test('handles single file', () => {
		const result = parseNumstat('42\t7\tindex.js');
		assert.strictEqual(result.size, 1);
		assert.deepStrictEqual(result.get('index.js'), { add: 42, del: 7 });
	});

	test('ignores malformed lines without file path', () => {
		const result = parseNumstat('10\t2\n5\t1\tvalid.ts\n');
		assert.strictEqual(result.size, 1);
		assert.ok(result.has('valid.ts'));
	});
});

suite('GitWorktreeMainService - getDiffStats', () => {

	let service: GitWorktreeMainService;
	let repoPath: string;
	const tempDirs: string[] = [];

	setup(async () => {
		service = new GitWorktreeMainService();
		repoPath = await createTempRepo();
		tempDirs.push(repoPath);
	});

	teardown(async () => {
		for (const dir of tempDirs) {
			await rm(dir, { recursive: true, force: true }).catch(() => { });
		}
		tempDirs.length = 0;
	});

	test('returns zeros for a branch with no changes', async () => {
		// Create worktree with no changes relative to main
		const wtPath = path.join(repoPath, '.workstreams', 'clean', 'tree');
		await git(repoPath, 'worktree', 'add', '-b', 'clean', wtPath);

		const stats = await service.getDiffStats(repoPath, wtPath);

		assert.strictEqual(stats.additions, 0);
		assert.strictEqual(stats.deletions, 0);
		assert.strictEqual(stats.filesChanged, 0);
	});

	test('counts committed changes against base', async () => {
		const wtPath = path.join(repoPath, '.workstreams', 'feat', 'tree');
		await git(repoPath, 'worktree', 'add', '-b', 'feat', wtPath);

		// Make a commit in the worktree
		await writeFile(path.join(wtPath, 'new-file.ts'), 'line1\nline2\nline3\n');
		await git(wtPath, 'add', '.');
		await git(wtPath, 'commit', '-m', 'add new file');

		const stats = await service.getDiffStats(repoPath, wtPath);

		assert.strictEqual(stats.additions, 3);
		assert.strictEqual(stats.deletions, 0);
		assert.strictEqual(stats.filesChanged, 1);
	});

	test('counts staged changes when no commits ahead', async () => {
		const wtPath = path.join(repoPath, '.workstreams', 'staged', 'tree');
		await git(repoPath, 'worktree', 'add', '-b', 'staged', wtPath);

		// Stage a change but don't commit
		await writeFile(path.join(wtPath, 'staged.ts'), 'hello\n');
		await git(wtPath, 'add', 'staged.ts');

		const stats = await service.getDiffStats(repoPath, wtPath);

		assert.strictEqual(stats.additions, 1);
		assert.strictEqual(stats.deletions, 0);
		assert.strictEqual(stats.filesChanged, 1);
	});

	test('counts unstaged changes when no commits ahead', async () => {
		const wtPath = path.join(repoPath, '.workstreams', 'unstaged', 'tree');
		await git(repoPath, 'worktree', 'add', '-b', 'unstaged', wtPath);

		// Modify an existing tracked file without staging
		await writeFile(path.join(wtPath, 'README.md'), '# Test\nmodified\n');

		const stats = await service.getDiffStats(repoPath, wtPath);

		assert.strictEqual(stats.additions, 1); // +modified line
		assert.strictEqual(stats.filesChanged, 1);
	});

	test('counts untracked files', async () => {
		const wtPath = path.join(repoPath, '.workstreams', 'untracked', 'tree');
		await git(repoPath, 'worktree', 'add', '-b', 'untracked', wtPath);

		// Create an untracked file (not staged, not committed)
		await writeFile(path.join(wtPath, 'brand-new.ts'), 'a\nb\nc\nd\n');

		const stats = await service.getDiffStats(repoPath, wtPath);

		assert.strictEqual(stats.additions, 4);
		assert.strictEqual(stats.deletions, 0);
		assert.strictEqual(stats.filesChanged, 1);
	});

	test('prefers against-base stats when commits are ahead', async () => {
		const wtPath = path.join(repoPath, '.workstreams', 'mixed', 'tree');
		await git(repoPath, 'worktree', 'add', '-b', 'mixed', wtPath);

		// Commit a change (against-base)
		await writeFile(path.join(wtPath, 'committed.ts'), 'committed\n');
		await git(wtPath, 'add', '.');
		await git(wtPath, 'commit', '-m', 'committed change');

		// Also make an unstaged change (local)
		await writeFile(path.join(wtPath, 'README.md'), '# Modified\n');

		const stats = await service.getDiffStats(repoPath, wtPath);

		// Should show against-base stats (committed.ts: +1), NOT local changes
		assert.strictEqual(stats.additions, 1);
		assert.strictEqual(stats.filesChanged, 1);
	});

	test('returns zeros for a squash-merged branch', async () => {
		const wtPath = path.join(repoPath, '.workstreams', 'squashed', 'tree');
		await git(repoPath, 'worktree', 'add', '-b', 'squashed', wtPath);

		// Make commits in the worktree
		await writeFile(path.join(wtPath, 'feature.ts'), 'export const x = 1;\n');
		await git(wtPath, 'add', '.');
		await git(wtPath, 'commit', '-m', 'add feature');

		await writeFile(path.join(wtPath, 'feature.ts'), 'export const x = 1;\nexport const y = 2;\n');
		await git(wtPath, 'add', '.');
		await git(wtPath, 'commit', '-m', 'extend feature');

		// Squash-merge the branch into main (from the main repo)
		await git(repoPath, 'merge', '--squash', 'squashed');
		await git(repoPath, 'commit', '-m', 'squash merge: add feature');

		const stats = await service.getDiffStats(repoPath, wtPath);

		// Scoped two-dot diff detects that branch files match main's tree
		assert.strictEqual(stats.additions, 0);
		assert.strictEqual(stats.deletions, 0);
		assert.strictEqual(stats.filesChanged, 0);
	});

	test('returns zeros for squash-merged branch even when main moves ahead', async () => {
		const wtPath = path.join(repoPath, '.workstreams', 'merged-stale', 'tree');
		await git(repoPath, 'worktree', 'add', '-b', 'merged-stale', wtPath);

		// Make a commit on the branch
		await writeFile(path.join(wtPath, 'feature.ts'), 'const x = 1;\n');
		await git(wtPath, 'add', '.');
		await git(wtPath, 'commit', '-m', 'add feature');

		// Squash-merge into main
		await git(repoPath, 'merge', '--squash', 'merged-stale');
		await git(repoPath, 'commit', '-m', 'squash merge');

		// Main moves ahead with UNRELATED changes (like the real scenario)
		await writeFile(path.join(repoPath, 'CHANGELOG.md'), '# Changes\n- stuff\n');
		await git(repoPath, 'add', '.');
		await git(repoPath, 'commit', '-m', 'update changelog');

		const stats = await service.getDiffStats(repoPath, wtPath);

		// Branch only touched feature.ts, which matches main.
		// CHANGELOG.md is main-only — should NOT be counted.
		assert.strictEqual(stats.additions, 0);
		assert.strictEqual(stats.deletions, 0);
		assert.strictEqual(stats.filesChanged, 0);
	});

	test('shows diff for partially merged branch', async () => {
		const wtPath = path.join(repoPath, '.workstreams', 'partial', 'tree');
		await git(repoPath, 'worktree', 'add', '-b', 'partial', wtPath);

		// First commit — will be squash-merged
		await writeFile(path.join(wtPath, 'a.ts'), 'aaa\n');
		await git(wtPath, 'add', '.');
		await git(wtPath, 'commit', '-m', 'add a');

		// Squash-merge just the first commit into main
		await git(repoPath, 'merge', '--squash', 'partial');
		await git(repoPath, 'commit', '-m', 'squash merge: add a');

		// Second commit — NOT merged
		await writeFile(path.join(wtPath, 'b.ts'), 'bbb\n');
		await git(wtPath, 'add', '.');
		await git(wtPath, 'commit', '-m', 'add b');

		const stats = await service.getDiffStats(repoPath, wtPath);

		// a.ts is merged (scoped diff = 0 for that file), b.ts is not.
		// The scoped two-dot diff should show only b.ts.
		assert.strictEqual(stats.additions, 1);
		assert.strictEqual(stats.deletions, 0);
		assert.strictEqual(stats.filesChanged, 1);
	});

	test('handles multiple files with mixed additions and deletions', async () => {
		const wtPath = path.join(repoPath, '.workstreams', 'multi', 'tree');
		await git(repoPath, 'worktree', 'add', '-b', 'multi', wtPath);

		// Modify existing file (add + delete lines)
		await writeFile(path.join(wtPath, 'README.md'), '# Updated Title\nNew content\n');
		// Add new file
		await writeFile(path.join(wtPath, 'config.json'), '{\n  "key": "value"\n}\n');
		await git(wtPath, 'add', '.');
		await git(wtPath, 'commit', '-m', 'multiple changes');

		const stats = await service.getDiffStats(repoPath, wtPath);

		assert.strictEqual(stats.filesChanged, 2);
		assert.ok(stats.additions > 0, 'should have additions');
		assert.ok(stats.deletions > 0, 'should have deletions from modified README');
	});

	test('falls back to local branch when origin is unavailable', async () => {
		// This repo has no remote, so origin/main doesn't exist.
		// getDiffStats should fall back to comparing against local main.
		const wtPath = path.join(repoPath, '.workstreams', 'noremote', 'tree');
		await git(repoPath, 'worktree', 'add', '-b', 'noremote', wtPath);

		await writeFile(path.join(wtPath, 'local.ts'), 'local change\n');
		await git(wtPath, 'add', '.');
		await git(wtPath, 'commit', '-m', 'local commit');

		const stats = await service.getDiffStats(repoPath, wtPath);

		assert.strictEqual(stats.additions, 1);
		assert.strictEqual(stats.filesChanged, 1);
	});
});
