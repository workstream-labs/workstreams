// Full-featured diff viewer for workstreams, built on critique's DiffView component.
// Two-panel layout: file list on the left, scrollable diff on the right.
// Supports syntax highlighting, theme picker, file picker,
// split/unified view, vim-style scroll, and mouse. Inline commenting with c key.

import "critique/dist/patch-terminal-dimensions.js";

import * as React from "react";
import {
  createCliRenderer,
  addDefaultParsers,
  MacOSScrollAccel,
  SyntaxStyle,
  type ScrollBoxRenderable,
  type DiffRenderable,
} from "@opentuah/core";
import {
  createRoot,
  useKeyboard,
  useTerminalDimensions,
  useRenderer,
} from "@opentuah/react";
import { parsePatch, formatPatch } from "diff";
import {
  processFiles,
  parseGitDiffFiles,
  stripSubmoduleHeaders,
  getFileName,
  getOldFileName,
  getFileStatus,
  countChanges,
  getViewMode,
  detectFiletype,
  type ParsedFile,
} from "critique/dist/diff-utils.js";
import { getResolvedTheme, getSyntaxTheme, themeNames, rgbaToHex } from "critique/dist/themes.js";
import { useAppStore } from "critique/dist/store.js";
import Dropdown from "critique/dist/dropdown.js";
import parsersConfig from "critique/dist/parsers-config.js";
import {
  loadComments,
  saveComments,
  type ReviewComment,
  type WorkstreamComments,
} from "../core/comments";

let parsersRegistered = false;

type ProcessedFile = ParsedFile & { rawDiff: string };

class ScrollAccel {
  private inner: MacOSScrollAccel;
  public multiplier = 1;
  constructor() { this.inner = new MacOSScrollAccel({ A: 1.5, maxMultiplier: 10 }); }
  tick(delta: number) { return this.inner.tick(delta) * this.multiplier; }
  reset() { this.inner.reset(); }
}

// --- Line map for cursor navigation ---

interface LineInfo {
  type: "context" | "add" | "remove" | "hunk-header";
  oldLine?: number;
  newLine?: number;
}

function parseDiffToLineMap(rawDiff: string): LineInfo[] {
  const patches = parsePatch(rawDiff);
  const map: LineInfo[] = [];
  for (const patch of patches) {
    for (const hunk of patch.hunks) {
      map.push({ type: "hunk-header" });
      let old = hunk.oldStart, neu = hunk.newStart;
      for (const ln of hunk.lines) {
        const ch = ln[0];
        if (ch === " ") map.push({ type: "context", oldLine: old++, newLine: neu++ });
        else if (ch === "-") map.push({ type: "remove", oldLine: old++ });
        else if (ch === "+") map.push({ type: "add", newLine: neu++ });
        // '\' no-newline marker: skip
      }
    }
  }
  return map;
}

// --- Status letter + color for file list ---

const STATUS_LETTER: Record<string, string> = {
  added: "A",
  deleted: "D",
  modified: "M",
  renamed: "R",
};

const STATUS_COLOR: Record<string, string> = {
  added: "#2d8a47",
  deleted: "#c53b53",
  modified: "#e5c07b",
  renamed: "#00b8d9",
};

// --- FileListItem ---

interface FileListItemProps {
  file: ProcessedFile;
  selected: boolean;
  focused: boolean;
  accentColor: string;
  textColor: string;
  mutedColor: string;
  commentCount: number;
  stripPrefix: (p: string) => string;
  width: number;
}

function FileListItem({
  file,
  selected,
  focused,
  accentColor,
  textColor,
  mutedColor,
  commentCount,
  stripPrefix,
  width,
}: FileListItemProps): React.ReactElement {
  const fileName = stripPrefix(getFileName(file));
  const status = getFileStatus(file);
  const letter = STATUS_LETTER[status] ?? "?";
  const letterColor = STATUS_COLOR[status] ?? mutedColor;
  const { additions, deletions } = countChanges(file.hunks);

  const parts = fileName.split("/");
  const basename = parts.pop() ?? fileName;
  const dir = parts.length > 0 ? parts.join("/") + "/" : "";

  const stats = `+${additions}-${deletions}`;
  const commentBadge = commentCount > 0 ? `${commentCount}` : "";

  // Cursor indicator
  const cursor = selected ? "▶" : " ";
  const cursorColor = selected && focused ? accentColor : mutedColor;

  // Background tint for selected row
  const bgColor = selected
    ? focused ? accentColor + "22" : "#264F7822"
    : undefined;

  return (
    <box
      height={1}
      style={{
        flexDirection: "row",
        backgroundColor: bgColor,
        paddingLeft: 1,
        width,
      }}
    >
      <text fg={cursorColor}>{cursor} </text>
      <text fg={letterColor}>{letter} </text>
      <box style={{ flexGrow: 1, flexDirection: "row", overflow: "hidden" }}>
        <text fg={mutedColor}>{dir}</text>
        <text fg={textColor} bold={selected}>{basename}</text>
      </box>
      {commentCount > 0 && (
        <>
          <text fg={mutedColor}> ○ </text>
          <text fg="#e5c07b">{commentBadge} </text>
        </>
      )}
      <text fg="#2d8a47">+{additions}</text>
      <text fg="#c53b53">-{deletions}</text>
      <text> </text>
    </box>
  );
}

