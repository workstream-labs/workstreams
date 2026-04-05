/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { URI } from '../../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { ICodeEditor, IDiffEditor } from '../../../../../editor/browser/editorBrowser.js';
import { ICodeEditorService } from '../../../../../editor/browser/services/codeEditorService.js';
import { EditorOption } from '../../../../../editor/common/config/editorOptions.js';
import { LineRange } from '../../../../../editor/common/core/ranges/lineRange.js';
import { DetailedLineRangeMapping } from '../../../../../editor/common/diff/rangeMapping.js';
import { ICommentController, ICommentService } from '../../../comments/browser/commentService.js';
import { WorkstreamCommentController } from '../../browser/workstreamCommentController.js';
import { IWorkstreamCommentService, IWorkstreamComment, IWorkstreamCommentThread, CommentSide } from '../../../../services/workstreamComments/common/workstreamCommentService.js';
import { IWorktreeEntry, WorktreeSessionState } from '../../../../services/orchestrator/common/orchestratorService.js';
import { TestConfigurationService } from '../../../../../platform/configuration/test/common/testConfigurationService.js';
import { NullLogService } from '../../../../../platform/log/common/log.js';
import { Emitter } from '../../../../../base/common/event.js';

// --- Mocks -------------------------------------------------------------------

function createMocks(ds: Pick<DisposableStore, 'add'>) {

	const commentService = {
		registerCommentController(_id: string, _controller: ICommentController): void { },
		unregisterCommentController(_id: string): void { },
		updateCommentingRanges(_id: string, _value: { schemes: string[] }): void { },
	} as Partial<ICommentService>;

	const onDidChangeComments = ds.add(new Emitter<{ workstream: string; filePath?: string }>());
	const workstreamCommentService = {
		onDidChangeComments: onDidChangeComments.event,
		async getComments(): Promise<IWorkstreamComment[]> { return []; },
		async getThread(workstream: string): Promise<IWorkstreamCommentThread> { return { workstream, comments: [], updatedAt: new Date().toISOString() }; },
		async addComment(): Promise<IWorkstreamComment> { throw new Error('not implemented'); },
		async updateComment(): Promise<void> { },
		async deleteComment(): Promise<void> { },
		async resolveComment(): Promise<void> { },
		async unresolveComment(): Promise<void> { },
	} as Partial<IWorkstreamCommentService>;

	const onDidChangeActiveWorktree = ds.add(new Emitter<IWorktreeEntry | undefined>());
	const orchestratorService = {
		activeWorktree: {
			name: 'test-worktree',
			branch: 'test-branch',
			path: '/test/repo/.workstreams/trees/test-worktree',
			isActive: true,
			sessionState: WorktreeSessionState.Idle,
		} as IWorktreeEntry | undefined,
		repositories: [],
		whenReady: Promise.resolve(),
		onDidChangeActiveWorktree: onDidChangeActiveWorktree.event,
		onDidChangeRepositories: ds.add(new Emitter<void>()).event,
		getAgentCommand(): string { return 'claude'; },
	};

	const onCodeEditorAdd = ds.add(new Emitter<ICodeEditor>());
	let editors: ICodeEditor[] = [];
	let diffEditors: IDiffEditor[] = [];
	const codeEditorService = {
		onCodeEditorAdd: onCodeEditorAdd.event,
		listCodeEditors(): ICodeEditor[] { return editors; },
		listDiffEditors(): IDiffEditor[] { return diffEditors; },
	} as Partial<ICodeEditorService>;

	const setEditors = (e: ICodeEditor[]) => { editors = e; };
	const setDiffEditors = (d: IDiffEditor[]) => { diffEditors = d; };

	const configurationServiceInstance = new TestConfigurationService();
	const configurationService = configurationServiceInstance;
	ds.add({ dispose() { configurationServiceInstance.onDidChangeConfigurationEmitter.dispose(); } });
	const logService = new NullLogService();

	return {
		commentService,
		workstreamCommentService,
		orchestratorService,
		codeEditorService,
		configurationService,
		logService,
		setEditors,
		setDiffEditors,
	};
}

function makeMockCodeEditor(opts: {
	id: string;
	uri: URI;
	inDiffEditor?: boolean;
}): ICodeEditor {
	return {
		getId: () => opts.id,
		getModel: () => ({ uri: opts.uri } as any),
		getOption: (option: EditorOption) => {
			if (option === EditorOption.inDiffEditor) {
				return opts.inDiffEditor ?? false;
			}
			return undefined as any;
		},
		onDidChangeModel: () => ({ dispose() { } }),
	} as any;
}

