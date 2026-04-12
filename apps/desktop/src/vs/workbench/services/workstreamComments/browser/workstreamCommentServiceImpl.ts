/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Workstreams Labs. All rights reserved.
 *  Licensed under the Elastic License 2.0 (ELv2). See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { Emitter } from '../../../../base/common/event.js';
import { URI } from '../../../../base/common/uri.js';
import { VSBuffer } from '../../../../base/common/buffer.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { IWorkstreamCommentService, IWorkstreamComment, IWorkstreamCommentThread, IWorkstreamCommentChangeEvent, CommentSide, DiffLineType } from '../common/workstreamCommentService.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { joinPath } from '../../../../base/common/resources.js';

/**
 * JSON shape written to disk. Uses the CLI's field names for compatibility
 * (apps/cli/src/core/comments.ts), but adds `id` and `resolved` fields
 * that the CLI ignores gracefully.
 */
interface IPersistedComment {
	id?: string;
	filePath: string;
	line?: number;
	side?: CommentSide;
	lineType?: DiffLineType;
	lineContent?: string;
	text: string;
	createdAt: string;
	resolved?: boolean;
}

interface IPersistedThread {
	workstream: string;
	comments: IPersistedComment[];
	overallComment?: string;
	updatedAt: string;
}

export class WorkstreamCommentServiceImpl extends Disposable implements IWorkstreamCommentService {

	declare readonly _serviceBrand: undefined;

	private readonly _onDidChangeComments = this._register(new Emitter<IWorkstreamCommentChangeEvent>());
	readonly onDidChangeComments = this._onDidChangeComments.event;

	/** In-memory cache: workstream name → thread data */
	private readonly _cache = new Map<string, IWorkstreamCommentThread>();

	/** Base path for resolving comment file URIs (set by the contribution on worktree switch) */
	private _basePath: URI | undefined;

	constructor(
		@IFileService private readonly fileService: IFileService,
		@ILogService private readonly logService: ILogService,
	) {
		super();
	}

	// --- Configuration ---

	/**
	 * Set the base repo path used to resolve comment file URIs.
	 * Called by the workbench contribution when the active worktree changes.
	 */
	setBasePath(basePath: URI): void {
		this._basePath = basePath;
		this._cache.clear();
	}

	/**
	 * Invalidate the cache for a workstream so the next read hits disk.
	 */
	invalidateCache(workstream?: string): void {
		if (workstream) {
			this._cache.delete(workstream);
		} else {
			this._cache.clear();
		}
	}

	// --- Public API ---

	async getComments(workstream: string, filePath?: string): Promise<IWorkstreamComment[]> {
		const thread = await this._loadThread(workstream);
		if (filePath) {
			return thread.comments.filter(c => c.filePath === filePath);
		}
		return thread.comments;
	}

	async getThread(workstream: string): Promise<IWorkstreamCommentThread> {
		return this._loadThread(workstream);
	}

	async addComment(workstream: string, filePath: string, line: number, text: string, side: CommentSide = 'new', lineType?: DiffLineType, lineContent?: string): Promise<IWorkstreamComment> {
		const thread = await this._loadThread(workstream);
		const comment: IWorkstreamComment = {
			id: generateUuid(),
			filePath,
			line,
			side,
			lineType,
			lineContent,
			text,
			createdAt: new Date().toISOString(),
			resolved: false,
		};

		const updatedThread: IWorkstreamCommentThread = {
			...thread,
			comments: [...thread.comments, comment],
			updatedAt: new Date().toISOString(),
		};

		await this._saveThread(workstream, updatedThread);
		this._onDidChangeComments.fire({ workstream, filePath });
		return comment;
	}

	async updateComment(workstream: string, commentId: string, text: string): Promise<void> {
		const thread = await this._loadThread(workstream);
		const idx = thread.comments.findIndex(c => c.id === commentId);
		if (idx === -1) {
			return;
		}

		const updated = { ...thread.comments[idx], text };
		const comments = [...thread.comments];
		comments[idx] = updated;

		await this._saveThread(workstream, {
			...thread,
			comments,
			updatedAt: new Date().toISOString(),
		});
		this._onDidChangeComments.fire({ workstream, filePath: updated.filePath });
	}

