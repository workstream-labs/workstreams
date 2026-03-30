/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { Emitter } from '../../../../base/common/event.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IRequestService, asJson } from '../../../../platform/request/common/request.js';
import { IAuthenticationService } from '../../../services/authentication/common/authentication.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { IGitHubCommentsService, IGitHubPRContext, IGitHubPRComment, IGitHubPRReviewThread, IGitHubUser } from '../common/githubCommentsService.js';
import { IGitWorktreeService } from '../../orchestrator/common/gitWorktreeService.js';

const LOG_PREFIX = '[GitHubComments]';
const GITHUB_API_BASE = 'https://api.github.com';
const GITHUB_GRAPHQL_ENDPOINT = `${GITHUB_API_BASE}/graphql`;

//#region GitHub API response types

interface IGitHubPullsListItem {
	readonly number: number;
	readonly state: string;
}

interface IGitHubGraphQLReviewThreadsResponse {
	readonly repository: {
		readonly pullRequest: {
			readonly reviewThreads: {
				readonly nodes: readonly IGitHubGraphQLReviewThreadNode[];
			};
		} | null;
	} | null;
}

interface IGitHubGraphQLReviewThreadNode {
	readonly id: string;
	readonly isResolved: boolean;
	readonly path: string;
	readonly line: number | null;
	readonly comments: {
		readonly nodes: readonly IGitHubGraphQLReviewCommentNode[];
	};
}

interface IGitHubGraphQLReviewCommentNode {
	readonly databaseId: number | null;
	readonly body: string;
	readonly createdAt: string;
	readonly updatedAt: string;
	readonly path: string | null;
	readonly line: number | null;
	readonly originalLine: number | null;
	readonly replyTo: { readonly databaseId: number | null } | null;
	readonly author: { readonly login: string; readonly avatarUrl: string } | null;
}

//#endregion

const GET_REVIEW_THREADS_QUERY = [
	'query GetReviewThreads($owner: String!, $repo: String!, $prNumber: Int!) {',
	'  repository(owner: $owner, name: $repo) {',
	'    pullRequest(number: $prNumber) {',
	'      reviewThreads(first: 100) {',
	'        nodes {',
	'          id',
	'          isResolved',
	'          path',
	'          line',
	'          comments(first: 100) {',
	'            nodes {',
	'              databaseId',
	'              body',
	'              createdAt',
	'              updatedAt',
	'              path',
	'              line',
	'              originalLine',
	'              replyTo {',
	'                databaseId',
	'              }',
	'              author {',
	'                login',
	'                avatarUrl',
	'              }',
	'            }',
	'          }',
	'        }',
	'      }',
	'    }',
	'  }',
	'}',
].join('\n');

/** Regex to extract owner/repo from GitHub remote URLs (HTTPS and SSH). */
const GITHUB_REMOTE_RE = /github\.com[/:]([^/]+)\/([^/.]+?)(?:\.git)?$/i;

function encodeURIPath(s: string): string {
	return encodeURIComponent(s);
}

export class GitHubCommentsServiceImpl extends Disposable implements IGitHubCommentsService {

	declare readonly _serviceBrand: undefined;

	private readonly _onDidChangeComments = this._register(new Emitter<void>());
	readonly onDidChangeComments = this._onDidChangeComments.event;

	/** Cache: "owner/repo:branch" → context */
	private readonly _contextCache = new Map<string, IGitHubPRContext | null>();

	/** Cache: "owner/repo#prNumber" → threads */
	private readonly _threadsCache = new Map<string, IGitHubPRReviewThread[]>();

	constructor(
		@IRequestService private readonly requestService: IRequestService,
		@IAuthenticationService private readonly authenticationService: IAuthenticationService,
		@IGitWorktreeService private readonly gitWorktreeService: IGitWorktreeService,
		@ILogService private readonly logService: ILogService,
	) {
		super();
	}

	async isAuthenticated(): Promise<boolean> {
		try {
			const sessions = await this.authenticationService.getSessions('github');
			return sessions.length > 0;
		} catch {
			return false;
		}
	}

	async signIn(): Promise<boolean> {
		try {
			// Check if already authenticated
			const existing = await this.authenticationService.getSessions('github');
			if (existing.length > 0) {
				await this.refresh();
				return true;
			}

			// Trigger the OAuth flow
			const session = await this.authenticationService.createSession('github', ['repo']);
			if (session) {
				await this.refresh();
				return true;
			}
			return false;
		} catch (err) {
			this.logService.warn(LOG_PREFIX, 'GitHub sign-in failed:', err);
			return false;
		}
	}

