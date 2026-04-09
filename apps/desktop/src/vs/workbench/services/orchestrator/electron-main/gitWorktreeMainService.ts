/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Workstreams Labs. All rights reserved.
 *  Licensed under the Elastic License 2.0 (ELv2). See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as cp from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { promisify } from 'util';
import { IGitWorktreeService, IGitWorktreeInfo, IDiffStats, IPRInfo, IWorktreeMeta, parseWorktreeList } from '../common/gitWorktreeService.js';

const execFile = promisify(cp.execFile);
const readFile = promisify(fs.readFile);
const rm = promisify(fs.rm);
const stat = promisify(fs.stat);
const writeFile = promisify(fs.writeFile);
const mkdir = promisify(fs.mkdir);

const MAX_UNTRACKED_FILE_SIZE = 256 * 1024; // 256 KB — skip large/binary files

const WORKSTREAMS_DIR = '.workstreams';
const WORKTREE_SUBDIR = 'tree';
const GITIGNORE_ENTRY = '.workstreams/';

export function parseNumstat(stdout: string): Map<string, { add: number; del: number }> {
	const files = new Map<string, { add: number; del: number }>();
	for (const line of stdout.trim().split('\n')) {
		if (!line) {
			continue;
		}
		const [a, d, file] = line.split('\t');
		if (!file) {
			continue;
		}
		const add = a === '-' ? 0 : (parseInt(a, 10) || 0);
		const del = d === '-' ? 0 : (parseInt(d, 10) || 0);
		files.set(file, { add, del });
	}
	return files;
}

export class GitWorktreeMainService implements IGitWorktreeService {

	declare readonly _serviceBrand: undefined;

	async isGitRepository(repoPath: string): Promise<boolean> {
		try {
			await execFile('git', ['rev-parse', '--is-inside-work-tree'], { cwd: repoPath });
			return true;
		} catch {
			return false;
		}
	}

	async initRepository(repoPath: string): Promise<void> {
		await execFile('git', ['init', '-b', 'main'], { cwd: repoPath });
	}

	async getCurrentBranch(repoPath: string): Promise<string> {
		try {
			const { stdout } = await execFile('git', ['branch', '--show-current'], { cwd: repoPath });
			return stdout.trim() || 'main';
		} catch {
			return 'main';
		}
	}

	async getRemoteUrl(repoPath: string): Promise<string | undefined> {
		try {
			const { stdout } = await execFile('git', ['remote', 'get-url', 'origin'], { cwd: repoPath });
			return stdout.trim() || undefined;
		} catch {
			// No 'origin' remote — try first available remote
			try {
				const { stdout: remotes } = await execFile('git', ['remote'], { cwd: repoPath });
				const firstRemote = remotes.trim().split('\n')[0];
				if (firstRemote) {
					const { stdout } = await execFile('git', ['remote', 'get-url', firstRemote], { cwd: repoPath });
					return stdout.trim() || undefined;
				}
			} catch {
				// No remotes at all
			}
			return undefined;
		}
	}

	async listWorktrees(repoPath: string): Promise<IGitWorktreeInfo[]> {
		try {
			const { stdout } = await execFile('git', ['worktree', 'list', '--porcelain'], { cwd: repoPath });
			return parseWorktreeList(stdout);
		} catch {
			return [];
		}
	}

	async listBranches(repoPath: string): Promise<string[]> {
		try {
			const { stdout } = await execFile('git', ['branch', '--format=%(refname:short)'], { cwd: repoPath });
			return stdout.trim().split('\n').filter(b => b);
		} catch {
			return [];
		}
	}

	async addWorktree(repoPath: string, name: string, baseBranch?: string): Promise<string> {
		const workstreamsDir = path.join(repoPath, WORKSTREAMS_DIR);
		const worktreeDir = path.join(workstreamsDir, name);
		const worktreePath = path.join(worktreeDir, WORKTREE_SUBDIR);

		await mkdir(worktreeDir, { recursive: true });
		const args = ['worktree', 'add', '-b', name, worktreePath];
		if (baseBranch) {
			args.push(baseBranch);
		}
		await execFile('git', args, { cwd: repoPath });

		await this.ensureGitignore(repoPath);

		return worktreePath;
	}

	async removeWorktree(repoPath: string, worktreePath: string, branchName?: string, force?: boolean): Promise<void> {
		const args = ['worktree', 'remove', worktreePath];
		if (force) {
			args.push('--force');
		}
		await execFile('git', args, { cwd: repoPath });
		if (branchName) {
			await execFile('git', ['branch', '-D', branchName], { cwd: repoPath });
		}

		// Clean up the parent .workstreams/<name>/ directory (workstream.json, etc.)
		const worktreeDir = path.dirname(worktreePath);
		if (worktreeDir.includes(WORKSTREAMS_DIR) && worktreeDir !== path.join(repoPath, WORKSTREAMS_DIR)) {
			await rm(worktreeDir, { recursive: true, force: true }).catch(() => { });
		}
	}