	async deleteComment(workstream: string, commentId: string): Promise<void> {
		const thread = await this._loadThread(workstream);
		const comment = thread.comments.find(c => c.id === commentId);
		if (!comment) {
			return;
		}

		await this._saveThread(workstream, {
			...thread,
			comments: thread.comments.filter(c => c.id !== commentId),
			updatedAt: new Date().toISOString(),
		});
		this._onDidChangeComments.fire({ workstream, filePath: comment.filePath });
	}

	async resolveComment(workstream: string, commentId: string): Promise<void> {
		await this._setResolved(workstream, commentId, true);
	}

	async unresolveComment(workstream: string, commentId: string): Promise<void> {
		await this._setResolved(workstream, commentId, false);
	}

	// --- Internal helpers ---

	private async _setResolved(workstream: string, commentId: string, resolved: boolean): Promise<void> {
		const thread = await this._loadThread(workstream);
		const idx = thread.comments.findIndex(c => c.id === commentId);
		if (idx === -1) {
			return;
		}

		const updated = { ...thread.comments[idx], resolved };
		const comments = [...thread.comments];
		comments[idx] = updated;

		await this._saveThread(workstream, {
			...thread,
			comments,
			updatedAt: new Date().toISOString(),
		});
		this._onDidChangeComments.fire({ workstream, filePath: updated.filePath });
	}

	private async _loadThread(workstream: string): Promise<IWorkstreamCommentThread> {
		const cached = this._cache.get(workstream);
		if (cached) {
			return cached;
		}

		const uri = this._commentsFileUri(workstream);
		try {
			const content = await this.fileService.readFile(uri);
			const parsed: IPersistedThread = JSON.parse(content.value.toString());
			const thread = this._fromPersisted(parsed);
			this._cache.set(workstream, thread);
			return thread;
		} catch {
			// File doesn't exist or is invalid — return empty thread
			const empty: IWorkstreamCommentThread = {
				workstream,
				comments: [],
				updatedAt: new Date().toISOString(),
			};
			this._cache.set(workstream, empty);
			return empty;
		}
	}

	private async _saveThread(workstream: string, thread: IWorkstreamCommentThread): Promise<void> {
		this._cache.set(workstream, thread);

		const uri = this._commentsFileUri(workstream);
		const persisted = this._toPersisted(thread);
		const content = JSON.stringify(persisted, null, 2);

		try {
			await this.fileService.writeFile(uri, VSBuffer.fromString(content));
		} catch (err) {
			this.logService.error(`[WorkstreamCommentService] Failed to write comments for ${workstream}:`, err);
		}
	}

	private _commentsFileUri(workstream: string): URI {
		const base = this._basePath ?? URI.file('.');
		return joinPath(base, workstream, 'comments.json');
	}

	// --- Serialization (CLI-compatible) ---

	private _fromPersisted(data: IPersistedThread): IWorkstreamCommentThread {
		return {
			workstream: data.workstream,
			comments: (data.comments ?? []).map(c => ({
				id: c.id ?? generateUuid(),
				filePath: c.filePath,
				line: c.line ?? 0,
				side: c.side ?? 'new',
				lineType: c.lineType,
				lineContent: c.lineContent,
				text: c.text,
				createdAt: c.createdAt,
				resolved: c.resolved ?? false,
			})),
			overallComment: data.overallComment,
			updatedAt: data.updatedAt,
		};
	}

	private _toPersisted(thread: IWorkstreamCommentThread): IPersistedThread {
		return {
			workstream: thread.workstream,
			comments: thread.comments.map(c => ({
				id: c.id,
				filePath: c.filePath,
				line: c.line,
				side: c.side,
				lineType: c.lineType,
				lineContent: c.lineContent,
				text: c.text,
				createdAt: c.createdAt,
				resolved: c.resolved,
			})),
			overallComment: thread.overallComment,
			updatedAt: thread.updatedAt,
		};
	}
}

registerSingleton(IWorkstreamCommentService, WorkstreamCommentServiceImpl, InstantiationType.Delayed);
