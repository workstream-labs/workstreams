import { $ } from "bun";
import { parseDiff, fileStat, type FileDiff } from "./diff-parser.js";

// ─── ANSI helpers ────────────────────────────────────────────────────────────

const ESC = "\x1b";
const CSI = ESC + "[";

const A = {
  reset: CSI + "0m",
  bold: CSI + "1m",
  dim: CSI + "2m",
  italic: CSI + "3m",
  black: CSI + "30m",
  red: CSI + "31m",
  green: CSI + "32m",
  yellow: CSI + "33m",
  blue: CSI + "34m",
  magenta: CSI + "35m",
  cyan: CSI + "36m",
  white: CSI + "37m",
  brightBlack: CSI + "90m",
  brightRed: CSI + "91m",
  brightGreen: CSI + "92m",
  brightYellow: CSI + "93m",
  brightBlue: CSI + "94m",
  brightMagenta: CSI + "95m",
  brightCyan: CSI + "96m",
  brightWhite: CSI + "97m",
  bgBlack: CSI + "40m",
  bgBrightBlack: CSI + "100m",
};

const bg256 = (n: number) => `\x1b[48;5;${n}m`;
const fg256 = (n: number) => `\x1b[38;5;${n}m`;

const C = {
  selectedBg: bg256(24),
  footerBg: bg256(235),
  addLineBg: bg256(22),
  delLineBg: bg256(52),
  hunkBg: bg256(17),
  hunkAt: fg256(67),
  hunkCtx: fg256(110),
  scrollTrack: fg256(240),
};

function moveTo(row: number, col: number) { return `${CSI}${row};${col}H`; }
function clearScreen() { return CSI + "2J" + moveTo(1, 1); }
function hideCursor() { return ESC + "[?25l"; }
function showCursor() { return ESC + "[?25h"; }
function enterAltScreen() { return ESC + "[?1049h"; }
function exitAltScreen() { return ESC + "[?1049l"; }

function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;]*m/g, "");
}

function truncate(s: string, width: number): string {
  if (s.length <= width) return s;
  return s.slice(0, width - 1) + "…";
}

function pad(str: string, width: number): string {
  const len = stripAnsi(str).length;
  if (len >= width) return str;
  return str + " ".repeat(width - len);
}

// ─── Types ───────────────────────────────────────────────────────────────────

export interface WorkstreamEntry {
  name: string;
  branch: string;
  status: string;         // "success", "failed", "running", "pending", or "workspace"
  prompt?: string;
  hasWorktree: boolean;
  ahead: number;
  behind: number;
  lastCommitAge: string;  // "3h ago", "2d ago", etc.
  lastCommitMsg: string;
  filesChanged: number;
  additions: number;
  deletions: number;
}

interface State {
  entries: WorkstreamEntry[];
  selected: number;
  scroll: number;
  diffScroll: number;
  diffLines: string[];
  termW: number;
  termH: number;
  loading: boolean;
}

// ─── Git helpers ─────────────────────────────────────────────────────────────

export async function getBranchInfo(branch: string): Promise<{
  ahead: number;
  behind: number;
  lastCommitAge: string;
  lastCommitMsg: string;
}> {
  const defaults = { ahead: 0, behind: 0, lastCommitAge: "", lastCommitMsg: "" };

  try {
    // Ahead/behind relative to HEAD (main working tree)
    const abResult = await $`git rev-list --left-right --count HEAD...${branch}`.quiet();
    const parts = abResult.stdout.toString().trim().split(/\s+/);
    const behind = parseInt(parts[0], 10) || 0;
    const ahead = parseInt(parts[1], 10) || 0;

    // Last commit message
    const msgResult = await $`git log -1 --format=%s ${branch}`.quiet();
    const lastCommitMsg = msgResult.stdout.toString().trim();

    // Last commit age
    const dateResult = await $`git log -1 --format=%cr ${branch}`.quiet();
    const lastCommitAge = dateResult.stdout.toString().trim();

    return { ahead, behind, lastCommitAge, lastCommitMsg };
  } catch {
    return defaults;
  }
}

