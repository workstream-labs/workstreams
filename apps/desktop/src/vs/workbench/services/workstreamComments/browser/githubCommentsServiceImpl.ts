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
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { IGitHubCommentsService, IGitHubPRContext, IGitHubPRComment, IGitHubPRReviewThread, IGitHubUser, IResolveContextResult, ResolveContextStatus } from '../common/githubCommentsService.js';
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

/** 1 hour TTL for cached PR lookups (not token TTL — VS Code manages that). */
const CACHE_TTL_MS = 60 * 60 * 1000;

/** Storage key for the persistent repo→account mapping. */
const REPO_TOKEN_MAP_KEY = 'githubComments.repoAccountMap';

interface ICacheEntry<T> {
	readonly data: T;
	readonly fetchedAt: number;
}

export class GitHubCommentsServiceImpl extends Disposable implements IGitHubCommentsService {

	declare readonly _serviceBrand: undefined;

	private readonly _onDidChangeComments = this._register(new Emitter<void>());
	readonly onDidChangeComments = this._onDidChangeComments.event;

	private readonly _contextCache = new Map<string, ICacheEntry<IResolveContextResult>>();
	private readonly _threadsCache = new Map<string, ICacheEntry<IGitHubPRReviewThread[]>>();

	/** Persistent: "owner/repo" → session account id. Survives restarts. */
	private readonly _repoTokenCache = new Map<string, string>();

	constructor(
		@IRequestService private readonly requestService: IRequestService,
		@IAuthenticationService private readonly authenticationService: IAuthenticationService,
		@IGitWorktreeService private readonly gitWorktreeService: IGitWorktreeService,
		@IStorageService private readonly storageService: IStorageService,
		@ILogService private readonly logService: ILogService,
	) {
		super();
		this._restoreRepoTokenCache();

		// Auto-refresh when GitHub sessions change (sign-in, sign-out, token refresh)
		this._register(this.authenticationService.onDidChangeSessions(e => {
			if (e.providerId === 'github') {
				this.refresh();
			}
		}));
	}

	//#region Public API

	async isAuthenticated(): Promise<boolean> {
		try {
			const sessions = await this.authenticationService.getSessions('github', ['repo']);
			return sessions.length > 0;
		} catch {
			return false;
		}
	}

	async signIn(owner?: string, repo?: string): Promise<boolean> {
		try {
			const session = await this.authenticationService.createSession('github', ['repo']);
			if (!session) {
				return false;
			}
			if (owner && repo) {
				await this._testAndLinkSession(session.accessToken, session.account.id, session.account.label, owner, repo);
			}
			await this.refresh();
			return true;
		} catch (err) {
			this.logService.warn(LOG_PREFIX, 'GitHub sign-in failed:', err);
			return false;
		}
	}

	async resolveContext(repoPath: string, branch: string): Promise<IResolveContextResult> {
		const cacheKey = `${repoPath}:${branch}`;
		const cached = this._contextCache.get(cacheKey);
		if (cached && (Date.now() - cached.fetchedAt) < CACHE_TTL_MS) {
			return cached.data;
		}

		try {
			const remoteUrl = await this.gitWorktreeService.getRemoteUrl(repoPath);
			if (!remoteUrl) {
				return this._cacheResult(cacheKey, { status: ResolveContextStatus.NotGitHub });
			}

			const match = GITHUB_REMOTE_RE.exec(remoteUrl);
			if (!match) {
				this.logService.warn(LOG_PREFIX, `Remote URL does not match GitHub pattern: ${remoteUrl}`);
				return this._cacheResult(cacheKey, { status: ResolveContextStatus.NotGitHub });
			}

			const owner = match[1];
			const repo = match[2];
			const repoSlug = `${owner}/${repo}`;
			const pullsUrl = `${GITHUB_API_BASE}/repos/${encodeURIPath(owner)}/${encodeURIPath(repo)}/pulls?head=${encodeURIComponent(`${owner}:${branch}`)}&state=open&per_page=1`;

			// Try stored session for this repo
			const storedToken = await this._getTokenForRepo(owner, repo);
			if (storedToken) {
				const result = await this._queryPRs(storedToken, pullsUrl, owner, repo, branch, cacheKey);
				if (result) {
					return result;
				}
				// Token expired/revoked — VS Code removed the session. Clear mapping.
				this.logService.info(LOG_PREFIX, `Stored session for ${repoSlug} expired, clearing mapping`);
				this._repoTokenCache.delete(repoSlug);
				this._persistRepoTokenCache();
			}

			// No valid session — don't prompt, let the view show a sign-in action
			this.logService.info(LOG_PREFIX, `No session for ${repoSlug}, sign-in required`);
			return this._cacheResult(cacheKey, { status: ResolveContextStatus.NoAccess });
		} catch (err) {
			this.logService.warn(LOG_PREFIX, 'Failed to resolve PR context:', err);
			return this._cacheResult(cacheKey, { status: ResolveContextStatus.NoPR });
		}
	}

