/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../base/common/cancellation.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { URI, UriComponents } from '../../../../base/common/uri.js';
import { IRange } from '../../../../editor/common/core/range.js';
import { ICodeEditor } from '../../../../editor/browser/editorBrowser.js';
import { ICodeEditorService } from '../../../../editor/browser/services/codeEditorService.js';
import { EditorOption } from '../../../../editor/common/config/editorOptions.js';
import * as languages from '../../../../editor/common/languages.js';
import { ICommentController, ICommentInfo, ICommentService, INotebookCommentInfo } from '../../comments/browser/commentService.js';
import { IWorkstreamCommentService } from '../../../services/workstreamComments/common/workstreamCommentService.js';
import { IOrchestratorService } from '../../../services/orchestrator/common/orchestratorService.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { WorkstreamCommentZoneWidget } from './workstreamCommentZoneWidget.js';
import { localize } from '../../../../nls.js';

// --- Constants ---------------------------------------------------------------

const OWNER_ID = 'workstreamComments';
const TAG = '[WSComments]';

/** Maximum line number for commenting ranges (covers any file). */
const MAX_LINE_NUMBER = 0x7FFFFFFF;

/** Delay before initial comment restore on startup (ms). */
const INITIAL_RESTORE_DELAY_MS = 500;

/** Staggered retry delays for re-registering commenting ranges after ext host restart (ms). */
const RANGE_RETRY_DELAYS_MS = [500, 2000, 5000];

export class WorkstreamCommentController extends Disposable implements ICommentController {

	readonly id = OWNER_ID;
	readonly label = localize("worktreeReview.label", "Workstream Review");
	readonly owner = OWNER_ID;
	readonly features = {};
	readonly options: languages.CommentOptions = {
		prompt: localize("worktreeReview.prompt", "Add a review comment..."),
		placeHolder: localize("worktreeReview.placeholder", "Leave a comment"),
	};
	activeComment: { thread: languages.CommentThread; comment?: languages.Comment } | undefined;

	/** Track active zone widgets by editor+line to avoid duplicates. */
	private readonly _activeWidgets = new Map<string, WorkstreamCommentZoneWidget>();