	async getDiffStats(repoPath: string, worktreePath: string): Promise<IDiffStats> {
		const empty: IDiffStats = { filesChanged: 0, additions: 0, deletions: 0 };
		try {
			/**
			 * Resolve the repo's default branch (e.g. "main" or "master")
			 * via origin/HEAD — NOT `git branch --show-current` which
			 * returns whatever is checked out locally (could be a feature branch).
			 */
			let defaultBranch = 'main';
			try {
				const { stdout } = await execFile('git', [
					'symbolic-ref', '--short', 'refs/remotes/origin/HEAD'
				], { cwd: repoPath });
				defaultBranch = stdout.trim().replace(/^origin\//, '');
			} catch {
				// origin/HEAD not set — fall back to 'main'
			}

			/**
			 * Prefer origin/<default> so stats reflect remote state;
			 * fall back to local branch for repos without a remote.
			 */
			let baseRef = `origin/${defaultBranch}`;
			try {
				await execFile('git', ['rev-parse', '--verify', baseRef], { cwd: worktreePath });
			} catch {
				baseRef = defaultBranch;
			}

			// Ahead count — how many commits this branch has over the base
			let ahead = 0;
			try {
				const { stdout: tracking } = await execFile('git', [
					'rev-list', '--left-right', '--count', `${baseRef}...HEAD`
				], { cwd: worktreePath });
				const [, aheadStr] = tracking.trim().split(/\s+/);
				ahead = parseInt(aheadStr || '0', 10);
			} catch {
				// If rev-list fails (e.g. unrelated histories), fall through
			}

			/**
			 * Build the set of files to diff against the base ref.
			 *
			 * When the branch has commits ahead, find files the branch
			 * touched (three-dot --name-only). Also include any locally
			 * modified tracked files (staged + unstaged). The union
			 * ensures both committed and uncommitted changes are counted.
			 *
			 * Scoping to specific files handles squash merges: if the
			 * branch was squash-merged, tree content for branch-touched
			 * files is identical to base → empty diff.
			 */
			const filesToDiff = new Set<string>();

			if (ahead > 0) {
				const nameResult = await execFile('git', [
					'diff', '--name-only', `${baseRef}...HEAD`
				], { cwd: worktreePath }).catch(() => null);

				if (nameResult) {
					for (const f of nameResult.stdout.trim().split('\n')) {
						if (f) {
							filesToDiff.add(f);
						}
					}
				}
			}

			// Find locally modified tracked files (staged + unstaged)
			const [stagedNamesResult, unstagedNamesResult, untrackedResult] = await Promise.all([
				execFile('git', ['diff', '--cached', '--name-only'], { cwd: worktreePath }).catch(() => null),
				execFile('git', ['diff', '--name-only'], { cwd: worktreePath }).catch(() => null),
				execFile('git', ['ls-files', '--others', '--exclude-standard'], { cwd: worktreePath }).catch(() => null),
			]);

			for (const result of [stagedNamesResult, unstagedNamesResult]) {
				if (result) {
					for (const f of result.stdout.trim().split('\n')) {
						if (f) {
							filesToDiff.add(f);
						}
					}
				}
			}

			/**
			 * Single diff from baseRef to the working tree, scoped to
			 * the files we care about. `git diff <ref>` (no second
			 * treeish) compares the ref directly to the working tree,
			 * so committed + staged + unstaged changes are all captured
			 * in one accurate numstat — no double-counting.
			 */
			const files = new Map<string, { add: number; del: number }>();

			if (filesToDiff.size > 0) {
				const result = await execFile('git', [
					'diff', '--numstat', baseRef, '--', ...filesToDiff
				], { cwd: worktreePath }).catch(() => null);
				if (result) {
					for (const [file, stats] of parseNumstat(result.stdout)) {
						files.set(file, stats);
					}
				}
			}

			// Untracked new files — git diff misses these entirely
			if (untrackedResult) {
				const untrackedFiles = untrackedResult.stdout.trim().split('\n')
					.filter(f => f && !f.startsWith('.claude/') && !files.has(f));

				const lineCountResults = await Promise.all(untrackedFiles.map(async file => {
					try {
						const filePath = path.join(worktreePath, file);
						const fileStat = await stat(filePath);
						if (fileStat.size > MAX_UNTRACKED_FILE_SIZE) {
							return { file, add: 1 };
						}
						const content = await readFile(filePath, 'utf8');
						const lineCount = content.split('\n').length - (content.endsWith('\n') ? 1 : 0);
						return { file, add: Math.max(lineCount, 1) };
					} catch {
						return { file, add: 1 };
					}
				}));

				for (const { file, add } of lineCountResults) {
					files.set(file, { add, del: 0 });
				}
			}

			let additions = 0;
			let deletions = 0;
			for (const { add, del } of files.values()) {
				additions += add;
				deletions += del;
			}
			return { filesChanged: files.size, additions, deletions };
		} catch {
			return empty;
		}
	}

	//#region PR info

	private static readonly PR_CACHE_TTL_MS = 60_000;
	private readonly _prCache = new Map<string, { info: IPRInfo | null; ts: number }>();

	async getPRInfo(repoPath: string, branch: string): Promise<IPRInfo | null> {
		const cacheKey = `${repoPath}:${branch}`;
		const cached = this._prCache.get(cacheKey);
		if (cached && Date.now() - cached.ts < GitWorktreeMainService.PR_CACHE_TTL_MS) {
			return cached.info;
		}

		try {
			const { stdout } = await execFile('gh', [
				'pr', 'view', branch,
				'--json', 'number,state,isDraft,mergeable,url',
			], { cwd: repoPath, timeout: 10_000, env: GitWorktreeMainService.augmentedEnv() });

			const raw = JSON.parse(stdout.trim());

			const rawState = typeof raw.state === 'string' ? raw.state.toLowerCase() : 'open';
			const state: IPRInfo['state'] = raw.isDraft ? 'draft'
				: (rawState === 'merged' || rawState === 'closed') ? rawState
					: 'open';

			const mergeable: IPRInfo['mergeable'] = raw.mergeable === 'MERGEABLE' ? 'mergeable'
				: raw.mergeable === 'CONFLICTING' ? 'conflicting'
					: 'unknown';

			const info: IPRInfo = {
				number: raw.number,
				state,
				mergeable,
				url: raw.url ?? '',
			};
			this._prCache.set(cacheKey, { info, ts: Date.now() });
			return info;
		} catch {
			this._prCache.set(cacheKey, { info: null, ts: Date.now() });
			return null;
		}
	}

	//#endregion

	/**
	 * When launched from DMG/Finder on macOS, process.env.PATH is minimal
	 * (e.g. /usr/bin:/bin:/usr/sbin:/sbin) and won't include paths like
	 * /opt/homebrew/bin where CLI tools (gh, claude, codex) are installed.
	 * Returns an env object with augmented PATH.
	 */
	private static augmentedEnv(): NodeJS.ProcessEnv {
		const home = process.env.HOME || '';
		const extraPaths = [
			'/opt/homebrew/bin',
			'/usr/local/bin',
			`${home}/.local/bin`,
			`${home}/.npm/bin`,
			`${home}/.cargo/bin`,
		];
		const currentPath = process.env.PATH || '/usr/bin:/bin';
		const augmentedPath = [...extraPaths, ...currentPath.split(':')].join(':');
		return { ...process.env, PATH: augmentedPath };
	}

	private static readonly KNOWN_AGENTS = ['claude', 'codex'];

	async detectAgents(): Promise<string[]> {
		const env = GitWorktreeMainService.augmentedEnv();

		const results = await Promise.all(
			GitWorktreeMainService.KNOWN_AGENTS.map(async agent => {
				try {
					await execFile('which', [agent], { env });
					return agent;
				} catch {
					return null;
				}
			})
		);
		return results.filter((a): a is string => a !== null);
	}

	async writeWorktreeMeta(repoPath: string, branchName: string, meta: IWorktreeMeta): Promise<void> {
		const worktreeDir = path.join(repoPath, WORKSTREAMS_DIR, branchName);
		const metaPath = path.join(worktreeDir, 'workstream.json');
		await mkdir(worktreeDir, { recursive: true });
		await writeFile(metaPath, JSON.stringify(meta, null, '\t') + '\n', 'utf8');
	}

	async readWorktreeMeta(repoPath: string, branchName: string): Promise<IWorktreeMeta | null> {
		const metaPath = path.join(repoPath, WORKSTREAMS_DIR, branchName, 'workstream.json');
		try {
			const content = await readFile(metaPath, 'utf8');
			return JSON.parse(content);
		} catch {
			return null;
		}
	}

	private async ensureGitignore(repoPath: string): Promise<void> {
		const gitignorePath = path.join(repoPath, '.gitignore');

		let content = '';
		try {
			content = await readFile(gitignorePath, 'utf8');
		} catch {
			// .gitignore doesn't exist yet
		}

		const lines = content.split('\n');
		const alreadyHasEntry = lines.some(line => line.trim() === GITIGNORE_ENTRY || line.trim() === WORKSTREAMS_DIR);

		if (!alreadyHasEntry) {
			const suffix = content.length > 0 && !content.endsWith('\n') ? '\n' : '';
			await writeFile(gitignorePath, content + suffix + GITIGNORE_ENTRY + '\n', 'utf8');
		}
	}
}
