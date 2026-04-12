/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Workstreams Labs. All rights reserved.
 *  Licensed under the Elastic License 2.0 (ELv2). See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as cp from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { promisify } from 'util';
import { IGitWorktreeService, IGitWorktreeInfo, IDiffStats, IPRInfo, IWorktreeMeta, parseWorktreeList } from '../common/gitWorktreeService.js';
import { ILogService } from '../../../../platform/log/common/log.js';

const execFile = promisify(cp.execFile);
const readFile = promisify(fs.readFile);
const rm = promisify(fs.rm);
const stat = promisify(fs.stat);
const writeFile = promisify(fs.writeFile);
const mkdir = promisify(fs.mkdir);

const TAG = '[GitWorktreeMainService]';

const MAX_UNTRACKED_FILE_SIZE = 256 * 1024; // 256 KB — skip large/binary files

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

	constructor(private readonly logService: ILogService) { }

	/**
	 * Wrapper around execFile that always includes the augmented PATH
	 * so that git/gh are found when launched from DMG/Finder on macOS.
	 */
	private static git(args: string[], opts: cp.ExecFileOptions) {
		return execFile('git', args, { ...opts, encoding: 'utf8', env: GitWorktreeMainService.augmentedEnv() });
	}

	async isGitRepository(repoPath: string): Promise<boolean> {
		try {
			await GitWorktreeMainService.git(['rev-parse', '--is-inside-work-tree'], { cwd: repoPath });
			return true;
		} catch {
			return false;
		}
	}

	async initRepository(repoPath: string): Promise<void> {
		await GitWorktreeMainService.git(['init', '-b', 'main'], { cwd: repoPath });
	}

	async getCurrentBranch(repoPath: string): Promise<string> {
		try {
			const { stdout } = await GitWorktreeMainService.git(['branch', '--show-current'], { cwd: repoPath });
			return stdout.trim() || 'main';
		} catch {
			return 'main';
		}
	}

	async getRemoteUrl(repoPath: string): Promise<string | undefined> {
		// Try 'origin' first
		const originUrl = await GitWorktreeMainService.git(['remote', 'get-url', 'origin'], { cwd: repoPath })
			.then(r => r.stdout.trim() || undefined)
			.catch(() => undefined);
		if (originUrl) {
			return originUrl;
		}

		// Fall back to the first available remote
		const remotes = await GitWorktreeMainService.git(['remote'], { cwd: repoPath })
			.then(r => r.stdout.trim())
			.catch(() => '');
		const firstRemote = remotes.split('\n')[0];
		if (!firstRemote) {
			return undefined;
		}
		return GitWorktreeMainService.git(['remote', 'get-url', firstRemote], { cwd: repoPath })
			.then(r => r.stdout.trim() || undefined)
			.catch(() => undefined);
	}

	async listWorktrees(repoPath: string): Promise<IGitWorktreeInfo[]> {
		try {
			const { stdout } = await GitWorktreeMainService.git(['worktree', 'list', '--porcelain'], { cwd: repoPath });
			return parseWorktreeList(stdout);
		} catch {
			return [];
		}
	}

	async listBranches(repoPath: string): Promise<string[]> {
		try {
			const { stdout } = await GitWorktreeMainService.git(['branch', '--format=%(refname:short)'], { cwd: repoPath });
			return stdout.trim().split('\n').filter(b => b);
		} catch {
			return [];
		}
	}

	async addWorktree(repoPath: string, name: string, baseBranch?: string): Promise<string> {
		const branchDir = this.branchDir(repoPath, name);
		const worktreePath = path.join(branchDir, path.basename(repoPath));

		await mkdir(branchDir, { recursive: true });
		const args = ['worktree', 'add', '-b', name, worktreePath];
		if (baseBranch) {
			args.push(baseBranch);
		}
		await GitWorktreeMainService.git(args, { cwd: repoPath });

		return worktreePath;
	}

	async removeWorktree(repoPath: string, worktreePath: string, branchName?: string, force?: boolean): Promise<void> {
		const args = ['worktree', 'remove', worktreePath];
		if (force) {
			args.push('--force');
		}
		await GitWorktreeMainService.git(args, { cwd: repoPath });
		if (branchName) {
			await GitWorktreeMainService.git(['branch', '-D', branchName], { cwd: repoPath });
		}

		// Clean up the parent branch directory (metadata.json, comments, images, etc.)
		const branchDir = path.dirname(worktreePath);
		const wsRoot = path.join(os.homedir(), '.workstreams');
		if (branchDir.startsWith(wsRoot + path.sep) && branchDir !== wsRoot) {
			await rm(branchDir, { recursive: true, force: true }).catch(() => { });
		}
	}

	async getDiffStats(repoPath: string, worktreePath: string): Promise<IDiffStats> {
		const empty: IDiffStats = { filesChanged: 0, additions: 0, deletions: 0, defaultBranch: 'main' };
		try {
			/**
			 * Resolve the repo's default branch (e.g. "main" or "master")
			 * via origin/HEAD — NOT `git branch --show-current` which
			 * returns whatever is checked out locally (could be a feature branch).
			 */
			let defaultBranch = 'main';
			try {
				const { stdout } = await GitWorktreeMainService.git([
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
				await GitWorktreeMainService.git(['rev-parse', '--verify', baseRef], { cwd: worktreePath });
			} catch {
				baseRef = defaultBranch;
			}

			/**
			 * Find the merge-base (common ancestor) between baseRef
			 * and HEAD. The diff is computed from merge-base to the
			 * working tree — matching how GitHub PRs show changes
			 * and how SCM "Changes in Parent" works.
			 */
			let mergeBase = baseRef;
			try {
				const { stdout } = await GitWorktreeMainService.git([
					'merge-base', baseRef, 'HEAD'
				], { cwd: worktreePath });
				mergeBase = stdout.trim();
			} catch {
				// If merge-base fails, fall back to baseRef
			}

			/**
			 * Single diff from merge-base to the working tree.
			 * This captures committed + staged + unstaged changes in
			 * one command — matching the "Changes in Parent" algorithm.
			 */
			const files = new Map<string, { add: number; del: number }>();

			const [numstatResult, untrackedResult] = await Promise.all([
				GitWorktreeMainService.git([
					'diff', '--numstat', mergeBase, '--'
				], { cwd: worktreePath }).catch(() => null),
				GitWorktreeMainService.git(['ls-files', '--others', '--exclude-standard'], { cwd: worktreePath }).catch(() => null),
			]);

			if (numstatResult) {
				for (const [file, stats] of parseNumstat(numstatResult.stdout)) {
					files.set(file, stats);
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
			return { filesChanged: files.size, additions, deletions, defaultBranch };
		} catch (err) {
			this.logService.error(TAG, `getDiffStats failed for "${worktreePath}":`, err);
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
		const dir = this.branchDir(repoPath, branchName);
		const metaPath = path.join(dir, 'metadata.json');
		await mkdir(dir, { recursive: true });
		await writeFile(metaPath, JSON.stringify(meta, null, '\t') + '\n', 'utf8');
	}

	async readWorktreeMeta(repoPath: string, branchName: string): Promise<IWorktreeMeta | null> {
		const metaPath = path.join(this.branchDir(repoPath, branchName), 'metadata.json');
		try {
			const content = await readFile(metaPath, 'utf8');
			return JSON.parse(content);
		} catch {
			return null;
		}
	}

	async getWorkstreamsDir(repoPath: string): Promise<string> {
		return path.join(os.homedir(), '.workstreams', path.basename(repoPath));
	}

	/** Returns the per-branch directory: ~/.workstreams/<repoName>/<branchName>/ */
	private branchDir(repoPath: string, branchName: string): string {
		return path.join(os.homedir(), '.workstreams', path.basename(repoPath), branchName);
	}
}
