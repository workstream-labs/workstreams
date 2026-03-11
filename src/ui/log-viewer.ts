// OpenCode-style session viewer for workstream agent output.
// Renders Claude Code JSONL sessions as a rich, structured scrollable TUI.
// Falls back to colored text log viewing when JSONL is unavailable.

import {
  A, bg256, fg256,
  moveTo, clearScreen, hideCursor, showCursor,
  enterAltScreen, exitAltScreen,
  stripAnsi, truncate, pad,
  STATUS_STYLE,
} from "./ansi.js";
import type { DisplayMessage, AssistantPart } from "../core/session-reader.js";
import { findSessionJsonl, parseSessionJsonl, parseSessionJsonlContent } from "../core/session-reader.js";

// ─── Theme & constants ──────────────────────────────────────────────────────

const T = {
  userBorder: A.brightCyan, text: A.white, textBold: A.bold + A.brightWhite,
  textMuted: A.brightBlack, thinkingBorder: fg256(239),
  thinkingText: A.dim + A.italic, toolIcon: fg256(245), toolText: fg256(245),
  panelBorder: fg256(239), resultIcon: A.brightCyan,
  errorText: A.brightRed, costText: A.brightGreen,
};

const TOOL_ICON: Record<string, string> = {
  Read: "\u2192", Write: "\u2190", Edit: "\u2190", Grep: "\u2731", Glob: "\u2731",
  List: "\u2192", WebFetch: "%", Bash: "$", Agent: "\u2502", Skill: "\u2192",
  NotebookEdit: "\u2190", AskUserQuestion: "?",
};

// ─── Helpers ────────────────────────────────────────────────────────────────

function wrapText(text: string, maxWidth: number): string[] {
  if (maxWidth <= 0) return [text];
  const result: string[] = [];
  for (const rawLine of text.split("\n")) {
    if (rawLine.length <= maxWidth) { result.push(rawLine); continue; }
    const words = rawLine.split(" ");
    let cur = "";
    for (const w of words) {
      if (!cur) cur = w;
      else if (cur.length + 1 + w.length <= maxWidth) cur += " " + w;
      else { result.push(cur); cur = w; }
    }
    if (cur) result.push(cur);
  }
  return result.length > 0 ? result : [""];
}

function normalizePath(p: string): string {
  const cwd = process.cwd();
  return p.startsWith(cwd + "/") ? p.slice(cwd.length + 1) : p.startsWith(cwd) ? p.slice(cwd.length) : p;
}

function toolArgSummary(name: string, input: Record<string, any>): string {
  switch (name) {
    case "Read": case "Write": case "Edit": case "NotebookEdit":
      return normalizePath(String(input.file_path ?? input.path ?? ""));
    case "Grep": case "Glob": {
      const pat = input.pattern ? `"${input.pattern}"` : "";
      return pat + (input.path ? ` in ${normalizePath(input.path)}` : "");
    }
    case "Bash": { const c = String(input.command ?? ""); return c.length > 80 ? c.slice(0, 77) + "..." : c; }
    case "Agent": { const d = String(input.prompt ?? input.task ?? ""); return `Task "${d.length > 60 ? d.slice(0, 57) + "..." : d}"`; }
    case "AskUserQuestion": return String(input.question ?? "").slice(0, 80);
    default:
      for (const v of Object.values(input)) if (typeof v === "string") return v.length > 80 ? v.slice(0, 77) + "..." : v;
      return "";
  }
}

/** Truncate a string with ANSI codes to a visible width. */
function truncateAnsi(s: string, maxVisible: number): string {
  let visible = 0, i = 0;
  while (i < s.length && visible < maxVisible) {
    if (s[i] === "\x1b") { const end = s.indexOf("m", i); if (end >= 0) { i = end + 1; continue; } }
    visible++; i++;
  }
  return s.slice(0, i) + A.reset;
}

// ─── Fallback line classification ───────────────────────────────────────────

const FALLBACK_COLORS: Record<string, string> = {
  assistant: A.brightWhite, tool_call: A.brightCyan, tool_result: A.brightBlack,
  result: A.brightGreen, system: A.brightYellow, meta: A.brightBlack, plain: A.white,
};

function colorizeFallbackLine(line: string): string {
  const t = line.trimStart();
  const type = t.startsWith("[assistant]") ? "assistant" : t.startsWith("[tool_call]") ? "tool_call"
    : t.startsWith("[tool_result]") ? "tool_result" : t.startsWith("[result]") ? "result"
    : t.startsWith("[system]") ? "system" : /^\[[\d\-T:.Z]+\]/.test(t) ? "meta" : "plain";
  return `${FALLBACK_COLORS[type]}${line}${A.reset}`;
}

// ─── Rich view: render DisplayMessage[] to string[] ─────────────────────────

