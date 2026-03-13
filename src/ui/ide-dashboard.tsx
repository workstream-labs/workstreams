// IDE-style dashboard for `ws switch`.
// Left panel: workstream list. Right panel: logs (default) or diff viewer.
// Built on the same @opentuah/core + critique stack as session-viewer and diff-viewer.

import "critique/dist/patch-terminal-dimensions.js";

import * as React from "react";
import {
  createCliRenderer,
  addDefaultParsers,
  type ScrollBoxRenderable,
  type DiffRenderable,
} from "@opentuah/core";
import {
  createRoot,
  useKeyboard,
  useTerminalDimensions,
  useRenderer,
} from "@opentuah/react";
import { rgbaToHex } from "critique/dist/themes.js";
import parsersConfig from "critique/dist/parsers-config.js";
import { parsePatch, formatPatch } from "diff";
import {
  processFiles,
  parseGitDiffFiles,
  stripSubmoduleHeaders,
  getFileName,
  getFileStatus,
  countChanges,
  detectFiletype,
  getViewMode,
  type ParsedFile,
} from "critique/dist/diff-utils.js";

import {
  theme,
  r as resolvedThemeRaw,
  syntaxTheme,
  Spinner,
  SessionMessages,
} from "./session-viewer.js";
import { parseSessionJsonlContent, type DisplayMessage } from "../core/session-reader.js";
import type { WorkstreamEntry, DashboardAction } from "./workstream-picker.js";
import {
  loadComments,
  saveComments,
  type ReviewComment,
  type WorkstreamComments,
} from "../core/comments";

let parsersRegistered = false;

// ─── Types ───────────────────────────────────────────────────────────────────

type FocusPanel = "workstreams" | "right";
type RightMode = "logs" | "diff";

export interface IdeDashboardOptions {
  onRefresh?: () => Promise<WorkstreamEntry[]>;
  refreshInterval?: number;
  getLogFile: (name: string) => string | null;
  getWorkstreamStatus: (name: string) => string;
  getDiff: (name: string) => Promise<string>;
  onSendPrompt: (name: string, prompt: string) => Promise<boolean>;
  onInterrupt: (name: string) => Promise<void>;
  onOpenEditor?: (name: string) => Promise<boolean>;
  onCreateWorkstream?: (name: string) => Promise<boolean>;
  onDestroy?: (name: string) => Promise<boolean>;
}

interface ActionOption {
  label: string;
  description: string;
  action: DashboardAction["type"];
}

// ─── Action picker options (reused from workstream-picker logic) ─────────────

function buildActionOptions(entry: WorkstreamEntry): ActionOption[] {
  const options: ActionOption[] = [];

  options.push({
    label: "Open in editor",
    description: "Open worktree in your editor",
    action: "editor",
  });

  const isActive = entry.status === "running" || entry.status === "queued";
  if (entry.hasSession && !isActive) {
    options.push({
      label: "Open session",
      description: "Resume interactive terminal",
      action: "open-session",
    });
  }

  if (!isActive) {
    options.push({
      label: "Delete",
      description: "Remove worktree and branch",
      action: "destroy",
    });
  }

  return options;
}

// ─── Diff colors ─────────────────────────────────────────────────────────────

const diffColors = {
  text: rgbaToHex(resolvedThemeRaw.text),
  bgPanel: rgbaToHex(resolvedThemeRaw.backgroundPanel),
  diffAddedBg: resolvedThemeRaw.diffAddedBg ? rgbaToHex(resolvedThemeRaw.diffAddedBg) : "#20303b",
  diffRemovedBg: resolvedThemeRaw.diffRemovedBg ? rgbaToHex(resolvedThemeRaw.diffRemovedBg) : "#37222c",
  diffContextBg: resolvedThemeRaw.diffContextBg ? rgbaToHex(resolvedThemeRaw.diffContextBg) : theme.backgroundPanel,
  diffLineNumber: resolvedThemeRaw.diffLineNumber ? rgbaToHex(resolvedThemeRaw.diffLineNumber) : theme.textMuted,
  diffAddedLineNumberBg: resolvedThemeRaw.diffAddedLineNumberBg ? rgbaToHex(resolvedThemeRaw.diffAddedLineNumberBg) : "#1b2b34",
  diffRemovedLineNumberBg: resolvedThemeRaw.diffRemovedLineNumberBg ? rgbaToHex(resolvedThemeRaw.diffRemovedLineNumberBg) : "#2d1f26",
};

// ─── Status config ───────────────────────────────────────────────────────────

const SPIN = ["\u280B", "\u2819", "\u2839", "\u2838", "\u283C", "\u2834", "\u2826", "\u2827", "\u2807", "\u280F"];

const STATUS_CONFIG: Record<string, { icon: string; color: string }> = {
  success: { icon: "\u2713", color: theme.success },
  failed: { icon: "\u2717", color: theme.error },
  running: { icon: "\u25CF", color: theme.warning },
  queued: { icon: "\u25C9", color: theme.info },
  ready: { icon: "\u25CB", color: theme.textMuted },
  workspace: { icon: "\u25C7", color: theme.info },
};

const FILE_STATUS_LETTER: Record<string, string> = {
  added: "A", deleted: "D", modified: "M", renamed: "R",
};
const FILE_STATUS_COLOR: Record<string, string> = {
  added: "#2d8a47", deleted: "#c53b53", modified: "#e5c07b", renamed: "#00b8d9",
};

// ─── Diff line mapping helpers ────────────────────────────────────────────────

interface LineInfo {
  type: "context" | "add" | "remove";
  oldLine?: number;
  newLine?: number;
}

function parseDiffToLineMap(rawDiff: string): LineInfo[] {
  const patches = parsePatch(rawDiff);
  const map: LineInfo[] = [];
  for (const patch of patches) {
    for (const hunk of patch.hunks) {
      let old = hunk.oldStart, neu = hunk.newStart;
      for (const ln of hunk.lines) {
        const ch = ln[0];
        if (ch === " ") map.push({ type: "context", oldLine: old++, newLine: neu++ });
        else if (ch === "-") map.push({ type: "remove", oldLine: old++ });
        else if (ch === "+") map.push({ type: "add", newLine: neu++ });
      }
    }
  }
  return map;
}

interface RendererLineInfo {
  side: "old" | "new";
  lineType: "add" | "remove" | "context";
  line: number | undefined;
  lineContent: string | undefined;
}

function queryRendererLine(
  diffRef: React.RefObject<DiffRenderable | null>,
  cursorLine: number,
  viewMode: "unified" | "split",
): RendererLineInfo | null {
  const dr = diffRef.current as any;
  if (!dr) return null;

  const getContent = (side: any, idx: number): string | undefined => {
    const content: string | undefined = side?.target?.content;
    if (!content) return undefined;
    return content.split("\n")[idx];
  };

  const signToType = (sign: string | undefined): "add" | "remove" | "context" =>
    sign === "-" ? "remove" : sign === "+" ? "add" : "context";

  if (viewMode === "unified") {
    const left = dr.leftSide;
    if (!left) return null;
    const lineNum = left.getLineNumbers()?.get(cursorLine);
    const sign = left.getLineSigns()?.get(cursorLine)?.after?.trim();
    const lineType = signToType(sign);
    const lineContent = getContent(left, cursorLine);
    return { side: lineType === "remove" ? "old" : "new", lineType, line: lineNum, lineContent };
  }

  const left = dr.leftSide;
  const right = dr.rightSide;
  if (!left && !right) return null;
  const leftNum = left?.getLineNumbers()?.get(cursorLine);
  const rightNum = right?.getLineNumbers()?.get(cursorLine);
  const leftSign = left?.getLineSigns()?.get(cursorLine)?.after?.trim();
  const rightSign = right?.getLineSigns()?.get(cursorLine)?.after?.trim();
  const hasLeft = leftNum !== undefined;
  const hasRight = rightNum !== undefined;

  if (hasLeft && leftSign === "-") return { side: "old", lineType: "remove", line: leftNum, lineContent: getContent(left, cursorLine) };
  if (hasRight && rightSign === "+") return { side: "new", lineType: "add", line: rightNum, lineContent: getContent(right, cursorLine) };
  return { side: "new", lineType: "context", line: rightNum ?? leftNum, lineContent: getContent(right ?? left, cursorLine) };
}

