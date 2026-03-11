// OpenCode-style session viewer for workstream agent output.
// Built on @opentuah/core + @opentuah/react with markdown rendering and syntax highlighting.

import "critique/dist/patch-terminal-dimensions.js";

import * as React from "react";
import {
  createCliRenderer,
  addDefaultParsers,
  SyntaxStyle,
  type ScrollBoxRenderable,
} from "@opentuah/core";
import {
  createRoot,
  useKeyboard,
  useTerminalDimensions,
  useRenderer,
} from "@opentuah/react";
import { getResolvedTheme, getSyntaxTheme, rgbaToHex } from "critique/dist/themes.js";
import parsersConfig from "critique/dist/parsers-config.js";
import { createPatch } from "diff";
import path from "path";
import type { DisplayMessage, AssistantPart } from "../core/session-reader.js";
import { parseSessionJsonlContent } from "../core/session-reader.js";

let parsersRegistered = false;

// ─── Theme from critique (OpenCode dark theme) ─────────────────────────────

const resolved = getResolvedTheme("opencode");
const syntaxTheme = SyntaxStyle.fromStyles(getSyntaxTheme("opencode"));

const r = resolved as any;
const theme = {
  background: rgbaToHex(r.background),
  backgroundPanel: rgbaToHex(r.backgroundPanel),
  backgroundElement: "#1e1e1e",
  text: rgbaToHex(r.text),
  textMuted: rgbaToHex(r.textMuted),
  border: "#484848",
  borderActive: "#606060",
  accent: "#9d7cd8",
  primary: rgbaToHex(r.primary),
  error: rgbaToHex(r.error),
  warning: "#f5a742",
  success: rgbaToHex(r.success),
  info: rgbaToHex(r.info),
};

// ─── SplitBorder (OpenCode style: heavy vertical bar) ───────────────────────

const EmptyBorder = {
  topLeft: "", bottomLeft: "", vertical: "", topRight: "", bottomRight: "",
  horizontal: " ", bottomT: "", topT: "", cross: "", leftT: "", rightT: "",
};
const SplitBorderChars = { ...EmptyBorder, vertical: "\u2503" };

// ─── Spinner (braille dots, 80ms) ───────────────────────────────────────────

const SPIN = ["\u280B", "\u2819", "\u2839", "\u2838", "\u283C", "\u2834", "\u2826", "\u2827", "\u2807", "\u280F"];

