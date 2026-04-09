/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Workstreams Labs. All rights reserved.
 *  Licensed under the Elastic License 2.0 (ELv2). See LICENSE.txt in the project root for license information.
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
const unlink = promisify(fs.unlink);

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

	test('combines committed and local changes', async () => {
		const wtPath = path.join(repoPath, '.workstreams', 'mixed', 'tree');
		await git(repoPath, 'worktree', 'add', '-b', 'mixed', wtPath);

		// Commit a change (against-base)
		await writeFile(path.join(wtPath, 'committed.ts'), 'committed\n');
		await git(wtPath, 'add', '.');
		await git(wtPath, 'commit', '-m', 'committed change');

		// Also make an unstaged change (local) to a different file
		await writeFile(path.join(wtPath, 'README.md'), '# Modified\n');

		const stats = await service.getDiffStats(repoPath, wtPath);

		// Should show both: committed.ts (+1) and README.md (+1 -1)
		assert.strictEqual(stats.filesChanged, 2);
		assert.strictEqual(stats.additions, 2);
		assert.strictEqual(stats.deletions, 1);
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

	test('combines committed + untracked files', async () => {
		const wtPath = path.join(repoPath, '.workstreams', 'commit-untracked', 'tree');
		await git(repoPath, 'worktree', 'add', '-b', 'commit-untracked', wtPath);

		// Commit a file
		await writeFile(path.join(wtPath, 'committed.ts'), 'line1\nline2\n');
		await git(wtPath, 'add', '.');
		await git(wtPath, 'commit', '-m', 'add committed file');

		// Add an untracked file (not staged, not committed)
		await writeFile(path.join(wtPath, 'brand-new.ts'), 'a\nb\nc\n');

		const stats = await service.getDiffStats(repoPath, wtPath);

		// committed.ts: +2, brand-new.ts: +3 (untracked)
		assert.strictEqual(stats.additions, 5);
		assert.strictEqual(stats.deletions, 0);
		assert.strictEqual(stats.filesChanged, 2);
	});

	test('committed + staged edits to same file are not double-counted', async () => {
		const wtPath = path.join(repoPath, '.workstreams', 'same-file', 'tree');
		await git(repoPath, 'worktree', 'add', '-b', 'same-file', wtPath);

		// Commit a new file with 3 lines
		await writeFile(path.join(wtPath, 'feature.ts'), 'line1\nline2\nline3\n');
		await git(wtPath, 'add', '.');
		await git(wtPath, 'commit', '-m', 'add feature');

		// Now stage a change to the SAME file (modify one line)
		await writeFile(path.join(wtPath, 'feature.ts'), 'line1\nmodified\nline3\n');
		await git(wtPath, 'add', 'feature.ts');

		const stats = await service.getDiffStats(repoPath, wtPath);

		// Single diff from base to working tree: still 3 lines added, 0 deleted
		// (the file doesn't exist on base, so all 3 lines are additions)
		// NOT 3 + 1 + 1 from summing committed + local diffs
		assert.strictEqual(stats.additions, 3);
		assert.strictEqual(stats.deletions, 0);
		assert.strictEqual(stats.filesChanged, 1);
	});

	test('committed + unstaged edits to existing file are not double-counted', async () => {
		const wtPath = path.join(repoPath, '.workstreams', 'existing-edit', 'tree');
		await git(repoPath, 'worktree', 'add', '-b', 'existing-edit', wtPath);

		// Commit a change to README (replace content)
		await writeFile(path.join(wtPath, 'README.md'), 'new title\nnew body\n');
		await git(wtPath, 'add', '.');
		await git(wtPath, 'commit', '-m', 'rewrite readme');

		// Now make an unstaged change to README (modify again)
		await writeFile(path.join(wtPath, 'README.md'), 'new title\nchanged body\n');

		const stats = await service.getDiffStats(repoPath, wtPath);

		// Base README was "# Test\n" (1 line). Working tree is "new title\nchanged body\n" (2 lines).
		// True diff from base: +2 -1. NOT committed (+2 -1) + local (+1 -1) = +3 -2.
		assert.strictEqual(stats.additions, 2);
		assert.strictEqual(stats.deletions, 1);
		assert.strictEqual(stats.filesChanged, 1);
	});

	test('excludes untracked files in .claude/ directory', async () => {
		const wtPath = path.join(repoPath, '.workstreams', 'claude-excl', 'tree');
		await git(repoPath, 'worktree', 'add', '-b', 'claude-excl', wtPath);

		// Create an untracked file inside .claude/
		await mkdir(path.join(wtPath, '.claude'), { recursive: true });
		await writeFile(path.join(wtPath, '.claude', 'settings.json'), '{"key":"value"}\n');

		// Create a normal untracked file
		await writeFile(path.join(wtPath, 'real-file.ts'), 'code\n');

		const stats = await service.getDiffStats(repoPath, wtPath);

		// Only real-file.ts should be counted, not .claude/settings.json
		assert.strictEqual(stats.filesChanged, 1);
		assert.strictEqual(stats.additions, 1);
	});

	test('counts large untracked file as 1 addition', async () => {
		const wtPath = path.join(repoPath, '.workstreams', 'large-file', 'tree');
		await git(repoPath, 'worktree', 'add', '-b', 'large-file', wtPath);

		// Create a file larger than 256KB
		const largeContent = 'x'.repeat(257 * 1024) + '\n';
		await writeFile(path.join(wtPath, 'big-binary.dat'), largeContent);

		const stats = await service.getDiffStats(repoPath, wtPath);

		// Large file should count as 1 addition, not line count
		assert.strictEqual(stats.filesChanged, 1);
		assert.strictEqual(stats.additions, 1);
	});

	test('counts committed file deletion', async () => {
		const wtPath = path.join(repoPath, '.workstreams', 'delete-file', 'tree');
		await git(repoPath, 'worktree', 'add', '-b', 'delete-file', wtPath);

		// Delete the README that exists on base
		await unlink(path.join(wtPath, 'README.md'));
		await git(wtPath, 'add', '.');
		await git(wtPath, 'commit', '-m', 'delete readme');

		const stats = await service.getDiffStats(repoPath, wtPath);

		// README.md was "# Test\n" → 1 deletion
		assert.strictEqual(stats.additions, 0);
		assert.strictEqual(stats.deletions, 1);
		assert.strictEqual(stats.filesChanged, 1);
	});

	test('staged + unstaged changes to same file without commits ahead', async () => {
		const wtPath = path.join(repoPath, '.workstreams', 'stage-unstage', 'tree');
		await git(repoPath, 'worktree', 'add', '-b', 'stage-unstage', wtPath);

		// Stage a change to README
		await writeFile(path.join(wtPath, 'README.md'), '# Staged\n');
		await git(wtPath, 'add', 'README.md');

		// Then make a further unstaged change
		await writeFile(path.join(wtPath, 'README.md'), '# Staged\nUnstaged line\n');

		const stats = await service.getDiffStats(repoPath, wtPath);

		// Base was "# Test\n", working tree is "# Staged\nUnstaged line\n"
		// True diff: +2 -1
		assert.strictEqual(stats.additions, 2);
		assert.strictEqual(stats.deletions, 1);
		assert.strictEqual(stats.filesChanged, 1);
	});

	test('committed + staged + unstaged all at once', async () => {
		const wtPath = path.join(repoPath, '.workstreams', 'triple', 'tree');
		await git(repoPath, 'worktree', 'add', '-b', 'triple', wtPath);

		// Committed change: new file
		await writeFile(path.join(wtPath, 'committed.ts'), 'line1\n');
		await git(wtPath, 'add', '.');
		await git(wtPath, 'commit', '-m', 'commit');

		// Staged change: modify README
		await writeFile(path.join(wtPath, 'README.md'), '# New Title\n');
		await git(wtPath, 'add', 'README.md');

		// Unstaged change: edit the committed file further
		await writeFile(path.join(wtPath, 'committed.ts'), 'line1\nline2\n');

		// Also an untracked file
		await writeFile(path.join(wtPath, 'untracked.txt'), 'hello\nworld\n');

		const stats = await service.getDiffStats(repoPath, wtPath);

		// committed.ts: base→working tree = +2 (new file, 2 lines)
		// README.md: base→working tree = +1 -1 (title changed)
		// untracked.txt: +2
		assert.strictEqual(stats.filesChanged, 3);
		assert.strictEqual(stats.additions, 5);
		assert.strictEqual(stats.deletions, 1);
	});

	test('returns defaultBranch as main when no origin/HEAD is set', async () => {
		const wtPath = path.join(repoPath, '.workstreams', 'default-branch', 'tree');
		await git(repoPath, 'worktree', 'add', '-b', 'default-branch', wtPath);

		const stats = await service.getDiffStats(repoPath, wtPath);

		assert.strictEqual(stats.defaultBranch, 'main');
	});

	test('returns defaultBranch as master when origin/HEAD points to master', async () => {
		// Set up a bare "remote" repo with master as default branch
		const remoteRepo = await mkdtemp(path.join(os.tmpdir(), 'ws-remote-'));
		tempDirs.push(remoteRepo);
		await git(remoteRepo, 'init', '--bare', '-b', 'master');

		// Push local main as master to the remote
		await git(repoPath, 'remote', 'add', 'origin', remoteRepo);
		await git(repoPath, 'push', '-u', 'origin', 'main:master');

		// Set origin/HEAD to point to master
		await git(repoPath, 'remote', 'set-head', 'origin', 'master');

		const wtPath = path.join(repoPath, '.workstreams', 'master-detect', 'tree');
		await git(repoPath, 'worktree', 'add', '-b', 'master-detect', wtPath);

		const stats = await service.getDiffStats(repoPath, wtPath);

		assert.strictEqual(stats.defaultBranch, 'master');
	});

	test('diff stats are correct against origin/master when default branch is master', async () => {
		// Set up a bare "remote" repo with master as default branch
		const remoteRepo = await mkdtemp(path.join(os.tmpdir(), 'ws-remote-'));
		tempDirs.push(remoteRepo);
		await git(remoteRepo, 'init', '--bare', '-b', 'master');

		// Push local main as master to the remote
		await git(repoPath, 'remote', 'add', 'origin', remoteRepo);
		await git(repoPath, 'push', '-u', 'origin', 'main:master');
		await git(repoPath, 'remote', 'set-head', 'origin', 'master');

		const wtPath = path.join(repoPath, '.workstreams', 'master-stats', 'tree');
		await git(repoPath, 'worktree', 'add', '-b', 'master-stats', wtPath);

		// Make a commit in the worktree
		await writeFile(path.join(wtPath, 'feature.ts'), 'line1\nline2\n');
		await git(wtPath, 'add', '.');
		await git(wtPath, 'commit', '-m', 'add feature');

		const stats = await service.getDiffStats(repoPath, wtPath);

		assert.strictEqual(stats.defaultBranch, 'master');
		assert.strictEqual(stats.filesChanged, 1);
		assert.strictEqual(stats.additions, 2);
		assert.strictEqual(stats.deletions, 0);
	});

	test('squash-merged branch with local edits shows only local edits', async () => {
		const wtPath = path.join(repoPath, '.workstreams', 'squash-local', 'tree');
		await git(repoPath, 'worktree', 'add', '-b', 'squash-local', wtPath);

		// Commit a feature
		await writeFile(path.join(wtPath, 'feature.ts'), 'export const x = 1;\n');
		await git(wtPath, 'add', '.');
		await git(wtPath, 'commit', '-m', 'add feature');

		// Squash-merge into main
		await git(repoPath, 'merge', '--squash', 'squash-local');
		await git(repoPath, 'commit', '-m', 'squash merge');

		// Now make a new unstaged edit in the worktree
		await writeFile(path.join(wtPath, 'README.md'), '# Changed\n');

		const stats = await service.getDiffStats(repoPath, wtPath);

		// feature.ts was squash-merged (tree matches) → 0 diff for that file.
		// README.md changed from "# Test\n" to "# Changed\n" → +1 -1.
		assert.strictEqual(stats.additions, 1);
		assert.strictEqual(stats.deletions, 1);
		assert.strictEqual(stats.filesChanged, 1);
	});
});