function extractDiffContext(rawDiff: string, cursorLine: number, windowSize = 3): string | undefined {
  const patches = parsePatch(rawDiff);
  const allLines: string[] = [];
  for (const patch of patches) {
    for (const hunk of patch.hunks) {
      for (const ln of hunk.lines) {
        if (ln[0] === "\\") continue;
        allLines.push(ln);
      }
    }
  }
  if (cursorLine < 0 || cursorLine >= allLines.length) return undefined;
  const start = Math.max(0, cursorLine - windowSize);
  const end = Math.min(allLines.length - 1, cursorLine + windowSize);
  return allLines.slice(start, end + 1).map((ln, i) => {
    const prefix = start + i === cursorLine ? "► " : "  ";
    return prefix + ln;
  }).join("\n");
}

// ─── Left panel constants ────────────────────────────────────────────────────

const LEFT_PANEL_WIDTH = 32;
const ITEM_HEIGHT = 3; // icon+name, prompt, separator

// ─── WorkstreamListItem ──────────────────────────────────────────────────────

function WorkstreamListItem({ entry, selected, focused, width, spinnerFrame }: {
  entry: WorkstreamEntry;
  selected: boolean;
  focused: boolean;
  width: number;
  spinnerFrame: number;
}) {
  const st = STATUS_CONFIG[entry.status] ?? STATUS_CONFIG.ready;
  const icon = entry.status === "running"
    ? SPIN[spinnerFrame % SPIN.length]
    : st.icon;

  const bg = selected
    ? focused ? theme.accent + "33" : "#264F7822"
    : undefined;

  const nameMaxW = width - 6;
  const displayName = entry.name.length > nameMaxW
    ? entry.name.slice(0, nameMaxW - 1) + "\u2026"
    : entry.name;

  // Brief metadata
  let meta = "";
  if (entry.status === "running") meta = "running";
  else if (entry.filesChanged > 0) meta = `+${entry.additions} -${entry.deletions}`;
  else if (!entry.hasWorktree) meta = "no tree";

  const promptMaxW = width - 5;
  const promptDisplay = entry.prompt
    ? (entry.prompt.length > promptMaxW ? entry.prompt.slice(0, promptMaxW - 1) + "\u2026" : entry.prompt)
    : "(no prompt)";

  return (
    <box style={{ minHeight: ITEM_HEIGHT, backgroundColor: bg, paddingLeft: 1 }} width={width}>
      <box flexDirection="row" gap={1}>
        <text fg={st.color}>{icon}</text>
        <text fg={selected ? theme.text : theme.textMuted} bold={selected}>{displayName}</text>
        <box flexGrow={1} />
        {meta && <text fg={theme.textMuted}>{meta} </text>}
      </box>
      <text fg={theme.textMuted} paddingLeft={3}>{promptDisplay}</text>
    </box>
  );
}

// ─── WorkstreamListPanel ─────────────────────────────────────────────────────

function AddWorkstreamButton({ selected, focused, width }: {
  selected: boolean;
  focused: boolean;
  width: number;
}) {
  const bg = selected
    ? focused ? theme.accent + "33" : "#264F7822"
    : undefined;

  return (
    <box style={{ minHeight: ITEM_HEIGHT, backgroundColor: bg, paddingLeft: 1 }} width={width}>
      <box flexDirection="row" gap={1}>
        <text fg={selected && focused ? theme.accent : theme.textMuted}>+</text>
        <text fg={selected ? theme.text : theme.textMuted} bold={selected}>Add workstream</text>
      </box>
      <text fg={theme.textMuted} paddingLeft={3}>Create a new workstream node</text>
    </box>
  );
}

const ADD_BUTTON_INDEX = -1; // sentinel value

function WorkstreamListPanel({ entries, selectedIdx, focused, spinnerFrame, scrollRef, scrollEnabled = true }: {
  entries: WorkstreamEntry[];
  selectedIdx: number;
  focused: boolean;
  spinnerFrame: number;
  scrollRef: React.RefObject<ScrollBoxRenderable | null>;
  scrollEnabled?: boolean;
}) {
  const isAddSelected = selectedIdx === entries.length;

  return (
    <box
      width={LEFT_PANEL_WIDTH}
      style={{
        flexShrink: 0,
        flexDirection: "column",
        border: ["right"],
        borderStyle: "single",
        borderColor: focused ? theme.accent : theme.border,
      }}
    >
      <box style={{ paddingLeft: 1, flexShrink: 0, paddingBottom: 1 }}>
        <text fg={theme.text} bold>Workstreams</text>
        <text fg={theme.textMuted}> ({entries.length})</text>
      </box>
      <scrollbox
        ref={scrollRef}
        scrollY={scrollEnabled}
        focused={false}
        style={{
          flexGrow: 1,
          rootOptions: { backgroundColor: theme.background, border: false },
          contentOptions: { minHeight: 0 },
          scrollbarOptions: {
            showArrows: false,
            trackOptions: { foregroundColor: theme.textMuted, backgroundColor: theme.background },
          },
        }}
      >
        {entries.map((entry, i) => (
          <WorkstreamListItem
            key={entry.name}
            entry={entry}
            selected={i === selectedIdx}
            focused={focused}
            width={LEFT_PANEL_WIDTH - 2}
            spinnerFrame={spinnerFrame}
          />
        ))}
        <box style={{ borderStyle: "single", border: ["top"], borderColor: theme.border, marginTop: 0 }} width={LEFT_PANEL_WIDTH - 2} />
        <AddWorkstreamButton
          selected={isAddSelected}
          focused={focused}
          width={LEFT_PANEL_WIDTH - 2}
        />
      </scrollbox>
    </box>
  );
}

// ─── Tab bar for right panel ─────────────────────────────────────────────────

function RightPanelTabs({ mode, onSwitch, wsName, wsStatus }: {
  mode: RightMode;
  onSwitch: (m: RightMode) => void;
  wsName: string;
  wsStatus: string;
}) {
  const st = STATUS_CONFIG[wsStatus] ?? STATUS_CONFIG.ready;
  const statusIcon = wsStatus === "running" ? "\u25CF" : st.icon;

  return (
    <box
      style={{
        flexShrink: 0,
        flexDirection: "row",
        alignItems: "center",
        paddingLeft: 1,
        paddingRight: 1,
        backgroundColor: theme.backgroundPanel,
        borderStyle: "single",
        border: ["bottom"],
        borderColor: theme.border,
      }}
    >
      <text
        fg={mode === "logs" ? theme.text : theme.textMuted}
        bold={mode === "logs"}
        backgroundColor={mode === "logs" ? theme.background : undefined}
      >
        {" Logs "}
      </text>
      <text fg={theme.border}> | </text>
      <text
        fg={mode === "diff" ? theme.text : theme.textMuted}
        bold={mode === "diff"}
        backgroundColor={mode === "diff" ? theme.background : undefined}
      >
        {" Diff "}
      </text>
      <box flexGrow={1} />
      <text fg={st.color}>{statusIcon}</text>
      <text fg={theme.text}> <b>{wsName}</b></text>
    </box>
  );
}

// ─── Logs panel (embeds SessionMessages) ─────────────────────────────────────

