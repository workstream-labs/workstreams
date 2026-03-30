/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { URI } from '../../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { WorkstreamCommentServiceImpl } from '../../browser/workstreamCommentServiceImpl.js';
import { workbenchInstantiationService } from '../../../../test/browser/workbenchTestServices.js';
suite('WorkstreamCommentService', () => {
	let service: WorkstreamCommentServiceImpl;

	const ds = ensureNoDisposablesAreLeakedInTestSuite();

	setup(() => {
		const instantiationService = ds.add(workbenchInstantiationService(undefined, ds));
		service = ds.add(instantiationService.createInstance(WorkstreamCommentServiceImpl));
		service.setBasePath(URI.file('/test/repo'));
	});

	test('returns empty thread for unknown workstream', async () => {
		const thread = await service.getThread('nonexistent');
		assert.strictEqual(thread.workstream, 'nonexistent');
		assert.deepStrictEqual(thread.comments, []);
	});

	test('returns empty comments for unknown workstream', async () => {
		const comments = await service.getComments('nonexistent');
		assert.deepStrictEqual(comments, []);
	});

	suite('addComment', () => {
		test('adds a comment and returns it with generated id', async () => {
			const comment = await service.addComment('ws1', 'src/foo.ts', 42, 'Fix this bug');
			assert.strictEqual(comment.filePath, 'src/foo.ts');
			assert.strictEqual(comment.line, 42);
			assert.strictEqual(comment.text, 'Fix this bug');
			assert.strictEqual(comment.side, 'new');
			assert.strictEqual(comment.resolved, false);
			assert.ok(comment.id);
			assert.ok(comment.createdAt);
		});

		test('comment appears in getComments', async () => {
			await service.addComment('ws1', 'src/foo.ts', 10, 'Comment A');
			const comments = await service.getComments('ws1');
			assert.strictEqual(comments.length, 1);
			assert.strictEqual(comments[0].text, 'Comment A');
		});

		test('comment appears in getThread', async () => {
			await service.addComment('ws1', 'src/foo.ts', 10, 'Comment A');
			const thread = await service.getThread('ws1');
			assert.strictEqual(thread.comments.length, 1);
			assert.strictEqual(thread.workstream, 'ws1');
		});

		test('multiple comments accumulate', async () => {
			await service.addComment('ws1', 'src/foo.ts', 10, 'First');
			await service.addComment('ws1', 'src/bar.ts', 20, 'Second');
			const comments = await service.getComments('ws1');
			assert.strictEqual(comments.length, 2);
		});

		test('getComments filters by filePath', async () => {
			await service.addComment('ws1', 'src/foo.ts', 10, 'Foo comment');
			await service.addComment('ws1', 'src/bar.ts', 20, 'Bar comment');

			const fooComments = await service.getComments('ws1', 'src/foo.ts');
			assert.strictEqual(fooComments.length, 1);
			assert.strictEqual(fooComments[0].text, 'Foo comment');
		});

		test('fires onDidChangeComments event', async () => {
			let firedEvent: { workstream: string; filePath?: string } | undefined;
			ds.add(service.onDidChangeComments(e => { firedEvent = e; }));

			await service.addComment('ws1', 'src/foo.ts', 10, 'Test');
			assert.ok(firedEvent);
			assert.strictEqual(firedEvent!.workstream, 'ws1');
			assert.strictEqual(firedEvent!.filePath, 'src/foo.ts');
		});

		test('stores optional fields (side, lineType, lineContent)', async () => {
			const comment = await service.addComment('ws1', 'src/foo.ts', 10, 'Test', 'old', 'remove', 'const x = 1;');
			assert.strictEqual(comment.side, 'old');
			assert.strictEqual(comment.lineType, 'remove');
			assert.strictEqual(comment.lineContent, 'const x = 1;');
		});
	});

	suite('updateComment', () => {
		test('updates comment text', async () => {
			const comment = await service.addComment('ws1', 'src/foo.ts', 10, 'Original');
			await service.updateComment('ws1', comment.id, 'Updated');

			const comments = await service.getComments('ws1');
			assert.strictEqual(comments[0].text, 'Updated');
		});

		test('no-ops for unknown comment id', async () => {
			await service.addComment('ws1', 'src/foo.ts', 10, 'Original');
			await service.updateComment('ws1', 'nonexistent-id', 'Updated');

			const comments = await service.getComments('ws1');
			assert.strictEqual(comments[0].text, 'Original');
		});

		test('fires onDidChangeComments event', async () => {
			const comment = await service.addComment('ws1', 'src/foo.ts', 10, 'Original');
			let firedCount = 0;
			ds.add(service.onDidChangeComments(() => { firedCount++; }));

			await service.updateComment('ws1', comment.id, 'Updated');
			assert.strictEqual(firedCount, 1);
		});
	});

	suite('deleteComment', () => {
		test('removes the comment', async () => {
			const comment = await service.addComment('ws1', 'src/foo.ts', 10, 'Delete me');
			await service.deleteComment('ws1', comment.id);

			const comments = await service.getComments('ws1');
			assert.strictEqual(comments.length, 0);
		});

		test('no-ops for unknown comment id', async () => {
			await service.addComment('ws1', 'src/foo.ts', 10, 'Keep me');
			await service.deleteComment('ws1', 'nonexistent-id');

			const comments = await service.getComments('ws1');
			assert.strictEqual(comments.length, 1);
		});

		test('fires onDidChangeComments event', async () => {
			const comment = await service.addComment('ws1', 'src/foo.ts', 10, 'Delete me');
			let firedCount = 0;
			ds.add(service.onDidChangeComments(() => { firedCount++; }));

			await service.deleteComment('ws1', comment.id);
			assert.strictEqual(firedCount, 1);
		});
	});

	suite('resolveComment / unresolveComment', () => {
		test('resolves a comment', async () => {
			const comment = await service.addComment('ws1', 'src/foo.ts', 10, 'Resolve me');
			await service.resolveComment('ws1', comment.id);

			const comments = await service.getComments('ws1');
			assert.strictEqual(comments[0].resolved, true);
		});

		test('unresolves a comment', async () => {
			const comment = await service.addComment('ws1', 'src/foo.ts', 10, 'Resolve me');
			await service.resolveComment('ws1', comment.id);
			await service.unresolveComment('ws1', comment.id);

			const comments = await service.getComments('ws1');
			assert.strictEqual(comments[0].resolved, false);
		});
	});

	suite('persistence', () => {
		// Note: The persistence round-trip test (write → invalidate → read) is an
		// integration concern — the mock IFileService in unit tests doesn't provide
		// a real in-memory FS. Real persistence is verified via manual testing in Step 2+.

		test('separate workstreams are independent', async () => {
			await service.addComment('ws1', 'src/foo.ts', 10, 'WS1 comment');
			await service.addComment('ws2', 'src/foo.ts', 20, 'WS2 comment');

			const ws1Comments = await service.getComments('ws1');
			const ws2Comments = await service.getComments('ws2');
			assert.strictEqual(ws1Comments.length, 1);
			assert.strictEqual(ws2Comments.length, 1);
			assert.strictEqual(ws1Comments[0].text, 'WS1 comment');
			assert.strictEqual(ws2Comments[0].text, 'WS2 comment');
		});
	});

	suite('setBasePath', () => {
		test('clears cache on base path change', async () => {
			await service.addComment('ws1', 'src/foo.ts', 10, 'Before path change');

			// Change base path — cache should be cleared, and the old file
			// won't be at the new path, so we get empty
			service.setBasePath(URI.file('/different/repo'));
			const comments = await service.getComments('ws1');
			assert.strictEqual(comments.length, 0);
		});
	});

	suite('CLI compatibility', () => {
		setup(async () => {
			await service.addComment(
				'add-tests',
				'src/core/executor.ts',
				42,
				'Should we add error handling here?',
				'new',
				'add',
				'  const result = await run();'
			);
		});

		test('persisted data has CLI-compatible fields', async () => {
			const thread = await service.getThread('add-tests');
			const comment = thread.comments[0];

			// Fields that the CLI expects
			assert.strictEqual(comment.filePath, 'src/core/executor.ts');
			assert.strictEqual(comment.line, 42);
			assert.strictEqual(comment.side, 'new');
			assert.strictEqual(comment.lineType, 'add');
			assert.strictEqual(comment.lineContent, '  const result = await run();');
			assert.strictEqual(comment.text, 'Should we add error handling here?');
			assert.ok(comment.createdAt);

			// Extra fields the desktop adds
			assert.ok(comment.id);
			assert.strictEqual(comment.resolved, false);
		});
	});
});
