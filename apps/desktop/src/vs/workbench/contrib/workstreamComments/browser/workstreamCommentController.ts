/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../base/common/cancellation.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { URI, UriComponents } from '../../../../base/common/uri.js';
import { IRange } from '../../../../editor/common/core/range.js';
import * as languages from '../../../../editor/common/languages.js';
import { ICommentController, ICommentInfo, ICommentService, INotebookCommentInfo } from '../../comments/browser/commentService.js';
import { IWorkstreamCommentService, IWorkstreamComment } from '../../../services/workstreamComments/common/workstreamCommentService.js';
import { IOrchestratorService } from '../../../services/orchestrator/common/orchestratorService.js';

const OWNER_ID = 'workstreamComments';

function isDocumentThread(this: languages.CommentThread<IRange>): this is languages.CommentThread<IRange> {
	return true;
}

interface WorkstreamCommentThread extends languages.CommentThread<IRange> {
	_workstreamCommentId?: string;
}

export class WorkstreamCommentController extends Disposable implements ICommentController {

	readonly id = OWNER_ID;
	readonly label = 'Workstream Review';
	readonly owner = OWNER_ID;
	readonly features = {};
	readonly options: languages.CommentOptions = {
		prompt: "Add a review comment...",
		placeHolder: "Leave a comment"
	};
	activeComment: { thread: languages.CommentThread; comment?: languages.Comment } | undefined;

	private _nextThreadHandle = 0;
	private readonly _threads = new Map<string, WorkstreamCommentThread>();

	private readonly _onDidChangeCommentThreads = this._register(new Emitter<void>());
	readonly onDidChangeCommentThreads: Event<void> = this._onDidChangeCommentThreads.event;

	constructor(
		private readonly commentService: ICommentService,
		private readonly workstreamCommentService: IWorkstreamCommentService,
		private readonly orchestratorService: IOrchestratorService,
	) {
		super();

		// Register with VS Code's comment system
		this.commentService.registerCommentController(OWNER_ID, this);
		this._register({ dispose: () => this.commentService.unregisterCommentController(OWNER_ID) });

		// Tell the comment system we provide commenting ranges for file:// URIs
		this.commentService.updateCommentingRanges(OWNER_ID, { schemes: ['file'] });

		// Listen for comment data changes to refresh threads
		this._register(this.workstreamCommentService.onDidChangeComments(() => {
			this._refreshCommentingRanges();
		}));
	}

	private _refreshCommentingRanges(): void {
		this.commentService.updateCommentingRanges(OWNER_ID, { schemes: ['file'] });
	}

	// --- ICommentController implementation ---

	async getDocumentComments(resource: URI, _token: CancellationToken): Promise<ICommentInfo<IRange>> {
		const worktree = this.orchestratorService.activeWorktree;
		if (!worktree) {
			return this._emptyCommentInfo(resource);
		}

		// Compute relative file path from worktree
		const worktreePath = worktree.path;
		const fileFsPath = resource.fsPath;
		if (!fileFsPath.startsWith(worktreePath)) {
			return this._emptyCommentInfo(resource);
		}

		const relativePath = fileFsPath.substring(worktreePath.length + 1); // +1 for the /
		const workstreamName = worktree.name;

		// Load existing comments for this file
		const comments = await this.workstreamCommentService.getComments(workstreamName, relativePath);

		// Convert to CommentThreads
		const threads: WorkstreamCommentThread[] = [];
		for (const comment of comments) {
			const thread = this._createThreadFromComment(resource, comment, workstreamName);
			threads.push(thread);
			this._threads.set(thread.threadId, thread);
		}

		// Get total line count from model — we want all lines commentable
		// Return a range covering all lines (1 to max int, the decorator will clip it)
		const commentingRanges: languages.CommentingRanges = {
			resource,
			ranges: [{ startLineNumber: 1, startColumn: 1, endLineNumber: 0x7FFFFFFF, endColumn: 1 }],
			fileComments: false,
		};

		return {
			uniqueOwner: OWNER_ID,
			label: this.label,
			threads,
			commentingRanges,
		};
	}

	async getNotebookComments(_resource: URI, _token: CancellationToken): Promise<INotebookCommentInfo> {
		return {
			uniqueOwner: OWNER_ID,
			label: this.label,
			threads: [],
		};
	}

