/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import './media/workstreamComments.css';
import { clearNode } from '../../../../base/browser/dom.js';
import { ICodeEditor } from '../../../../editor/browser/editorBrowser.js';
import { ZoneWidget } from '../../../../editor/contrib/zoneWidget/browser/zoneWidget.js';
import { IWorkstreamCommentService, IWorkstreamComment } from '../../../services/workstreamComments/common/workstreamCommentService.js';
import { IOrchestratorService } from '../../../services/orchestrator/common/orchestratorService.js';
import { Color, RGBA } from '../../../../base/common/color.js';
import { URI } from '../../../../base/common/uri.js';
import { Emitter } from '../../../../base/common/event.js';

const FRAME_COLOR = new Color(new RGBA(0, 122, 204, 0.5));
const SAVED_FRAME_COLOR = new Color(new RGBA(0, 122, 204, 0.3));

export class WorkstreamCommentZoneWidget extends ZoneWidget {

	private _root!: HTMLElement;
	private _savedComment: IWorkstreamComment | undefined;

	private readonly _onDidClose = new Emitter<void>();
	readonly onDidClose = this._onDidClose.event;

	constructor(
		editor: ICodeEditor,
		private readonly _lineNumber: number,
		existingComment: IWorkstreamComment | undefined,
		private readonly _workstreamCommentService: IWorkstreamCommentService,
		private readonly _orchestratorService: IOrchestratorService,
		private readonly _side: 'old' | 'new' = 'new',
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

		const header = document.createElement('div');
		header.className = 'ws-comment-header';
		const sideLabel = this._side === 'old' ? 'original' : 'modified';
		header.textContent = `Comment on line ${this._lineNumber} (${sideLabel})`;
		this._root.appendChild(header);

		const body = document.createElement('div');
		body.className = 'ws-comment-body';
		body.textContent = this._savedComment!.text;
		this._root.appendChild(body);

		const actions = document.createElement('div');
		actions.className = 'ws-comment-actions';

		const editBtn = document.createElement('button');
		editBtn.className = 'ws-comment-btn ws-comment-btn-cancel';
		editBtn.textContent = 'Edit';
		editBtn.addEventListener('click', () => this._switchToEditMode());
		actions.appendChild(editBtn);

		const deleteBtn = document.createElement('button');
		deleteBtn.className = 'ws-comment-btn ws-comment-btn-delete';
		deleteBtn.textContent = 'Delete';
		deleteBtn.addEventListener('click', () => this._delete());
		actions.appendChild(deleteBtn);

		this._root.appendChild(actions);
	}

	// --- Edit mode (new or editing) ---

	private _renderEditMode(): void {
		clearNode(this._root);

		const header = document.createElement('div');
		header.className = 'ws-comment-header';
		const sideLabel = this._side === 'old' ? 'original' : 'modified';
		header.textContent = this._savedComment
			? `Edit comment on line ${this._lineNumber} (${sideLabel})`
			: `Add a comment on line ${this._lineNumber} (${sideLabel})`;
		this._root.appendChild(header);

		const textarea = document.createElement('textarea');
		textarea.className = 'ws-comment-textarea';
		textarea.placeholder = 'Leave a comment';
		textarea.rows = 4;
		if (this._savedComment) {
			textarea.value = this._savedComment.text;
		}

		const submitBtn = document.createElement('button');
		submitBtn.className = 'ws-comment-btn ws-comment-btn-submit';
		submitBtn.textContent = this._savedComment ? 'Update' : 'Comment';
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
		cancelBtn.textContent = 'Cancel';
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
		deleteBtn.textContent = 'Delete';
		deleteBtn.disabled = !this._savedComment;
		deleteBtn.addEventListener('click', () => this._delete());
		actions.appendChild(deleteBtn);

		this._root.appendChild(actions);

		// Focus textarea
		setTimeout(() => textarea.focus(), 0);
	}

	private _switchToEditMode(): void {
		this._renderEditMode();
		// Re-show to ensure zone height is correct
		this.show({ lineNumber: this._lineNumber, column: 1 }, 10);
	}

	public display(): void {
		const heightInLines = this._savedComment ? 7 : 10;
		this.show({ lineNumber: this._lineNumber, column: 1 }, heightInLines);

		if (!this._savedComment) {
			// Focus textarea for new comments
			const textarea = this._root.querySelector('.ws-comment-textarea') as HTMLTextAreaElement | null;
			setTimeout(() => textarea?.focus(), 0);
		}
	}

	// --- Actions ---

	private async _submitFromTextarea(textarea: HTMLTextAreaElement): Promise<void> {
		const text = textarea.value.trim();
		if (!text) {
			return;
		}

		const worktree = this._orchestratorService.activeWorktree;
		if (!worktree) {
			return;
		}

		const resource = this.editor.getModel()?.uri;
		if (!resource) {
			return;
		}

		const relativePath = this._getRelativePath(resource, worktree.path);
		if (!relativePath) {
			return;
		}

		if (this._savedComment) {
			await this._workstreamCommentService.updateComment(worktree.name, this._savedComment.id, text);
			this._savedComment = { ...this._savedComment, text };
		} else {
			this._savedComment = await this._workstreamCommentService.addComment(
				worktree.name, relativePath, this._lineNumber, text, this._side
			);
		}

		// Switch to display mode
		this._renderDisplayMode();
		this.show({ lineNumber: this._lineNumber, column: 1 }, 7);
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
		this.hide();
		this._onDidClose.fire();
		this.dispose();
	}

	private _getRelativePath(resource: URI, worktreePath: string): string | undefined {
		const fsPath = resource.fsPath;
		if (!fsPath.startsWith(worktreePath)) {
			return undefined;
		}
		return fsPath.substring(worktreePath.length + 1);
	}

	override dispose(): void {
		this._onDidClose.dispose();
		super.dispose();
	}
}
