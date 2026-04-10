/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Workstreams Labs. All rights reserved.
 *  Licensed under the Elastic License 2.0 (ELv2). See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { showDeleteWorktreeModal, DeleteWorktreeModalOptions } from '../../browser/deleteWorktreeModal.js';

suite('DeleteWorktreeModal', () => {

	function baseOptions(overrides?: Partial<DeleteWorktreeModalOptions>): DeleteWorktreeModalOptions {
		return {
			name: 'feature-login',
			branch: 'feature-login',
			defaultBranch: 'main',
			...overrides,
		};
	}

	/**
	 * Helper: open the modal, grab the overlay element, and return it
	 * along with the pending promise so the caller can click buttons.
	 */
	function openModal(opts: DeleteWorktreeModalOptions) {
		const promise = showDeleteWorktreeModal(opts);
		const overlay = document.querySelector('.delete-worktree-overlay') as HTMLElement;
		assert.ok(overlay, 'overlay should be mounted in the DOM');
		return { promise, overlay };
	}

	teardown(() => {
		// Trigger close() on any open modals so the internal DisposableStore is disposed.
		// Tests that only inspect DOM without clicking a button leave the promise pending.
		document.querySelectorAll<HTMLButtonElement>('.delete-worktree-btn.cancel').forEach(btn => btn.click());
	});

	ensureNoDisposablesAreLeakedInTestSuite();

	test('resolves false when cancel is clicked', async () => {
		const { promise, overlay } = openModal(baseOptions());

		const cancelBtn = overlay.querySelector('.delete-worktree-btn.cancel') as HTMLButtonElement;
		assert.ok(cancelBtn);
		cancelBtn.click();

		assert.strictEqual(await promise, false);
	});

	test('resolves true when delete is clicked', async () => {
		const { promise, overlay } = openModal(baseOptions());

		const deleteBtn = overlay.querySelector('.delete-worktree-btn.delete') as HTMLButtonElement;
		assert.ok(deleteBtn);
		deleteBtn.click();

		assert.strictEqual(await promise, true);
	});

	test('resolves false when Escape is pressed', async () => {
		const { promise, overlay } = openModal(baseOptions());

		overlay.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

		assert.strictEqual(await promise, false);
	});

	test('resolves false when clicking overlay backdrop', async () => {
		const { promise, overlay } = openModal(baseOptions());

		// Click the overlay itself (not the modal card)
		overlay.dispatchEvent(new MouseEvent('click', { bubbles: true }));

		assert.strictEqual(await promise, false);
	});

	test('removes overlay from DOM after close', async () => {
		const { promise, overlay } = openModal(baseOptions());

		const cancelBtn = overlay.querySelector('.delete-worktree-btn.cancel') as HTMLButtonElement;
		cancelBtn.click();
		await promise;

		assert.strictEqual(document.querySelectorAll('.delete-worktree-overlay').length, 0);
	});

	test('displays worktree name and branch', () => {
		openModal(baseOptions({ name: 'my-worktree', branch: 'feat/awesome' }));

		const items = document.querySelectorAll('.delete-worktree-item-path');
		const texts = Array.from(items).map(el => el.textContent);

		assert.ok(texts.includes('my-worktree'), 'should show worktree name');
		assert.ok(texts.includes('feat/awesome'), 'should show branch name');
	});

	test('shows stats warning with "ahead of origin/main" when filesChanged > 0', () => {
		openModal(baseOptions({
			filesChanged: 3,
			additions: 10,
			deletions: 5,
			defaultBranch: 'main',
		}));

		const statsText = document.querySelector('.delete-worktree-stats-text');
		assert.ok(statsText);
		assert.ok(
			statsText!.textContent!.includes('ahead of origin/main'),
			`expected "ahead of origin/main" but got: "${statsText!.textContent}"`
		);
	});

	test('shows stats warning with "ahead of origin/master" when default branch is master', () => {
		openModal(baseOptions({
			filesChanged: 2,
			additions: 7,
			deletions: 0,
			defaultBranch: 'master',
		}));

		const statsText = document.querySelector('.delete-worktree-stats-text');
		assert.ok(statsText);
		assert.ok(
			statsText!.textContent!.includes('ahead of origin/master'),
			`expected "ahead of origin/master" but got: "${statsText!.textContent}"`
		);
	});

	test('does not show stats warning when filesChanged is 0', () => {
		openModal(baseOptions({
			filesChanged: 0,
			additions: 0,
			deletions: 0,
		}));

		const statsWarning = document.querySelector('.delete-worktree-stats-warning');
		assert.strictEqual(statsWarning, null, 'should not show stats warning for zero changes');
	});

	test('does not show stats warning when filesChanged is undefined', () => {
		openModal(baseOptions());

		const statsWarning = document.querySelector('.delete-worktree-stats-warning');
		assert.strictEqual(statsWarning, null, 'should not show stats warning when filesChanged is undefined');
	});

	test('stats text includes file count, additions, and deletions', () => {
		openModal(baseOptions({
			filesChanged: 5,
			additions: 20,
			deletions: 8,
			defaultBranch: 'main',
		}));

		const statsText = document.querySelector('.delete-worktree-stats-text')!;
		const text = statsText.textContent!;

		assert.ok(text.includes('5'), 'should include files changed count');
		assert.ok(text.includes('+20'), 'should include additions');
		assert.ok(text.includes('\u22128'), `should include deletions with minus sign, got: "${text}"`);
	});

	test('stats text for single file uses singular form', () => {
		openModal(baseOptions({
			filesChanged: 1,
			additions: 3,
			deletions: 0,
			defaultBranch: 'main',
		}));

		const statsText = document.querySelector('.delete-worktree-stats-text')!;
		const text = statsText.textContent!;

		assert.ok(text.includes('1 file changed'), `expected singular "file changed" but got: "${text}"`);
		assert.ok(!text.includes('files'), `should not contain plural "files" but got: "${text}"`);
	});

	test('default focus is on cancel button', () => {
		openModal(baseOptions());

		const cancelBtn = document.querySelector('.delete-worktree-btn.cancel') as HTMLButtonElement;
		assert.strictEqual(document.activeElement, cancelBtn, 'cancel button should have focus by default');
	});

	test('modal has correct ARIA attributes', () => {
		openModal(baseOptions());

		const modal = document.querySelector('.delete-worktree-modal') as HTMLElement;
		assert.strictEqual(modal.getAttribute('role'), 'dialog');
		assert.strictEqual(modal.getAttribute('aria-modal'), 'true');
		assert.strictEqual(modal.getAttribute('aria-labelledby'), 'delete-worktree-title');
	});

	test('double-close is safe (idempotent)', async () => {
		const { promise, overlay } = openModal(baseOptions());

		const cancelBtn = overlay.querySelector('.delete-worktree-btn.cancel') as HTMLButtonElement;
		cancelBtn.click();
		cancelBtn.click(); // second click should be a no-op

		assert.strictEqual(await promise, false);
	});
});