// --- FileListPanel ---

interface FileListPanelProps {
  files: ProcessedFile[];
  fileIndex: number;
  focused: boolean;
  accentColor: string;
  textColor: string;
  mutedColor: string;
  comments: WorkstreamComments | null;
  stripPrefix: (p: string) => string;
  scrollboxRef: React.RefObject<ScrollBoxRenderable | null>;
  bg: string;
}

const FILE_PANEL_WIDTH = 34;

function FileListPanel({
  files,
  fileIndex,
  focused,
  accentColor,
  textColor,
  mutedColor,
  comments,
  stripPrefix,
  scrollboxRef,
  bg,
}: FileListPanelProps): React.ReactElement {
  const commentCounts = React.useMemo(() => {
    const counts = new Map<string, number>();
    if (!comments) return counts;
    for (const c of comments.comments) {
      counts.set(c.filePath, (counts.get(c.filePath) ?? 0) + 1);
    }
    return counts;
  }, [comments]);

  return (
    <box
      width={FILE_PANEL_WIDTH}
      style={{
        flexShrink: 0,
        flexDirection: "column",
        borderStyle: "single",
        border: ["right"],
        borderColor: focused ? accentColor : mutedColor,
      }}
    >
      <box style={{ paddingLeft: 1, flexShrink: 0 }}>
        <text fg={textColor} bold>Files ({files.length})</text>
      </box>
      <scrollbox
        ref={scrollboxRef}
        scrollY
        focused={false}
        style={{
          flexGrow: 1,
          rootOptions: { backgroundColor: bg, border: false },
          contentOptions: { minHeight: 0 },
          scrollbarOptions: {
            showArrows: false,
            trackOptions: { foregroundColor: mutedColor, backgroundColor: bg },
          },
        }}
      >
        {files.map((f, i) => (
          <FileListItem
            key={i}
            file={f}
            selected={i === fileIndex}
            focused={focused}
            accentColor={accentColor}
            textColor={textColor}
            mutedColor={mutedColor}
            commentCount={commentCounts.get(stripPrefix(getFileName(f))) ?? 0}
            stripPrefix={stripPrefix}
            width={FILE_PANEL_WIDTH - 2}
          />
        ))}
      </scrollbox>
    </box>
  );
}

// --- DiffWithCursor: inlines DiffView color setup and exposes a ref for cursor highlight ---

interface DiffWithCursorProps {
  diff: string;
  view: "unified" | "split";
  filetype?: string;
  themeName: string;
  diffRef: React.RefObject<DiffRenderable | null>;
}

function DiffWithCursor({ diff, view, filetype, themeName, diffRef }: DiffWithCursorProps): React.ReactElement {
  const resolvedTheme = React.useMemo(() => getResolvedTheme(themeName), [themeName]);
  const syntaxStyle = React.useMemo(() => SyntaxStyle.fromStyles(getSyntaxTheme(themeName)), [themeName]);
  const colors = React.useMemo(() => ({
    text: rgbaToHex(resolvedTheme.text),
    bgPanel: rgbaToHex(resolvedTheme.backgroundPanel),
    diffAddedBg: rgbaToHex(resolvedTheme.diffAddedBg),
    diffRemovedBg: rgbaToHex(resolvedTheme.diffRemovedBg),
    diffLineNumber: rgbaToHex(resolvedTheme.diffLineNumber),
    diffAddedLineNumberBg: rgbaToHex(resolvedTheme.diffAddedLineNumberBg),
    diffRemovedLineNumberBg: rgbaToHex(resolvedTheme.diffRemovedLineNumberBg),
  }), [resolvedTheme]);

  return (
    <box style={{ backgroundColor: colors.bgPanel }}>
      <diff
        ref={diffRef}
        diff={diff}
        view={view}
        fg={colors.text}
        filetype={filetype}
        syntaxStyle={syntaxStyle}
        showLineNumbers={true}
        wrapMode="word"
        addedBg={colors.diffAddedBg}
        removedBg={colors.diffRemovedBg}
        contextBg={colors.bgPanel}
        addedContentBg={colors.diffAddedBg}
        removedContentBg={colors.diffRemovedBg}
        contextContentBg={colors.bgPanel}
        lineNumberFg={colors.diffLineNumber}
        lineNumberBg={colors.bgPanel}
        addedLineNumberBg={colors.diffAddedLineNumberBg}
        removedLineNumberBg={colors.diffRemovedLineNumberBg}
        selectionBg="#264F78"
        selectionFg="#FFFFFF"
      />
    </box>
  );
}