function LogsPanel({ messages, status, follow, showThinking, scrollRef, scrollEnabled = true }: {
  messages: DisplayMessage[];
  status: string;
  follow: boolean;
  showThinking: boolean;
  scrollRef: React.RefObject<ScrollBoxRenderable | null>;
  scrollEnabled?: boolean;
}) {
  const hasResult = messages.some((m: DisplayMessage) => m.role === "result");
  const isRunning = status === "running" && !hasResult;

  // Auto-follow: scroll to bottom when messages change.
  // Use a short delay so the scrollbox layout has updated with the new content.
  React.useEffect(() => {
    if (!follow) return;
    const tick = () => scrollRef.current?.scrollBy(100_000);
    tick();
    const id = setTimeout(tick, 32);
    return () => clearTimeout(id);
  }, [messages, follow]);

  return (
    <scrollbox
      ref={scrollRef}
      flexGrow={1}
      scrollY={scrollEnabled}
      paddingLeft={1}
      paddingRight={1}
      paddingBottom={2}
      verticalScrollbarOptions={{
        trackOptions: { backgroundColor: theme.background, foregroundColor: theme.borderActive },
      }}
    >
      <SessionMessages
        messages={messages}
        showThinking={showThinking}
        isRunning={isRunning}
      />
    </scrollbox>
  );
}

// ─── Diff file list item ─────────────────────────────────────────────────────

type ProcessedFile = ParsedFile & { rawDiff: string };

function DiffFileItem({ file, selected, focused, width }: {
  file: ProcessedFile;
  selected: boolean;
  focused: boolean;
  width: number;
}) {
  const fileName = getFileName(file).replace(/^[ab]\//, "");
  const status = getFileStatus(file);
  const letter = FILE_STATUS_LETTER[status] ?? "?";
  const letterColor = FILE_STATUS_COLOR[status] ?? theme.textMuted;
  const { additions, deletions } = countChanges(file.hunks);

  const parts = fileName.split("/");
  const basename = parts.pop() ?? fileName;
  const dir = parts.length > 0 ? parts.join("/") + "/" : "";

  const cursor = selected ? "\u25B6" : " ";
  const cursorColor = selected && focused ? theme.accent : theme.textMuted;
  const bg = selected ? (focused ? theme.accent + "22" : "#264F7822") : undefined;

  return (
    <box height={1} style={{ flexDirection: "row", backgroundColor: bg, paddingLeft: 1 }} width={width}>
      <text fg={cursorColor}>{cursor} </text>
      <text fg={letterColor}>{letter} </text>
      <box style={{ flexGrow: 1, flexDirection: "row", overflow: "hidden" }}>
        <text fg={theme.textMuted}>{dir}</text>
        <text fg={theme.text} bold={selected}>{basename}</text>
      </box>
      <text fg="#2d8a47">+{additions}</text>
      <text fg="#c53b53">-{deletions} </text>
    </box>
  );
}

// ─── Diff panel ──────────────────────────────────────────────────────────────

const DIFF_FILE_PANEL_W = 30;

function DiffPanel({ rawDiff, loading, focused, fileIndex, subFocus, diffScrollRef, diffRef, viewMode, cursorLine, commentedLineIndices, bottomSlot, scrollEnabled = true }: {
  rawDiff: string | null;
  loading: boolean;
  focused: boolean;
  fileIndex: number;
  subFocus: "files" | "diff";
  diffScrollRef: React.RefObject<ScrollBoxRenderable | null>;
  diffRef: React.RefObject<DiffRenderable | null>;
  viewMode: "unified" | "split";
  cursorLine: number;
  commentedLineIndices: Set<number>;
  bottomSlot?: React.ReactNode;
}) {
  const fileScrollRef = React.useRef<ScrollBoxRenderable | null>(null);

  const files = React.useMemo(() => {
    if (!rawDiff) return [] as ProcessedFile[];
    return processFiles(
      parseGitDiffFiles(stripSubmoduleHeaders(rawDiff), parsePatch),
      formatPatch,
    ) as ProcessedFile[];
  }, [rawDiff]);

  // Clamp file index
  const clampedIdx = Math.min(fileIndex, Math.max(0, files.length - 1));

  // Cursor and comment marker highlighting
  React.useEffect(() => {
    const dr = diffRef.current;
    if (!dr) return;
    dr.clearAllLineColors();
    const commentColor = "#e5c07b";
    for (const idx of commentedLineIndices) {
      dr.setLineColor(idx, { gutter: commentColor, content: commentColor + "22" });
    }
    if (cursorLine >= 0 && focused && subFocus === "diff") {
      dr.setLineColor(cursorLine, { gutter: theme.accent, content: theme.accent + "33" });
    }
  }, [cursorLine, commentedLineIndices, focused, subFocus]);

  if (loading) {
    return (
      <box flexGrow={1} justifyContent="center" alignItems="center">
        <Spinner color={theme.accent}>Loading diff...</Spinner>
      </box>
    );
  }

  if (!rawDiff || files.length === 0) {
    return (
      <box flexGrow={1} justifyContent="center" alignItems="center">
        <text fg={theme.textMuted}>{"\u25CB"} No changes</text>
      </box>
    );
  }

  const file = files[clampedIdx];
  const fileName = file ? getFileName(file).replace(/^[ab]\//, "") : "";
  const filetype = fileName ? detectFiletype(fileName) : undefined;
  const { additions, deletions } = file ? countChanges(file.hunks) : { additions: 0, deletions: 0 };

  // Total stats
  let totalAdd = 0, totalDel = 0;
  for (const f of files) {
    const s = countChanges(f.hunks);
    totalAdd += s.additions;
    totalDel += s.deletions;
  }

  return (
    <box flexDirection="column" flexGrow={1}>
      {/* Stats header */}
      <box style={{ flexShrink: 0, flexDirection: "row", paddingLeft: 1, paddingRight: 1 }}>
        <text fg={theme.textMuted}>{files.length} files </text>
        <text fg="#2d8a47">+{totalAdd} </text>
        <text fg="#c53b53">-{totalDel}</text>
        <box flexGrow={1} />
        {file && (
          <>
            <text fg={theme.text} bold>{fileName}</text>
            <text fg="#2d8a47"> +{additions}</text>
            <text fg="#c53b53">-{deletions}</text>
          </>
        )}
      </box>

      {/* File list + diff content */}
      <box flexDirection="row" flexGrow={1}>
        {/* File list */}
        <box
          width={DIFF_FILE_PANEL_W}
          style={{
            flexShrink: 0,
            flexDirection: "column",
            border: ["right"],
            borderStyle: "single",
            borderColor: focused && subFocus === "files" ? theme.accent : theme.border,
          }}
        >
          <scrollbox
            ref={fileScrollRef}
            scrollY={scrollEnabled}
            focused={false}
            style={{
              flexGrow: 1,
              rootOptions: { backgroundColor: theme.background, border: false },
              contentOptions: { minHeight: 0 },
              scrollbarOptions: {
                showArrows: false,
                trackOptions: { foregroundColor: theme.textMuted, backgroundColor: theme.background },
              },
            }}
          >
            {files.map((f: ProcessedFile, i: number) => (
              <DiffFileItem
                file={f}
                selected={i === clampedIdx}
                focused={focused && subFocus === "files"}
                width={DIFF_FILE_PANEL_W - 2}
              />
            ))}
          </scrollbox>
        </box>

        {/* Diff content */}
        <box style={{ flexDirection: "column", flexGrow: 1, flexShrink: 1 }}>
          <scrollbox
            ref={diffScrollRef}
            scrollY
            style={{
              flexGrow: 1,
              flexShrink: 1,
              rootOptions: { backgroundColor: theme.background, border: false },
              contentOptions: { minHeight: 0 },
              scrollbarOptions: {
                showArrows: false,
                trackOptions: { foregroundColor: theme.textMuted, backgroundColor: theme.background },
              },
            }}
            focused={false}
          >
            {file && (
              <box style={{ backgroundColor: diffColors.bgPanel }}>
                <diff
                  ref={diffRef}
                  diff={file.rawDiff ?? ""}
                  view={viewMode}
                  fg={diffColors.text}
                  filetype={filetype}
                  syntaxStyle={syntaxTheme}
                  showLineNumbers={true}
                  wrapMode="word"
                  addedBg={diffColors.diffAddedBg}
                  removedBg={diffColors.diffRemovedBg}
                  contextBg={diffColors.diffContextBg}
                  addedContentBg={diffColors.diffAddedBg}
                  removedContentBg={diffColors.diffRemovedBg}
                  contextContentBg={diffColors.diffContextBg}
                  lineNumberFg={diffColors.diffLineNumber}
                  lineNumberBg={diffColors.bgPanel}
                  addedLineNumberBg={diffColors.diffAddedLineNumberBg}
                  removedLineNumberBg={diffColors.diffRemovedLineNumberBg}
                />
              </box>
            )}
          </scrollbox>
          {bottomSlot}
        </box>
      </box>
    </box>
  );
}

// ─── Inline comment form ─────────────────────────────────────────────────────

function InlineCommentForm({ fileName, fileLine, onTextChange, initialValue, isEditing }: {
  fileName: string;
  fileLine?: number;
  onTextChange: (v: string) => void;
  initialValue?: string;
  isEditing?: boolean;
}) {
  const loc = fileLine !== undefined ? `${fileName}:${fileLine}` : fileName;
  return (
    <box
      style={{
        flexShrink: 0,
        minHeight: 8,
        borderStyle: "single",
        borderColor: theme.border,
        margin: 1,
        padding: 1,
        flexDirection: "column",
      }}
    >
      <box flexDirection="row">
        <text fg={theme.textMuted}>{isEditing ? "editing " : "comment on "}</text>
        <text fg={theme.text}>{loc}</text>
      </box>
      <textarea
        placeholder="Write a comment..."
        initialValue={initialValue}
        focused={true}
        onInput={onTextChange}
        style={{ marginTop: 1, minHeight: 3, backgroundColor: theme.backgroundElement }}
      />
      <box flexDirection="row" marginTop={1}>
        <text fg={theme.text}>ctrl+s</text>
        <text fg={theme.textMuted}> {isEditing ? "update" : "submit"}  </text>
        <text fg={theme.text}>esc</text>
        <text fg={theme.textMuted}> cancel</text>
        {isEditing && (
          <>
            <text fg={theme.textMuted}>  </text>
            <text fg="#c53b53">ctrl+d</text>
            <text fg={theme.textMuted}> delete</text>
          </>
        )}
      </box>
    </box>
  );
}

// ─── Model name helpers ──────────────────────────────────────────────────────

function extractModelName(messages: DisplayMessage[]): string | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role === "assistant" && msg.model) return msg.model;
    if (msg.role === "result" && msg.model) return msg.model;
  }
  return undefined;
}