	async getReviewThreads(ctx: IGitHubPRContext): Promise<IGitHubPRReviewThread[]> {
		const cacheKey = `${ctx.owner}/${ctx.repo}#${ctx.prNumber}`;
		const cached = this._threadsCache.get(cacheKey);
		if (cached && (Date.now() - cached.fetchedAt) < CACHE_TTL_MS) {
			return cached.data;
		}

		try {
			const token = await this._getTokenForRepo(ctx.owner, ctx.repo);
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
			this._threadsCache.set(cacheKey, { data: threads, fetchedAt: Date.now() });
			return threads;
		} catch (err) {
			this.logService.warn(LOG_PREFIX, 'Failed to fetch review threads:', err);
			return [];
		}
	}

	clearCaches(): void {
		this._contextCache.clear();
		this._threadsCache.clear();
	}

	async refresh(): Promise<void> {
		this.clearCaches();
		this._onDidChangeComments.fire();
	}

	//#endregion

	//#region Private helpers

	/**
	 * Query GitHub for open PRs. Returns a cached result on success (200),
	 * or undefined if the token lacks access (so caller can handle it).
	 */
	private async _queryPRs(token: string, pullsUrl: string, owner: string, repo: string, branch: string, cacheKey: string): Promise<IResolveContextResult | undefined> {
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
			return undefined;
		}

		const pulls = await asJson<IGitHubPullsListItem[]>(response);
		if (!pulls || pulls.length === 0) {
			this.logService.info(LOG_PREFIX, `No open PRs for ${owner}/${repo} branch=${branch}`);
			return this._cacheResult(cacheKey, { status: ResolveContextStatus.NoPR });
		}

		this.logService.info(LOG_PREFIX, `Resolved PR #${pulls[0].number} for ${owner}/${repo} branch=${branch}`);
		return this._cacheResult(cacheKey, {
			status: ResolveContextStatus.Found,
			context: { owner, repo, prNumber: pulls[0].number },
		});
	}

	private _cacheResult(cacheKey: string, result: IResolveContextResult): IResolveContextResult {
		this._contextCache.set(cacheKey, { data: result, fetchedAt: Date.now() });
		return result;
	}

	/**
	 * Test a token against a repo and persist the mapping if it works.
	 */
	private async _testAndLinkSession(token: string, accountId: string, accountLabel: string, owner: string, repo: string): Promise<void> {
		const repoSlug = `${owner}/${repo}`;
		try {
			const response = await this.requestService.request({
				type: 'GET',
				url: `${GITHUB_API_BASE}/repos/${encodeURIPath(owner)}/${encodeURIPath(repo)}`,
				headers: {
					'Authorization': `token ${token}`,
					'Accept': 'application/vnd.github.v3+json',
					'User-Agent': 'VSCode-Workstream-Comments',
				},
				callSite: 'githubComments.testAndLink',
			}, CancellationToken.None);
			if (response.res.statusCode === 200) {
				this._repoTokenCache.set(repoSlug, accountId);
				this._persistRepoTokenCache();
				this.logService.info(LOG_PREFIX, `Linked session "${accountLabel}" to ${repoSlug}`);
			}
		} catch {
			// Test failed — don't link, but don't error either
		}
	}

	/**
	 * Get the stored token for a specific repo. Returns undefined if
	 * no mapping exists or the session has been removed by VS Code
	 * (e.g. token expired/revoked).
	 */
	private async _getTokenForRepo(owner: string, repo: string): Promise<string | undefined> {
		const cachedAccountId = this._repoTokenCache.get(`${owner}/${repo}`);
		if (!cachedAccountId) {
			return undefined;
		}
		const sessions = await this.authenticationService.getSessions('github', ['repo']);
		const match = sessions.find(s => s.account.id === cachedAccountId);
		return match?.accessToken;
	}

	private _restoreRepoTokenCache(): void {
		try {
			const raw = this.storageService.get(REPO_TOKEN_MAP_KEY, StorageScope.APPLICATION);
			if (raw) {
				const map: Record<string, string> = JSON.parse(raw);
				for (const [repoSlug, accountId] of Object.entries(map)) {
					this._repoTokenCache.set(repoSlug, accountId);
				}
				this.logService.info(LOG_PREFIX, `Restored ${this._repoTokenCache.size} repo→account mapping(s)`);
			}
		} catch {
			// Corrupted data — ignore
		}
	}

	private _persistRepoTokenCache(): void {
		const obj: Record<string, string> = {};
		for (const [repoSlug, accountId] of this._repoTokenCache) {
			obj[repoSlug] = accountId;
		}
		this.storageService.store(REPO_TOKEN_MAP_KEY, JSON.stringify(obj), StorageScope.APPLICATION, StorageTarget.MACHINE);
	}

	//#endregion
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