	async createCommentThreadTemplate(resource: UriComponents, range: IRange | undefined, _editorId?: string): Promise<void> {
		if (!range) {
			return;
		}

		const uri = URI.revive(resource);
		const threadId = `workstream-new-${this._nextThreadHandle++}`;

		// Create a template thread (empty, for user input)
		const thread: WorkstreamCommentThread = {
			commentThreadHandle: this._nextThreadHandle,
			controllerHandle: 0,
			threadId,
			resource: uri.toString(),
			range,
			comments: [],
			collapsibleState: languages.CommentThreadCollapsibleState.Expanded,
			state: languages.CommentThreadState.Unresolved,
			canReply: true,
			isDisposed: false,
			isTemplate: true,
			label: undefined,
			contextValue: undefined,
			applicability: languages.CommentThreadApplicability.Current,
			input: { value: '', uri },
			onDidChangeInput: Event.None,
			onDidChangeLabel: Event.None,
			onDidChangeCollapsibleState: Event.None,
			onDidChangeInitialCollapsibleState: Event.None,
			onDidChangeState: Event.None,
			onDidChangeComments: Event.None,
			onDidChangeCanReply: Event.None,
			initialCollapsibleState: languages.CommentThreadCollapsibleState.Expanded,
			isDocumentCommentThread: isDocumentThread,
		};

		this._threads.set(threadId, thread);

		// Notify the comment service about the new thread
		this.commentService.updateComments(OWNER_ID, {
			added: [thread],
			removed: [],
			changed: [],
			pending: [],
		});
	}

	async updateCommentThreadTemplate(_threadHandle: number, _range: IRange): Promise<void> {
		// No-op for now
	}

	deleteCommentThreadMain(commentThreadId: string): void {
		this._threads.delete(commentThreadId);
	}

	async toggleReaction(_uri: URI, _thread: languages.CommentThread, _comment: languages.Comment, _reaction: languages.CommentReaction, _token: CancellationToken): Promise<void> {
		// No reactions support
	}

	async setActiveCommentAndThread(commentInfo: { thread: languages.CommentThread; comment?: languages.Comment } | undefined): Promise<void> {
		this.activeComment = commentInfo;
	}

	// --- Helpers ---

	private _createThreadFromComment(resource: URI, comment: IWorkstreamComment, _workstreamName: string): WorkstreamCommentThread {
		const threadId = `workstream-${comment.id}`;
		const range: IRange = {
			startLineNumber: comment.line,
			startColumn: 1,
			endLineNumber: comment.line,
			endColumn: 1,
		};

		const commentObj: languages.Comment = {
			uniqueIdInThread: 0,
			body: comment.text,
			userName: 'Reviewer',
			commentReactions: [],
			mode: languages.CommentMode.Preview,
			state: comment.resolved ? languages.CommentState.Published : languages.CommentState.Draft,
			timestamp: comment.createdAt,
		};

		return {
			commentThreadHandle: this._nextThreadHandle++,
			controllerHandle: 0,
			threadId,
			resource: resource.toString(),
			range,
			comments: [commentObj],
			collapsibleState: languages.CommentThreadCollapsibleState.Collapsed,
			state: comment.resolved ? languages.CommentThreadState.Resolved : languages.CommentThreadState.Unresolved,
			canReply: false,
			isDisposed: false,
			isTemplate: false,
			label: undefined,
			contextValue: undefined,
			applicability: languages.CommentThreadApplicability.Current,
			onDidChangeInput: Event.None,
			onDidChangeLabel: Event.None,
			onDidChangeCollapsibleState: Event.None,
			onDidChangeInitialCollapsibleState: Event.None,
			onDidChangeState: Event.None,
			onDidChangeComments: Event.None,
			onDidChangeCanReply: Event.None,
			initialCollapsibleState: languages.CommentThreadCollapsibleState.Collapsed,
			isDocumentCommentThread: isDocumentThread,
			_workstreamCommentId: comment.id,
		};
	}

	private _emptyCommentInfo(resource: URI): ICommentInfo<IRange> {
		return {
			uniqueOwner: OWNER_ID,
			label: this.label,
			threads: [],
			commentingRanges: {
				resource,
				ranges: [],
				fileComments: false,
			},
		};
	}
}