function makeMockDiffEditor(opts: {
	originalEditor: ICodeEditor;
	modifiedEditor: ICodeEditor;
	renderSideBySide: boolean;
	changes2?: DetailedLineRangeMapping[];
}): IDiffEditor {
	return {
		getOriginalEditor: () => opts.originalEditor,
		getModifiedEditor: () => opts.modifiedEditor,
		get renderSideBySide() { return opts.renderSideBySide; },
		getDiffComputationResult: () => opts.changes2 ? {
			changes: [],
			changes2: opts.changes2,
			identical: false,
			quitEarly: false,
		} : null,
		getLineChanges: () => null,
	} as any;
}

// --- Tests -------------------------------------------------------------------

suite('WorkstreamCommentController', () => {
	const ds = ensureNoDisposablesAreLeakedInTestSuite();

	let controller: WorkstreamCommentController;
	let mocks: ReturnType<typeof createMocks>;

	setup(() => {
		mocks = createMocks(ds);
		controller = ds.add(new WorkstreamCommentController(
			mocks.commentService as any,
			mocks.workstreamCommentService as any,
			mocks.orchestratorService as any,
			mocks.codeEditorService as any,
			mocks.configurationService,
			mocks.logService,
		));
	});

	suite('getDocumentComments', () => {
		test('returns commenting ranges for git:// URIs (original side)', async () => {
			const resource = URI.from({ scheme: 'git', path: '/test/repo/.workstreams/trees/test-worktree/src/foo.ts' });
			const result = await controller.getDocumentComments(resource, CancellationToken.None);
			assert.strictEqual(result.commentingRanges!.ranges!.length, 1);
		});

		test('returns empty for file:// URIs not in a diff editor', async () => {
			const resource = URI.file('/test/repo/.workstreams/trees/test-worktree/src/foo.ts');
			mocks.setEditors([]);
			mocks.setDiffEditors([]);

			const result = await controller.getDocumentComments(resource, CancellationToken.None);
			assert.strictEqual(result.commentingRanges!.ranges!.length, 0);
		});

		test('returns commenting ranges for file:// URIs in a diff editor', async () => {
			const resource = URI.file('/test/repo/.workstreams/trees/test-worktree/src/foo.ts');
			const editor = makeMockCodeEditor({ id: 'e1', uri: resource, inDiffEditor: true });
			const originalEditor = makeMockCodeEditor({
				id: 'e0',
				uri: URI.from({ scheme: 'git', path: resource.path }),
				inDiffEditor: true,
			});
			const diffEditor = makeMockDiffEditor({
				originalEditor,
				modifiedEditor: editor,
				renderSideBySide: true,
			});

			mocks.setEditors([originalEditor, editor]);
			mocks.setDiffEditors([diffEditor]);

			const result = await controller.getDocumentComments(resource, CancellationToken.None);
			assert.strictEqual(result.commentingRanges!.ranges!.length, 1);
		});

		test('handles race condition via EditorOption.inDiffEditor fallback', async () => {
			const resource = URI.file('/test/repo/.workstreams/trees/test-worktree/src/foo.ts');
			const editor = makeMockCodeEditor({ id: 'e1', uri: resource, inDiffEditor: true });
			mocks.setEditors([editor]);
			mocks.setDiffEditors([]); // empty — simulates race

			const result = await controller.getDocumentComments(resource, CancellationToken.None);
			assert.strictEqual(result.commentingRanges!.ranges!.length, 1,
				'Should provide ranges even when listDiffEditors is empty but editor has inDiffEditor');
		});

		test('returns empty for unknown scheme', async () => {
			const resource = URI.from({ scheme: 'untitled', path: 'test' });
			const result = await controller.getDocumentComments(resource, CancellationToken.None);
			assert.strictEqual(result.commentingRanges!.ranges!.length, 0);
		});

		test('returns empty when no active worktree', async () => {
			mocks.orchestratorService.activeWorktree = undefined;
			const resource = URI.from({ scheme: 'git', path: '/test/repo/src/foo.ts' });
			const result = await controller.getDocumentComments(resource, CancellationToken.None);
			assert.strictEqual(result.commentingRanges!.ranges!.length, 0);
		});

		test('returns empty for files outside worktree path', async () => {
			const resource = URI.from({ scheme: 'git', path: '/other/repo/src/foo.ts' });
			const result = await controller.getDocumentComments(resource, CancellationToken.None);
			assert.strictEqual(result.commentingRanges!.ranges!.length, 0);
		});
	});

	suite('side and label detection', () => {
		test('split view: left editor → side old, label L{n}', () => {
			const resource = URI.from({ scheme: 'git', path: '/test/repo/.workstreams/trees/test-worktree/src/foo.ts' });
			const originalEditor = makeMockCodeEditor({ id: 'orig', uri: resource, inDiffEditor: true });
			const modifiedEditor = makeMockCodeEditor({
				id: 'mod',
				uri: URI.file('/test/repo/.workstreams/trees/test-worktree/src/foo.ts'),
				inDiffEditor: true,
			});
			const diffEditor = makeMockDiffEditor({
				originalEditor,
				modifiedEditor,
				renderSideBySide: true,
			});

			mocks.setEditors([originalEditor, modifiedEditor]);
			mocks.setDiffEditors([diffEditor]);

			const result = (controller as any)._getCommentSideAndLabel(originalEditor, 42);
			assert.strictEqual(result.side, 'old');
			assert.strictEqual(result.label, 'L42');
		});

		test('split view: right editor → side new, label R{n}', () => {
			const resource = URI.file('/test/repo/.workstreams/trees/test-worktree/src/foo.ts');
			const originalEditor = makeMockCodeEditor({
				id: 'orig',
				uri: URI.from({ scheme: 'git', path: resource.path }),
				inDiffEditor: true,
			});
			const modifiedEditor = makeMockCodeEditor({ id: 'mod', uri: resource, inDiffEditor: true });
			const diffEditor = makeMockDiffEditor({
				originalEditor,
				modifiedEditor,
				renderSideBySide: true,
			});

			mocks.setEditors([originalEditor, modifiedEditor]);
			mocks.setDiffEditors([diffEditor]);

			const result = (controller as any)._getCommentSideAndLabel(modifiedEditor, 42);
			assert.strictEqual(result.side, 'new');
			assert.strictEqual(result.label, 'R42');
		});

		test('inline view: pure addition → side new, label R{n}', () => {
			const resource = URI.file('/test/repo/.workstreams/trees/test-worktree/src/foo.ts');
			const modifiedEditor = makeMockCodeEditor({ id: 'mod', uri: resource, inDiffEditor: true });
			const originalEditor = makeMockCodeEditor({
				id: 'orig',
				uri: URI.from({ scheme: 'git', path: resource.path }),
				inDiffEditor: true,
			});

			const additionMapping = new DetailedLineRangeMapping(
				new LineRange(10, 10), // original: empty
				new LineRange(10, 13), // modified: lines 10-12
				undefined,
			);

			const diffEditor = makeMockDiffEditor({
				originalEditor,
				modifiedEditor,
				renderSideBySide: false,
				changes2: [additionMapping],
			});

			mocks.setEditors([originalEditor, modifiedEditor]);
			mocks.setDiffEditors([diffEditor]);

			const result = (controller as any)._getCommentSideAndLabel(modifiedEditor, 11);
			assert.strictEqual(result.side, 'new');
			assert.strictEqual(result.label, 'R11');
		});

		test('inline view: changed line → side new, label L{n}', () => {
			const resource = URI.file('/test/repo/.workstreams/trees/test-worktree/src/foo.ts');
			const modifiedEditor = makeMockCodeEditor({ id: 'mod', uri: resource, inDiffEditor: true });
			const originalEditor = makeMockCodeEditor({
				id: 'orig',
				uri: URI.from({ scheme: 'git', path: resource.path }),
				inDiffEditor: true,
			});

			const changeMapping = new DetailedLineRangeMapping(
				new LineRange(10, 12), // original: lines 10-11
				new LineRange(10, 13), // modified: lines 10-12
				undefined,
			);

			const diffEditor = makeMockDiffEditor({
				originalEditor,
				modifiedEditor,
				renderSideBySide: false,
				changes2: [changeMapping],
			});

			mocks.setEditors([originalEditor, modifiedEditor]);
			mocks.setDiffEditors([diffEditor]);

			const result = (controller as any)._getCommentSideAndLabel(modifiedEditor, 11);
			assert.strictEqual(result.side, 'new');
			assert.strictEqual(result.label, 'L11');
		});

		test('inline view: context line → side new, label L{n}', () => {
			const resource = URI.file('/test/repo/.workstreams/trees/test-worktree/src/foo.ts');
			const modifiedEditor = makeMockCodeEditor({ id: 'mod', uri: resource, inDiffEditor: true });
			const originalEditor = makeMockCodeEditor({
				id: 'orig',
				uri: URI.from({ scheme: 'git', path: resource.path }),
				inDiffEditor: true,
			});

			const changeMapping = new DetailedLineRangeMapping(
				new LineRange(20, 22),
				new LineRange(20, 23),
				undefined,
			);

			const diffEditor = makeMockDiffEditor({
				originalEditor,
				modifiedEditor,
				renderSideBySide: false,
				changes2: [changeMapping],
			});

			mocks.setEditors([originalEditor, modifiedEditor]);
			mocks.setDiffEditors([diffEditor]);

			const result = (controller as any)._getCommentSideAndLabel(modifiedEditor, 5);
			assert.strictEqual(result.side, 'new');
			assert.strictEqual(result.label, 'L5');
		});

		test('no diff editor → defaults to side new, label R{n}', () => {
			const resource = URI.file('/test/repo/src/foo.ts');
			const editor = makeMockCodeEditor({ id: 'e1', uri: resource });

			mocks.setEditors([editor]);
			mocks.setDiffEditors([]);

			const result = (controller as any)._getCommentSideAndLabel(editor, 42);
			assert.strictEqual(result.side, 'new');
			assert.strictEqual(result.label, 'R42');
		});
	});

	suite('_buildLineLabel — consistency with creation', () => {
		test('split view: old side → L{n}', () => {
			const diffEditor = makeMockDiffEditor({
				originalEditor: makeMockCodeEditor({ id: 'orig', uri: URI.from({ scheme: 'git', path: '/foo' }), inDiffEditor: true }),
				modifiedEditor: makeMockCodeEditor({ id: 'mod', uri: URI.file('/foo'), inDiffEditor: true }),
				renderSideBySide: true,
			});

			assert.strictEqual((controller as any)._buildLineLabel(diffEditor, 42, 'old'), 'L42');
		});

		test('split view: new side → R{n}', () => {
			const diffEditor = makeMockDiffEditor({
				originalEditor: makeMockCodeEditor({ id: 'orig', uri: URI.from({ scheme: 'git', path: '/foo' }), inDiffEditor: true }),
				modifiedEditor: makeMockCodeEditor({ id: 'mod', uri: URI.file('/foo'), inDiffEditor: true }),
				renderSideBySide: true,
			});

			assert.strictEqual((controller as any)._buildLineLabel(diffEditor, 42, 'new'), 'R42');
		});

		test('inline view: addition line uses R{n} consistent with creation', () => {
			const additionMapping = new DetailedLineRangeMapping(
				new LineRange(10, 10),
				new LineRange(10, 13),
				undefined,
			);

			const diffEditor = makeMockDiffEditor({
				originalEditor: makeMockCodeEditor({ id: 'orig', uri: URI.from({ scheme: 'git', path: '/foo' }), inDiffEditor: true }),
				modifiedEditor: makeMockCodeEditor({ id: 'mod', uri: URI.file('/foo'), inDiffEditor: true }),
				renderSideBySide: false,
				changes2: [additionMapping],
			});

			assert.strictEqual((controller as any)._buildLineLabel(diffEditor, 11, 'new'), 'R11');
		});

		test('inline view: old side comment → L{n}', () => {
			const diffEditor = makeMockDiffEditor({
				originalEditor: makeMockCodeEditor({ id: 'orig', uri: URI.from({ scheme: 'git', path: '/foo' }), inDiffEditor: true }),
				modifiedEditor: makeMockCodeEditor({ id: 'mod', uri: URI.file('/foo'), inDiffEditor: true }),
				renderSideBySide: false,
				changes2: [],
			});

			assert.strictEqual((controller as any)._buildLineLabel(diffEditor, 42, 'old'), 'L42');
		});

		test('no diff editor: old → L, new → R', () => {
			assert.strictEqual((controller as any)._buildLineLabel(undefined, 42, 'old'), 'L42');
			assert.strictEqual((controller as any)._buildLineLabel(undefined, 42, 'new'), 'R42');
		});
	});
});