function renderMessages(messages: DisplayMessage[], termW: number, showThinking: boolean): string[] {
  const lines: string[] = [];
  const mw = Math.max(20, termW - 6);
  let prev: string | null = null;

  for (const msg of messages) {
    if (msg.role === "user") {
      lines.push("");
      for (const wl of wrapText(msg.text, mw))
        lines.push(`  ${T.userBorder}\u2502${A.reset} ${T.text}${wl}${A.reset}`);
      prev = "user";
    } else if (msg.role === "assistant") {
      for (const part of msg.parts) {
        if (part.type === "thinking") {
          if (!showThinking) continue;
          lines.push("");
          lines.push(`  ${T.thinkingBorder}\u2502${A.reset} ${T.thinkingText}Thinking...${A.reset}`);
          for (const tl of part.text.split("\n").slice(0, 3))
            for (const wl of wrapText(tl, mw))
              lines.push(`  ${T.thinkingBorder}\u2502${A.reset} ${T.thinkingText}${wl}${A.reset}`);
          prev = "thinking";
        } else if (part.type === "text") {
          if (prev !== "text") lines.push("");
          for (const wl of wrapText(part.text, mw))
            lines.push(`   ${T.text}${wl}${A.reset}`);
          prev = "text";
        } else if (part.type === "tool") {
          const icon = TOOL_ICON[part.name] ?? "\u2699";
          const arg = toolArgSummary(part.name, part.input);
          if (part.name === "Bash" && part.result !== undefined) {
            // Block format for Bash with result
            lines.push("");
            const desc = part.input.description as string | undefined;
            if (desc) lines.push(`  ${T.panelBorder}\u2502${A.reset} ${T.textMuted}# ${desc}${A.reset}`);
            const cw = wrapText(String(part.input.command ?? ""), mw - 2);
            for (let ci = 0; ci < cw.length; ci++)
              lines.push(`  ${T.panelBorder}\u2502${A.reset} ${T.text}${ci === 0 ? "$ " : "  "}${cw[ci]}${A.reset}`);
            const clean = stripAnsi(part.result);
            const ol = clean.split("\n");
            for (const o of ol.slice(0, 10)) {
              const tr = o.length > mw ? o.slice(0, mw - 3) + "..." : o;
              lines.push(`  ${T.panelBorder}\u2502${A.reset} ${T.textMuted}${tr}${A.reset}`);
            }
            if (ol.length > 10)
              lines.push(`  ${T.panelBorder}\u2502${A.reset} ${T.textMuted}... (${ol.length - 10} more lines)${A.reset}`);
            prev = "tool_block";
          } else {
            lines.push(`   ${T.toolIcon}${icon}${A.reset} ${T.toolText}${part.name} ${arg}${A.reset}`);
            prev = "tool_inline";
          }
        }
      }
      if (msg.durationMs) {
        lines.push("");
        lines.push(`   ${T.resultIcon}\u25A3${A.reset} ${T.textMuted}${msg.model ?? ""}${A.reset} ${T.textMuted}\u00B7 ${(msg.durationMs / 1000).toFixed(1)}s${A.reset}`);
        prev = "result";
      }
    } else if (msg.role === "result") {
      lines.push("");
      const p: string[] = [`${T.resultIcon}\u25A3${A.reset}`, `${T.textBold}Code${A.reset}`];
      if (msg.model) p.push(`${T.textMuted}\u00B7 ${msg.model}${A.reset}`);
      if (msg.duration) p.push(`${T.textMuted}\u00B7 ${(msg.duration / 1000).toFixed(1)}s${A.reset}`);
      if (msg.cost) p.push(`${T.costText}\u00B7 $${msg.cost.toFixed(2)}${A.reset}`);
      lines.push(`   ${p.join(" ")}`);
      prev = "result";
    }
  }
  return lines;
}

// ─── View state & rendering ─────────────────────────────────────────────────

interface ViewState {
  name: string; status: string; lines: string[]; scrollTop: number;
  follow: boolean; showThinking: boolean; termW: number; termH: number;
  isRichView: boolean; messages?: DisplayMessage[]; rawLines?: string[];
}

function rebuildLines(s: ViewState): void {
  if (s.isRichView && s.messages) s.lines = renderMessages(s.messages, s.termW, s.showThinking);
  else if (s.rawLines) s.lines = s.rawLines.map(colorizeFallbackLine);
  else s.lines = [];
}