// --- CommentForm ---

interface CommentFormProps {
  fileName: string;
  fileLine?: number;
  side: "old" | "new";
  viewMode: "unified" | "split";
  onTextChange: (v: string) => void;
  onCancel: () => void;
  textColor: string;
  mutedColor: string;
  bg: string;
  style?: any;
  initialValue?: string;
  isEditing?: boolean;
}

function CommentForm({
  fileName,
  fileLine,
  side,
  viewMode,
  onTextChange,
  textColor,
  mutedColor,
  bg,
  style,
  initialValue,
  isEditing,
}: CommentFormProps): React.ReactElement {
  const loc = fileLine !== undefined ? `${fileName}:${fileLine}` : fileName;
  return (
    <box
      style={{
        flexShrink: 0,
        minHeight: 10,
        borderStyle: "single",
        borderColor: mutedColor,
        marginLeft: 1,
        marginRight: 1,
        marginBottom: 1,
        padding: 1,
        flexDirection: "column",
        ...style,
      }}
    >
      <box style={{ flexDirection: "row" }}>
        <text fg={mutedColor}>{isEditing ? "editing comment on " : "commenting on "}</text>
        <text fg={textColor}>{loc}</text>
        {viewMode === "split" && (
          <>
            <text fg={mutedColor}>  side: </text>
            <text fg={textColor}>{side === "old" ? "◀ old" : "new ▶"}</text>
          </>
        )}
      </box>
      <textarea
        placeholder="Write a comment..."
        initialValue={initialValue}
        focused={true}
        onInput={onTextChange}
        style={{ marginTop: 1, minHeight: 3, backgroundColor: bg }}
      />
      <box style={{ flexDirection: "row", marginTop: 1 }}>
        <text fg={textColor}>ctrl+s</text>
        <text fg={mutedColor}> {isEditing ? "update" : "submit"}  ·  </text>
        <text fg={textColor}>esc</text>
        <text fg={mutedColor}> cancel</text>
        {isEditing && (
          <>
            <text fg={mutedColor}>  ·  </text>
            <text fg="#c53b53">ctrl+d</text>
            <text fg={mutedColor}> delete</text>
          </>
        )}
      </box>
    </box>
  );
}

// --- CommentsPanel ---

interface CommentsPanelProps {
  fileComments: ReviewComment[];
  textColor: string;
  mutedColor: string;
}

function CommentsPanel({
  fileComments,
  textColor,
  mutedColor,
}: CommentsPanelProps): React.ReactElement {
  return (
    <box
      style={{
        flexShrink: 0,
        maxHeight: 6,
        marginLeft: 1,
        marginRight: 1,
        marginBottom: 1,
        borderStyle: "single",
        borderColor: mutedColor,
        flexDirection: "column",
        padding: 1,
      }}
    >
      {fileComments.map((c, i) => (
        <box key={i} style={{ flexDirection: "row" }}>
          <text fg={mutedColor}>{"  "}</text>
          <text fg={c.line !== undefined ? textColor : mutedColor}>
            {c.line !== undefined ? String(c.line) : "—"}
          </text>
          <text fg={mutedColor}>{c.side ? ` (${c.side})` : " "} · </text>
          <text fg={textColor}>{c.text}</text>
        </box>
      ))}
    </box>
  );
}

// --- DiffApp ---

interface DiffAppProps {
  name: string;
  files: ProcessedFile[];
  currentWorkstream?: string;
  workstreams?: string[];
  returnLabel?: string;
}

