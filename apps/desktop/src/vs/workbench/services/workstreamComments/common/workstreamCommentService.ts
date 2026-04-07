/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Workstreams Labs. All rights reserved.
 *  Licensed under the Elastic License 2.0 (ELv2). See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../../base/common/event.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';

/** Which side of the diff a comment targets. */
export type CommentSide = 'old' | 'new';

/** The diff-hunk line classification. */
export type DiffLineType = 'add' | 'remove' | 'context';

/**
 * A single inline review comment on a workstream diff.
 * Compatible with the CLI's ReviewComment shape (apps/cli/src/core/comments.ts).
 */
export interface IWorkstreamComment {
	readonly id: string;
	readonly filePath: string;
	readonly line: number;
	readonly side: CommentSide;
	readonly lineType?: DiffLineType;
	readonly lineContent?: string;
	readonly text: string;
	readonly createdAt: string;
	readonly resolved: boolean;
}

/**
 * All comments for a single workstream (stored as one JSON file).
 * Compatible with the CLI's WorkstreamComments shape.
 */
export interface IWorkstreamCommentThread {
	readonly workstream: string;
	readonly comments: IWorkstreamComment[];
	readonly overallComment?: string;
	readonly updatedAt: string;
}

export interface IWorkstreamCommentChangeEvent {
	readonly workstream: string;
	readonly filePath?: string;
}

export const IWorkstreamCommentService = createDecorator<IWorkstreamCommentService>('workstreamCommentService');

export interface IWorkstreamCommentService {
	readonly _serviceBrand: undefined;

	readonly onDidChangeComments: Event<IWorkstreamCommentChangeEvent>;

	/**
	 * Get all comments for a workstream, optionally filtered by file path.
	 */
	getComments(workstream: string, filePath?: string): Promise<IWorkstreamComment[]>;

	/**
	 * Get the full comment thread data for a workstream.
	 */
	getThread(workstream: string): Promise<IWorkstreamCommentThread>;

	/**
	 * Add a new comment. Returns the created comment with generated id.
	 */
	addComment(workstream: string, filePath: string, line: number, text: string, side?: CommentSide, lineType?: DiffLineType, lineContent?: string): Promise<IWorkstreamComment>;

	/**
	 * Update the text of an existing comment.
	 */
	updateComment(workstream: string, commentId: string, text: string): Promise<void>;

	/**
	 * Delete a comment by id.
	 */
	deleteComment(workstream: string, commentId: string): Promise<void>;

	/**
	 * Mark a comment as resolved.
	 */
	resolveComment(workstream: string, commentId: string): Promise<void>;

	/**
	 * Mark a comment as unresolved.
	 */
	unresolveComment(workstream: string, commentId: string): Promise<void>;
}
