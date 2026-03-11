// Full-screen log viewer for workstream agent output.
// Supports color-coded log lines, scrolling, and live tailing via fs.watch.

import {
  A, C, bg256, fg256,
  moveTo, clearScreen, hideCursor, showCursor,
  enterAltScreen, exitAltScreen,
  stripAnsi, truncate, pad,
  STATUS_STYLE,
} from "./ansi.js";

// ─── Line classification ─────────────────────────────────────────────────────

type LineType = "assistant" | "tool_call" | "tool_result" | "result" | "system" | "meta" | "plain";

function classifyLine(line: string): LineType {
  const trimmed = line.trimStart();
  if (trimmed.startsWith("[assistant]")) return "assistant";
  if (trimmed.startsWith("[tool_call]")) return "tool_call";
  if (trimmed.startsWith("[tool_result]")) return "tool_result";
  if (trimmed.startsWith("[result]")) return "result";
  if (trimmed.startsWith("[system]")) return "system";
  // Executor meta lines: [ISO timestamp] ...
  if (/^\[[\d\-T:.Z]+\]/.test(trimmed)) return "meta";
  return "plain";
}

const LINE_COLORS: Record<LineType, string> = {
  assistant: A.brightWhite,
  tool_call: A.brightCyan,
  tool_result: A.brightBlack,
  result: A.brightGreen,
  system: A.brightYellow,
  meta: A.brightBlack,
  plain: A.white,
};

const LINE_LABELS: Record<LineType, string> = {
  assistant: `${A.bold}${A.brightWhite}[assistant]${A.reset}`,
  tool_call: `${A.bold}${A.brightCyan}[tool_call]${A.reset}`,
  tool_result: `${A.brightBlack}[tool_result]${A.reset}`,
  result: `${A.bold}${A.brightGreen}[result]${A.reset}`,
  system: `${A.brightYellow}[system]${A.reset}`,
  meta: "",
  plain: "",
};

function colorize(line: string, type: LineType): string {
  const color = LINE_COLORS[type];
  const label = LINE_LABELS[type];

  if (type === "meta" || type === "plain") {
    return `${color}${line}${A.reset}`;
  }

  // Strip the [type] prefix from the line and replace with colored version
  const trimmed = line.trimStart();
  const leadingSpaces = line.length - trimmed.length;
  const prefix = " ".repeat(leadingSpaces);
  const tagEnd = trimmed.indexOf("]") + 1;
  const rest = trimmed.slice(tagEnd);

  return `${prefix}${label}${color}${rest}${A.reset}`;
}

// ─── Word-wrap ───────────────────────────────────────────────────────────────

function wrapLines(lines: string[], width: number): string[] {
  const result: string[] = [];
  for (const line of lines) {
    const plain = stripAnsi(line);
    if (plain.length <= width) {
      result.push(line);
    } else {
      // Simple character-based wrap (respecting ANSI codes is complex; use plain text)
      let pos = 0;
      while (pos < plain.length) {
        const chunk = plain.slice(pos, pos + width);
        // Re-classify and colorize each wrapped chunk based on the original line type
        if (pos === 0) {
          result.push(line.slice(0, findAnsiEnd(line, width)));
        } else {
          const type = classifyLine(lines[lines.indexOf(line)] ?? line);
          result.push(`${LINE_COLORS[type]}  ${chunk}${A.reset}`);
        }
        pos += width;
      }
    }
  }
  return result;
}

// Find the position in an ANSI string that corresponds to `visibleLen` visible characters
function findAnsiEnd(s: string, visibleLen: number): number {
  let visible = 0;
  let i = 0;
  while (i < s.length && visible < visibleLen) {
    if (s[i] === "\x1b") {
      // Skip ANSI escape sequence
      const end = s.indexOf("m", i);
      if (end >= 0) { i = end + 1; continue; }
    }
    visible++;
    i++;
  }
  return i;
}

// ─── Rendering ───────────────────────────────────────────────────────────────

interface ViewState {
  name: string;
  status: string;
  lines: string[];           // raw log lines
  coloredLines: string[];    // color-coded lines
  scrollTop: number;
  follow: boolean;
  termW: number;
  termH: number;
}

