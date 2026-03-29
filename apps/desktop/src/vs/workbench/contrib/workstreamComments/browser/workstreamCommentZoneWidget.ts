/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import './media/workstreamComments.css';
import { ICodeEditor } from '../../../../editor/browser/editorBrowser.js';
import { ZoneWidget } from '../../../../editor/contrib/zoneWidget/browser/zoneWidget.js';
import { IWorkstreamCommentService, IWorkstreamComment } from '../../../services/workstreamComments/common/workstreamCommentService.js';
import { IOrchestratorService } from '../../../services/orchestrator/common/orchestratorService.js';
import { Color, RGBA } from '../../../../base/common/color.js';
import { URI } from '../../../../base/common/uri.js';
import { Emitter } from '../../../../base/common/event.js';

const FRAME_COLOR = new Color(new RGBA(0, 122, 204, 0.5));

export class WorkstreamCommentZoneWidget extends ZoneWidget {

	private _textarea!: HTMLTextAreaElement;
	private _submitBtn!: HTMLButtonElement;
	private _deleteBtn!: HTMLButtonElement;

	private readonly _onDidClose = new Emitter<void>();
	readonly onDidClose = this._onDidClose.event;

	constructor(
		editor: ICodeEditor,
		private readonly _lineNumber: number,
		private readonly _existingComment: IWorkstreamComment | undefined,
		private readonly _workstreamCommentService: IWorkstreamCommentService,
		private readonly _orchestratorService: IOrchestratorService,
	) {
		super(editor, {
			showFrame: true,
			showArrow: true,
			frameColor: FRAME_COLOR,
			arrowColor: FRAME_COLOR,
			className: 'workstream-comment-zone',
			keepEditorSelection: true,
		});

		this.create();
	}

	protected override _fillContainer(container: HTMLElement): void {
		const root = document.createElement('div');
		root.className = 'workstream-comment-widget';

		// Header
		const header = document.createElement('div');
		header.className = 'ws-comment-header';
		header.textContent = this._existingComment
			? `Comment on line ${this._lineNumber}`
			: `Add a comment on line ${this._lineNumber}`;
		root.appendChild(header);

		// Textarea
		this._textarea = document.createElement('textarea');
		this._textarea.className = 'ws-comment-textarea';
		this._textarea.placeholder = 'Leave a comment';
		this._textarea.rows = 4;
		if (this._existingComment) {
			this._textarea.value = this._existingComment.text;
		}
		this._textarea.addEventListener('input', () => this._updateSubmitState());
		this._textarea.addEventListener('keydown', (e) => {
			if (e.key === 'Escape') {
				e.stopPropagation();
				this._close();
			}
			if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
				e.preventDefault();
				this._submit();
			}
		});
		root.appendChild(this._textarea);

		// Actions
		const actions = document.createElement('div');
		actions.className = 'ws-comment-actions';

		// Submit button
		this._submitBtn = document.createElement('button');
		this._submitBtn.className = 'ws-comment-btn ws-comment-btn-submit';
		this._submitBtn.textContent = this._existingComment ? 'Update' : 'Comment';
		this._submitBtn.disabled = !this._existingComment;
		this._submitBtn.addEventListener('click', () => this._submit());
		actions.appendChild(this._submitBtn);

		// Cancel button
		const cancelBtn = document.createElement('button');
		cancelBtn.className = 'ws-comment-btn ws-comment-btn-cancel';
		cancelBtn.textContent = 'Cancel';
		cancelBtn.addEventListener('click', () => this._close());
		actions.appendChild(cancelBtn);

		// Delete button
		this._deleteBtn = document.createElement('button');
		this._deleteBtn.className = 'ws-comment-btn ws-comment-btn-delete';
		this._deleteBtn.textContent = 'Delete';
		this._deleteBtn.disabled = !this._existingComment;
		this._deleteBtn.addEventListener('click', () => this._delete());
		actions.appendChild(this._deleteBtn);

		root.appendChild(actions);
		container.appendChild(root);
	}

	public display(): void {
		this.show({ lineNumber: this._lineNumber, column: 1 }, 10);

		// Focus textarea after rendering
		setTimeout(() => this._textarea?.focus(), 0);
	}

	private _updateSubmitState(): void {
		const hasText = this._textarea.value.trim().length > 0;
		this._submitBtn.disabled = !hasText;
	}

	private async _submit(): Promise<void> {
		const text = this._textarea.value.trim();
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

		if (this._existingComment) {
			await this._workstreamCommentService.updateComment(worktree.name, this._existingComment.id, text);
		} else {
			await this._workstreamCommentService.addComment(worktree.name, relativePath, this._lineNumber, text);
		}

		this._close();
	}

	private async _delete(): Promise<void> {
		if (!this._existingComment) {
			return;
		}

		const worktree = this._orchestratorService.activeWorktree;
		if (!worktree) {
			return;
		}

		await this._workstreamCommentService.deleteComment(worktree.name, this._existingComment.id);
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
