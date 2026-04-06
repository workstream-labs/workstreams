/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import './media/workstreamComments.css';
import { clearNode } from '../../../../base/browser/dom.js';
import { ICodeEditor } from '../../../../editor/browser/editorBrowser.js';
import { ZoneWidget } from '../../../../editor/contrib/zoneWidget/browser/zoneWidget.js';
import { IWorkstreamCommentService, IWorkstreamComment, CommentSide } from '../../../services/workstreamComments/common/workstreamCommentService.js';
import { IOrchestratorService } from '../../../services/orchestrator/common/orchestratorService.js';
import { Color, RGBA } from '../../../../base/common/color.js';
import { URI } from '../../../../base/common/uri.js';
import { Emitter } from '../../../../base/common/event.js';
import { localize } from '../../../../nls.js';

// --- Constants ---------------------------------------------------------------

const FRAME_COLOR = new Color(new RGBA(0, 122, 204, 0.5));
const SAVED_FRAME_COLOR = new Color(new RGBA(0, 122, 204, 0.3));

/** Height in editor lines for the edit mode zone widget. */
const EDIT_MODE_HEIGHT = 10;

/** Minimum height in editor lines for the display mode zone widget. */
const MIN_DISPLAY_HEIGHT = 5;

/** Lines reserved for header, padding, actions row, frame, and breathing room in display mode. */
const DISPLAY_PADDING_LINES = 6;

/** Estimated characters per visual line for word-wrap height calculation. */
const ESTIMATED_CHARS_PER_LINE = 60;

// --- Widget ------------------------------------------------------------------

export class WorkstreamCommentZoneWidget extends ZoneWidget {

	private _root!: HTMLElement;
	private _savedComment: IWorkstreamComment | undefined;
	private _closed = false;

	/** Whether this widget was created for an existing saved comment (vs a new unsaved one). */
	get hasSavedComment(): boolean { return !!this._savedComment; }

	private readonly _onDidClose = new Emitter<void>();
	readonly onDidClose = this._onDidClose.event;

	constructor(
		editor: ICodeEditor,
		private readonly _lineNumber: number,
		existingComment: IWorkstreamComment | undefined,
		private readonly _workstreamCommentService: IWorkstreamCommentService,
		private readonly _orchestratorService: IOrchestratorService,
		private readonly _side: CommentSide = 'new',
		private readonly _lineLabel?: string,
		private readonly _storedLine: number = _lineNumber,
	) {
		super(editor, {
			showFrame: true,
			showArrow: true,
			frameColor: existingComment ? SAVED_FRAME_COLOR : FRAME_COLOR,
			arrowColor: existingComment ? SAVED_FRAME_COLOR : FRAME_COLOR,
			className: 'workstream-comment-zone',
			keepEditorSelection: true,
		});

		this._savedComment = existingComment;
		this.create();
	}

	protected override _fillContainer(container: HTMLElement): void {
		this._root = document.createElement('div');
		this._root.className = 'workstream-comment-widget';
		container.appendChild(this._root);

		if (this._savedComment) {
			this._renderDisplayMode();
		} else {
			this._renderEditMode();
		}
	}

	// --- Display mode (saved comment) ---

	private _renderDisplayMode(): void {
		clearNode(this._root);

		const lineRef = this._lineLabel ?? (this._side === 'old' ? `L${this._lineNumber}` : `R${this._lineNumber}`);

		const header = document.createElement('div');
		header.className = 'ws-comment-header';
		header.textContent = localize("comment.header.display.labeled", "Comment on line {0}", lineRef);
		this._root.appendChild(header);

		const body = document.createElement('div');
		body.className = 'ws-comment-body';
		body.textContent = this._savedComment!.text;
		this._root.appendChild(body);

		const actions = document.createElement('div');
		actions.className = 'ws-comment-actions';

		const editBtn = document.createElement('button');
		editBtn.className = 'ws-comment-btn ws-comment-btn-cancel';
		editBtn.textContent = localize("comment.action.edit", "Edit");
		editBtn.addEventListener('click', () => this._switchToEditMode());
		actions.appendChild(editBtn);

		const deleteBtn = document.createElement('button');
		deleteBtn.className = 'ws-comment-btn ws-comment-btn-delete';
		deleteBtn.textContent = localize("comment.action.delete", "Delete");
		deleteBtn.addEventListener('click', () => this._delete());
		actions.appendChild(deleteBtn);

		this._root.appendChild(actions);
	}

	// --- Edit mode (new or editing) ---

