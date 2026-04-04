/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as cp from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { promisify } from 'util';
import { IGitWorktreeService, IGitWorktreeInfo, IDiffStats, IWorktreeMeta, parseWorktreeList } from '../common/gitWorktreeService.js';

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
			const { stdout: branchOut } = await execFile('git', ['branch', '--show-current'], { cwd: worktreePath });
			const branch = branchOut.trim();
			if (!branch) {
				return empty;
			}

			// 1) Committed changes: diff from merge-base to branch tip
			// 2) Uncommitted changes: staged + unstaged in the worktree
			const [committedResult, uncommittedResult, untrackedResult] = await Promise.all([
				execFile('git', ['diff', '--numstat', `HEAD...${branch}`], { cwd: repoPath }).catch(() => null),
				execFile('git', ['diff', '--numstat', 'HEAD'], { cwd: worktreePath }).catch(() => null),
				execFile('git', ['ls-files', '--others', '--exclude-standard'], { cwd: worktreePath }).catch(() => null),
			]);

			// Accumulate by file path — committed diff (merge-base → branch tip) and
			// uncommitted diff (branch tip → working tree) are additive, not overlapping
			const files = new Map<string, { add: number; del: number }>();

			for (const result of [committedResult, uncommittedResult]) {
				if (!result) {
					continue;
				}
				for (const line of result.stdout.trim().split('\n')) {
					if (!line) {
						continue;
					}
					const [a, d, file] = line.split('\t');
					if (!file) {
						continue;
					}
					const add = a === '-' ? 0 : (parseInt(a, 10) || 0);
					const del = d === '-' ? 0 : (parseInt(d, 10) || 0);
					const existing = files.get(file);
					if (existing) {
						existing.add += add;
						existing.del += del;
					} else {
						files.set(file, { add, del });
					}
				}
			}

			// 3) Untracked new files — git diff HEAD misses these entirely
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

	private static readonly KNOWN_AGENTS = ['claude', 'codex'];

	async detectAgents(): Promise<string[]> {
		/**
		 * When launched from DMG/Finder on macOS, process.env.PATH is minimal
		 * (e.g. /usr/bin:/bin:/usr/sbin:/sbin) and won't include paths like
		 * /opt/homebrew/bin where agents are typically installed.
		 * Augment PATH with common binary locations so `which` can find them.
		 */
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
		const env = { ...process.env, PATH: augmentedPath };

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
