/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as cp from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { promisify } from 'util';
import { IGitWorktreeService, IGitWorktreeInfo, parseWorktreeList } from '../common/gitWorktreeService.js';

const execFile = promisify(cp.execFile);
const readFile = promisify(fs.readFile);
const writeFile = promisify(fs.writeFile);
const mkdir = promisify(fs.mkdir);

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

	async listWorktrees(repoPath: string): Promise<IGitWorktreeInfo[]> {
		try {
			const { stdout } = await execFile('git', ['worktree', 'list', '--porcelain'], { cwd: repoPath });
			return parseWorktreeList(stdout);
		} catch {
			return [];
		}
	}

	async addWorktree(repoPath: string, name: string): Promise<string> {
		const workstreamsDir = path.join(repoPath, WORKSTREAMS_DIR);
		const worktreeDir = path.join(workstreamsDir, name);
		const worktreePath = path.join(worktreeDir, WORKTREE_SUBDIR);

		await mkdir(worktreeDir, { recursive: true });
		await execFile('git', ['worktree', 'add', '-b', name, worktreePath], { cwd: repoPath });

		await this.ensureGitignore(repoPath);

		return worktreePath;
	}

	async removeWorktree(repoPath: string, worktreePath: string, branchName?: string): Promise<void> {
		await execFile('git', ['worktree', 'remove', worktreePath], { cwd: repoPath });
		if (branchName) {
			await execFile('git', ['branch', '-D', branchName], { cwd: repoPath });
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
