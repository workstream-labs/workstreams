/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Workstreams Labs. All rights reserved.
 *  Licensed under the Elastic License 2.0 (ELv2). See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';

export interface IGitWorktreeInfo {
	readonly path: string;
	readonly branch: string;
	readonly isBare: boolean;
}

export const IGitWorktreeService = createDecorator<IGitWorktreeService>('gitWorktreeService');

export interface IDiffStats {
	readonly filesChanged: number;
	readonly additions: number;
	readonly deletions: number;
	readonly defaultBranch: string;
}

export interface IWorktreeMeta {
	readonly name: string;
	readonly branch: string;
	readonly baseBranch?: string;
	readonly description?: string;
	readonly createdAt: string;
}

export interface IPRInfo {
	readonly number: number;
	readonly state: 'open' | 'draft' | 'merged' | 'closed';
	readonly mergeable: 'mergeable' | 'conflicting' | 'unknown';
	readonly url: string;
}

export interface IGitWorktreeService {
	readonly _serviceBrand: undefined;

	isGitRepository(repoPath: string): Promise<boolean>;
	initRepository(repoPath: string): Promise<void>;
	getCurrentBranch(repoPath: string): Promise<string>;
	getRemoteUrl(repoPath: string): Promise<string | undefined>;
	listWorktrees(repoPath: string): Promise<IGitWorktreeInfo[]>;
	listBranches(repoPath: string): Promise<string[]>;
	addWorktree(repoPath: string, name: string, baseBranch?: string): Promise<string>;
	removeWorktree(repoPath: string, worktreePath: string, branchName?: string, force?: boolean): Promise<void>;
	getDiffStats(repoPath: string, worktreePath: string): Promise<IDiffStats>;
	getPRInfo(repoPath: string, branch: string): Promise<IPRInfo | null>;
	detectAgents(): Promise<string[]>;
	writeWorktreeMeta(repoPath: string, branchName: string, meta: IWorktreeMeta): Promise<void>;
	readWorktreeMeta(repoPath: string, branchName: string): Promise<IWorktreeMeta | null>;
}

export function parseWorktreeList(output: string): IGitWorktreeInfo[] {
	const worktrees: IGitWorktreeInfo[] = [];
	const blocks = output.trim().split('\n\n');

	for (const block of blocks) {
		if (!block.trim()) {
			continue;
		}

		const lines = block.split('\n');
		let wtPath = '';
		let branch = '';
		let isBare = false;

		for (const line of lines) {
			if (line.startsWith('worktree ')) {
				wtPath = line.substring('worktree '.length);
			} else if (line.startsWith('branch ')) {
				branch = line.substring('branch '.length);
				branch = branch.replace(/^refs\/heads\//, '');
			} else if (line === 'bare') {
				isBare = true;
			}
		}

		if (wtPath) {
			worktrees.push({ path: wtPath, branch: branch || 'HEAD', isBare });
		}
	}

	return worktrees;
}