function formatModelName(model: string): string {
  return model.replace(/-\d{8}$/, "");
}

// ─── Chat input ──────────────────────────────────────────────────────────────

function ChatInput({ modelName, isRunning, focused, inputKey, onInput }: {
  modelName: string | undefined;
  isRunning: boolean;
  focused: boolean;
  inputKey: number;
  onInput: (v: string) => void;
}) {
  const displayModel = modelName ? formatModelName(modelName) : "claude";

  return (
    <box
      flexShrink={0}
      style={{
        flexDirection: "column",
        margin: 1,
        marginTop: 0,
      }}
    >
      <box
        style={{
          flexDirection: "column",
          borderStyle: "rounded",
          borderColor: focused ? theme.accent : theme.border,
          backgroundColor: focused ? theme.backgroundElement : theme.background,
        }}
      >
        <textarea
          key={inputKey}
          placeholder={isRunning ? "Agent is working..." : "Message claude..."}
          initialValue=""
          focused={focused}
          onInput={onInput}
          style={{
            minHeight: 1,
            maxHeight: 4,
            paddingLeft: 1,
            paddingRight: 1,
          }}
        />

        {/* Bottom bar: action hints only */}
        <box
          flexDirection="row"
          style={{
            alignItems: "center",
            paddingLeft: 1,
            paddingRight: 1,
          }}
        >
          <box flexGrow={1} />
          {isRunning ? (
            <box flexDirection="row" gap={1}>
              <text fg={theme.warning}>{"\u25CF"} running</text>
              <text fg={theme.textMuted}> </text>
              <text fg={theme.text} bold>^X</text>
              <text fg={theme.textMuted}> stop</text>
            </box>
          ) : (
            <box flexDirection="row" gap={1}>
              <text fg={focused ? theme.accent : theme.textMuted} bold>{"\u21B5"}</text>
              <text fg={theme.textMuted}> send</text>
            </box>
          )}
        </box>
      </box>
      {/* Model name below the input */}
      <box flexDirection="row" paddingLeft={1}>
        <text fg={theme.accent}>{"\u2726"} </text>
        <text fg={theme.textMuted}>{displayModel}</text>
      </box>
    </box>
  );
}

function WelcomeChatInput({ modelName, focused, inputKey, onInput, initialValue }: {
  modelName: string | undefined;
  focused: boolean;
  inputKey: number;
  onInput: (v: string) => void;
  initialValue?: string;
}) {
  const displayModel = modelName ? formatModelName(modelName) : "claude";

  return (
    <box flexGrow={1} justifyContent="center" alignItems="center" flexDirection="column">
      {/* Welcome header */}
      <box flexDirection="column" alignItems="center" marginBottom={2}>
        <text fg={theme.text} bold>What should we work on?</text>
      </box>

      {/* Centered input */}
      <box
        width="80%"
        style={{
          flexDirection: "column",
          borderStyle: "rounded",
          borderColor: focused ? theme.accent : theme.border,
          backgroundColor: focused ? theme.backgroundElement : theme.background,
        }}
      >
        <textarea
          key={inputKey}
          placeholder={"Message claude..."}
          initialValue={initialValue ?? ""}
          focused={focused}
          onInput={onInput}
          style={{
            minHeight: 2,
            maxHeight: 8,
            paddingLeft: 1,
            paddingRight: 1,
          }}
        />

        {/* Bottom bar */}
        <box
          flexDirection="row"
          style={{
            alignItems: "center",
            paddingLeft: 1,
            paddingRight: 1,
          }}
        >
          <box flexGrow={1} />
          <box flexDirection="row" gap={1}>
            <text fg={focused ? theme.accent : theme.textMuted} bold>{"\u21B5"}</text>
            <text fg={theme.textMuted}> send</text>
          </box>
        </box>
      </box>
      {/* Model name below */}
      <box flexDirection="row" justifyContent="center" marginTop={1}>
        <text fg={theme.accent}>{"\u2726"} </text>
        <text fg={theme.textMuted}>{displayModel}</text>
      </box>
    </box>
  );
}

// ─── Action picker overlay ───────────────────────────────────────────────────

function ActionPicker({ entry, options, selected, width }: {
  entry: WorkstreamEntry;
  options: ActionOption[];
  selected: number;
  width: number;
}) {
  const rightPanelW = width - LEFT_PANEL_WIDTH;
  const modalW = Math.min(50, rightPanelW - 4);
  return (
    <box
      style={{
        position: "absolute",
        left: LEFT_PANEL_WIDTH + Math.floor((rightPanelW - modalW) / 2),
        top: 4,
        width: modalW,
        backgroundColor: theme.backgroundPanel,
        borderStyle: "single",
        borderColor: theme.border,
        padding: 1,
        flexDirection: "column",
        zIndex: 10,
      }}
    >
      <text fg={theme.text} bold>Actions</text>
      <box height={1} />
      {options.map((opt, i) => {
        const isSel = i === selected;
        return (
          <box key={i} flexDirection="column">
            <box flexDirection="row">
              <text fg={isSel ? theme.accent : theme.textMuted}>
                {isSel ? "\u276F " : "  "}
              </text>
              <text fg={isSel ? theme.text : theme.textMuted} bold={isSel}>
                {opt.label}
              </text>
            </box>
            <box flexDirection="row">
              <text fg={theme.textMuted}>{"  "}</text>
              <text fg={theme.textMuted}>{opt.description}</text>
            </box>
            <box height={1} />
          </box>
        );
      })}
      <box flexDirection="row">
        <text fg={theme.text}>{"↑↓"}</text>
        <text fg={theme.textMuted}> select  </text>
        <text fg={theme.text}>enter</text>
        <text fg={theme.textMuted}> confirm  </text>
        <text fg={theme.text}>esc</text>
        <text fg={theme.textMuted}> back</text>
      </box>
    </box>
  );
}

// ─── Add workstream modal ─────────────────────────────────────────────────────

