// IDE-style dashboard for `ws switch`.
// Left panel: workstream list. Right panel: logs (default) or diff viewer.
// Built on the same @opentuah/core + critique stack as session-viewer and diff-viewer.

import "critique/dist/patch-terminal-dimensions.js";

import * as React from "react";
import {
  createCliRenderer,
  addDefaultParsers,
  type ScrollBoxRenderable,
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
}

interface ActionOption {
  label: string;
  description: string;
  action: DashboardAction["type"] | "set-prompt-input" | "pending-prompt-input";
}

// ─── Action picker options (reused from workstream-picker logic) ─────────────

function buildActionOptions(entry: WorkstreamEntry): ActionOption[] {
  const options: ActionOption[] = [];

  options.push({
    label: "Open in editor",
    description: "Create worktree if needed and open in your editor",
    action: "editor",
  });

  const isActive = entry.status === "running" || entry.status === "queued";
  if (!entry.hasSession && !isActive) {
    options.push({
      label: entry.prompt ? "Edit prompt" : "Set prompt",
      description: entry.prompt
        ? "Modify the workstream prompt in workstream.yaml"
        : "Add a prompt to this workspace in workstream.yaml",
      action: "set-prompt-input",
    });
    if (entry.prompt) {
      options.push({
        label: "Run",
        description: "Run the agent with the configured prompt",
        action: "run",
      });
    }
  }

  if (entry.hasSession && !isActive) {
    options.push({
      label: "Open session",
      description: "Continue in an interactive terminal session",
      action: "open-session",
    });
    options.push({
      label: entry.hasPendingPrompt ? "Edit prompt" : "Set prompt",
      description: "Set instructions to continue with",
      action: "pending-prompt-input",
    });
    if (entry.hasPendingPrompt || entry.commentCount > 0) {
      const pending: string[] = [];
      if (entry.commentCount > 0) pending.push(`${entry.commentCount} comment${entry.commentCount !== 1 ? "s" : ""}`);
      if (entry.hasPendingPrompt) pending.push("prompt");
      options.push({
        label: "Run",
        description: `Send ${pending.join(" + ")} to the agent`,
        action: "run",
      });
    }
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

function WorkstreamListPanel({ entries, selectedIdx, focused, spinnerFrame, scrollRef }: {
  entries: WorkstreamEntry[];
  selectedIdx: number;
  focused: boolean;
  spinnerFrame: number;
  scrollRef: React.RefObject<ScrollBoxRenderable | null>;
}) {
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
        scrollY
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
        {" "}1 Logs{" "}
      </text>
      <text fg={theme.border}> | </text>
      <text
        fg={mode === "diff" ? theme.text : theme.textMuted}
        bold={mode === "diff"}
        backgroundColor={mode === "diff" ? theme.background : undefined}
      >
        {" "}2 Diff{" "}
      </text>
      <box flexGrow={1} />
      <text fg={st.color}>{statusIcon}</text>
      <text fg={theme.text}> <b>{wsName}</b></text>
    </box>
  );
}

// ─── Logs panel (embeds SessionMessages) ─────────────────────────────────────

function LogsPanel({ messages, status, follow, showThinking, scrollRef }: {
  messages: DisplayMessage[];
  status: string;
  follow: boolean;
  showThinking: boolean;
  scrollRef: React.RefObject<ScrollBoxRenderable | null>;
}) {
  const hasResult = messages.some((m: DisplayMessage) => m.role === "result");
  const isRunning = status === "running" && !hasResult;

  // Auto-follow when running
  React.useEffect(() => {
    if (follow && scrollRef.current) scrollRef.current.scrollBy(100_000);
  }, [messages, follow]);

  if (messages.length === 0 && status !== "running") {
    return (
      <box flexGrow={1} justifyContent="center" alignItems="center">
        <box flexDirection="column" alignItems="center" gap={1}>
          <text fg={theme.textMuted}>{"\u25CB"} No logs yet</text>
          <text fg={theme.textMuted}>Run this workstream to see agent output</text>
        </box>
      </box>
    );
  }

  return (
    <scrollbox
      ref={scrollRef}
      flexGrow={1}
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

function DiffPanel({ rawDiff, loading, focused, fileIndex, subFocus, diffScrollRef }: {
  rawDiff: string | null;
  loading: boolean;
  focused: boolean;
  fileIndex: number;
  subFocus: "files" | "diff";
  diffScrollRef: React.RefObject<ScrollBoxRenderable | null>;
}) {
  const { width } = useTerminalDimensions();
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
  const diffPanelW = Math.max(40, width - LEFT_PANEL_WIDTH - DIFF_FILE_PANEL_W);
  const viewMode = getViewMode(additions, deletions, diffPanelW);

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
            scrollY
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
  return (
    <box
      style={{
        position: "absolute",
        left: Math.floor((width - 50) / 2),
        top: 4,
        width: 50,
        backgroundColor: theme.backgroundPanel,
        borderStyle: "single",
        borderColor: theme.border,
        padding: 1,
        flexDirection: "column",
        zIndex: 10,
      }}
    >
      <text fg={theme.text} bold>{entry.name}</text>
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
            <text fg={theme.textMuted} paddingLeft={3}>{opt.description}</text>
            <box height={1} />
          </box>
        );
      })}
      <box flexDirection="row" justifyContent="center">
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

// ─── Prompt input overlay ────────────────────────────────────────────────────

function PromptInput({ title, initialValue, onSubmit, onCancel }: {
  title: string;
  initialValue: string;
  onSubmit: (value: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = React.useState(initialValue);

  return (
    <box
      style={{
        position: "absolute",
        left: "15%",
        top: 5,
        width: "70%",
        backgroundColor: theme.backgroundPanel,
        borderStyle: "single",
        borderColor: theme.accent,
        padding: 1,
        flexDirection: "column",
        zIndex: 10,
      }}
    >
      <text fg={theme.text} bold>{title}</text>
      <textarea
        placeholder="Enter prompt..."
        initialValue={initialValue}
        focused={true}
        onInput={(v: string) => setValue(v)}
        style={{ marginTop: 1, minHeight: 3, backgroundColor: theme.backgroundElement }}
      />
      <box flexDirection="row" marginTop={1}>
        <text fg={theme.text}>ctrl+s</text>
        <text fg={theme.textMuted}> submit  </text>
        <text fg={theme.text}>esc</text>
        <text fg={theme.textMuted}> cancel</text>
      </box>
    </box>
  );
}

// ─── Footer ──────────────────────────────────────────────────────────────────

function Footer({ focusPanel, rightMode }: {
  focusPanel: FocusPanel;
  rightMode: RightMode;
}) {
  return (
    <box
      style={{
        flexShrink: 0,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
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
      ) : rightMode === "logs" ? (
        <>
          <text fg={theme.text}>{"↑↓"}</text>
          <text fg={theme.textMuted}> scroll  </text>
          <text fg={theme.text}>f</text>
          <text fg={theme.textMuted}> follow  </text>
          <text fg={theme.text}>t</text>
          <text fg={theme.textMuted}> thinking  </text>
        </>
      ) : (
        <>
          <text fg={theme.text}>{"↑↓"}</text>
          <text fg={theme.textMuted}> {" navigate"}  </text>
          <text fg={theme.text}>Tab</text>
          <text fg={theme.textMuted}> sub-panel  </text>
        </>
      )}
      <text fg={theme.text}>1</text>
      <text fg={theme.textMuted}> logs  </text>
      <text fg={theme.text}>2</text>
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

  // ─── Overlay state ───────────────────────────────────────────
  const [showActionPicker, setShowActionPicker] = React.useState(false);
  const [actionPickerOptions, setActionPickerOptions] = React.useState<ActionOption[]>([]);
  const [actionPickerSelected, setActionPickerSelected] = React.useState(0);
  const [promptMode, setPromptMode] = React.useState<"set-prompt" | "pending-prompt" | null>(null);
  const promptValueRef = React.useRef("");

  // ─── Derived ─────────────────────────────────────────────────
  const selectedEntry = entries[selectedIdx];
  const selectedName = selectedEntry?.name ?? "";
  const selectedStatus = selectedEntry ? options.getWorkstreamStatus(selectedEntry.name) : "ready";

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
      } catch {
        if (!cancelled) setMessages([]);
      }
    };

    const go = async () => {
      try {
        await stat(filePath);
        await refresh();
        watcher = watch(filePath, { persistent: false }, () => refresh());
      } catch {
        // File doesn't exist yet, poll
        const p = setInterval(async () => {
          if (cancelled) { clearInterval(p); return; }
          try { await stat(filePath); clearInterval(p); go(); } catch {}
        }, 1000);
      }
    };

    go();
    const status = options.getWorkstreamStatus(selectedEntry.name);
    setFollow(status === "running");

    return () => {
      cancelled = true;
      if (watcher) watcher.close();
    };
  }, [selectedName]);

  // ─── Reset diff state on workstream change ──────────────────
  React.useEffect(() => {
    setDiffData(null);
    setDiffFileIndex(0);
    setDiffSubFocus("files");
  }, [selectedName]);

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

  // ─── Keyboard handler ──────────────────────────────────────
  useKeyboard((key: any) => {
    const n = key.name ?? key.sequence ?? "";

    // ─── Prompt input mode ─────────────────────────────
    if (promptMode) {
      if (n === "escape") { setPromptMode(null); return; }
      if (key.ctrl && n === "s") {
        const value = promptValueRef.current.trim();
        if (value && selectedEntry) {
          if (promptMode === "set-prompt") {
            onAction({ type: "set-prompt", name: selectedEntry.name, prompt: value });
          } else {
            onAction({ type: "save-pending-prompt", name: selectedEntry.name, prompt: value });
          }
        }
        setPromptMode(null);
        return;
      }
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
        if (opt.action === "set-prompt-input") {
          promptValueRef.current = selectedEntry.prompt ?? "";
          setPromptMode("set-prompt");
          return;
        }
        if (opt.action === "pending-prompt-input") {
          promptValueRef.current = selectedEntry.pendingPromptText ?? "";
          setPromptMode("pending-prompt");
          return;
        }
        // Actions that leave the dashboard
        onAction({ type: opt.action, name: selectedEntry.name } as DashboardAction);
        return;
      }
      return;
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
        // In logs mode, tab goes to workstreams
        if (rightMode === "diff" && diffSubFocus === "files") {
          setDiffSubFocus("diff");
        } else {
          setFocusPanel("workstreams");
          setDiffSubFocus("files");
        }
      }
      return;
    }

    // Mode switching (works from anywhere)
    if (n === "1") { setRightMode("logs"); return; }
    if (n === "2") { setRightMode("diff"); return; }

    // ─── Left panel (workstreams) ──────────────────────
    if (focusPanel === "workstreams") {
      if (n === "j" || n === "down") {
        setSelectedIdx(v => {
          const next = Math.min(v + 1, entries.length - 1);
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
        const last = entries.length - 1;
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
        if (selectedEntry) {
          const opts = buildActionOptions(selectedEntry);
          setActionPickerOptions(opts);
          setActionPickerSelected(0);
          setShowActionPicker(true);
        }
        return;
      }
      if (n === "l" || n === "right") {
        setFocusPanel("right");
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

    // ─── Right panel: Logs mode ────────────────────────
    if (rightMode === "logs") {
      const sb = logsScrollRef.current;
      if (n === "j" || n === "down") { sb?.scrollBy(1); return; }
      if (n === "k" || n === "up") { sb?.scrollBy(-1); return; }
      if (key.ctrl && n === "d") { sb?.scrollBy(0.5, "viewport"); return; }
      if (key.ctrl && n === "u") { sb?.scrollBy(-0.5, "viewport"); return; }
      if (key.shift && n === "g") { sb?.scrollBy(100_000); setFollow(false); return; }
      if (n === "g" && !key.shift) { sb?.scrollTo(0); setFollow(false); return; }
      if (n === "f") { setFollow(v => { if (!v && sb) sb.scrollBy(100_000); return !v; }); return; }
      if (n === "t") { setShowThinking(v => !v); return; }
      return;
    }

    // ─── Right panel: Diff mode ────────────────────────
    if (rightMode === "diff") {
      if (diffSubFocus === "files") {
        if (n === "j" || n === "down") {
          setDiffFileIndex((v: number) => v + 1); // clamped in DiffPanel
          return;
        }
        if (n === "k" || n === "up") {
          setDiffFileIndex((v: number) => Math.max(v - 1, 0));
          return;
        }
        if (n === "l" || n === "return" || n === "right") {
          setDiffSubFocus("diff");
          return;
        }
        return;
      }

      // Diff sub-focus: diff content
      const sb = diffScrollRef.current;
      if (n === "j" || n === "down") { sb?.scrollBy(1); return; }
      if (n === "k" || n === "up") { sb?.scrollBy(-1); return; }
      if (key.ctrl && n === "d") { sb?.scrollBy(0.5, "viewport"); return; }
      if (key.ctrl && n === "u") { sb?.scrollBy(-0.5, "viewport"); return; }
      if (key.shift && n === "g") { sb?.scrollBy(100_000); return; }
      if (n === "g" && !key.shift) { sb?.scrollTo(0); return; }
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
            <LogsPanel
              messages={messages}
              status={selectedStatus}
              follow={follow}
              showThinking={showThinking}
              scrollRef={logsScrollRef}
            />
          ) : (
            <DiffPanel
              rawDiff={diffData}
              loading={diffLoading}
              focused={focusPanel === "right"}
              fileIndex={diffFileIndex}
              subFocus={diffSubFocus}
              diffScrollRef={diffScrollRef}
            />
          )}
        </box>
      </box>

      {/* Footer */}
      <Footer focusPanel={focusPanel} rightMode={rightMode} />

      {/* Overlays */}
      {showActionPicker && selectedEntry && (
        <ActionPicker
          entry={selectedEntry}
          options={actionPickerOptions}
          selected={actionPickerSelected}
          width={width}
        />
      )}

      {promptMode && selectedEntry && (
        <PromptInput
          title={promptMode === "set-prompt" ? "Set prompt" : "Set continuation prompt"}
          initialValue={promptValueRef.current}
          onSubmit={(v) => {
            if (promptMode === "set-prompt") {
              onAction({ type: "set-prompt", name: selectedEntry.name, prompt: v });
            } else {
              onAction({ type: "save-pending-prompt", name: selectedEntry.name, prompt: v });
            }
            setPromptMode(null);
          }}
          onCancel={() => setPromptMode(null)}
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
