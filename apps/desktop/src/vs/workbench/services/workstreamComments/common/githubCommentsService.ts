/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
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

//#endregion

export const IGitHubCommentsService = createDecorator<IGitHubCommentsService>('githubCommentsService');

export interface IGitHubCommentsService {
	readonly _serviceBrand: undefined;

	readonly onDidChangeComments: Event<void>;

	/**
	 * Check whether a GitHub authentication session exists (without prompting).
	 */
	isAuthenticated(): Promise<boolean>;

	/**
	 * Trigger the GitHub OAuth sign-in flow. Returns true if successful.
	 */
	signIn(): Promise<boolean>;

	/**
	 * Resolve the GitHub PR context (owner/repo/prNumber) for a given
	 * repository path and branch name. Returns undefined if no PR is found.
	 */
	resolveContext(repoPath: string, branch: string): Promise<IGitHubPRContext | undefined>;

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