function renderView(s: ViewState): string {
  const out: string[] = [hideCursor(), clearScreen()];
  const contentH = s.termH - 3;

  // Header
  const st = STATUS_STYLE[s.status] ?? STATUS_STYLE.pending;
  const statusBadge = `${st.color}${st.icon} ${s.status}${A.reset}`;
  const followBadge = s.follow ? `${A.brightGreen}\u25CF FOLLOW${A.reset}` : `${A.brightBlack}\u25CB follow${A.reset}`;
  const headerLeft = `${A.bold}${A.brightCyan}ws logs:${A.reset} ${A.bold}${A.white}${s.name}${A.reset}  ${statusBadge}`;
  const headerRight = `${A.brightBlack}${s.isRichView ? "rich" : "text"}${A.reset}  ${followBadge}  ${A.brightBlack}${s.lines.length} lines${A.reset}`;
  const hlLen = stripAnsi(headerLeft).length, hrLen = stripAnsi(headerRight).length;
  const gap = Math.max(1, s.termW - hlLen - hrLen);
  out.push(moveTo(1, 1));
  out.push(`${bg256(235)}${headerLeft}${" ".repeat(gap)}${headerRight}${" ".repeat(Math.max(0, s.termW - hlLen - gap - hrLen))}${A.reset}`);

  // Content
  const maxScroll = Math.max(0, s.lines.length - contentH);
  const top = Math.min(s.scrollTop, maxScroll);
  for (let i = 0; i < contentH; i++) {
    const li = top + i;
    out.push(moveTo(i + 2, 1));
    if (li < s.lines.length) {
      const line = s.lines[li], plain = stripAnsi(line);
      out.push(plain.length > s.termW ? truncateAnsi(line, s.termW) : line + " ".repeat(Math.max(0, s.termW - plain.length)));
    } else {
      out.push(`${A.brightBlack}~${A.reset}${" ".repeat(s.termW - 1)}`);
    }
  }

  // Scrollbar
  if (s.lines.length > contentH) {
    const thumbH = Math.max(1, Math.round((contentH / s.lines.length) * contentH));
    const thumbPos = Math.round((top / Math.max(1, maxScroll)) * (contentH - thumbH));
    for (let i = 0; i < contentH; i++) {
      out.push(moveTo(i + 2, s.termW));
      out.push((i >= thumbPos && i < thumbPos + thumbH) ? `${bg256(244)} ${A.reset}` : `${bg256(236)} ${A.reset}`);
    }
  }

  // Footer: key hints
  const ki = [
    `${A.white}esc${A.reset}${A.brightBlack} back${A.reset}`,
    `${A.white}\u2191\u2193${A.reset}${A.brightBlack} scroll${A.reset}`,
    `${A.white}d${A.reset}${A.brightBlack} page down${A.reset}`,
    `${A.white}u${A.reset}${A.brightBlack} page up${A.reset}`,
    `${A.white}g${A.reset}${A.brightBlack} top${A.reset}`,
    `${A.white}G${A.reset}${A.brightBlack} bottom${A.reset}`,
    `${A.white}f${A.reset}${A.brightBlack} follow${A.reset}`,
  ];
  if (s.isRichView) ki.push(`${A.white}t${A.reset}${A.brightBlack} thinking${A.reset}`);
  const keysLine = ki.join("  ");
  out.push(moveTo(s.termH - 1, 1));
  out.push(`${bg256(235)}${" ".repeat(s.termW)}${A.reset}`);
  out.push(moveTo(s.termH - 1, Math.max(1, Math.floor((s.termW - stripAnsi(keysLine).length) / 2))));
  out.push(`${bg256(235)}${keysLine}${A.reset}`);

  // Footer: position
  const posText = s.lines.length > 0
    ? `${A.brightBlack}${top + 1}\u2013${Math.min(top + contentH, s.lines.length)} of ${s.lines.length}${A.reset}`
    : `${A.brightBlack}(empty)${A.reset}`;
  out.push(moveTo(s.termH, 1));
  out.push(`${bg256(235)}${" ".repeat(s.termW)}${A.reset}`);
  out.push(moveTo(s.termH, s.termW - stripAnsi(posText).length));
  out.push(`${bg256(235)}${posText}${A.reset}`);

  return out.join("");
}

// ─── Main ───────────────────────────────────────────────────────────────────

export interface LogViewerOptions {
  name: string;
  logFile: string;
  status: string;
  sessionId?: string;
}