function DiffApp({ name, files, currentWorkstream, workstreams, returnLabel }: DiffAppProps): React.ReactElement {
  const [fileIndex, setFileIndex] = React.useState(0);
  const [focusPanel, setFocusPanel] = React.useState<"files" | "diff">("files");
  const [showFilePicker, setShowFilePicker] = React.useState(false);
  const [showThemePicker, setShowThemePicker] = React.useState(false);
  const [previewTheme, setPreviewTheme] = React.useState<string | null>(null);
  const [viewOverride, setViewOverride] = React.useState<"split" | "unified" | null>(null);
  const [scrollAccel] = React.useState(() => new ScrollAccel());
  const scrollboxRef = React.useRef<ScrollBoxRenderable | null>(null);
  const fileListScrollboxRef = React.useRef<ScrollBoxRenderable | null>(null);
  const lastKeyRef = React.useRef<{ key: string; time: number } | null>(null);
  const renderer = useRenderer();
  const { width } = useTerminalDimensions();

  // Cursor
  const [cursorLine, setCursorLine] = React.useState(0);
  const diffRef = React.useRef<DiffRenderable | null>(null);
  // True while a keyboard/programmatic scroll is in flight — suppresses scroll→cursor sync
  const keyboardScrollRef = React.useRef(false);

  // Comment state
  const [showCommentForm, setShowCommentForm] = React.useState(false);
  const commentTextRef = React.useRef("");
  const [commentSide, setCommentSide] = React.useState<"old" | "new">("new");
  const [commentFileLine, setCommentFileLine] = React.useState<number | undefined>();
  const [comments, setComments] = React.useState<WorkstreamComments | null>(null);
  const [editingCommentIndex, setEditingCommentIndex] = React.useState<number | null>(null);
  const [flashMessage, setFlashMessage] = React.useState<string | null>(null);

  const themeName = useAppStore((s: { themeName: string }) => s.themeName);
  const activeTheme = previewTheme ?? themeName;
  const resolvedTheme = getResolvedTheme(activeTheme);
  const bg = resolvedTheme.background;
  const textColor = rgbaToHex(resolvedTheme.text);
  const mutedColor = rgbaToHex(resolvedTheme.textMuted);
  const accentColor = "#00b8d9";
  const commentMarkerColor = "#e5c07b";

  const file = files[fileIndex];
  const stripPrefix = (p: string) => p.replace(/^[ab]\//, "");
  const fileName = file ? stripPrefix(getFileName(file)) : "";

  // Total stats across all files
  const { totalAdditions, totalDeletions } = React.useMemo(() => {
    let add = 0, del = 0;
    for (const f of files) {
      const s = countChanges(f.hunks);
      add += s.additions;
      del += s.deletions;
    }
    return { totalAdditions: add, totalDeletions: del };
  }, [files]);

  // Per-file line map for cursor navigation
  const lineMap = React.useMemo(
    () => file ? parseDiffToLineMap(file.rawDiff) : [],
    [file],
  );

  // Compute viewMode — subtract file panel width from available width for auto mode
  const { additions, deletions } = file ? countChanges(file.hunks) : { additions: 0, deletions: 0 };
  const diffPanelWidth = Math.max(40, width - FILE_PANEL_WIDTH);
  const viewMode = viewOverride ?? getViewMode(additions, deletions, diffPanelWidth);

  const refreshComments = React.useCallback(async () => {
    const data = await loadComments(name);
    setComments(data);
  }, [name]);

  React.useEffect(() => { refreshComments(); }, [refreshComments]);

  // Reset cursor and edit state when navigating to a different file
  React.useEffect(() => {
    setCursorLine(0);
    diffRef.current?.clearAllLineColors();
    setEditingCommentIndex(null);
  }, [fileIndex]);

  // Sync cursor to trackpad/mouse scroll — skip when keyboard initiated the scroll
  React.useEffect(() => {
    const sb = scrollboxRef.current;
    if (!sb) return;
    const handler = ({ position }: { position: number }) => {
      if (keyboardScrollRef.current) return;
      const line = Math.round(position);
      if (line >= 0 && line < lineMap.length) {
        setCursorLine(line);
      }
    };
    sb.on("change", handler);
    return () => { sb.off("change", handler); };
  }, [lineMap]);

  const fileComments = React.useMemo(
    () => comments?.comments.filter(c => c.filePath === fileName) ?? [],
    [comments, fileName],
  );

  // Map commented lines to { lineMapIndex -> side } for per-panel gutter highlighting
  const commentedLineMap = React.useMemo(() => {
    const result = new Map<number, "old" | "new">();
    const annotated = fileComments.filter(c => c.line !== undefined);
    if (annotated.length === 0) return result;
    lineMap.forEach((info, idx) => {
      for (const c of annotated) {
        if (info.type === "add" && info.newLine === c.line && c.side !== "old") {
          result.set(idx, "new");
        } else if (info.type === "remove" && info.oldLine === c.line && c.side !== "new") {
          result.set(idx, "old");
        }
      }
    });
    return result;
  }, [fileComments, lineMap]);

  // Apply cursor highlight and comment markers whenever relevant state changes
  React.useEffect(() => {
    const dr = diffRef.current;
    if (!dr) return;
    dr.clearAllLineColors();
    const drAny = dr as any;
    for (const [idx, side] of commentedLineMap) {
      if (viewMode === "split") {
        const panel = side === "old" ? drAny.leftSide : drAny.rightSide;
        panel?.setLineColor(idx, { gutter: commentMarkerColor, content: commentMarkerColor + "22" });
      } else {
        dr.setLineColor(idx, { gutter: commentMarkerColor, content: commentMarkerColor + "22" });
      }
    }
    if (cursorLine >= 0 && cursorLine < lineMap.length) {
      dr.setLineColor(cursorLine, { gutter: accentColor, content: accentColor + "33" });
    }
  }, [cursorLine, lineMap, accentColor, commentedLineMap, commentMarkerColor, viewMode]);

  const handleCommentSubmit = async (text: string) => {
    if (!text.trim()) { setShowCommentForm(false); return; }
    const current = comments ?? { workstream: name, comments: [], updatedAt: new Date().toISOString() };
    let updated: WorkstreamComments;
    if (editingCommentIndex !== null) {
      const updatedList = [...current.comments];
      updatedList[editingCommentIndex] = { ...updatedList[editingCommentIndex], text: text.trim() };
      updated = { ...current, comments: updatedList };
    } else {
      const newComment: ReviewComment = {
        filePath: fileName,
        line: commentFileLine,
        side: commentSide,
        text: text.trim(),
        createdAt: new Date().toISOString(),
      };
      updated = { ...current, comments: [...current.comments, newComment] };
    }
    await saveComments(updated);
    await refreshComments();
    setShowCommentForm(false);
    setEditingCommentIndex(null);
    setFlashMessage("✔ comment saved");
    setTimeout(() => setFlashMessage(null), 1500);
  };

  const handleCommentDelete = async () => {
    if (editingCommentIndex === null) return;
    const current = comments ?? { workstream: name, comments: [], updatedAt: new Date().toISOString() };
    const updatedList = [...current.comments];
    updatedList.splice(editingCommentIndex, 1);
    await saveComments({ ...current, comments: updatedList });
    await refreshComments();
    setShowCommentForm(false);
    setEditingCommentIndex(null);
    setFlashMessage("✔ comment deleted");
    setTimeout(() => setFlashMessage(null), 1500);
  };

  const scrollCursorIntoView = (line: number) => {
    const sb = scrollboxRef.current;
    if (!sb) return;
    keyboardScrollRef.current = true;
    const viewportH = sb.viewport.height;
    const top = sb.scrollTop;
    const bottom = top + viewportH;
    const margin = 2;
    if (line < top + margin) {
      sb.scrollTo(Math.max(0, line - margin));
    } else if (line >= bottom - margin) {
      sb.scrollTo(line - viewportH + margin + 1);
    }
    setTimeout(() => { keyboardScrollRef.current = false; }, 100);
  };

  const scrollFileIntoView = (idx: number) => {
    const sb = fileListScrollboxRef.current;
    if (!sb) return;
    const viewportH = sb.viewport.height;
    const top = sb.scrollTop;
    if (idx < top + 1) sb.scrollTo(Math.max(0, idx - 1));
    else if (idx >= top + viewportH - 1) sb.scrollTo(idx - viewportH + 2);
  };

  const scrollDiffToTop = () => {
    keyboardScrollRef.current = true;
    scrollboxRef.current?.scrollTo(0);
    setTimeout(() => { keyboardScrollRef.current = false; }, 100);
  };

  const selectFile = (idx: number) => {
    setFileIndex(idx);
    scrollFileIntoView(idx);
    scrollDiffToTop();
  };

  useKeyboard((key: any) => {
    if (showFilePicker || showThemePicker) {
      if (key.name === "escape") {
        setShowFilePicker(false);
        setShowThemePicker(false);
        setPreviewTheme(null);
      }
      return;
    }

    // Comment form: handle submit, cancel, and side-toggle; everything else goes to textarea
    if (showCommentForm) {
      if (key.name === "escape") { setShowCommentForm(false); return; }
      if (key.ctrl && key.name === "s") {
        handleCommentSubmit(commentTextRef.current);
        return;
      }
      if (key.ctrl && key.name === "d" && editingCommentIndex !== null) {
        handleCommentDelete();
        return;
      }
      return;
    }

    // Global keys
    if (key.name === "escape" || key.name === "q") { renderer.destroy(); return; }
    if (key.ctrl && key.name === "z") { renderer.console.toggle(); return; }
    if (key.ctrl && key.name === "p") { setShowFilePicker(true); return; }
    if (key.name === "t") { setShowThemePicker(true); return; }
    if (key.name === "s") {
      setViewOverride(viewMode === "split" ? "unified" : "split");
      return;
    }

    // Panel focus switching
    if (key.name === "tab") {
      setFocusPanel((p) => p === "files" ? "diff" : "files");
      return;
    }

    // --- File list panel keys ---
    if (focusPanel === "files") {
      if (key.name === "j" || key.name === "down") {
        const next = Math.min(fileIndex + 1, files.length - 1);
        selectFile(next);
        return;
      }
      if (key.name === "k" || key.name === "up") {
        const prev = Math.max(fileIndex - 1, 0);
        selectFile(prev);
        return;
      }
      if (key.name === "g" && key.shift) {
        selectFile(files.length - 1);
        return;
      }
      if (key.name === "g" && !key.shift && !key.ctrl) {
        const now = Date.now();
        if (lastKeyRef.current?.key === "g" && now - lastKeyRef.current.time < 300) {
          selectFile(0);
          lastKeyRef.current = null;
        } else {
          lastKeyRef.current = { key: "g", time: now };
        }
        return;
      }
      if (key.name === "l" || key.name === "return") {
        setFocusPanel("diff");
        return;
      }
      return;
    }

    // --- Diff panel keys ---
    if (key.name === "h") {
      setFocusPanel("files");
      return;
    }

    // Cursor navigation
    if (key.name === "j" || key.name === "down") {
      const next = Math.min(cursorLine + 1, lineMap.length - 1);
      setCursorLine(next);
      scrollCursorIntoView(next);
      return;
    }
    if (key.name === "k" || key.name === "up") {
      const prev = Math.max(cursorLine - 1, 0);
      setCursorLine(prev);
      scrollCursorIntoView(prev);
      return;
    }

    // Open comment form — only on added (+) or removed (-) lines
    if (key.name === "c") {
      const info = lineMap[cursorLine];
      if (!info || (info.type !== "add" && info.type !== "remove")) return;

      const autoSide: "old" | "new" = info.type === "add" ? "new" : "old";
      const fileLine = info.type === "add" ? info.newLine : info.oldLine;

      const existingIdx = comments?.comments.findIndex(
        c => c.filePath === fileName && c.line === fileLine && c.side === autoSide
      ) ?? -1;
      if (existingIdx >= 0) {
        const existing = comments!.comments[existingIdx];
        commentTextRef.current = existing.text;
        setEditingCommentIndex(existingIdx);
      } else {
        commentTextRef.current = "";
        setEditingCommentIndex(null);
      }
      setCommentSide(autoSide);
      setCommentFileLine(fileLine);
      setShowCommentForm(true);
      return;
    }

    const sb = scrollboxRef.current;
    if (sb) {
      if (key.name === "g" && key.shift) { sb.scrollBy(1, "content"); return; }
      if (key.name === "g" && !key.shift && !key.ctrl) {
        const now = Date.now();
        if (lastKeyRef.current?.key === "g" && now - lastKeyRef.current.time < 300) {
          sb.scrollTo(0);
          setCursorLine(0);
          lastKeyRef.current = null;
        } else {
          lastKeyRef.current = { key: "g", time: now };
        }
        return;
      }
      if (key.ctrl && key.name === "d") { sb.scrollBy(0.5, "viewport"); return; }
      if (key.ctrl && key.name === "u") { sb.scrollBy(-0.5, "viewport"); return; }
    }

    if (key.option) {
      scrollAccel.multiplier = key.eventType === "release" ? 1 : 10;
    }
  });

  if (files.length === 0) {
    return (
      <box style={{ padding: 1, backgroundColor: bg }}>
        <text fg={textColor}>No changes to display</text>
      </box>
    );
  }

  const rawOldFileName = file ? getOldFileName(file) : undefined;
  const oldFileName = rawOldFileName ? stripPrefix(rawOldFileName) : undefined;
  const filetype = fileName ? detectFiletype(fileName) : undefined;

  const fileOptions = files.map((f, idx) => {
    const name = stripPrefix(getFileName(f));
    return { title: name, value: String(idx), keywords: name.split("/") };
  });

  const themeOpts = themeNames.map((n: string) => ({ title: n, value: n }));

  const showNormalUI = !showFilePicker && !showThemePicker;

  return (
    <box style={{ flexDirection: "column", height: "100%", backgroundColor: bg }}>

      {/* Overlays */}
      {showThemePicker && (
        <box style={{ flexShrink: 0, maxHeight: 15 }}>
          <Dropdown
            tooltip="Select theme"
            options={themeOpts}
            selectedValues={[themeName]}
            onChange={(v: string) => {
              useAppStore.setState({ themeName: v });
              setShowThemePicker(false);
              setPreviewTheme(null);
            }}
            onFocus={(v: string) => setPreviewTheme(v)}
            onEscape={() => { setShowThemePicker(false); setPreviewTheme(null); }}
            placeholder="Search themes..."
            itemsPerPage={6}
            theme={resolvedTheme}
          />
        </box>
      )}
      {showFilePicker && (
        <box style={{ flexShrink: 0, maxHeight: 15 }}>
          <Dropdown
            tooltip="Select file"
            options={fileOptions}
            selectedValues={[String(fileIndex)]}
            onChange={(v: string) => {
              const idx = parseInt(v, 10);
              selectFile(idx);
              setShowFilePicker(false);
            }}
            onEscape={() => setShowFilePicker(false)}
            placeholder="Search files..."
            itemsPerPage={6}
            theme={resolvedTheme}
          />
        </box>
      )}

      {/* Header */}
      {showNormalUI && (
        <box
          style={{
            flexShrink: 0,
            flexDirection: "row",
            alignItems: "center",
            paddingLeft: 1,
            paddingRight: 1,
            paddingBottom: 1,
          }}
        >
          <text fg={accentColor}>ws diff: </text>
          <text fg={textColor} bold>{name}</text>
          <box style={{ flexGrow: 1 }} />
          <text fg={mutedColor}>{files.length} files </text>
          <text fg="#2d8a47">+{totalAdditions} </text>
          <text fg="#c53b53">-{totalDeletions}</text>
        </box>
      )}

      {/* Two-panel body: file list + diff */}
      <box style={{ flexDirection: "row", flexGrow: 1, flexShrink: 1 }}>
        {/* File list panel */}
        {showNormalUI && (
          <FileListPanel
            files={files}
            fileIndex={fileIndex}
            focused={focusPanel === "files"}
            accentColor={accentColor}
            textColor={textColor}
            mutedColor={mutedColor}
            comments={comments}
            stripPrefix={stripPrefix}
            scrollboxRef={fileListScrollboxRef}
            bg={bg}
          />
        )}

        {/* Diff panel (right side) */}
        <box style={{ flexDirection: "column", flexGrow: 1, flexShrink: 1 }}>
          {/* Current file name sub-header */}
          {showNormalUI && (
            <box
              style={{
                flexShrink: 0,
                flexDirection: "row",
                paddingLeft: 1,
                paddingRight: 1,
              }}
            >
              {oldFileName && oldFileName !== fileName ? (
                <>
                  <text fg={mutedColor}>{oldFileName} → </text>
                  <text fg={textColor} bold>{fileName}</text>
                </>
              ) : (
                <text fg={textColor} bold>{fileName}</text>
              )}
              <text fg="#2d8a47"> +{additions}</text>
              <text fg="#c53b53">-{deletions}</text>
            </box>
          )}

          {/* Diff scrollbox */}
          <scrollbox
            ref={scrollboxRef}
            scrollY
            scrollAcceleration={scrollAccel}
            style={{
              flexGrow: 1,
              flexShrink: 1,
              rootOptions: { backgroundColor: bg, border: false },
              contentOptions: { minHeight: 0 },
              scrollbarOptions: {
                showArrows: false,
                trackOptions: { foregroundColor: mutedColor, backgroundColor: bg },
              },
            }}
            focused={false}
          >
            {file && (
              <DiffWithCursor
                diff={file.rawDiff ?? ""}
                view={viewMode}
                filetype={filetype}
                themeName={activeTheme}
                diffRef={diffRef}
              />
            )}
          </scrollbox>

          {/* Flash confirmation — inside diff panel */}
          {showNormalUI && flashMessage && (
            <box style={{ flexDirection: "row", justifyContent: "center", paddingBottom: 1, flexShrink: 0 }}>
              <text fg="#2d8a47">{flashMessage}</text>
            </box>
          )}

          {/* Comment form — inside diff panel */}
          {showNormalUI && showCommentForm && (
            <box style={{ flexDirection: "row", width: "100%", flexShrink: 0 }}>
              {viewMode === "split" && commentSide === "new"
                ? <box style={{ width: "50%" }} />
                : null}
              <CommentForm
                key={editingCommentIndex !== null ? `edit-${editingCommentIndex}` : "new"}
                fileName={fileName}
                fileLine={commentFileLine}
                side={commentSide}
                viewMode={viewMode}
                onTextChange={(v) => { commentTextRef.current = v; }}
                onCancel={() => setShowCommentForm(false)}
                textColor={textColor}
                mutedColor={mutedColor}
                bg={bg}
                style={{ width: viewMode === "split" ? "50%" : "100%" }}
                initialValue={editingCommentIndex !== null ? comments?.comments[editingCommentIndex]?.text : undefined}
                isEditing={editingCommentIndex !== null}
              />
              {viewMode === "split" && commentSide === "old"
                ? <box style={{ width: "50%" }} />
                : null}
            </box>
          )}
        </box>
      </box>

      {/* Footer */}
      {showNormalUI && (
        <box
          style={{
            flexShrink: 0,
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "center",
            paddingTop: 1,
            paddingLeft: 1,
            paddingRight: 1,
          }}
        >
          <text fg={textColor}>q</text>
          <text fg={mutedColor}> {returnLabel ?? "quit"}  </text>
          <text fg={textColor}>Tab</text>
          <text fg={mutedColor}> panel  </text>
          <text fg={textColor}>↑↓</text>
          <text fg={mutedColor}> {focusPanel === "files" ? "select file" : "cursor"}  </text>
          {focusPanel === "diff" && (
            <>
              <text fg={textColor}>c</text>
              <text fg={mutedColor}> comment  </text>
            </>
          )}
          <text fg={textColor}>s</text>
          <text fg={mutedColor}> {viewMode}  </text>
          <text fg={textColor}>t</text>
          <text fg={mutedColor}> theme  </text>
          <text fg={textColor}>ctrl p</text>
          <text fg={mutedColor}> search</text>
        </box>
      )}

      {/* Workstream tabs */}
      {workstreams && workstreams.length > 1 && showNormalUI && (
        <box
          style={{
            flexShrink: 0,
            flexDirection: "row",
            justifyContent: "flex-end",
            paddingLeft: 1,
            paddingRight: 1,
            paddingBottom: 1,
          }}
        >
          {workstreams.map((ws, i) => (
            <React.Fragment key={ws}>
              {i > 0 && <text fg={mutedColor}> | </text>}
              {ws === currentWorkstream
                ? <text fg={textColor}><b>{ws}</b></text>
                : <text fg={mutedColor}>{ws}</text>
              }
            </React.Fragment>
          ))}
        </box>
      )}
    </box>
  );
}

export interface DiffViewerOptions {
  workstreams?: string[];
  returnLabel?: string;
}

export async function openDiffViewer(
  name: string,
  rawDiff: string,
  options?: DiffViewerOptions,
): Promise<void> {
  if (!parsersRegistered) {
    addDefaultParsers(parsersConfig.parsers);
    parsersRegistered = true;
  }

  const files = processFiles(
    parseGitDiffFiles(stripSubmoduleHeaders(rawDiff), parsePatch),
    formatPatch,
  ) as ProcessedFile[];

  return new Promise<void>(async (resolve) => {
    const renderer = await createCliRenderer({
      onDestroy() { resolve(); },
      exitOnCtrlC: true,
      useMouse: true,
      enableMouseMovement: true,
    });

    createRoot(renderer).render(
      <DiffApp
        name={name}
        files={files}
        currentWorkstream={name}
        workstreams={options?.workstreams}
        returnLabel={options?.returnLabel}
      />
    );
  });
}