function renderView(s: ViewState): string {
  const out: string[] = [];
  out.push(hideCursor());
  out.push(clearScreen());

  const contentH = s.termH - 3; // header (1) + footer (2)

  // ── Header ──
  const st = STATUS_STYLE[s.status] ?? STATUS_STYLE.pending;
  const statusBadge = `${st.color}${st.icon} ${s.status}${A.reset}`;
  const followBadge = s.follow ? `${A.brightGreen}● FOLLOW${A.reset}` : `${A.brightBlack}○ follow${A.reset}`;
  const lineCount = `${A.brightBlack}${s.coloredLines.length} lines${A.reset}`;
  const headerLeft = `${A.bold}${A.brightCyan}ws logs:${A.reset} ${A.bold}${A.white}${s.name}${A.reset}  ${statusBadge}`;
  const headerRight = `${followBadge}  ${lineCount}`;

  // Compute visible widths for alignment
  const headerLeftLen = stripAnsi(headerLeft).length;
  const headerRightLen = stripAnsi(headerRight).length;
  const gap = Math.max(1, s.termW - headerLeftLen - headerRightLen);

  out.push(moveTo(1, 1));
  out.push(`${bg256(235)}${headerLeft}${" ".repeat(gap)}${headerRight}${" ".repeat(Math.max(0, s.termW - headerLeftLen - gap - headerRightLen))}${A.reset}`);

  // ── Content ──
  const maxScroll = Math.max(0, s.coloredLines.length - contentH);
  const top = Math.min(s.scrollTop, maxScroll);

  for (let i = 0; i < contentH; i++) {
    const lineIdx = top + i;
    const row = i + 2; // 1-indexed, after header
    out.push(moveTo(row, 1));
    if (lineIdx < s.coloredLines.length) {
      const line = s.coloredLines[lineIdx];
      const plain = stripAnsi(line);
      if (plain.length > s.termW) {
        out.push(truncate(plain, s.termW));
      } else {
        out.push(line + " ".repeat(Math.max(0, s.termW - plain.length)));
      }
    } else {
      out.push(`${A.brightBlack}~${A.reset}${" ".repeat(s.termW - 1)}`);
    }
  }

  // ── Scrollbar ──
  if (s.coloredLines.length > contentH) {
    const trackH = contentH;
    const thumbH = Math.max(1, Math.round((contentH / s.coloredLines.length) * trackH));
    const thumbPos = Math.round((top / Math.max(1, maxScroll)) * (trackH - thumbH));

    for (let i = 0; i < trackH; i++) {
      const row = i + 2;
      const isThumb = i >= thumbPos && i < thumbPos + thumbH;
      out.push(moveTo(row, s.termW));
      out.push(isThumb ? `${bg256(244)} ${A.reset}` : `${bg256(236)} ${A.reset}`);
    }
  }

  // ── Footer ──
  const footerRow = s.termH - 1;
  const keysLine = [
    `${A.white}esc${A.reset}${A.brightBlack} back${A.reset}`,
    `${A.white}\u2191\u2193${A.reset}${A.brightBlack} scroll${A.reset}`,
    `${A.white}d${A.reset}${A.brightBlack} page down${A.reset}`,
    `${A.white}u${A.reset}${A.brightBlack} page up${A.reset}`,
    `${A.white}g${A.reset}${A.brightBlack} top${A.reset}`,
    `${A.white}G${A.reset}${A.brightBlack} bottom${A.reset}`,
    `${A.white}f${A.reset}${A.brightBlack} follow${A.reset}`,
  ].join("  ");

  out.push(moveTo(footerRow, 1));
  out.push(`${bg256(235)}${" ".repeat(s.termW)}${A.reset}`);
  out.push(moveTo(footerRow, 1));

  // Center the keys line
  const keysLen = stripAnsi(keysLine).length;
  const keysLeft = Math.max(1, Math.floor((s.termW - keysLen) / 2));
  out.push(moveTo(footerRow, keysLeft));
  out.push(`${bg256(235)}${keysLine}${A.reset}`);

  // Position line
  const posRow = s.termH;
  const posText = s.coloredLines.length > 0
    ? `${A.brightBlack}${top + 1}–${Math.min(top + contentH, s.coloredLines.length)} of ${s.coloredLines.length}${A.reset}`
    : `${A.brightBlack}(empty)${A.reset}`;
  out.push(moveTo(posRow, 1));
  out.push(`${bg256(235)}${" ".repeat(s.termW)}${A.reset}`);
  const posLen = stripAnsi(posText).length;
  out.push(moveTo(posRow, s.termW - posLen));
  out.push(`${bg256(235)}${posText}${A.reset}`);

  return out.join("");
}

// ─── Main ────────────────────────────────────────────────────────────────────

export interface LogViewerOptions {
  name: string;
  logFile: string;
  status: string;
}