function AddWorkstreamModal({ onNameInput, panelLeft, panelWidth }: {
  onNameInput: (v: string) => void;
  panelLeft: number;
  panelWidth: number;
}) {
  const modalW = Math.floor(panelWidth * 0.6);
  const modalLeft = panelLeft + Math.floor((panelWidth - modalW) / 2);
  return (
    <box
      style={{
        position: "absolute",
        left: modalLeft,
        top: 5,
        width: modalW,
        backgroundColor: theme.backgroundPanel,
        borderStyle: "single",
        borderColor: theme.accent,
        padding: 1,
        flexDirection: "column",
        zIndex: 10,
      }}
    >
      <text fg={theme.text} bold>Add workstream</text>
      <box height={1} />

      {/* Name field */}
      <box flexDirection="row" gap={1}>
        <text fg={theme.accent}>{"\u276F"}</text>
        <text fg={theme.textMuted}>Name</text>
      </box>
      <textarea
        placeholder="e.g. add-auth, fix-sidebar"
        initialValue=""
        focused={true}
        onInput={onNameInput}
        style={{
          marginLeft: 2,
          minHeight: 1,
          maxHeight: 1,
          backgroundColor: theme.backgroundElement,
          borderStyle: "single",
          borderColor: theme.accent,
          border: ["bottom"],
        }}
      />
      <box height={1} />

      {/* Footer hints */}
      <box flexDirection="row">
        <text fg={theme.text}>{"\u21B5"}</text>
        <text fg={theme.textMuted}> create  </text>
        <text fg={theme.text}>esc</text>
        <text fg={theme.textMuted}> cancel</text>
      </box>
    </box>
  );
}

// ─── Footer ──────────────────────────────────────────────────────────────────

function Footer({ focusPanel, rightMode, isAgentActive, diffSubFocus, viewMode }: {
  focusPanel: FocusPanel;
  rightMode: RightMode;
  isAgentActive: boolean;
  diffSubFocus: "files" | "diff";
  viewMode: "unified" | "split";
}) {
  const inChatInput = focusPanel === "right" && rightMode === "logs";

  return (
    <box
      style={{
        flexShrink: 0,
        flexDirection: "row",
        alignItems: "center",
        paddingLeft: 1,
        paddingRight: 1,
        backgroundColor: theme.backgroundPanel,
      }}
    >
      <text fg={theme.text}>Tab</text>
      <text fg={theme.textMuted}> panel  </text>
      {focusPanel === "workstreams" ? (
        <>
          <text fg={theme.text}>{"↑↓"}</text>
          <text fg={theme.textMuted}> navigate  </text>
          <text fg={theme.text}>Enter</text>
          <text fg={theme.textMuted}> actions  </text>
        </>
      ) : inChatInput ? (
        <>
          {isAgentActive ? (
            <>
              <text fg={theme.text}>^X</text>
              <text fg={theme.textMuted}> stop  </text>
            </>
          ) : (
            <>
              <text fg={theme.text}>{"\u21B5"}</text>
              <text fg={theme.textMuted}> send  </text>
            </>
          )}
          <text fg={theme.text}>{"↑↓"}</text>
          <text fg={theme.textMuted}> scroll  </text>
        </>
      ) : rightMode === "diff" ? (
        <>
          <text fg={theme.text}>{"↑↓"}</text>
          <text fg={theme.textMuted}> {diffSubFocus === "files" ? "navigate" : "cursor"}  </text>
          {diffSubFocus === "diff" && (
            <>
              <text fg={theme.text}>c</text>
              <text fg={theme.textMuted}> comment  </text>
            </>
          )}
          <text fg={theme.text}>s</text>
          <text fg={theme.textMuted}> {viewMode}  </text>
        </>
      ) : null}
      <text fg={theme.text}>L</text>
      <text fg={theme.textMuted}> logs  </text>
      <text fg={theme.text}>D</text>
      <text fg={theme.textMuted}> diff  </text>
      <text fg={theme.text}>q</text>
      <text fg={theme.textMuted}> quit</text>
    </box>
  );
}

// ─── Main IDE Dashboard ──────────────────────────────────────────────────────

interface IdeDashboardProps {
  entries: WorkstreamEntry[];
  options: IdeDashboardOptions;
  onAction: (action: DashboardAction) => void;
}

