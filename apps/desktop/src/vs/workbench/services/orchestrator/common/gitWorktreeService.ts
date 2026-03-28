/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';

export interface IGitWorktreeInfo {
	readonly path: string;
	readonly branch: string;
	readonly isBare: boolean;
}

export const IGitWorktreeService = createDecorator<IGitWorktreeService>('gitWorktreeService');

export interface IGitWorktreeService {
	readonly _serviceBrand: undefined;

	isGitRepository(repoPath: string): Promise<boolean>;
	initRepository(repoPath: string): Promise<void>;
	getCurrentBranch(repoPath: string): Promise<string>;
	listWorktrees(repoPath: string): Promise<IGitWorktreeInfo[]>;
	addWorktree(repoPath: string, name: string): Promise<string>;
	removeWorktree(repoPath: string, worktreePath: string, branchName?: string): Promise<void>;
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