export async function openLogViewer(options: LogViewerOptions): Promise<void> {
  const { readFile, stat } = await import("fs/promises");
  const { watch } = await import("fs");
  const { resolve } = await import("path");

  const logPath = resolve(options.logFile);

  // Read initial content
  let rawContent = "";
  try {
    rawContent = await readFile(logPath, "utf-8");
  } catch {
    // File may not exist yet
  }

  const rawLines = rawContent ? rawContent.split("\n") : [];

  const state: ViewState = {
    name: options.name,
    status: options.status,
    lines: rawLines,
    coloredLines: rawLines.map(l => colorize(l, classifyLine(l))),
    scrollTop: 0,
    follow: options.status === "running",
    termW: process.stdout.columns ?? 120,
    termH: process.stdout.rows ?? 40,
  };

  // If following, start at the bottom
  if (state.follow) {
    const contentH = state.termH - 3;
    state.scrollTop = Math.max(0, state.coloredLines.length - contentH);
  }

  const stdin = process.stdin;
  const stdout = process.stdout;

  stdout.write(enterAltScreen() + hideCursor());

  const draw = () => stdout.write(renderView(state));
  draw();

  const onResize = () => {
    state.termW = process.stdout.columns ?? 120;
    state.termH = process.stdout.rows ?? 40;
    draw();
  };
  process.stdout.on("resize", onResize);

  // Watch for file changes (live tailing)
  let watcher: ReturnType<typeof watch> | null = null;
  let lastSize = rawContent.length;

  const refreshFromFile = async () => {
    try {
      const content = await readFile(logPath, "utf-8");
      if (content.length === lastSize) return;
      lastSize = content.length;

      const newLines = content.split("\n");
      state.lines = newLines;
      state.coloredLines = newLines.map(l => colorize(l, classifyLine(l)));

      if (state.follow) {
        const contentH = state.termH - 3;
        state.scrollTop = Math.max(0, state.coloredLines.length - contentH);
      }

      draw();
    } catch {
      // File might have been deleted
    }
  };

  try {
    watcher = watch(logPath, { persistent: false }, () => {
      refreshFromFile();
    });
  } catch {
    // File might not exist yet — poll instead
  }

  // If no watcher (file doesn't exist yet), poll periodically
  let pollInterval: ReturnType<typeof setInterval> | null = null;
  if (!watcher && options.status === "running") {
    pollInterval = setInterval(async () => {
      // Try to start watcher if file now exists
      try {
        await stat(logPath);
        if (!watcher) {
          watcher = watch(logPath, { persistent: false }, () => {
            refreshFromFile();
          });
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

  return new Promise<void>((resolve) => {
    let lastGTime = 0;

    const cleanup = () => {
      stdin.off("data", onData);
      stdin.setRawMode(false);
      stdin.pause();
      process.stdout.off("resize", onResize);
      if (watcher) watcher.close();
      if (pollInterval) clearInterval(pollInterval);
      stdout.write(showCursor() + exitAltScreen());
      resolve();
    };

    const contentH = () => state.termH - 3;
    const maxScroll = () => Math.max(0, state.coloredLines.length - contentH());

    const onData = (key: string) => {
      // Quit
      if (key === "q" || key === "\x03" || key === "\x1b") {
        cleanup();
        return;
      }

      // Toggle follow
      if (key === "f") {
        state.follow = !state.follow;
        if (state.follow) {
          state.scrollTop = maxScroll();
        }
        draw();
        return;
      }

      // Scroll down
      if (key === "j" || key === "\x1b[B") {
        state.follow = false;
        state.scrollTop = Math.min(state.scrollTop + 1, maxScroll());
        draw();
        return;
      }

      // Scroll up
      if (key === "k" || key === "\x1b[A") {
        state.follow = false;
        state.scrollTop = Math.max(state.scrollTop - 1, 0);
        draw();
        return;
      }

      // Half-page down (ctrl-d or d)
      if (key === "d" || key === "\x04") {
        state.follow = false;
        state.scrollTop = Math.min(state.scrollTop + Math.floor(contentH() / 2), maxScroll());
        draw();
        return;
      }

      // Half-page up (ctrl-u or u)
      if (key === "u" || key === "\x15") {
        state.follow = false;
        state.scrollTop = Math.max(state.scrollTop - Math.floor(contentH() / 2), 0);
        draw();
        return;
      }

      // Go to bottom (G)
      if (key === "G") {
        state.scrollTop = maxScroll();
        state.follow = false;
        draw();
        return;
      }

      // Go to top (gg)
      if (key === "g") {
        const now = Date.now();
        if (now - lastGTime < 300) {
          state.scrollTop = 0;
          state.follow = false;
          draw();
          lastGTime = 0;
        } else {
          lastGTime = now;
        }
        return;
      }
    };

    stdin.on("data", onData);
  });
}