function IdeDashboard({ entries: initialEntries, options, onAction }: IdeDashboardProps) {
  const renderer = useRenderer();
  const { width } = useTerminalDimensions();

  // ─── Core state ──────────────────────────────────────────────
  const [entries, setEntries] = React.useState(initialEntries);
  const [selectedIdx, setSelectedIdx] = React.useState(0);
  const [focusPanel, setFocusPanel] = React.useState<FocusPanel>("workstreams");
  const [rightMode, setRightMode] = React.useState<RightMode>("logs");
  const [spinnerFrame, setSpinnerFrame] = React.useState(0);

  // ─── Logs state ──────────────────────────────────────────────
  const [messages, setMessages] = React.useState<DisplayMessage[]>([]);
  const [showThinking, setShowThinking] = React.useState(true);
  const [follow, setFollow] = React.useState(false);
  const logsScrollRef = React.useRef<ScrollBoxRenderable | null>(null);
  const wsListScrollRef = React.useRef<ScrollBoxRenderable | null>(null);

  // ─── Diff state ──────────────────────────────────────────────
  const [diffData, setDiffData] = React.useState<string | null>(null);
  const [diffLoading, setDiffLoading] = React.useState(false);
  const [diffFileIndex, setDiffFileIndex] = React.useState(0);
  const [diffSubFocus, setDiffSubFocus] = React.useState<"files" | "diff">("files");
  const diffScrollRef = React.useRef<ScrollBoxRenderable | null>(null);
  const diffElementRef = React.useRef<DiffRenderable | null>(null);
  const [viewOverride, setViewOverride] = React.useState<"split" | "unified" | null>(null);
  const [cursorLine, setCursorLine] = React.useState(0);

  // ─── Comment state ──────────────────────────────────────────
  const [showCommentForm, setShowCommentForm] = React.useState(false);
  const commentTextRef = React.useRef("");
  const [commentSide, setCommentSide] = React.useState<"old" | "new">("new");
  const [commentFileLine, setCommentFileLine] = React.useState<number | undefined>();
  const [commentLineContent, setCommentLineContent] = React.useState<string | undefined>();
  const commentLineTypeRef = React.useRef<"add" | "remove" | "context" | undefined>();
  const commentDiffContextRef = React.useRef<string | undefined>();
  const [comments, setComments] = React.useState<WorkstreamComments | null>(null);
  const [editingCommentIndex, setEditingCommentIndex] = React.useState<number | null>(null);
  const [flashMessage, setFlashMessage] = React.useState<string | null>(null);

  // ─── Overlay state ───────────────────────────────────────────
  const [showActionPicker, setShowActionPicker] = React.useState(false);
  const [actionPickerOptions, setActionPickerOptions] = React.useState<ActionOption[]>([]);
  const [actionPickerSelected, setActionPickerSelected] = React.useState(0);
  const [showAddModal, setShowAddModal] = React.useState(false);
  const addModalNameRef = React.useRef("");

  // ─── Chat input state ──────────────────────────────────────
  const [chatInputKey, setChatInputKey] = React.useState(0);
  const chatInputValueRef = React.useRef("");

  // ─── Derived ─────────────────────────────────────────────────
  const isAddButtonSelected = selectedIdx === entries.length;
  const selectedEntry = isAddButtonSelected ? undefined : entries[selectedIdx];
  const selectedName = selectedEntry?.name ?? "";
  const selectedStatus = selectedEntry ? options.getWorkstreamStatus(selectedEntry.name) : "ready";
  const hasOverlay = showActionPicker;
  const chatInputFocused = focusPanel === "right" && rightMode === "logs" && !showActionPicker;
  const isAgentActive = selectedEntry?.status === "running" || selectedEntry?.status === "queued";
  const hasMessages = messages.length > 0;
  const isEmptyState = !hasMessages && !isAgentActive;

  // ─── Diff derived state ─────────────────────────────────────
  const diffFiles = React.useMemo(() => {
    if (!diffData) return [] as ProcessedFile[];
    return processFiles(
      parseGitDiffFiles(stripSubmoduleHeaders(diffData), parsePatch),
      formatPatch,
    ) as ProcessedFile[];
  }, [diffData]);

  const clampedDiffIdx = Math.min(diffFileIndex, Math.max(0, diffFiles.length - 1));
  const currentDiffFile = diffFiles[clampedDiffIdx] as ProcessedFile | undefined;
  const currentFileName = currentDiffFile ? getFileName(currentDiffFile).replace(/^[ab]\//, "") : "";

  const lineMap = React.useMemo(
    () => currentDiffFile ? parseDiffToLineMap(currentDiffFile.rawDiff) : [],
    [currentDiffFile],
  );

  const { additions: fileAdditions, deletions: fileDeletions } = currentDiffFile
    ? countChanges(currentDiffFile.hunks)
    : { additions: 0, deletions: 0 };
  const diffPanelW = Math.max(40, width - LEFT_PANEL_WIDTH - DIFF_FILE_PANEL_W);
  const viewMode: "unified" | "split" = viewOverride ?? getViewMode(fileAdditions, fileDeletions, diffPanelW);

  const fileComments = React.useMemo(
    () => comments?.comments.filter((c: ReviewComment) => c.filePath === currentFileName) ?? [],
    [comments, currentFileName],
  );

  const commentedLineIndices = React.useMemo(() => {
    const result = new Set<number>();
    const annotated = fileComments.filter((c: ReviewComment) => c.line !== undefined);
    if (annotated.length === 0) return result;
    lineMap.forEach((info: LineInfo, idx: number) => {
      for (const c of annotated) {
        if (info.type === "add" && info.newLine === c.line && c.side !== "old") result.add(idx);
        else if (info.type === "remove" && info.oldLine === c.line && c.side !== "new") result.add(idx);
        else if (info.type === "context") {
          if (info.newLine === c.line && c.side === "new") result.add(idx);
          else if (info.oldLine === c.line && c.side === "old") result.add(idx);
        }
      }
    });
    return result;
  }, [fileComments, lineMap]);

  // ─── Spinner animation ─────────────────────────────────────
  React.useEffect(() => {
    const hasRunning = entries.some(e => e.status === "running");
    if (!hasRunning) return;
    const id = setInterval(() => setSpinnerFrame(v => (v + 1) % SPIN.length), 80);
    return () => clearInterval(id);
  }, [entries]);

  // ─── Refresh entries periodically ──────────────────────────
  React.useEffect(() => {
    if (!options.onRefresh) return;
    const interval = options.refreshInterval ?? 3000;
    const doRefresh = options.onRefresh;
    const id = setInterval(async () => {
      try {
        const updated = await doRefresh();
        setEntries(prev => {
          // Preserve selection by name
          const prevName = prev[selectedIdx]?.name;
          const newIdx = updated.findIndex(e => e.name === prevName);
          if (newIdx >= 0 && newIdx !== selectedIdx) setSelectedIdx(newIdx);
          return updated;
        });
      } catch {}
    }, interval);
    return () => clearInterval(id);
  }, [options.onRefresh, options.refreshInterval, selectedIdx]);

  // ─── Load log messages when selection changes ──────────────
  React.useEffect(() => {
    if (!selectedEntry) return;
    const logFile = options.getLogFile(selectedEntry.name);
    if (!logFile) { setMessages([]); return; }

    const { readFile, stat } = require("fs/promises");
    const { watch } = require("fs");
    const { resolve } = require("path");
    const filePath = resolve(logFile);
    let lastSize = 0;
    let watcher: any = null;
    let cancelled = false;

    const refresh = async () => {
      if (cancelled) return;
      try {
        const s = await stat(filePath);
        if (s.size === lastSize) return;
        lastSize = s.size;
        const content = await readFile(filePath, "utf-8");
        if (!cancelled) setMessages(parseSessionJsonlContent(content));
      } catch {}
    };

    // Initial read + set up fs.watch (best-effort, unreliable on macOS)
    const go = async () => {
      try {
        await refresh();
        watcher = watch(filePath, { persistent: false }, () => refresh());
      } catch {}
    };
    go();

    // Poll as the primary change-detection mechanism. fs.watch is
    // unreliable on macOS for detecting appends. The stat-size guard
    // in refresh() makes redundant polls cheap (no file read unless
    // the size changed). Also handles the file-not-yet-created case.
    const pollId = setInterval(() => refresh(), 1000);
    setFollow(isAgentActive);

    return () => {
      cancelled = true;
      if (watcher) watcher.close();
      clearInterval(pollId);
    };
  }, [selectedName]);

  // ─── Auto-follow when agent becomes active ─────────────────
  React.useEffect(() => {
    if (isAgentActive) setFollow(true);
  }, [isAgentActive]);

  // ─── Reset state on workstream change ───────────────────────
  React.useEffect(() => {
    setDiffData(null);
    setDiffFileIndex(0);
    setDiffSubFocus("files");
    setViewOverride(null);
    setCursorLine(0);
    setShowCommentForm(false);
    // Pre-populate chat with the workstream's prompt (if any)
    chatInputValueRef.current = selectedEntry?.prompt ?? "";
    setChatInputKey(k => k + 1);
  }, [selectedName]);

  // ─── Reset cursor when diff file changes ───────────────────
  React.useEffect(() => {
    setCursorLine(0);
    diffElementRef.current?.clearAllLineColors();
    setEditingCommentIndex(null);
  }, [diffFileIndex]);

  // ─── Load comments ─────────────────────────────────────────
  const refreshComments = React.useCallback(async () => {
    if (!selectedEntry) return;
    const data = await loadComments(selectedEntry.name);
    setComments(data);
  }, [selectedName]);

  React.useEffect(() => { refreshComments(); }, [refreshComments]);

  // ─── Load diff data on demand ──────────────────────────────
  React.useEffect(() => {
    if (rightMode !== "diff" || !selectedEntry) return;
    if (!selectedEntry.hasWorktree) { setDiffData(null); setDiffLoading(false); return; }

    let cancelled = false;
    setDiffLoading(true);
    options.getDiff(selectedEntry.name).then((data: string) => {
      if (!cancelled) { setDiffData(data); setDiffLoading(false); }
    }).catch(() => {
      if (!cancelled) { setDiffData(null); setDiffLoading(false); }
    });

    return () => { cancelled = true; };
  }, [selectedName, rightMode]);

  // ─── Scroll workstream list to keep selection visible ──────
  const scrollWsIntoView = (idx: number) => {
    const sb = wsListScrollRef.current;
    if (!sb) return;
    const viewportH = sb.viewport.height;
    const itemTop = idx * ITEM_HEIGHT;
    const top = sb.scrollTop;
    if (itemTop < top + 1) sb.scrollTo(Math.max(0, itemTop - 1));
    else if (itemTop + ITEM_HEIGHT >= top + viewportH) sb.scrollTo(itemTop - viewportH + ITEM_HEIGHT + 1);
  };

  // ─── Diff scroll + comment helpers ──────────────────────────
  const scrollCursorIntoView = (line: number) => {
    const sb = diffScrollRef.current;
    if (!sb) return;
    const viewportH = sb.viewport.height;
    const top = sb.scrollTop;
    const bottom = top + viewportH;
    const margin = 2;
    if (line < top + margin) sb.scrollTo(Math.max(0, line - margin));
    else if (line >= bottom - margin) sb.scrollTo(line - viewportH + margin + 1);
  };

  const handleCommentSubmit = async () => {
    const text = commentTextRef.current;
    if (!text.trim()) { setShowCommentForm(false); return; }
    const current = comments ?? { workstream: selectedName, comments: [], updatedAt: new Date().toISOString() };
    let updated: WorkstreamComments;
    if (editingCommentIndex !== null) {
      const updatedList = [...current.comments];
      updatedList[editingCommentIndex] = { ...updatedList[editingCommentIndex], text: text.trim() };
      updated = { ...current, comments: updatedList };
    } else {
      const newComment: ReviewComment = {
        filePath: currentFileName,
        line: commentFileLine,
        side: commentSide,
        lineType: commentLineTypeRef.current,
        lineContent: commentLineContent,
        diffContext: commentDiffContextRef.current,
        text: text.trim(),
        createdAt: new Date().toISOString(),
      };
      updated = { ...current, comments: [...current.comments, newComment] };
    }
    await saveComments(updated);
    await refreshComments();
    setShowCommentForm(false);
    setEditingCommentIndex(null);
    setFlashMessage("\u2714 comment saved");
    setTimeout(() => setFlashMessage(null), 1500);
  };

  const handleCommentDelete = async () => {
    if (editingCommentIndex === null) return;
    const current = comments ?? { workstream: selectedName, comments: [], updatedAt: new Date().toISOString() };
    const updatedList = [...current.comments];
    updatedList.splice(editingCommentIndex, 1);
    await saveComments({ ...current, comments: updatedList });
    await refreshComments();
    setShowCommentForm(false);
    setEditingCommentIndex(null);
    setFlashMessage("\u2714 comment deleted");
    setTimeout(() => setFlashMessage(null), 1500);
  };

  // ─── Keyboard handler ──────────────────────────────────────
  useKeyboard((key: any) => {
    const n = key.name ?? key.sequence ?? "";

    // ─── Add workstream modal mode ──────────────────────
    if (showAddModal) {
      if (n === "escape") { setShowAddModal(false); return; }
      if (n === "return") {
        const wsName = addModalNameRef.current.trim();
        if (!wsName) return;
        if (entries.some(e => e.name === wsName)) return;
        setShowAddModal(false);
        if (options.onCreateWorkstream) {
          options.onCreateWorkstream(wsName).then(async (created) => {
            if (created) {
              setFlashMessage(`\u2714 Created "${wsName}"`);
              setTimeout(() => setFlashMessage(null), 2000);
              // Refresh entries so the new workstream appears in the list
              if (options.onRefresh) {
                const updated = await options.onRefresh();
                setEntries(updated);
                // Select the new workstream
                const newIdx = updated.findIndex(e => e.name === wsName);
                if (newIdx >= 0) setSelectedIdx(newIdx);
              }
            } else {
              setFlashMessage("Failed to create workstream");
              setTimeout(() => setFlashMessage(null), 2000);
            }
          });
        } else {
          onAction({ type: "create-workstream", name: wsName });
        }
        return;
      }
    }
    // ─── Comment form mode ──────────────────────────────
    if (showCommentForm) {
      if (n === "escape") { setShowCommentForm(false); return; }
      if (key.ctrl && n === "s") { handleCommentSubmit(); return; }
      if (key.ctrl && n === "d" && editingCommentIndex !== null) { handleCommentDelete(); return; }
      return; // let textarea handle other keys
    }

    // ─── Action picker mode ────────────────────────────
    if (showActionPicker) {
      if (n === "escape" || n === "q") { setShowActionPicker(false); return; }
      if (n === "j" || n === "down") {
        setActionPickerSelected(v => Math.min(v + 1, actionPickerOptions.length - 1));
        return;
      }
      if (n === "k" || n === "up") {
        setActionPickerSelected(v => Math.max(v - 1, 0));
        return;
      }
      if (n === "return") {
        const opt = actionPickerOptions[actionPickerSelected];
        if (!opt || !selectedEntry) return;
        setShowActionPicker(false);
        // Handle "editor" inline — keep dashboard open, show flash
        if (opt.action === "editor" && options.onOpenEditor) {
          options.onOpenEditor(selectedEntry.name).then((opened) => {
            setFlashMessage(opened ? "\u2714 Editor opened" : "Could not open editor");
            setTimeout(() => setFlashMessage(null), 2000);
          });
          return;
        }
        // Handle "destroy" inline
        if (opt.action === "destroy" && options.onDestroy) {
          const name = selectedEntry.name;
          options.onDestroy(name).then(async (destroyed) => {
            if (destroyed) {
              setFlashMessage(`\u2714 Deleted "${name}"`);
              setTimeout(() => setFlashMessage(null), 2000);
              if (options.onRefresh) {
                const updated = await options.onRefresh();
                setEntries(updated);
                setSelectedIdx(v => Math.min(v, updated.length - 1));
              }
            } else {
              setFlashMessage("Failed to delete workstream");
              setTimeout(() => setFlashMessage(null), 2000);
            }
          });
          return;
        }
        onAction({ type: opt.action, name: selectedEntry.name } as DashboardAction);
        return;
      }
      return;
    }

    // ─── Chat input mode (right panel, logs) ────────────
    // Must be before global keys so printable chars go to textarea
    if (chatInputFocused) {
      if (n === "return") {
        const prompt = chatInputValueRef.current.trim();
        if (prompt && selectedEntry && !isAgentActive) {
          options.onSendPrompt(selectedEntry.name, prompt).then((sent) => {
            if (!sent) {
              setFlashMessage("Agent is busy — try again in a moment");
              setTimeout(() => setFlashMessage(null), 2000);
            }
          });
          chatInputValueRef.current = "";
          setChatInputKey(k => k + 1);
          setFollow(true);
        }
        return;
      }
      if (key.ctrl && n === "x") {
        if (selectedEntry && isAgentActive) {
          options.onInterrupt(selectedEntry.name);
        }
        return;
      }
      if (n === "escape" || (n === "tab" && !key.shift)) {
        setFocusPanel("workstreams");
        return;
      }
      // Scroll logs while in chat input
      if (key.ctrl && n === "d") { logsScrollRef.current?.scrollBy(0.5, "viewport"); return; }
      if (key.ctrl && n === "u") { logsScrollRef.current?.scrollBy(-0.5, "viewport"); return; }
      return; // let textarea handle all other keys
    }

    // ─── Global keys ───────────────────────────────────
    if (n === "q" || (key.ctrl && n === "c")) {
      onAction({ type: "quit" });
      return;
    }

    // Tab switch between panels
    if (n === "tab") {
      if (focusPanel === "workstreams") {
        setFocusPanel("right");
      } else {
        // In diff mode with sub-focus on files, tab goes to diff
        // In diff mode with sub-focus on diff, tab goes to workstreams
        if (rightMode === "diff" && diffSubFocus === "files") {
          setDiffSubFocus("diff");
        } else {
          setFocusPanel("workstreams");
          setDiffSubFocus("files");
        }
      }
      return;
    }

    // Mode switching (works from anywhere except chat input)
    if (n === "1" || (key.shift && n === "l")) { setRightMode("logs"); return; }
    if (n === "2" || (key.shift && n === "d")) { setRightMode("diff"); return; }

    // ─── Left panel (workstreams) ──────────────────────
    if (focusPanel === "workstreams") {
      if (n === "j" || n === "down") {
        setSelectedIdx(v => {
          const next = Math.min(v + 1, entries.length); // entries.length = add button
          scrollWsIntoView(next);
          return next;
        });
        return;
      }
      if (n === "k" || n === "up") {
        setSelectedIdx(v => {
          const prev = Math.max(v - 1, 0);
          scrollWsIntoView(prev);
          return prev;
        });
        return;
      }
      if (key.shift && n === "g") {
        const last = entries.length; // include add button
        setSelectedIdx(last);
        scrollWsIntoView(last);
        return;
      }
      if (n === "g" && !key.shift) {
        setSelectedIdx(0);
        scrollWsIntoView(0);
        return;
      }
      if (n === "return") {
        if (isAddButtonSelected) {
          addModalNameRef.current = "";
          setShowAddModal(true);
          return;
        }
        if (selectedEntry) {
          const opts = buildActionOptions(selectedEntry);
          setActionPickerOptions(opts);
          setActionPickerSelected(0);
          setShowActionPicker(true);
        }
        return;
      }
      // 'a' hotkey — open add modal from anywhere in the list
      if (n === "a") {
        addModalNameRef.current = "";
        setShowAddModal(true);
        return;
      }
      if (n === "right") {
        if (!isAddButtonSelected) setFocusPanel("right");
        return;
      }
      if (n === "escape") {
        onAction({ type: "quit" });
        return;
      }
      return;
    }

    // ─── Right panel ───────────────────────────────────
    // Go back to left panel
    if (n === "h" || n === "left" || n === "escape") {
      if (rightMode === "diff" && diffSubFocus === "diff") {
        setDiffSubFocus("files");
      } else {
        setFocusPanel("workstreams");
      }
      return;
    }

    // ─── Right panel: Diff mode ────────────────────────
    if (rightMode === "diff") {
      // Split/unified toggle (works in both sub-focuses)
      if (n === "s") {
        setViewOverride(viewMode === "split" ? "unified" : "split");
        return;
      }

      if (diffSubFocus === "files") {
        if (n === "j" || n === "down") {
          setDiffFileIndex((v: number) => v + 1); // clamped in DiffPanel
          return;
        }
        if (n === "k" || n === "up") {
          setDiffFileIndex((v: number) => Math.max(v - 1, 0));
          return;
        }
        if (n === "return" || n === "right") {
          setDiffSubFocus("diff");
          return;
        }
        return;
      }

      // Diff sub-focus: diff content — cursor-based navigation
      if (n === "j" || n === "down") {
        const next = Math.min(cursorLine + 1, lineMap.length - 1);
        setCursorLine(next);
        scrollCursorIntoView(next);
        return;
      }
      if (n === "k" || n === "up") {
        const prev = Math.max(cursorLine - 1, 0);
        setCursorLine(prev);
        scrollCursorIntoView(prev);
        return;
      }

      // Comment on current line
      if (n === "c") {
        const info = queryRendererLine(diffElementRef, cursorLine, viewMode);
        if (!info) return;
        const existingIdx = comments?.comments.findIndex(
          c => c.filePath === currentFileName && c.line === info.line && c.side === info.side
        ) ?? -1;
        if (existingIdx >= 0) {
          commentTextRef.current = comments!.comments[existingIdx].text;
          setEditingCommentIndex(existingIdx);
        } else {
          commentTextRef.current = "";
          setEditingCommentIndex(null);
        }
        commentLineTypeRef.current = info.lineType;
        commentDiffContextRef.current = currentDiffFile ? extractDiffContext(currentDiffFile.rawDiff, cursorLine) : undefined;
        setCommentSide(info.side);
        setCommentFileLine(info.line);
        setCommentLineContent(info.lineContent);
        setShowCommentForm(true);
        return;
      }

      const sb = diffScrollRef.current;
      if (key.ctrl && n === "d") { sb?.scrollBy(0.5, "viewport"); return; }
      if (key.ctrl && n === "u") { sb?.scrollBy(-0.5, "viewport"); return; }
      if (key.shift && n === "g") {
        const last = Math.max(0, lineMap.length - 1);
        setCursorLine(last);
        sb?.scrollBy(100_000);
        return;
      }
      if (n === "g" && !key.shift) {
        setCursorLine(0);
        sb?.scrollTo(0);
        return;
      }
      return;
    }
  });

  return (
    <box width="100%" height="100%" backgroundColor={theme.background} flexDirection="column">
      {/* Main split layout */}
      <box flexDirection="row" flexGrow={1} flexShrink={1}>
        {/* Left: Workstream list */}
        <WorkstreamListPanel
          entries={entries}
          selectedIdx={selectedIdx}
          focused={focusPanel === "workstreams"}
          spinnerFrame={spinnerFrame}
          scrollRef={wsListScrollRef}
          scrollEnabled={!hasOverlay}
        />

        {/* Right: Tabs + content */}
        <box flexDirection="column" flexGrow={1} flexShrink={1}>
          <RightPanelTabs
            mode={rightMode}
            onSwitch={setRightMode}
            wsName={selectedName}
            wsStatus={selectedStatus}
          />

          {rightMode === "logs" ? (
            <box flexDirection="column" flexGrow={1} flexShrink={1}>
              {isEmptyState ? (
                <WelcomeChatInput
                  modelName={extractModelName(messages)}
                  focused={chatInputFocused}
                  inputKey={chatInputKey}
                  onInput={(v: string) => { chatInputValueRef.current = v; }}
                  initialValue={selectedEntry?.prompt}
                />
              ) : (
                <>
                  <LogsPanel
                    messages={messages}
                    status={selectedStatus}
                    follow={follow}
                    showThinking={showThinking}
                    scrollRef={logsScrollRef}
                  />
                  {rightMode === "logs" && flashMessage && (
                    <box style={{ flexDirection: "row", flexShrink: 0, paddingLeft: 1 }}>
                      <text fg={theme.warning}>{flashMessage}</text>
                    </box>
                  )}
                  <ChatInput
                    modelName={extractModelName(messages)}
                    isRunning={isAgentActive}
                    focused={chatInputFocused}
                    inputKey={chatInputKey}
                    onInput={(v: string) => { chatInputValueRef.current = v; }}
                  />
                </>
              )}
            </box>
          ) : (
            <DiffPanel
              rawDiff={diffData}
              loading={diffLoading}
              focused={focusPanel === "right"}
              fileIndex={diffFileIndex}
              subFocus={diffSubFocus}
              diffScrollRef={diffScrollRef}
              diffRef={diffElementRef}
              viewMode={viewMode}
              cursorLine={cursorLine}
              commentedLineIndices={commentedLineIndices}
              bottomSlot={
                <>
                  {flashMessage && (
                    <box style={{ flexDirection: "row", paddingBottom: 1, paddingLeft: 1, flexShrink: 0 }}>
                      <text fg="#2d8a47">{flashMessage}</text>
                    </box>
                  )}
                  {showCommentForm && (
                    <InlineCommentForm
                      fileName={currentFileName}
                      fileLine={commentFileLine}
                      onTextChange={(v) => { commentTextRef.current = v; }}
                      initialValue={editingCommentIndex !== null ? comments?.comments[editingCommentIndex]?.text : undefined}
                      isEditing={editingCommentIndex !== null}
                    />
                  )}
                </>
              }
            />
          )}
        </box>
      </box>

      {/* Footer */}
      <Footer focusPanel={focusPanel} rightMode={rightMode} isAgentActive={isAgentActive} diffSubFocus={diffSubFocus} viewMode={viewMode}/>
      {/* Overlays */}
      {showActionPicker && selectedEntry && (
        <ActionPicker
          entry={selectedEntry}
          options={actionPickerOptions}
          selected={actionPickerSelected}
          width={width}
        />
      )}

      {showAddModal && (
        <AddWorkstreamModal
          onNameInput={(v: string) => { addModalNameRef.current = v; }}
          panelLeft={LEFT_PANEL_WIDTH}
          panelWidth={width - LEFT_PANEL_WIDTH}
        />
      )}
    </box>
  );
}

// ─── Entry point ─────────────────────────────────────────────────────────────

export async function openIdeDashboard(
  entries: WorkstreamEntry[],
  options: IdeDashboardOptions,
): Promise<DashboardAction> {
  if (!parsersRegistered) {
    addDefaultParsers(parsersConfig.parsers);
    parsersRegistered = true;
  }

  if (entries.length === 0) {
    console.log("No workstreams found.");
    return { type: "quit" };
  }

  return new Promise<DashboardAction>(async (resolve) => {
    const renderer = await createCliRenderer({
      onDestroy() { resolve({ type: "quit" }); },
      exitOnCtrlC: true,
      useMouse: true,
      enableMouseMovement: true,
    });

    let resolved = false;
    const handleAction = (action: DashboardAction) => {
      if (resolved) return;
      resolved = true;
      renderer.destroy();
      // resolve is called by onDestroy for quit, but for other actions we need to resolve explicitly
      if (action.type !== "quit") {
        resolve(action);
      }
    };

    createRoot(renderer).render(
      <IdeDashboard
        entries={entries}
        options={options}
        onAction={handleAction}
      />
    );
  });
}