export async function getDiffStats(branch: string): Promise<{
  filesChanged: number;
  additions: number;
  deletions: number;
}> {
  try {
    const result = await $`git diff --stat HEAD...${branch}`.quiet();
    const output = result.stdout.toString().trim();
    const lines = output.split("\n");
    if (lines.length === 0) return { filesChanged: 0, additions: 0, deletions: 0 };

    // Last line is summary: " N files changed, X insertions(+), Y deletions(-)"
    const summary = lines[lines.length - 1];
    const filesMatch = summary.match(/(\d+) files? changed/);
    const addMatch = summary.match(/(\d+) insertions?\(\+\)/);
    const delMatch = summary.match(/(\d+) deletions?\(-\)/);

    return {
      filesChanged: filesMatch ? parseInt(filesMatch[1], 10) : 0,
      additions: addMatch ? parseInt(addMatch[1], 10) : 0,
      deletions: delMatch ? parseInt(delMatch[1], 10) : 0,
    };
  } catch {
    return { filesChanged: 0, additions: 0, deletions: 0 };
  }
}

export async function getBranchDiff(branch: string): Promise<string> {
  try {
    const result = await $`git diff HEAD...${branch}`.quiet();
    return result.stdout.toString();
  } catch {
    return "";
  }
}

// ─── Layout ──────────────────────────────────────────────────────────────────

const LIST_PANEL_WIDTH = 50;
const HEADER_ROWS = 2;
const FOOTER_ROWS = 1;

// ─── Status styling ─────────────────────────────────────────────────────────

const STATUS_STYLE: Record<string, { color: string; icon: string }> = {
  success: { color: A.brightGreen, icon: "✓" },
  failed: { color: A.brightRed, icon: "✗" },
  running: { color: A.brightYellow, icon: "●" },
  pending: { color: A.brightBlack, icon: "○" },
  queued: { color: A.cyan, icon: "◉" },
  waiting: { color: A.brightYellow, icon: "⏸" },
  workspace: { color: A.brightBlue, icon: "◇" },
};

// ─── Rendering ───────────────────────────────────────────────────────────────

function renderHeader(s: State): string {
  const title = `${A.bold}${A.brightWhite} ws switch${A.reset}`;
  const count = `${A.brightBlack}${s.entries.length} workstream${s.entries.length !== 1 ? "s" : ""}${A.reset}`;
  const keys = `${A.brightBlack}↑↓ select  │  → preview  │  enter open  │  q quit${A.reset}`;

  const row1 = ` ${title}  ${count}${"  "}${keys} `;

  const listSeg = LIST_PANEL_WIDTH - 1;
  const diffSeg = s.termW - LIST_PANEL_WIDTH;
  const divider =
    A.brightBlack + "─".repeat(listSeg) + "┬" + "─".repeat(diffSeg) + A.reset;

  return moveTo(1, 1) + A.bgBrightBlack + A.brightWhite + pad(row1, s.termW) + A.reset + "\n" + divider;
}