export async function openLogViewer(options: LogViewerOptions): Promise<void> {
  const { readFile, stat } = await import("fs/promises");
  const { watch } = await import("fs");
  const { resolve } = await import("path");

  const logPath = resolve(options.logFile);

  // Try rich view (JSONL)
  let jsonlPath: string | null = null;
  let messages: DisplayMessage[] | undefined;
  if (options.sessionId) {
    jsonlPath = await findSessionJsonl(options.sessionId);
    if (jsonlPath) {
      try { messages = await parseSessionJsonl(jsonlPath); }
      catch { jsonlPath = null; }
    }
  }
  const isRichView = !!messages && messages.length > 0;

  // Fallback: read text log
  let rawLines: string[] = [];
  if (!isRichView) {
    try { rawLines = (await readFile(logPath, "utf-8")).split("\n"); }
    catch { /* file may not exist yet */ }
  }

  const state: ViewState = {
    name: options.name, status: options.status, lines: [], scrollTop: 0,
    follow: options.status === "running", showThinking: false,
    termW: process.stdout.columns ?? 120, termH: process.stdout.rows ?? 40,
    isRichView, messages: isRichView ? messages : undefined,
    rawLines: isRichView ? undefined : rawLines,
  };
  rebuildLines(state);
  if (state.follow) state.scrollTop = Math.max(0, state.lines.length - (state.termH - 3));

  const stdin = process.stdin, stdout = process.stdout;
  stdout.write(enterAltScreen() + hideCursor());
  const draw = () => stdout.write(renderView(state));
  draw();

  const onResize = () => {
    state.termW = process.stdout.columns ?? 120;
    state.termH = process.stdout.rows ?? 40;
    rebuildLines(state); draw();
  };
  stdout.on("resize", onResize);

  // Live tailing
  let watcher: ReturnType<typeof watch> | null = null;
  let lastSize = 0;
  const watchTarget = isRichView && jsonlPath ? jsonlPath : logPath;

  const refreshFromFile = async () => {
    try {
      const fs = await stat(watchTarget);
      if (fs.size === lastSize) return;
      lastSize = fs.size;
      if (state.isRichView && jsonlPath) {
        state.messages = parseSessionJsonlContent(await readFile(jsonlPath, "utf-8"));
      } else {
        state.rawLines = (await readFile(logPath, "utf-8")).split("\n");
      }
      rebuildLines(state);
      if (state.follow) state.scrollTop = Math.max(0, state.lines.length - (state.termH - 3));
      draw();
    } catch { /* file may not exist */ }
  };

  try {
    lastSize = (await stat(watchTarget)).size;
    watcher = watch(watchTarget, { persistent: false }, () => { refreshFromFile(); });
  } catch { /* file might not exist yet */ }

  let pollInterval: ReturnType<typeof setInterval> | null = null;
  if (!watcher && options.status === "running") {
    pollInterval = setInterval(async () => {
      try {
        await stat(watchTarget);
        if (!watcher) {
          lastSize = (await stat(watchTarget)).size;
          watcher = watch(watchTarget, { persistent: false }, () => { refreshFromFile(); });
          if (pollInterval) clearInterval(pollInterval);
          pollInterval = null;
        }
      } catch {}
      refreshFromFile();
    }, 500);
  }

  stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding("utf8");

  return new Promise<void>((resolvePromise) => {
    let lastGTime = 0;
    const contentH = () => state.termH - 3;
    const maxScroll = () => Math.max(0, state.lines.length - contentH());

    const cleanup = () => {
      stdin.off("data", onData);
      stdin.setRawMode(false);
      stdin.pause();
      stdout.off("resize", onResize);
      if (watcher) watcher.close();
      if (pollInterval) clearInterval(pollInterval);
      stdout.write(showCursor() + exitAltScreen());
      resolvePromise();
    };

    const onData = (key: string) => {
      if (key === "q" || key === "\x03" || key === "\x1b") { cleanup(); return; }
      if (key === "f") { state.follow = !state.follow; if (state.follow) state.scrollTop = maxScroll(); draw(); return; }
      if (key === "t" && state.isRichView) {
        state.showThinking = !state.showThinking; rebuildLines(state);
        state.scrollTop = Math.min(state.scrollTop, maxScroll());
        if (state.follow) state.scrollTop = maxScroll(); draw(); return;
      }
      if (key === "j" || key === "\x1b[B") { state.follow = false; state.scrollTop = Math.min(state.scrollTop + 1, maxScroll()); draw(); return; }
      if (key === "k" || key === "\x1b[A") { state.follow = false; state.scrollTop = Math.max(state.scrollTop - 1, 0); draw(); return; }
      if (key === "d" || key === "\x04") { state.follow = false; state.scrollTop = Math.min(state.scrollTop + Math.floor(contentH() / 2), maxScroll()); draw(); return; }
      if (key === "u" || key === "\x15") { state.follow = false; state.scrollTop = Math.max(state.scrollTop - Math.floor(contentH() / 2), 0); draw(); return; }
      if (key === "G") { state.scrollTop = maxScroll(); state.follow = false; draw(); return; }
      if (key === "g") {
        const now = Date.now();
        if (now - lastGTime < 300) { state.scrollTop = 0; state.follow = false; draw(); lastGTime = 0; }
        else lastGTime = now;
      }
    };
    stdin.on("data", onData);
  });
}
