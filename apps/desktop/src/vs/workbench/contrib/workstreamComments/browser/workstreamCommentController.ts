/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../base/common/cancellation.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { URI, UriComponents } from '../../../../base/common/uri.js';
import { IRange } from '../../../../editor/common/core/range.js';
import { ICodeEditor, IDiffEditor } from '../../../../editor/browser/editorBrowser.js';
import { ICodeEditorService } from '../../../../editor/browser/services/codeEditorService.js';
import { EditorOption } from '../../../../editor/common/config/editorOptions.js';
import { DetailedLineRangeMapping } from '../../../../editor/common/diff/rangeMapping.js';
import * as languages from '../../../../editor/common/languages.js';
import { ICommentController, ICommentInfo, ICommentService, INotebookCommentInfo } from '../../comments/browser/commentService.js';
import { IWorkstreamCommentService, CommentSide } from '../../../services/workstreamComments/common/workstreamCommentService.js';
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

		// Refresh all widgets when the user toggles between split and inline diff mode.
		// Labels and side assignments depend on the current view mode.
		this._register(this.configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration('diffEditor.renderSideBySide')) {
				this._disposeAllWidgets();
				this._showSavedCommentsOnAllEditors();
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
			// Check if this file URI belongs to any diff editor.
			// Uses two strategies to handle the race where listDiffEditors()
			// may not yet include a newly-opened diff editor:
			// 1. Check listDiffEditors() for URI match
			// 2. Check EditorOption.inDiffEditor on code editors (may briefly
			//    return true on a stale editor during teardown — harmless since
			//    we only provide commenting ranges, not render widgets)
			const isInDiff = this._isResourceInDiff(resource);
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

		const { side, label, storedLine } = this._getCommentSideAndLabel(editor, range.startLineNumber);
		this._openWidget(editor, range.startLineNumber, side, label, storedLine);
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

			// Only dispose widgets that show saved comments — preserve unsaved edit-mode widgets
			const prefix = editor.getId() + ':';
			for (const [key, widget] of this._activeWidgets) {
				if (key.startsWith(prefix) && widget.hasSavedComment) {
					widget.dispose();
					this._activeWidgets.delete(key);
				}
			}

			const isInline = this._isInlineDiffMode();

			// git: scheme URIs are always the original (left) side of a diff,
			// even during races where _findDiffEditorForCodeEditor returns undefined.
			const isOriginal = model.uri.scheme === 'git' || this._isOriginalSideOfDiff(editor);

			// In inline mode, only the modified editor is visible — skip the
			// hidden original editor entirely to prevent invisible widgets that
			// persist incorrectly through view mode switches.
			if (isInline && isOriginal) {
				return;
			}

			// In inline mode, show comments from both sides on the modified editor.
			// In split mode, show only the matching side.
			const editorSide: CommentSide | 'both' = isInline ? 'both' : (isOriginal ? 'old' : 'new');

			const relativePath = model.uri.fsPath.substring(worktreePrefix.length);
			const comments = await this.workstreamCommentService.getComments(worktree.name, relativePath);

			for (const comment of comments) {
				if (editorSide !== 'both' && comment.side !== editorSide) {
					continue;
				}

				const widgetKey = `${editor.getId()}:${comment.side}:${comment.line}`;
				if (this._activeWidgets.has(widgetKey)) {
					continue;
				}

				const lineLabel = this._buildLineLabel(comment.line, comment.side);

				const widget = new WorkstreamCommentZoneWidget(
					editor,
					comment.line,
					comment,
					this.workstreamCommentService,
					this.orchestratorService,
					comment.side,
					lineLabel,
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

	private _openWidget(editor: ICodeEditor, lineNumber: number, side: CommentSide = 'new', lineLabel?: string, storedLine?: number): void {
		const widgetKey = `${editor.getId()}:${side}:${lineNumber}`;

		if (this._activeWidgets.has(widgetKey)) {
			return;
		}

		const label = lineLabel ?? this._buildLineLabel(lineNumber, side);

		const widget = new WorkstreamCommentZoneWidget(
			editor,
			lineNumber,
			undefined,
			this.workstreamCommentService,
			this.orchestratorService,
			side,
			label,
			storedLine ?? lineNumber,
		);

		this._activeWidgets.set(widgetKey, widget);
		widget.onDidClose(() => {
			this._activeWidgets.delete(widgetKey);
		});

		widget.display();
	}

	// --- Diff / side detection ---

	/**
	 * Read the current diff view mode from the configuration service rather
	 * than from `diffEditor.renderSideBySide`. The config service always has
	 * the latest value, whereas the diff editor object may update its own
	 * property asynchronously — creating a stale-state window during view
	 * mode switches that can cause comments to appear on the wrong editor.
	 */
	private _isInlineDiffMode(): boolean {
		return !(this.configurationService.getValue<boolean>('diffEditor.renderSideBySide') ?? true);
	}

	/**
	 * Check if a file:// resource is part of any diff editor.
	 */
	private _isResourceInDiff(resource: URI): boolean {
		const resourceStr = resource.toString();

		// Strategy 1: check registered diff editors
		for (const diff of this.codeEditorService.listDiffEditors()) {
			const modified = diff.getModifiedEditor().getModel()?.uri;
			const original = diff.getOriginalEditor().getModel()?.uri;
			if (modified?.toString() === resourceStr || original?.toString() === resourceStr) {
				return true;
			}
		}

		// Strategy 2: check EditorOption.inDiffEditor on code editors (handles race)
		for (const editor of this.codeEditorService.listCodeEditors()) {
			if (editor.getModel()?.uri.toString() === resourceStr && editor.getOption(EditorOption.inDiffEditor)) {
				return true;
			}
		}

		return false;
	}

	/**
	 * Find the diff editor that contains a given code editor.
	 */
	private _findDiffEditorForCodeEditor(editor: ICodeEditor): IDiffEditor | undefined {
		for (const diff of this.codeEditorService.listDiffEditors()) {
			if (diff.getOriginalEditor() === editor || diff.getModifiedEditor() === editor) {
				return diff;
			}
		}
		return undefined;
	}

	/**
	 * Determine the comment side and a GitHub-style line label for a given
	 * editor and line number.
	 *
	 * Split view:  L{n} for original/left, R{n} for modified/right
	 * Inline view:  R{n} for pure additions, L{n} for everything else
	 *               (matches GitHub unified view convention)
	 */
	/**
	 * Determine the comment side, display label, and persisted line number for a
	 * click at `lineNumber` in `editor`.
	 *
	 * GitHub convention (which we match):
	 *   Split view:
	 *     - Right editor (any line)   → side:'new',  label:R{n}, storedLine:n
	 *     - Left editor, deleted line → side:'old',  label:L{n}, storedLine:n
	 *     - Left editor, context line → side:'new',  label:R{right-n}, storedLine:right-n
	 *       (context lines are always anchored to the right-side line number)
	 *   Inline/unified view:
	 *     - All clickable lines       → side:'new',  label:R{n}, storedLine:n
	 *       (deleted lines are view zones — not clickable)
	 */
	private _getCommentSideAndLabel(editor: ICodeEditor, lineNumber: number): { side: CommentSide; label: string; storedLine: number } {
		const diffEditor = this._findDiffEditorForCodeEditor(editor);

		if (!diffEditor) {
			return { side: 'new', label: `R${lineNumber}`, storedLine: lineNumber };
		}

		const isInline = this._isInlineDiffMode();

		if (!isInline) {
			// Split view — right editor is always the 'new' side
			if (diffEditor.getModifiedEditor() === editor) {
				return { side: 'new', label: `R${lineNumber}`, storedLine: lineNumber };
			}

			// Left (original) editor: distinguish deleted lines from context lines.
			// Lines within a diff mapping's original range are deleted/changed (L side).
			// Lines outside all mappings are context lines — map to the right-side number.
			const diffResult = diffEditor.getDiffComputationResult();
			if (diffResult) {
				for (const mapping of diffResult.changes2) {
					if (lineNumber >= mapping.original.startLineNumber && lineNumber < mapping.original.endLineNumberExclusive) {
						// Deleted / changed line on the left — stays L side
						return { side: 'old', label: `L${lineNumber}`, storedLine: lineNumber };
					}
				}
				// Context line: compute the corresponding right-side line number
				const rightLine = this._toRightLineNumber(lineNumber, diffResult.changes2);
				return { side: 'new', label: `R${rightLine}`, storedLine: rightLine };
			}

			// No diff result yet — right side is the safe default
			return { side: 'new', label: `R${lineNumber}`, storedLine: lineNumber };
		}

		// Inline/unified view: the only visible editor is the modified editor.
		// Deleted lines are view zones (not real model lines) so the "+" glyph
		// only appears on modified-side lines. All of them use R{n}.
		return { side: 'new', label: `R${lineNumber}`, storedLine: lineNumber };
	}

	/**
	 * Build a display label for a saved comment when restoring it into a widget.
	 * side:'old' → L{n} (deletion/change on the original file)
	 * side:'new' → R{n} (addition, change, or context on the modified file)
	 *
	 * `lineNumber` is always the persisted line (right-side for 'new' comments,
	 * left-side for 'old' comments), so the label is just a prefix + number.
	 */
	private _buildLineLabel(lineNumber: number, side: CommentSide): string {
		return side === 'old' ? `L${lineNumber}` : `R${lineNumber}`;
	}

	/**
	 * Given a line number in the original (left) file and the diff mappings,
	 * compute the corresponding line number in the modified (right) file.
	 * Used to anchor context-line comments to the right-side coordinate.
	 */
	private _toRightLineNumber(leftLine: number, mappings: readonly DetailedLineRangeMapping[]): number {
		let delta = 0;
		for (const mapping of mappings) {
			if (mapping.original.endLineNumberExclusive <= leftLine) {
				delta += mapping.modified.length - mapping.original.length;
			}
		}
		return leftLine + delta;
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