function renderListPanel(s: State): string {
  const contentH = s.termH - HEADER_ROWS - FOOTER_ROWS;
  const panelW = LIST_PANEL_WIDTH - 1;
  let out = "";

  for (let i = 0; i < contentH; i++) {
    const idx = s.scroll + i;
    const entry = s.entries[idx];
    const row = HEADER_ROWS + 1 + i;

    if (!entry) {
      out += moveTo(row, 1) + " ".repeat(panelW) + A.brightBlack + "│" + A.reset;
      continue;
    }

    const selected = idx === s.selected;
    const st = STATUS_STYLE[entry.status] ?? STATUS_STYLE.pending;

    // Build the line content
    const nameStr = truncate(entry.name, panelW - 24);
    const aheadBehind = entry.ahead || entry.behind
      ? `${A.brightGreen}↑${entry.ahead}${A.reset} ${A.brightRed}↓${entry.behind}${A.reset}`
      : `${A.brightBlack}  =${A.reset}`;
    const abVis = entry.ahead || entry.behind
      ? `↑${entry.ahead} ↓${entry.behind}`
      : "  =";
    const age = entry.lastCommitAge
      ? truncate(entry.lastCommitAge, 10)
      : "";

    // Stats
    const stats = entry.filesChanged > 0
      ? `${A.brightGreen}+${entry.additions}${A.reset} ${A.brightRed}-${entry.deletions}${A.reset}`
      : "";
    const statsVis = entry.filesChanged > 0
      ? `+${entry.additions} -${entry.deletions}`
      : "";

    const nameVis = stripAnsi(nameStr);
    const fixedRight = abVis + "  " + age;
    const gap = Math.max(1, panelW - 4 - nameVis.length - fixedRight.length);

    let line: string;
    if (selected) {
      const cursor = `${A.brightCyan}▶${A.reset}`;
      line =
        C.selectedBg + ` ${cursor}${C.selectedBg} ${st.color}${st.icon}${A.reset}` +
        C.selectedBg + A.bold + A.brightWhite + ` ${nameStr}` + A.reset +
        C.selectedBg + " ".repeat(gap) +
        aheadBehind + C.selectedBg + "  " +
        A.brightBlack + age + A.reset;
      const lineVis = ` ▶ ${st.icon} ${nameVis}` + " ".repeat(gap) + fixedRight;
      const trailing = Math.max(0, panelW - lineVis.length);
      line += C.selectedBg + " ".repeat(trailing) + A.reset;
    } else {
      line =
        `  ${st.color}${st.icon}${A.reset}` +
        ` ${A.white}${nameStr}${A.reset}` +
        " ".repeat(gap) +
        aheadBehind + "  " +
        A.brightBlack + age + A.reset;
      const lineVis = `  ${st.icon} ${nameVis}` + " ".repeat(gap) + fixedRight;
      const trailing = Math.max(0, panelW - lineVis.length);
      line += " ".repeat(trailing);
    }

    out += moveTo(row, 1) + line + A.brightBlack + "│" + A.reset;
  }

  return out;
}

function buildDiffPreview(rawDiff: string, panelW: number): string[] {
  if (!rawDiff.trim()) return [A.brightBlack + "  (no changes)" + A.reset];

  const parsed = parseDiff(rawDiff);
  const lines: string[] = [];

  // Summary line
  let totalAdd = 0, totalDel = 0;
  for (const f of parsed.files) {
    const st = fileStat(f);
    totalAdd += st.added;
    totalDel += st.deleted;
  }
  lines.push(
    A.bold + A.brightWhite +
    ` ${parsed.files.length} file${parsed.files.length !== 1 ? "s" : ""} ` +
    A.brightGreen + `+${totalAdd} ` +
    A.brightRed + `-${totalDel}` +
    A.reset
  );
  lines.push("");

  for (const file of parsed.files) {
    const st = fileStat(file);
    const statusIcon = file.status === "A" ? A.brightGreen + "✚" :
                       file.status === "D" ? A.brightRed + "✖" :
                       A.brightYellow + "●";
    lines.push(
      ` ${statusIcon}${A.reset} ${A.bold}${file.path}${A.reset} ` +
      `${A.brightGreen}+${st.added}${A.reset} ${A.brightRed}-${st.deleted}${A.reset}`
    );

    if (file.binary) {
      lines.push(A.brightBlack + "    Binary file" + A.reset);
      continue;
    }

    const contentW = panelW - 4;
    for (const hunk of file.hunks) {
      // Hunk header
      const m = hunk.header.match(/^(@@ [^@]+ @@)(.*)?$/);
      const atPart = m ? m[1] : hunk.header;
      const ctxPart = m ? (m[2] ?? "") : "";
      lines.push(
        C.hunkBg + "  " + C.hunkAt + atPart + A.reset +
        C.hunkBg + C.hunkCtx + ctxPart + A.reset +
        C.hunkBg + " ".repeat(Math.max(0, contentW - stripAnsi(atPart + ctxPart).length)) + A.reset
      );

      for (const dl of hunk.lines) {
        const content = truncate(dl.content, contentW - 2);
        const trail = Math.max(0, contentW - content.length - 1);
        if (dl.type === "add") {
          lines.push(C.addLineBg + A.brightGreen + "  +" + content + " ".repeat(trail) + A.reset);
        } else if (dl.type === "del") {
          lines.push(C.delLineBg + A.brightRed + "  -" + content + " ".repeat(trail) + A.reset);
        } else {
          lines.push(A.dim + "   " + content + A.reset);
        }
      }
    }
    lines.push("");
  }

  return lines;
}

