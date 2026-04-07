/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Workstreams Labs. All rights reserved.
 *  Licensed under the Elastic License 2.0 (ELv2). See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../../base/common/event.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';

//#region GitHub PR types (workbench-layer equivalents of sessions-layer types)

export interface IGitHubUser {
	readonly login: string;
	readonly avatarUrl: string;
}

export interface IGitHubPRComment {
	readonly id: number;
	readonly body: string;
	readonly author: IGitHubUser;
	readonly createdAt: string;
	readonly updatedAt: string;
	readonly path: string | undefined;
	readonly line: number | undefined;
	readonly threadId: string;
	readonly inReplyToId: number | undefined;
}

export interface IGitHubPRReviewThread {
	readonly id: string;
	readonly isResolved: boolean;
	readonly path: string;
	readonly line: number | undefined;
	readonly comments: readonly IGitHubPRComment[];
}

export interface IGitHubPRContext {
	readonly owner: string;
	readonly repo: string;
	readonly prNumber: number;
}

export const enum ResolveContextStatus {
	/** An open PR was found for this branch. */
	Found = 'found',
	/** No open PR exists for this branch. */
	NoPR = 'noPR',
	/** No valid GitHub session for this repository. */
	NoAccess = 'noAccess',
	/** The remote URL is not a GitHub URL. */
	NotGitHub = 'notGitHub',
}

export type IResolveContextResult =
	| { readonly status: ResolveContextStatus.Found; readonly context: IGitHubPRContext }
	| { readonly status: ResolveContextStatus.NoPR | ResolveContextStatus.NoAccess | ResolveContextStatus.NotGitHub };

//#endregion

export const IGitHubCommentsService = createDecorator<IGitHubCommentsService>('githubCommentsService');

export interface IGitHubCommentsService {
	readonly _serviceBrand: undefined;

	readonly onDidChangeComments: Event<void>;

	/**
	 * Trigger the GitHub OAuth sign-in flow (always opens browser,
	 * even if sessions already exist). If owner/repo are provided,
	 * the new session is tested and linked to that repo.
	 */
	signIn(owner?: string, repo?: string): Promise<boolean>;

	/**
	 * Resolve the GitHub PR context (owner/repo/prNumber) for a given
	 * repository path and branch name.
	 */
	resolveContext(repoPath: string, branch: string): Promise<IResolveContextResult>;

	/**
	 * Fetch review threads for the given PR context.
	 */
	getReviewThreads(ctx: IGitHubPRContext): Promise<IGitHubPRReviewThread[]>;

	/**
	 * Clear cached data without firing events.
	 */
	clearCaches(): void;

	/**
	 * Clear cached data and fire change event.
	 */
	refresh(): Promise<void>;
}