	async resolveContext(repoPath: string, branch: string): Promise<IGitHubPRContext | undefined> {
		const cacheKey = `${repoPath}:${branch}`;
		const cached = this._contextCache.get(cacheKey);
		if (cached !== undefined) {
			return cached ?? undefined;
		}

		try {
			const remoteUrl = await this.gitWorktreeService.getRemoteUrl(repoPath);
			if (!remoteUrl) {
				this._contextCache.set(cacheKey, null);
				return undefined;
			}

			const match = GITHUB_REMOTE_RE.exec(remoteUrl);
			if (!match) {
				this._contextCache.set(cacheKey, null);
				return undefined;
			}

			const owner = match[1];
			const repo = match[2];

			// Find open PR for this branch
			const token = await this._getAuthToken();
			if (!token) {
				this._contextCache.set(cacheKey, null);
				return undefined;
			}

			const pullsUrl = `${GITHUB_API_BASE}/repos/${encodeURIPath(owner)}/${encodeURIPath(repo)}/pulls?head=${encodeURIComponent(`${owner}:${branch}`)}&state=open&per_page=1`;
			const response = await this.requestService.request({
				type: 'GET',
				url: pullsUrl,
				headers: {
					'Authorization': `token ${token}`,
					'Accept': 'application/vnd.github.v3+json',
					'User-Agent': 'VSCode-Workstream-Comments',
				},
				callSite: 'githubComments.resolveContext',
			}, CancellationToken.None);

			if (response.res.statusCode !== 200) {
				this.logService.warn(LOG_PREFIX, `Failed to list PRs: ${response.res.statusCode}`);
				this._contextCache.set(cacheKey, null);
				return undefined;
			}

			const pulls = await asJson<IGitHubPullsListItem[]>(response);
			if (!pulls || pulls.length === 0) {
				this._contextCache.set(cacheKey, null);
				return undefined;
			}

			const ctx: IGitHubPRContext = { owner, repo, prNumber: pulls[0].number };
			this._contextCache.set(cacheKey, ctx);
			return ctx;
		} catch (err) {
			this.logService.warn(LOG_PREFIX, 'Failed to resolve PR context:', err);
			this._contextCache.set(cacheKey, null);
			return undefined;
		}
	}

	async getReviewThreads(ctx: IGitHubPRContext): Promise<IGitHubPRReviewThread[]> {
		const cacheKey = `${ctx.owner}/${ctx.repo}#${ctx.prNumber}`;
		const cached = this._threadsCache.get(cacheKey);
		if (cached) {
			return cached;
		}

		try {
			const token = await this._getAuthToken();
			if (!token) {
				return [];
			}

			const response = await this.requestService.request({
				type: 'POST',
				url: GITHUB_GRAPHQL_ENDPOINT,
				headers: {
					'Authorization': `token ${token}`,
					'Accept': 'application/vnd.github+json',
					'Content-Type': 'application/json',
					'User-Agent': 'VSCode-Workstream-Comments',
				},
				data: JSON.stringify({
					query: GET_REVIEW_THREADS_QUERY,
					variables: { owner: ctx.owner, repo: ctx.repo, prNumber: ctx.prNumber },
				}),
				callSite: 'githubComments.getReviewThreads',
			}, CancellationToken.None);

			const body = await asJson<{ data?: IGitHubGraphQLReviewThreadsResponse; errors?: { message: string }[] }>(response);
			if (body?.errors?.length) {
				this.logService.warn(LOG_PREFIX, 'GraphQL errors:', body.errors.map(e => e.message).join('; '));
				return [];
			}

			const threadNodes = body?.data?.repository?.pullRequest?.reviewThreads.nodes;
			if (!threadNodes) {
				return [];
			}

			const threads = threadNodes.map(mapReviewThread);
			this._threadsCache.set(cacheKey, threads);
			return threads;
		} catch (err) {
			this.logService.warn(LOG_PREFIX, 'Failed to fetch review threads:', err);
			return [];
		}
	}

	async refresh(): Promise<void> {
		this._contextCache.clear();
		this._threadsCache.clear();
		this._onDidChangeComments.fire();
	}

	private async _getAuthToken(): Promise<string | undefined> {
		try {
			const sessions = await this.authenticationService.getSessions('github');
			if (sessions.length === 0) {
				return undefined;
			}
			return sessions[0].accessToken ?? undefined;
		} catch {
			return undefined;
		}
	}
}

//#region Mapping helpers

function mapUser(author: { login: string; avatarUrl: string }): IGitHubUser {
	return { login: author.login, avatarUrl: author.avatarUrl };
}

function mapReviewThread(node: IGitHubGraphQLReviewThreadNode): IGitHubPRReviewThread {
	return {
		id: node.id,
		isResolved: node.isResolved,
		path: node.path,
		line: node.line ?? undefined,
		comments: node.comments.nodes.flatMap(c => mapReviewComment(c, node)),
	};
}

function mapReviewComment(node: IGitHubGraphQLReviewCommentNode, thread: IGitHubGraphQLReviewThreadNode): IGitHubPRComment[] {
	if (node.databaseId === null || node.author === null) {
		return [];
	}
	return [{
		id: node.databaseId,
		body: node.body,
		author: mapUser(node.author),
		createdAt: node.createdAt,
		updatedAt: node.updatedAt,
		path: node.path ?? thread.path,
		line: node.line ?? node.originalLine ?? thread.line ?? undefined,
		threadId: thread.id,
		inReplyToId: node.replyTo?.databaseId ?? undefined,
	}];
}

//#endregion

registerSingleton(IGitHubCommentsService, GitHubCommentsServiceImpl, InstantiationType.Delayed);