function renderDiffPanel(s: State): string {
  const contentH = s.termH - HEADER_ROWS - FOOTER_ROWS;
  const panelX = LIST_PANEL_WIDTH + 1;
  const panelW = s.termW - LIST_PANEL_WIDTH;
  const innerW = panelW - 1;
  let out = "";

  const entry = s.entries[s.selected];

  if (s.loading) {
    const msg = A.brightBlack + "  Loading diff..." + A.reset;
    out += moveTo(HEADER_ROWS + 1, panelX) + pad(msg, panelW);
    for (let r = 1; r < contentH; r++) {
      out += moveTo(HEADER_ROWS + 1 + r, panelX) + " ".repeat(panelW);
    }
    return out;
  }

  // Header: branch name + stats
  if (entry) {
    const stats = entry.filesChanged > 0
      ? `  ${A.brightGreen}+${entry.additions}${A.reset} ${A.brightRed}-${entry.deletions}${A.reset}  ${A.brightBlack}${entry.filesChanged} file${entry.filesChanged !== 1 ? "s" : ""}${A.reset}`
      : "";
    const header = A.bold + A.brightCyan + ` ${entry.branch}` + A.reset + stats;
    out += moveTo(HEADER_ROWS + 1, panelX) + pad(header, panelW);

    // Second line: last commit
    if (entry.lastCommitMsg) {
      const commitLine = `${A.brightBlack} ${entry.lastCommitAge}  ${A.dim}${truncate(entry.lastCommitMsg, innerW - 20)}${A.reset}`;
      out += moveTo(HEADER_ROWS + 2, panelX) + pad(commitLine, panelW);
    } else {
      out += moveTo(HEADER_ROWS + 2, panelX) + " ".repeat(panelW);
    }

    // Prompt if present
    const promptLine = entry.prompt
      ? `${A.brightBlack} ${truncate(entry.prompt, innerW - 2)}${A.reset}`
      : "";
    out += moveTo(HEADER_ROWS + 3, panelX) + pad(promptLine, panelW);
  }

  // Diff content
  const diffStartRow = HEADER_ROWS + 4;
  const viewH = contentH - 3;
  const visible = s.diffLines.slice(s.diffScroll, s.diffScroll + viewH);

  // Scrollbar
  const total = s.diffLines.length;
  const hasScroll = total > viewH;
  const thumbH = hasScroll ? Math.max(1, Math.round((viewH / total) * viewH)) : viewH;
  const thumbTop = hasScroll && total > viewH
    ? Math.round((s.diffScroll / (total - viewH)) * (viewH - thumbH))
    : 0;

  for (let i = 0; i < viewH; i++) {
    const row = diffStartRow + i;
    out += moveTo(row, panelX);
    if (i < visible.length) {
      const raw = visible[i];
      const vis = stripAnsi(raw);
      const trailing = Math.max(0, innerW - vis.length);
      out += raw + " ".repeat(trailing);
    } else {
      out += " ".repeat(innerW);
    }
    if (hasScroll) {
      const inThumb = i >= thumbTop && i < thumbTop + thumbH;
      out += C.scrollTrack + (inThumb ? "█" : "│") + A.reset;
    } else {
      out += " ";
    }
  }

  return out;
}

function renderFooter(s: State): string {
  const entry = s.entries[s.selected];
  const sep = A.brightBlack + "  │  " + A.brightWhite;

  const items = [
    `${A.brightYellow}↑↓${A.brightWhite} select`,
    `${A.brightYellow}jk${A.brightWhite} scroll diff`,
    `${A.brightYellow}enter${A.brightWhite} open`,
    `${A.brightYellow}q${A.brightWhite} quit`,
  ];

  const help = C.footerBg + A.brightWhite + "  " + items.join(sep) + "  " + A.reset;
  return moveTo(s.termH, 1) + C.footerBg + pad(help, s.termW) + A.reset;
}

function render(s: State): string {
  return (
    hideCursor() +
    clearScreen() +
    renderHeader(s) +
    renderListPanel(s) +
    renderDiffPanel(s) +
    renderFooter(s)
  );
}

// ─── Main ────────────────────────────────────────────────────────────────────