	private _renderEditMode(): void {
		clearNode(this._root);

		const lineRef = this._lineLabel ?? (this._side === 'old' ? `L${this._lineNumber}` : `R${this._lineNumber}`);

		const header = document.createElement('div');
		header.className = 'ws-comment-header';
		header.textContent = this._savedComment
			? localize("comment.header.edit.labeled", "Edit comment on line {0}", lineRef)
			: localize("comment.header.add.labeled", "Add a comment on line {0}", lineRef);
		this._root.appendChild(header);

		const textarea = document.createElement('textarea');
		textarea.className = 'ws-comment-textarea';
		textarea.placeholder = localize("comment.placeholder", "Leave a comment");
		textarea.rows = 4;
		if (this._savedComment) {
			textarea.value = this._savedComment.text;
		}

		const submitBtn = document.createElement('button');
		submitBtn.className = 'ws-comment-btn ws-comment-btn-submit';
		submitBtn.textContent = this._savedComment
			? localize("comment.action.update", "Update")
			: localize("comment.action.comment", "Comment");
		submitBtn.disabled = !this._savedComment;

		textarea.addEventListener('input', () => {
			submitBtn.disabled = textarea.value.trim().length === 0;
		});
		textarea.addEventListener('keydown', (e) => {
			if (e.key === 'Escape') {
				e.stopPropagation();
				if (this._savedComment) {
					this._renderDisplayMode();
				} else {
					this._close();
				}
			}
			if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
				e.preventDefault();
				this._submitFromTextarea(textarea);
			}
		});
		this._root.appendChild(textarea);

		const actions = document.createElement('div');
		actions.className = 'ws-comment-actions';

		submitBtn.addEventListener('click', () => this._submitFromTextarea(textarea));
		actions.appendChild(submitBtn);

		const cancelBtn = document.createElement('button');
		cancelBtn.className = 'ws-comment-btn ws-comment-btn-cancel';
		cancelBtn.textContent = localize("comment.action.cancel", "Cancel");
		cancelBtn.addEventListener('click', () => {
			if (this._savedComment) {
				this._renderDisplayMode();
			} else {
				this._close();
			}
		});
		actions.appendChild(cancelBtn);

		const deleteBtn = document.createElement('button');
		deleteBtn.className = 'ws-comment-btn ws-comment-btn-delete';
		deleteBtn.textContent = localize("comment.action.delete", "Delete");
		deleteBtn.disabled = !this._savedComment;
		deleteBtn.addEventListener('click', () => this._delete());
		actions.appendChild(deleteBtn);

		this._root.appendChild(actions);

		// Focus textarea
		setTimeout(() => textarea.focus(), 0);
	}

	private _switchToEditMode(): void {
		this._renderEditMode();
		this.show({ lineNumber: this._lineNumber, column: 1 }, EDIT_MODE_HEIGHT);
	}

	public display(): void {
		const heightInLines = this._savedComment
			? this._estimateDisplayHeight(this._savedComment.text)
			: EDIT_MODE_HEIGHT;
		this.show({ lineNumber: this._lineNumber, column: 1 }, heightInLines);

		if (!this._savedComment) {
			const textarea = this._root.querySelector('.ws-comment-textarea') as HTMLTextAreaElement | null;
			setTimeout(() => textarea?.focus(), 0);
		}
	}

	private _estimateDisplayHeight(text: string): number {
		const wrappedLines = text.split('\n').reduce(
			(sum, line) => sum + Math.max(1, Math.ceil(line.length / ESTIMATED_CHARS_PER_LINE)), 0
		);
		return Math.max(MIN_DISPLAY_HEIGHT, wrappedLines + DISPLAY_PADDING_LINES);
	}

	// --- Actions ---

	private async _submitFromTextarea(textarea: HTMLTextAreaElement): Promise<void> {
		const text = textarea.value.trim();
		if (!text) {
			console.warn('[WSComments] submit: empty text, bailing');
			return;
		}

		const worktree = this._orchestratorService.activeWorktree;
		if (!worktree) {
			console.warn('[WSComments] submit: no active worktree, bailing');
			return;
		}

		const resource = this.editor.getModel()?.uri;
		if (!resource) {
			console.warn('[WSComments] submit: no editor model URI, bailing');
			return;
		}

		console.log('[WSComments] submit: resource scheme=%s fsPath=%s worktreePath=%s', resource.scheme, resource.fsPath, worktree.path);

		const relativePath = this._getRelativePath(resource, worktree.path);
		if (!relativePath) {
			console.warn('[WSComments] submit: _getRelativePath returned undefined — fsPath does not start with worktree prefix');
			return;
		}

		console.log('[WSComments] submit: relativePath=%s storedLine=%d side=%s', relativePath, this._storedLine, this._side);

		if (this._savedComment) {
			await this._workstreamCommentService.updateComment(worktree.name, this._savedComment.id, text);
		} else {
			await this._workstreamCommentService.addComment(
				worktree.name, relativePath, this._storedLine, text, this._side
			);
		}
		// Close — onDidChangeComments will recreate from saved data
		this._close();
	}

	private async _delete(): Promise<void> {
		if (!this._savedComment) {
			return;
		}

		const worktree = this._orchestratorService.activeWorktree;
		if (!worktree) {
			return;
		}

		await this._workstreamCommentService.deleteComment(worktree.name, this._savedComment.id);
		this._close();
	}

	private _close(): void {
		if (this._closed) {
			return;
		}
		this._closed = true;
		this.hide();
		this._onDidClose.fire();
		this.dispose();
	}

	private _getRelativePath(resource: URI, worktreePath: string): string | undefined {
		const fsPath = resource.fsPath;
		const prefix = worktreePath.endsWith('/') ? worktreePath : worktreePath + '/';
		if (!fsPath.startsWith(prefix)) {
			return undefined;
		}
		return fsPath.substring(prefix.length);
	}

	override dispose(): void {
		this._onDidClose.dispose();
		super.dispose();
	}
}