	constructor(
		private readonly commentService: ICommentService,
		private readonly workstreamCommentService: IWorkstreamCommentService,
		private readonly orchestratorService: IOrchestratorService,
		private readonly codeEditorService: ICodeEditorService,
		private readonly configurationService: IConfigurationService,
		private readonly logService: ILogService,
	) {
		super();

		// Force split diff mode — inline diff is not supported for comments
		this.configurationService.updateValue('diffEditor.renderSideBySide', true);

		// Register with VS Code's comment system (provides "+" hover glyph)
		this.commentService.registerCommentController(OWNER_ID, this);
		this._register({ dispose: () => this.commentService.unregisterCommentController(OWNER_ID) });

		// Tell the comment system we provide commenting ranges for file:// and git:// URIs
		this.commentService.updateCommentingRanges(OWNER_ID, { schemes: ['file', 'git'] });

		// When a new editor appears, listen for model changes
		this._register(this.codeEditorService.onCodeEditorAdd(editor => {
			this._register(editor.onDidChangeModel(() => {
				this._disposeWidgetsForEditor(editor);
				this._onEditorReady(editor);
			}));
		}));

		// Prevent inline diff mode — force back to split if user toggles it
		this._register(this.configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration('diffEditor.renderSideBySide')) {
				if (!this.configurationService.getValue<boolean>('diffEditor.renderSideBySide')) {
					this.configurationService.updateValue('diffEditor.renderSideBySide', true);
				}
			}
		}));

		// Refresh when comment data changes
		this._register(this.workstreamCommentService.onDidChangeComments(() => {
			this.commentService.updateCommentingRanges(OWNER_ID, { schemes: ['file', 'git'] });
		}));

		// When worktree changes, dispose old widgets first, then show new ones
		this._register(this.orchestratorService.onDidChangeActiveWorktree(() => {
			this._disposeAllWidgets();
			this._showSavedCommentsOnAllEditors();
		}));

		// Show comments on already-open editors (delayed to let orchestrator settle)
		setTimeout(() => this._showSavedCommentsOnAllEditors(), INITIAL_RESTORE_DELAY_MS);
	}

	// --- ICommentController implementation ---

	async getDocumentComments(resource: URI, _token: CancellationToken): Promise<ICommentInfo<IRange>> {
		const worktree = this.orchestratorService.activeWorktree;

		// Only enable commenting in diff editors, not regular file editors.
		// git:// URIs are always the left side of a diff.
		// file:// URIs need a check: only if they're inside a diff editor.
		if (resource.scheme === 'git') {
			// Left side of diff — always a diff context, proceed
		} else if (resource.scheme === 'file') {
			const isInDiff = this.codeEditorService.listDiffEditors().some(diff => {
				const modified = diff.getModifiedEditor().getModel()?.uri;
				const original = diff.getOriginalEditor().getModel()?.uri;
				return modified?.toString() === resource.toString() || original?.toString() === resource.toString();
			});
			if (!isInDiff) {
				return this._emptyCommentInfo(resource);
			}
		} else {
			return this._emptyCommentInfo(resource);
		}

		if (!worktree) {
			return this._emptyCommentInfo(resource);
		}

		const worktreePrefix = this._normalizePrefix(worktree.path);
		if (!resource.fsPath.startsWith(worktreePrefix)) {
			return this._emptyCommentInfo(resource);
		}

		// Show saved comments on editors displaying this file.
		// This is the reliable trigger — onCodeEditorAdd/onDidChangeModel miss
		// diff sub-editors whose models are set inside batchEventsGlobally.
		for (const editor of this.codeEditorService.listCodeEditors()) {
			if (editor.getModel()?.uri.toString() === resource.toString()) {
				this._showSavedComments(editor);
			}
		}

		return {
			uniqueOwner: OWNER_ID,
			label: this.label,
			threads: [],
			commentingRanges: {
				resource,
				ranges: [{ startLineNumber: 1, startColumn: 1, endLineNumber: MAX_LINE_NUMBER, endColumn: 1 }],
				fileComments: false,
			},
		};
	}

	async getNotebookComments(_resource: URI, _token: CancellationToken): Promise<INotebookCommentInfo> {
		return { uniqueOwner: OWNER_ID, label: this.label, threads: [] };
	}

	async createCommentThreadTemplate(resource: UriComponents, range: IRange | undefined, editorId?: string): Promise<void> {
		if (!range) {
			return;
		}

		const editor = this._findEditor(URI.revive(resource), editorId);
		if (!editor) {
			return;
		}

		const side = this._isOriginalSideOfDiff(editor) ? 'old' : 'new';
		this._openWidget(editor, range.startLineNumber, side);
	}

	async updateCommentThreadTemplate(_threadHandle: number, _range: IRange): Promise<void> {
		// No-op
	}

	deleteCommentThreadMain(_commentThreadId: string): void {
		// No-op
	}

	async toggleReaction(_uri: URI, _thread: languages.CommentThread, _comment: languages.Comment, _reaction: languages.CommentReaction, _token: CancellationToken): Promise<void> {
		// No reactions
	}

	async setActiveCommentAndThread(commentInfo: { thread: languages.CommentThread; comment?: languages.Comment } | undefined): Promise<void> {
		this.activeComment = commentInfo;
	}

	// --- Helpers ---

	private async _onEditorReady(editor: ICodeEditor): Promise<void> {
		await this._showSavedComments(editor);
		this._refreshCommentingRanges();
		for (const delay of RANGE_RETRY_DELAYS_MS) {
			setTimeout(() => this._refreshCommentingRanges(), delay);
		}
	}

	private _disposeAllWidgets(): void {
		for (const [key, widget] of this._activeWidgets) {
			widget.dispose();
			this._activeWidgets.delete(key);
		}
	}

	private _disposeWidgetsForEditor(editor: ICodeEditor): void {
		const prefix = editor.getId() + ':';
		for (const [key, widget] of this._activeWidgets) {
			if (key.startsWith(prefix)) {
				widget.dispose();
				this._activeWidgets.delete(key);
			}
		}
	}

	private _refreshCommentingRanges(): void {
		// Unregister and re-register to force VS Code's CommentsController
		// instances to re-query getDocumentComments from scratch.
		// updateCommentingRanges alone is not strong enough — the event gets
		// lost when the Extension Host restarts during worktree switches.
		this.commentService.unregisterCommentController(OWNER_ID);
		this.commentService.registerCommentController(OWNER_ID, this);
		this.commentService.updateCommentingRanges(OWNER_ID, { schemes: ['file', 'git'] });
	}

	private async _showSavedCommentsOnAllEditors(): Promise<void> {
		for (const editor of this.codeEditorService.listCodeEditors()) {
			await this._showSavedComments(editor);
		}
		this._refreshCommentingRanges();
		for (const delay of RANGE_RETRY_DELAYS_MS) {
			setTimeout(() => this._refreshCommentingRanges(), delay);
		}
	}

	private async _showSavedComments(editor: ICodeEditor): Promise<void> {
		try {
			const model = editor.getModel();
			if (!model) {
				return;
			}

			const worktree = this.orchestratorService.activeWorktree;
			if (!worktree) {
				return;
			}

			const worktreePrefix = this._normalizePrefix(worktree.path);
			if (!model.uri.fsPath.startsWith(worktreePrefix)) {
				return;
			}

			// Always clear old widgets on this editor first — the file may have changed
			this._disposeWidgetsForEditor(editor);

			const isOriginal = this._isOriginalSideOfDiff(editor);
			const editorSide: 'old' | 'new' = isOriginal ? 'old' : 'new';

			const relativePath = model.uri.fsPath.substring(worktreePrefix.length);
			const comments = await this.workstreamCommentService.getComments(worktree.name, relativePath);

			for (const comment of comments) {
				if (comment.side !== editorSide) {
					continue;
				}

				const widgetKey = `${editor.getId()}:${comment.line}`;
				if (this._activeWidgets.has(widgetKey)) {
					continue;
				}

				const widget = new WorkstreamCommentZoneWidget(
					editor,
					comment.line,
					comment,
					this.workstreamCommentService,
					this.orchestratorService,
					comment.side,
				);

				this._activeWidgets.set(widgetKey, widget);
				const closeListener = widget.onDidClose(() => {
					this._activeWidgets.delete(widgetKey);
					closeListener.dispose();
				});

				widget.display();
			}
		} catch (err) {
			this.logService.warn(TAG, 'Failed to show saved comments:', err);
		}
	}

	private _openWidget(editor: ICodeEditor, lineNumber: number, side: 'old' | 'new' = 'new'): void {
		const widgetKey = `${editor.getId()}:${lineNumber}`;

		if (this._activeWidgets.has(widgetKey)) {
			return;
		}

		const widget = new WorkstreamCommentZoneWidget(
			editor,
			lineNumber,
			undefined,
			this.workstreamCommentService,
			this.orchestratorService,
			side,
		);

		this._activeWidgets.set(widgetKey, widget);
		widget.onDidClose(() => {
			this._activeWidgets.delete(widgetKey);
		});

		widget.display();
	}

	private _isOriginalSideOfDiff(editor: ICodeEditor): boolean {
		if (!editor.getOption(EditorOption.inDiffEditor)) {
			return false;
		}
		for (const diffEditor of this.codeEditorService.listDiffEditors()) {
			if (diffEditor.getOriginalEditor() === editor) {
				return true;
			}
		}
		return false;
	}

	private _findEditor(resource: URI, editorId?: string): ICodeEditor | undefined {
		const editors = this.codeEditorService.listCodeEditors();
		if (editorId) {
			return editors.find(e => e.getId() === editorId);
		}
		return editors.find(e => e.getModel()?.uri.toString() === resource.toString());
	}

	/** Normalize a worktree path to always end with '/' for safe prefix matching. */
	private _normalizePrefix(path: string): string {
		return path.endsWith('/') ? path : path + '/';
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