export async function openWorkstreamPicker(
  entries: WorkstreamEntry[],
): Promise<WorkstreamEntry | null> {
  if (entries.length === 0) {
    console.log("No workstreams found.");
    return null;
  }

  // Preload diff for the first entry
  const panelW = (process.stdout.columns ?? 120) - LIST_PANEL_WIDTH - 1;
  let currentDiff = "";
  if (entries[0].hasWorktree) {
    currentDiff = await getBranchDiff(entries[0].branch);
  }

  const state: State = {
    entries,
    selected: 0,
    scroll: 0,
    diffScroll: 0,
    diffLines: buildDiffPreview(currentDiff, panelW),
    termW: process.stdout.columns ?? 120,
    termH: process.stdout.rows ?? 40,
    loading: false,
  };

  const stdin = process.stdin;
  const stdout = process.stdout;

  stdout.write(enterAltScreen() + hideCursor());

  const draw = () => stdout.write(render(state));
  draw();

  const onResize = () => {
    state.termW = process.stdout.columns ?? 120;
    state.termH = process.stdout.rows ?? 40;
    draw();
  };
  process.stdout.on("resize", onResize);

  stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding("utf8");

  const loadDiff = async (idx: number) => {
    const entry = state.entries[idx];
    const pw = state.termW - LIST_PANEL_WIDTH - 1;
    if (entry.hasWorktree) {
      state.loading = true;
      draw();
      const raw = await getBranchDiff(entry.branch);
      state.diffLines = buildDiffPreview(raw, pw);
      state.loading = false;
    } else {
      state.diffLines = [A.brightBlack + "  (no worktree — use enter to create)" + A.reset];
    }
    state.diffScroll = 0;
  };

  return new Promise<WorkstreamEntry | null>((resolve) => {
    const cleanup = (result: WorkstreamEntry | null) => {
      stdin.off("data", onData);
      stdin.setRawMode(false);
      stdin.pause();
      process.stdout.off("resize", onResize);
      stdout.write(showCursor() + exitAltScreen());
      resolve(result);
    };

    const onData = async (key: string) => {
      const contentH = state.termH - HEADER_ROWS - FOOTER_ROWS;
      const maxScroll = Math.max(0, state.entries.length - contentH);
      const diffViewH = contentH - 3;
      const maxDiffScroll = Math.max(0, state.diffLines.length - diffViewH);

      // Quit
      if (key === "q" || key === "\x03" || key === "\x1b") {
        cleanup(null);
        return;
      }

      // Enter — select
      if (key === "\r") {
        cleanup(state.entries[state.selected]);
        return;
      }

      // Up/down — move selection
      if (key === "\x1b[A" || key === "K") { // Up arrow or shift-K
        if (state.selected > 0) {
          state.selected--;
          if (state.selected < state.scroll) state.scroll = state.selected;
          await loadDiff(state.selected);
        }
        draw();
        return;
      }
      if (key === "\x1b[B" || key === "J") { // Down arrow or shift-J
        if (state.selected < state.entries.length - 1) {
          state.selected++;
          if (state.selected >= state.scroll + contentH) state.scroll = state.selected - contentH + 1;
          await loadDiff(state.selected);
        }
        draw();
        return;
      }

      // j/k — scroll diff
      if (key === "j") {
        state.diffScroll = Math.min(state.diffScroll + 1, maxDiffScroll);
        draw();
        return;
      }
      if (key === "k") {
        state.diffScroll = Math.max(state.diffScroll - 1, 0);
        draw();
        return;
      }

      // g/G — top/bottom of diff
      if (key === "g") {
        state.diffScroll = 0;
        draw();
        return;
      }
      if (key === "G") {
        state.diffScroll = maxDiffScroll;
        draw();
        return;
      }

      // d/u — half-page scroll diff
      if (key === "d") {
        state.diffScroll = Math.min(state.diffScroll + Math.floor(diffViewH / 2), maxDiffScroll);
        draw();
        return;
      }
      if (key === "u") {
        state.diffScroll = Math.max(state.diffScroll - Math.floor(diffViewH / 2), 0);
        draw();
        return;
      }
    };

    stdin.on("data", onData);
  });
}
