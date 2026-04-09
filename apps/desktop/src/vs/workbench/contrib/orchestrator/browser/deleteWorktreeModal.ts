/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Workstreams Labs. All rights reserved.
 *  Licensed under the Elastic License 2.0 (ELv2). See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { addDisposableListener, EventType } from '../../../../base/browser/dom.js';
import { DisposableStore } from '../../../../base/common/lifecycle.js';
import { localize } from '../../../../nls.js';

export interface DeleteWorktreeModalOptions {
	readonly name: string;
	readonly branch: string;
	readonly additions?: number;
	readonly deletions?: number;
	readonly filesChanged?: number;
}

export function showDeleteWorktreeModal(options: DeleteWorktreeModalOptions): Promise<boolean> {
	return new Promise(resolve => {
		const disposables = new DisposableStore();
		let closed = false;

		// --- Overlay ---
		const overlay = document.createElement('div');
		overlay.className = 'delete-worktree-overlay';

		const modal = document.createElement('div');
		modal.className = 'delete-worktree-modal';
		modal.setAttribute('role', 'dialog');
		modal.setAttribute('aria-modal', 'true');
		modal.setAttribute('aria-labelledby', 'delete-worktree-title');
		overlay.appendChild(modal);

		// --- Card ---
		const card = document.createElement('div');
		card.className = 'delete-worktree-card';
		modal.appendChild(card);

		// --- Header ---
		const header = document.createElement('div');
		header.className = 'delete-worktree-header';
		card.appendChild(header);

		const warningIcon = document.createElement('span');
		warningIcon.className = 'delete-worktree-warning-icon codicon codicon-warning';
		header.appendChild(warningIcon);

		const title = document.createElement('span');
		title.className = 'delete-worktree-title';
		title.id = 'delete-worktree-title';
		title.textContent = localize('deleteWorktreeTitle', "Delete worktree");
		header.appendChild(title);

		// --- Separator ---
		const sep1 = document.createElement('div');
		sep1.className = 'delete-worktree-separator';
		card.appendChild(sep1);

		// --- Body ---
		const body = document.createElement('div');
		body.className = 'delete-worktree-body';
		card.appendChild(body);

		const desc = document.createElement('div');
		desc.className = 'delete-worktree-desc';
		desc.textContent = localize('deleteWorktreeDesc', "This will permanently remove:");
		body.appendChild(desc);

		const list = document.createElement('ul');
		list.className = 'delete-worktree-list';
		body.appendChild(list);

		// Worktree files
		const liWorktree = document.createElement('li');
		const liWorktreeLabel = document.createElement('span');
		liWorktreeLabel.className = 'delete-worktree-item-label';
		liWorktreeLabel.textContent = localize('worktreeFiles', "Worktree");
		liWorktree.appendChild(liWorktreeLabel);
		const liWorktreePath = document.createElement('span');
		liWorktreePath.className = 'delete-worktree-item-path';
		liWorktreePath.textContent = options.name;
		liWorktree.appendChild(liWorktreePath);
		list.appendChild(liWorktree);

		// Branch
		const liBranch = document.createElement('li');
		const liBranchLabel = document.createElement('span');
		liBranchLabel.className = 'delete-worktree-item-label';
		liBranchLabel.textContent = localize('branchLabel', "Branch");
		liBranch.appendChild(liBranchLabel);
		const liBranchName = document.createElement('span');
		liBranchName.className = 'delete-worktree-item-path';
		liBranchName.textContent = options.branch;
		liBranch.appendChild(liBranchName);
		list.appendChild(liBranch);

		// Session data
		const liSession = document.createElement('li');
		const liSessionLabel = document.createElement('span');
		liSessionLabel.className = 'delete-worktree-item-label';
		liSessionLabel.textContent = localize('sessionData', "Session data & config");
		liSession.appendChild(liSessionLabel);
		list.appendChild(liSession);

		// --- Stats warning (if there are uncommitted changes) ---
		if ((options.filesChanged ?? 0) > 0) {
			const statsWarning = document.createElement('div');
			statsWarning.className = 'delete-worktree-stats-warning';

			const statsIcon = document.createElement('span');
			statsIcon.className = 'delete-worktree-stats-icon codicon codicon-warning';
			statsWarning.appendChild(statsIcon);

			const parts: string[] = [];
			if (options.filesChanged) {
				parts.push(localize('filesChanged', "{0} file{1} changed", options.filesChanged, options.filesChanged === 1 ? '' : 's'));
			}
			if ((options.additions ?? 0) > 0) {
				parts.push(`+${options.additions}`);
			}
			if ((options.deletions ?? 0) > 0) {
				parts.push(`\u2212${options.deletions}`);
			}

			const statsText = document.createElement('span');
			statsText.className = 'delete-worktree-stats-text';
			statsText.textContent = localize('uncommittedWarning', "{0} \u2014 uncommitted changes will be lost", parts.join(', '));
			statsWarning.appendChild(statsText);
			body.appendChild(statsWarning);
		}

		// --- Separator ---
		const sep2 = document.createElement('div');
		sep2.className = 'delete-worktree-separator';
		card.appendChild(sep2);

		// --- Buttons ---
		const actions = document.createElement('div');
		actions.className = 'delete-worktree-actions';
		card.appendChild(actions);

		const cancelBtn = document.createElement('button');
		cancelBtn.className = 'delete-worktree-btn cancel';
		cancelBtn.type = 'button';
		cancelBtn.textContent = localize('cancel', "Cancel");
		actions.appendChild(cancelBtn);

		const deleteBtn = document.createElement('button');
		deleteBtn.className = 'delete-worktree-btn delete';
		deleteBtn.type = 'button';
		deleteBtn.textContent = localize('confirmDelete', "Delete");
		actions.appendChild(deleteBtn);

		// --- Close helper ---
		function close(confirmed: boolean): void {
			if (closed) {
				return;
			}
			closed = true;
			overlay.remove();
			disposables.dispose();
			resolve(confirmed);
		}

		// --- Events ---
		disposables.add(addDisposableListener(cancelBtn, EventType.CLICK, () => {
			close(false);
		}));

		disposables.add(addDisposableListener(deleteBtn, EventType.CLICK, () => {
			close(true);
		}));

		disposables.add(addDisposableListener(overlay, EventType.CLICK, (e) => {
			if (e.target === overlay) {
				close(false);
			}
		}));

		disposables.add(addDisposableListener(overlay, EventType.KEY_DOWN, (e: KeyboardEvent) => {
			if (e.key === 'Escape') {
				close(false);
			}
			if (e.key === 'Enter' && document.activeElement === deleteBtn) {
				e.preventDefault();
				close(true);
			}
		}));

		// Tab trap: cycle focus between cancel and delete
		disposables.add(addDisposableListener(cancelBtn, EventType.KEY_DOWN, (e: KeyboardEvent) => {
			if (e.key === 'Tab') {
				e.preventDefault();
				deleteBtn.focus();
			}
		}));
		disposables.add(addDisposableListener(deleteBtn, EventType.KEY_DOWN, (e: KeyboardEvent) => {
			if (e.key === 'Tab') {
				e.preventDefault();
				cancelBtn.focus();
			}
		}));

		// --- Mount & focus ---
		const workbench = document.querySelector('.monaco-workbench') ?? document.body;
		workbench.appendChild(overlay);
		cancelBtn.focus(); // Default focus on cancel — prevents accidental deletion
	});
}