function Spinner({ color, children }: { color?: string; children?: React.ReactNode }) {
  const [f, setF] = React.useState(0);
  React.useEffect(() => {
    const id = setInterval(() => setF((v: number) => (v + 1) % SPIN.length), 80);
    return () => clearInterval(id);
  }, []);
  const fg = color ?? theme.textMuted;
  return (
    <box flexDirection="row" gap={1}>
      <text fg={fg}>{SPIN[f]}</text>
      {children && <text fg={fg}>{children}</text>}
    </box>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function normPath(p: string): string {
  const cwd = process.cwd();
  if (p.startsWith(cwd + "/")) return p.slice(cwd.length + 1);
  if (p.startsWith(cwd)) return p.slice(cwd.length) || ".";
  const home = process.env.HOME;
  if (home && p.startsWith(home)) return "~" + p.slice(home.length);
  return p;
}

function toolSummary(name: string, input: Record<string, any>): string {
  switch (name) {
    case "Read": case "Write": case "Edit": case "NotebookEdit":
      return normPath(String(input.file_path ?? input.path ?? ""));
    case "Grep": case "Glob": {
      const pat = input.pattern ? `"${input.pattern}"` : "";
      return pat + (input.path ? ` in ${normPath(input.path)}` : "");
    }
    case "Bash": { const c = String(input.command ?? ""); return c.length > 80 ? c.slice(0, 77) + "\u2026" : c; }
    case "Agent": { const d = String(input.prompt ?? input.task ?? input.description ?? ""); return d.length > 60 ? d.slice(0, 57) + "\u2026" : d; }
    case "WebFetch": return String(input.url ?? "");
    case "Skill": return `"${input.name ?? ""}"`;
    case "AskUserQuestion": return String(input.question ?? "").slice(0, 80);
    default:
      for (const v of Object.values(input))
        if (typeof v === "string" && v.length > 0) return v.length > 80 ? v.slice(0, 77) + "\u2026" : v;
      return "";
  }
}

// Icon map — using literal Unicode chars to avoid any escape issues
const ICONS: Record<string, string> = {
  Read: "\u2192",       // →
  Write: "\u2190",      // ←
  Edit: "\u2190",       // ←
  Grep: "\u2731",       // ✱
  Glob: "\u2731",       // ✱
  List: "\u2192",       // →
  WebFetch: "%",
  Bash: "$",
  Agent: "\u2502",      // │
  Skill: "\u2192",      // →
  NotebookEdit: "\u2190", // ←
  AskUserQuestion: "?",
  ToolSearch: "\u2699",  // ⚙
};

const LANG_EXT: Record<string, string> = {
  ".py": "python", ".ts": "typescript", ".tsx": "typescript", ".js": "javascript",
  ".jsx": "javascript", ".rs": "rust", ".go": "go", ".rb": "ruby", ".java": "java",
  ".c": "c", ".cpp": "cpp", ".cs": "csharp", ".php": "php", ".sh": "bash",
  ".bash": "bash", ".json": "json", ".yaml": "yaml", ".yml": "yaml",
  ".html": "html", ".css": "css", ".scala": "scala", ".swift": "swift",
  ".hs": "haskell", ".nix": "nix", ".prisma": "prisma",
};

function detectFiletype(filePath: string): string {
  return LANG_EXT[path.extname(filePath)] ?? "none";
}

function fmtDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  return s < 60 ? `${s.toFixed(1)}s` : `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`;
}

function fmtCost(usd: number): string { return `$${usd.toFixed(2)}`; }
function stripAnsi(s: string): string { return s.replace(/\x1b\[[0-9;]*m/g, ""); }

// ─── InlineTool / BlockTool (matching OpenCode's patterns) ──────────────────

function InlineTool({ icon, children, pending, complete, isSpinner }: {
  icon: string; children: React.ReactNode; pending: string; complete: any; isSpinner?: boolean;
}) {
  if (isSpinner) return <box paddingLeft={3}><Spinner color={theme.text}>{pending}</Spinner></box>;
  const fg = complete ? theme.textMuted : theme.text;
  return (
    <box paddingLeft={3}>
      <text fg={fg}><b>{icon}</b> {children}</text>
    </box>
  );
}

function BlockTool({ title, children, isSpinner }: {
  title: string; children: React.ReactNode; isSpinner?: boolean;
}) {
  return (
    <box border={["left"]} paddingTop={1} paddingBottom={1} paddingLeft={2} marginTop={1} gap={1}
      backgroundColor={theme.backgroundPanel} customBorderChars={SplitBorderChars} borderColor={theme.background}>
      {isSpinner
        ? <Spinner color={theme.textMuted}>{title.replace(/^# /, "")}</Spinner>
        : <text paddingLeft={3} fg={theme.textMuted}>{title}</text>}
      {children}
    </box>
  );
}

// ─── Part renderers ─────────────────────────────────────────────────────────

function ThinkingPartView({ part }: { part: Extract<AssistantPart, { type: "thinking" }> }) {
  const txt = part.text.replace("[REDACTED]", "").trim();
  if (!txt) return null;
  return (
    <box paddingLeft={2} marginTop={1} border={["left"]}
      customBorderChars={SplitBorderChars} borderColor={theme.backgroundElement}>
      <code filetype="markdown" drawUnstyledText={false} streaming={true}
        syntaxStyle={syntaxTheme} content={"_Thinking:_ " + txt.split("\n").slice(0, 5).join("\n")}
        conceal={true} fg={theme.textMuted} />
    </box>
  );
}

function TextPartView({ part }: { part: Extract<AssistantPart, { type: "text" }> }) {
  const txt = part.text.trim();
  if (!txt) return null;
  return (
    <box paddingLeft={3} marginTop={1} flexShrink={0}>
      <code filetype="markdown" drawUnstyledText={false} streaming={true}
        syntaxStyle={syntaxTheme} content={txt} conceal={true} fg={theme.text} />
    </box>
  );
}

// Diff block for Edit tool — auto-switches split/unified based on width
function EditDiff({ fp, ft, diffStr }: { fp: string; ft: string; diffStr: string }) {
  const { width } = useTerminalDimensions();
  const view = width > 120 ? "split" : "unified";
  return (
    <BlockTool title={`\u2190 Edit ${fp}`}>
      <box paddingLeft={1}>
        <diff diff={diffStr} view={view} filetype={ft} syntaxStyle={syntaxTheme}
          showLineNumbers={true} width="100%"
          fg={theme.text}
          addedBg={r.diffAddedBg ? rgbaToHex(r.diffAddedBg) : "#20303b"}
          removedBg={r.diffRemovedBg ? rgbaToHex(r.diffRemovedBg) : "#37222c"}
          contextBg={r.diffContextBg ? rgbaToHex(r.diffContextBg) : theme.backgroundPanel}
          addedSignColor={r.diffHighlightAdded ? rgbaToHex(r.diffHighlightAdded) : "#b8db87"}
          removedSignColor={r.diffHighlightRemoved ? rgbaToHex(r.diffHighlightRemoved) : "#e26a75"}
          lineNumberFg={r.diffLineNumber ? rgbaToHex(r.diffLineNumber) : theme.textMuted}
          lineNumberBg={r.diffContextBg ? rgbaToHex(r.diffContextBg) : theme.backgroundPanel}
          addedLineNumberBg={r.diffAddedLineNumberBg ? rgbaToHex(r.diffAddedLineNumberBg) : "#1b2b34"}
          removedLineNumberBg={r.diffRemovedLineNumberBg ? rgbaToHex(r.diffRemovedLineNumberBg) : "#2d1f26"}
        />
      </box>
    </BlockTool>
  );
}

function ToolPartView({ part, isRunning }: {
  part: Extract<AssistantPart, { type: "tool" }>; isRunning: boolean;
}) {
  const icon = ICONS[part.name] ?? "\u2699";
  const summary = toolSummary(part.name, part.input);
  const done = part.result !== undefined;

  // Bash with output → block
  if (part.name === "Bash" && done) {
    const desc = (part.input.description as string) ?? "Shell";
    const cmd = String(part.input.command ?? "");
    const output = stripAnsi(part.result!).trim();
    const lines = output.split("\n");
    const limited = lines.length > 10 ? lines.slice(0, 10).join("\n") + `\n\u2026 (${lines.length - 10} more lines)` : output;
    return (
      <BlockTool title={`# ${desc}`} isSpinner={isRunning}>
        <box gap={1}>
          <text fg={theme.text}>$ {cmd}</text>
          {output && <text fg={theme.text}>{limited}</text>}
        </box>
      </BlockTool>
    );
  }

  // Write with file content → block showing syntax-highlighted code
  if (part.name === "Write" && done && part.input.content) {
    const fp = normPath(String(part.input.file_path ?? ""));
    const ft = detectFiletype(String(part.input.file_path ?? ""));
    const raw = String(part.input.content);
    const allLines = raw.split("\n");
    const maxLines = 50;
    const content = allLines.length > maxLines
      ? allLines.slice(0, maxLines).join("\n")
      : raw;
    return (
      <BlockTool title={`# Wrote ${fp}`}>
        <code filetype={ft} syntaxStyle={syntaxTheme} content={content}
          conceal={false} fg={theme.text} drawUnstyledText={false} />
        {allLines.length > maxLines && (
          <text fg={theme.textMuted}>{`\u2026 ${allLines.length - maxLines} more lines`}</text>
        )}
      </BlockTool>
    );
  }

  // Write without content → inline
  if (part.name === "Write" && done) {
    return (
      <InlineTool icon={icon} pending="Preparing write..." complete={done}>
        Write {summary}
      </InlineTool>
    );
  }

  // Edit with old_string/new_string → block showing diff
  if (part.name === "Edit" && done && part.input.old_string && part.input.new_string) {
    const fp = normPath(String(part.input.file_path ?? ""));
    const ft = detectFiletype(String(part.input.file_path ?? ""));
    const diffStr = createPatch(fp, part.input.old_string + "\n", part.input.new_string + "\n", "", "");
    return (
      <EditDiff fp={fp} ft={ft} diffStr={diffStr} />
    );
  }

  // TodoWrite → checkbox items
  if (part.name === "TodoWrite" && part.input.todos) {
    const todos = part.input.todos as Array<{ content: string; status: string }>;
    return (
      <BlockTool title="# Todos">
        <box>
          {todos.map((todo: any) => (
            <text fg={todo.status === "completed" ? theme.textMuted : theme.text}>
              {todo.status === "completed" ? "[✓]" : "[ ]"} {todo.content}
            </text>
          ))}
        </box>
      </BlockTool>
    );
  }

  // Edit without diff data (e.g. replace_all or missing strings) → inline
  if (part.name === "Edit" && done) {
    return (
      <InlineTool icon={icon} pending="Preparing edit..." complete={done}>
        Edit {summary}
      </InlineTool>
    );
  }

  // Agent/Task
  if (part.name === "Agent") {
    const desc = String(part.input.description ?? part.input.prompt ?? part.input.task ?? "");
    const trunc = desc.length > 60 ? desc.slice(0, 57) + "\u2026" : desc;
    return (
      <InlineTool icon={icon} pending="Delegating..." complete={done} isSpinner={isRunning}>
        Task {trunc}{done ? "\n\u2514 completed" : ""}
      </InlineTool>
    );
  }

  // All other tools → inline
  const pendingMsg: Record<string, string> = {
    Read: "Reading file...", Grep: "Searching content...", Glob: "Finding files...",
    WebFetch: "Fetching from the web...", Skill: "Loading skill...", Bash: "Writing command...",
    ToolSearch: "Loading tools...",
  };

  return (
    <InlineTool icon={icon} pending={pendingMsg[part.name] ?? `Running ${part.name}...`}
      complete={done} isSpinner={isRunning}>
      {part.name} {summary}
    </InlineTool>
  );
}

// ─── Message renderers ──────────────────────────────────────────────────────

function UserMsg({ msg, isFirst }: {
  msg: Extract<DisplayMessage, { role: "user" }>; isFirst: boolean;
}) {
  return (
    <box border={["left"]} borderColor={theme.accent}
      customBorderChars={SplitBorderChars} marginTop={isFirst ? 0 : 1}>
      <box paddingTop={1} paddingBottom={1} paddingLeft={2}
        backgroundColor={theme.backgroundPanel}>
        <text fg={theme.text}>{msg.text}</text>
      </box>
    </box>
  );
}

function AssistantMsg({ msg, showThinking, isLast }: {
  msg: Extract<DisplayMessage, { role: "assistant" }>; showThinking: boolean; isLast: boolean;
}) {
  const running = isLast && !msg.durationMs;
  return (
    <>
      {msg.parts.map((part: AssistantPart, i: number) => {
        if (part.type === "thinking") return showThinking ? <ThinkingPartView part={part} /> : null;
        if (part.type === "text") return <TextPartView part={part} />;
        if (part.type === "tool") return <ToolPartView part={part} isRunning={running && i === msg.parts.length - 1} />;
        return null;
      })}
      {msg.durationMs && msg.model ? (
        <box paddingLeft={3} marginTop={1}>
          <text fg={theme.textMuted}>
            <span style={{ fg: theme.accent }}>{"\u25A3"} </span>
            <span style={{ fg: theme.text }}><b>Code</b></span>
            <span> {"\u00B7"} {msg.model}</span>
            <span> {"\u00B7"} {fmtDuration(msg.durationMs)}</span>
          </text>
        </box>
      ) : null}
    </>
  );
}

function ResultMsg({ msg }: { msg: Extract<DisplayMessage, { role: "result" }> }) {
  return (
    <box paddingLeft={3} marginTop={1}>
      <text fg={theme.textMuted}>
        <span style={{ fg: theme.accent }}>{"\u25A3"} </span>
        <span style={{ fg: theme.text }}><b>Code</b></span>
        {msg.model && <span> {"\u00B7"} {msg.model}</span>}
        {msg.duration != null && <span> {"\u00B7"} {fmtDuration(msg.duration)}</span>}
        {msg.cost != null && <span style={{ fg: theme.success }}> {"\u00B7"} {fmtCost(msg.cost)}</span>}
      </text>
    </box>
  );
}

// ─── Main SessionApp ────────────────────────────────────────────────────────

function SessionApp({ name, status, messages: init, logFile }: {
  name: string; status: string; messages: DisplayMessage[]; logFile: string;
}) {
  const { width } = useTerminalDimensions();
  const renderer = useRenderer();
  const scrollRef = React.useRef<ScrollBoxRenderable | null>(null);
  const [messages, setMessages] = React.useState(init);
  const [showThinking, setShowThinking] = React.useState(true);
<<<<<<< HEAD
  const [liveStatus, setLiveStatus] = React.useState(status);
  const [follow, setFollow] = React.useState(status === "running");

  // Watch state.json for status changes (e.g. running → success/failed)
  React.useEffect(() => {
    if (status !== "running") return;
    const { watch } = require("fs");
    const { readFile } = require("fs/promises");
    const stateFile = ".workstreams/state.json";
    let watcher: any = null;
    const check = async () => {
      try {
        const data = JSON.parse(await readFile(stateFile, "utf-8"));
        const ws = data?.currentRun?.workstreams?.[name]?.status;
        if (ws && ws !== "running") setLiveStatus(ws);
      } catch {}
    };
    try { watcher = watch(stateFile, { persistent: false }, () => check()); } catch {}
    return () => { if (watcher) watcher.close(); };
  }, [name, status]);

=======
  const [follow, setFollow] = React.useState(status === "running");

>>>>>>> 9f45a854aa3971fb373d3ae689d741c537900c2e
  // Live tailing — re-parse the stream-json log file on changes
  React.useEffect(() => {
    const { watch } = require("fs");
    const { readFile, stat } = require("fs/promises");
    const { resolve } = require("path");
    const filePath = resolve(logFile);
    let lastSize = 0;
    let watcher: any = null;
    const refresh = async () => {
      try {
        const s = await stat(filePath);
        if (s.size === lastSize) return;
        lastSize = s.size;
        setMessages(parseSessionJsonlContent(await readFile(filePath, "utf-8")));
      } catch {}
    };
    const go = async () => {
      try { lastSize = (await stat(filePath)).size; watcher = watch(filePath, { persistent: false }, () => refresh()); }
      catch { const p = setInterval(async () => { try { await stat(filePath); clearInterval(p); go(); } catch {} refresh(); }, 500); }
    };
    go();
    return () => { if (watcher) watcher.close(); };
  }, [logFile]);

  React.useEffect(() => {
    if (follow && scrollRef.current) scrollRef.current.scrollBy(100_000);
  }, [messages, follow]);

  useKeyboard((key: any) => {
    const n = key.name ?? key.sequence ?? "";
    if (n === "q" || n === "escape" || (key.ctrl && n === "c")) { renderer.destroy(); return; }
    if (n === "t") { setShowThinking((v: boolean) => !v); return; }
    if (n === "f") { setFollow((v: boolean) => { if (!v && scrollRef.current) scrollRef.current.scrollBy(100_000); return !v; }); return; }
    if (key.shift && n === "g") { scrollRef.current?.scrollBy(100_000); setFollow(false); }
  });

  let totalCost = 0;
  for (const m of messages) if (m.role === "result" && m.cost) totalCost += m.cost;
<<<<<<< HEAD
  const hasResult = messages.some((m: DisplayMessage) => m.role === "result");
  const isRunning = liveStatus === "running" && !hasResult;
  const lastAst = messages.reduce((a: number, m: DisplayMessage, i: number) => m.role === "assistant" ? i : a, -1);
  const sIcon = isRunning ? "\u25CF" : liveStatus === "success" ? "\u2713" : liveStatus === "failed" ? "\u2717" : "\u25CB";
  const sColor = isRunning ? theme.warning : liveStatus === "success" ? theme.success : liveStatus === "failed" ? theme.error : theme.textMuted;
=======
  const isRunning = status === "running";
  const lastAst = messages.reduce((a: number, m: DisplayMessage, i: number) => m.role === "assistant" ? i : a, -1);
  const sIcon = isRunning ? "\u25CF" : status === "success" ? "\u2713" : status === "failed" ? "\u2717" : "\u25CB";
  const sColor = isRunning ? theme.warning : status === "success" ? theme.success : status === "failed" ? theme.error : theme.textMuted;
>>>>>>> 9f45a854aa3971fb373d3ae689d741c537900c2e

  return (
    <box width="100%" height="100%" backgroundColor={theme.background} flexDirection="column">
      {/* Header */}
      <box flexShrink={0}>
        <box paddingTop={1} paddingBottom={1} paddingLeft={2} paddingRight={1}
          border={["left"]} customBorderChars={SplitBorderChars} borderColor={theme.border}
          backgroundColor={theme.backgroundPanel} flexDirection="row" justifyContent="space-between">
          <text fg={theme.text}><b># {name}</b></text>
          <box flexDirection="row" gap={2} flexShrink={0}>
<<<<<<< HEAD
            <text fg={sColor}>{sIcon} {liveStatus}</text>
=======
            <text fg={sColor}>{sIcon} {status}</text>
>>>>>>> 9f45a854aa3971fb373d3ae689d741c537900c2e
            {follow && <text fg={theme.success}>{"\u25CF"} FOLLOW</text>}
            {totalCost > 0 && <text fg={theme.textMuted}>{fmtCost(totalCost)}</text>}
          </box>
        </box>
      </box>

      {/* Messages */}
      <scrollbox ref={scrollRef} flexGrow={1} paddingLeft={1} paddingRight={1} paddingBottom={2}
        verticalScrollbarOptions={{ trackOptions: { backgroundColor: theme.background, foregroundColor: theme.borderActive } }}>
        <box flexShrink={0} gap={0} paddingBottom={1}>
          {messages.map((msg: DisplayMessage, i: number) => {
            if (msg.role === "user") return <UserMsg msg={msg} isFirst={i === 0} />;
            if (msg.role === "assistant") return <AssistantMsg msg={msg} showThinking={showThinking} isLast={i === lastAst} />;
            if (msg.role === "result") return <ResultMsg msg={msg} />;
            return null;
          })}
          {isRunning && <box paddingLeft={3} marginTop={1}><Spinner color={theme.accent}>Working...</Spinner></box>}
        </box>
      </scrollbox>

      {/* Footer */}
      <box flexShrink={0} flexDirection="row" justifyContent="space-between"
        paddingLeft={2} paddingRight={2} backgroundColor={theme.backgroundPanel}>
<<<<<<< HEAD
        <text fg={theme.textMuted}><span style={{ fg: theme.text }}>esc</span> back</text>
=======
        <box flexDirection="row" gap={2}>
          <text fg={theme.textMuted}><span style={{ fg: theme.text }}>esc</span> back</text>
          <text fg={theme.textMuted}><span style={{ fg: theme.text }}>{"\u2191\u2193"}</span> scroll</text>
          <text fg={theme.textMuted}><span style={{ fg: theme.text }}>G</span> bottom</text>
          <text fg={theme.textMuted}><span style={{ fg: theme.text }}>f</span> follow</text>
          <text fg={theme.textMuted}><span style={{ fg: theme.text }}>t</span> thinking</text>
        </box>
>>>>>>> 9f45a854aa3971fb373d3ae689d741c537900c2e
        <text fg={theme.textMuted}>{messages.length} messages</text>
      </box>
    </box>
  );
}

// ─── Fallback: plain text viewer ────────────────────────────────────────────

function FallbackApp({ name, status, logFile }: { name: string; status: string; logFile: string }) {
  const renderer = useRenderer();
  const scrollRef = React.useRef<ScrollBoxRenderable | null>(null);
  const [lines, setLines] = React.useState<string[]>([]);
  const [follow, setFollow] = React.useState(status === "running");

  React.useEffect(() => {
    const { readFile, stat } = require("fs/promises");
    const { watch } = require("fs");
    const { resolve } = require("path");
    const p = resolve(logFile);
    let lastSize = 0;
    let watcher: any = null;
    const refresh = async () => {
      try { const s = await stat(p); if (s.size === lastSize) return; lastSize = s.size; setLines((await readFile(p, "utf-8")).split("\n")); } catch {}
    };
    refresh();
    const go = async () => {
      try { await stat(p); watcher = watch(p, { persistent: false }, () => refresh()); }
      catch { const t = setInterval(async () => { try { await stat(p); clearInterval(t); go(); } catch {} refresh(); }, 500); }
    };
    go();
    return () => { if (watcher) watcher.close(); };
  }, [logFile]);

  React.useEffect(() => { if (follow && scrollRef.current) scrollRef.current.scrollBy(100_000); }, [lines, follow]);

  useKeyboard((key: any) => {
    const n = key.name ?? key.sequence ?? "";
    if (n === "q" || n === "escape" || (key.ctrl && n === "c")) { renderer.destroy(); return; }
    if (n === "f") { setFollow((v: boolean) => { if (!v && scrollRef.current) scrollRef.current.scrollBy(100_000); return !v; }); }
    if (key.shift && n === "g" && scrollRef.current) { scrollRef.current.scrollBy(100_000); setFollow(false); }
  });

  return (
    <box width="100%" height="100%" backgroundColor={theme.background} flexDirection="column">
      <box flexShrink={0} paddingLeft={2} paddingTop={1} paddingBottom={1} backgroundColor={theme.backgroundPanel}>
        <text fg={theme.text}><b># {name}</b> <span style={{ fg: theme.textMuted }}>({status})</span></text>
      </box>
      <scrollbox ref={scrollRef} flexGrow={1} paddingLeft={2} paddingRight={1}
        verticalScrollbarOptions={{ trackOptions: { backgroundColor: theme.background, foregroundColor: theme.borderActive } }}>
        <box flexShrink={0} paddingBottom={1}>
          {lines.map((line: string) => <text fg={theme.text}>{line}</text>)}
        </box>
      </scrollbox>
      <box flexShrink={0} flexDirection="row" justifyContent="space-between" paddingLeft={2} paddingRight={2} backgroundColor={theme.backgroundPanel}>
<<<<<<< HEAD
        <text fg={theme.textMuted}><span style={{ fg: theme.text }}>esc</span> back</text>
=======
        <box flexDirection="row" gap={2}>
          <text fg={theme.textMuted}><span style={{ fg: theme.text }}>esc</span> back</text>
          <text fg={theme.textMuted}><span style={{ fg: theme.text }}>f</span> follow</text>
        </box>
>>>>>>> 9f45a854aa3971fb373d3ae689d741c537900c2e
        <text fg={theme.textMuted}>{lines.length} lines</text>
      </box>
    </box>
  );
}

// ─── Entry point ────────────────────────────────────────────────────────────

export interface SessionViewerOptions {
  name: string;
  logFile: string;
  status: string;
  sessionId?: string; // kept for compat but not used — we read logFile directly
}

export async function openSessionViewer(options: SessionViewerOptions): Promise<void> {
  if (!parsersRegistered) {
    addDefaultParsers(parsersConfig.parsers);
    parsersRegistered = true;
  }

  const { resolve } = await import("path");
  const logPath = resolve(options.logFile);

<<<<<<< HEAD
  // Try to parse the log file as stream-json.
  // Even if 0 messages parsed initially (file still being written),
  // use the rich viewer if status is running — it will live-tail and re-parse.
  let messages: DisplayMessage[] = [];
  let hasJsonLines = false;
  try {
    const raw = await Bun.file(logPath).text();
    messages = parseSessionJsonlContent(raw);
    // Check if the file contains JSON lines (even if parser returned 0 messages)
    hasJsonLines = raw.split("\n").some(l => { try { JSON.parse(l.trim()); return true; } catch { return false; } });
  } catch { /* file may not exist yet */ }

  const isRich = messages.length > 0 || hasJsonLines || options.status === "running";
=======
  // Try to parse the log file as stream-json
  let messages: DisplayMessage[] = [];
  try {
    const raw = await Bun.file(logPath).text();
    messages = parseSessionJsonlContent(raw);
  } catch { /* file may not exist yet */ }

  const isRich = messages.length > 0;
>>>>>>> 9f45a854aa3971fb373d3ae689d741c537900c2e

  return new Promise<void>(async (resolvePromise) => {
    const renderer = await createCliRenderer({
      onDestroy() { resolvePromise(); },
      exitOnCtrlC: true,
      useMouse: true,
      enableMouseMovement: true,
    });

    if (isRich) {
      createRoot(renderer).render(
        <SessionApp name={options.name} status={options.status}
          messages={messages} logFile={options.logFile} />
      );
    } else {
      // Fallback for non-stream-json logs or empty files
      createRoot(renderer).render(
        <FallbackApp name={options.name} status={options.status}
          logFile={options.logFile} />
      );
    }
  });
}
