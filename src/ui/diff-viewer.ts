import { parseDiff, fileStat, type FileDiff, type DiffLine } from "./diff-parser.js";

// ─── ANSI helpers ────────────────────────────────────────────────────────────

const ESC = "\x1b";
const CSI = ESC + "[";

const A = {
  reset: CSI + "0m",
  bold: CSI + "1m",
  dim: CSI + "2m",
  // fg
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
  // bg
  bgRed: CSI + "41m",
  bgGreen: CSI + "42m",
  bgBlue: CSI + "44m",
  bgBrightBlack: CSI + "100m",
  bgBlack: CSI + "40m",
  bgWhite: CSI + "47m",
};

function moveTo(row: number, col: number) {
  return `${CSI}${row};${col}H`;
}
function clearScreen() {
  return CSI + "2J" + moveTo(1, 1);
}
function hideCursor() {
  return ESC + "[?25l";
}
function showCursor() {
  return ESC + "[?25h";
}
function enterAltScreen() {
  return ESC + "[?1049h";
}
function exitAltScreen() {
  return ESC + "[?1049l";
}

/** Pad string to at least `width` visible characters (no ANSI truncation — use truncate() first) */
function pad(str: string, width: number, align: "left" | "right" = "left"): string {
  const len = stripAnsi(str).length;
  if (len >= width) return str;
  const spaces = " ".repeat(width - len);
  return align === "right" ? spaces + str : str + spaces;
}

function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;]*m/g, "");
}

function truncate(s: string, width: number): string {
  if (s.length <= width) return s;
  return s.slice(0, width - 1) + "…";
}

// ─── State ───────────────────────────────────────────────────────────────────

type ViewMode = "unified" | "sidebyside";
type Focus = "files" | "diff";

interface State {
  files: FileDiff[];
  selectedFile: number;
  diffScroll: number;
  fileScroll: number;
  mode: ViewMode;
  focus: Focus;
  termW: number;
  termH: number;
  workstreamName: string;
}

// ─── Layout constants ─────────────────────────────────────────────────────────

const FILE_PANEL_WIDTH = 28; // left panel width including border
const HEADER_ROWS = 2;       // top bar + divider
const FOOTER_ROWS = 1;       // bottom help bar

// ─── Rendering ────────────────────────────────────────────────────────────────

function renderHeader(s: State): string {
  const title = `${A.bold}${A.brightWhite} ws diff: ${A.brightCyan}${s.workstreamName}${A.reset}`;
  const modeLabel =
    s.mode === "unified"
      ? `${A.brightBlack}[${A.brightYellow}t${A.brightBlack}]${A.reset} ${A.brightYellow}unified${A.reset}`
      : `${A.brightBlack}[${A.brightYellow}t${A.brightBlack}]${A.reset} ${A.brightMagenta}side-by-side${A.reset}`;

  const keys = [
    `${A.brightBlack}[${A.brightYellow}q${A.brightBlack}]${A.reset}quit`,
    `${A.brightBlack}[${A.brightYellow}Tab${A.brightBlack}]${A.reset}switch`,
    `${A.brightBlack}[${A.brightYellow}jk${A.brightBlack}]${A.reset}scroll`,
    `${A.brightBlack}[${A.brightYellow}np${A.brightBlack}]${A.reset}next/prev`,
    modeLabel,
  ].join("  ");

  const titleVis = stripAnsi(title);
  const keysVis = stripAnsi(keys);
  const gap = Math.max(1, s.termW - titleVis.length - keysVis.length - 2);
  const row1 = ` ${title}${" ".repeat(gap)}${keys} `;

  // Divider
  const divider =
    A.brightBlack +
    "─".repeat(FILE_PANEL_WIDTH - 1) +
    "┬" +
    "─".repeat(s.termW - FILE_PANEL_WIDTH) +
    A.reset;

  return moveTo(1, 1) + A.bgBrightBlack + A.brightWhite + pad(row1, s.termW) + A.reset + "\n" + divider;
}

function renderFileList(s: State): string {
  const contentH = s.termH - HEADER_ROWS - FOOTER_ROWS;
  const panelW = FILE_PANEL_WIDTH - 1; // subtract border char
  let out = "";

  const header = A.bold + A.brightWhite + ` Files (${s.files.length})` + A.reset;
  out += moveTo(HEADER_ROWS + 1, 1) + pad(header, panelW) + A.brightBlack + "│" + A.reset;

  for (let i = 0; i < contentH - 1; i++) {
    const fileIdx = s.fileScroll + i;
    const file = s.files[fileIdx];
    const row = HEADER_ROWS + 2 + i;

    if (!file) {
      out += moveTo(row, 1) + " ".repeat(panelW) + A.brightBlack + "│" + A.reset;
      continue;
    }

    const selected = fileIdx === s.selectedFile;
    const stat = fileStat(file);
    const addDelVis = `+${stat.added}/-${stat.deleted}`;
    const statusColor =
      file.status === "A" ? A.brightGreen : file.status === "D" ? A.brightRed : A.brightYellow;
    const arrow = selected ? A.brightCyan + "▶" + A.reset : " ";
    const name = truncate(file.path.split("/").pop() ?? file.path, panelW - addDelVis.length - 5);
    const nameColored = selected
      ? A.bold + A.brightWhite + name + A.reset
      : A.white + name + A.reset;
    const statusChar = statusColor + file.status + A.reset;
    const addDelStr =
      A.brightGreen + `+${stat.added}` + A.reset +
      A.brightBlack + "/" + A.reset +
      A.brightRed + `-${stat.deleted}` + A.reset;

    // Visible width calculation for padding
    const prefixVis = `  ${selected ? "▶" : " "} ${name} ${file.status} `;
    const gap = Math.max(0, panelW - prefixVis.length - addDelVis.length);

    let line: string;
    if (selected && s.focus === "files") {
      line = A.bgBlue + `  ${arrow} ${nameColored} ${statusChar} ` + " ".repeat(gap) + addDelStr + A.reset;
    } else if (selected) {
      line = `  ${arrow} ${nameColored} ${statusChar} ` + " ".repeat(gap) + addDelStr;
    } else {
      line = `   ${nameColored} ${statusChar} ` + " ".repeat(gap) + addDelStr;
    }

    out += moveTo(row, 1) + line + A.brightBlack + "│" + A.reset;
  }

  return out;
}

/** Build flat list of renderable diff lines for a file */
function buildDiffLines(file: FileDiff, mode: ViewMode, panelW: number): string[] {
  const lines: string[] = [];

  if (file.binary) {
    lines.push(A.brightBlack + "  Binary file — no diff available" + A.reset);
    return lines;
  }
  if (file.hunks.length === 0) {
    lines.push(A.brightBlack + "  No changes" + A.reset);
    return lines;
  }

  const numW = 4; // width for line numbers

  function fmtNum(n: number | undefined): string {
    if (n === undefined) return " ".repeat(numW);
    return A.brightBlack + String(n).padStart(numW) + A.reset;
  }

  for (const hunk of file.hunks) {
    // Hunk header
    lines.push(A.brightBlack + A.bold + truncate(hunk.header, panelW - 1) + A.reset);

    if (mode === "unified") {
      for (const dl of hunk.lines) {
        const num = dl.type === "add" ? fmtNum(dl.newNum) : fmtNum(dl.oldNum);
        const content = truncate(dl.content, panelW - numW - 3);
        if (dl.type === "add") {
          lines.push(` ${num} ${A.brightGreen}+${content}${A.reset}`);
        } else if (dl.type === "del") {
          lines.push(` ${num} ${A.brightRed}-${content}${A.reset}`);
        } else {
          lines.push(` ${num} ${A.brightBlack} ${A.reset}${A.dim}${content}${A.reset}`);
        }
      }
    } else {
      // Side-by-side: pair del/add lines
      const halfW = Math.floor((panelW - 1) / 2);
      const colW = halfW - numW - 3;

      // Header for columns
      lines.push(
        A.bold + A.brightBlack +
        " OLD" + " ".repeat(halfW - 4) + "│" +
        " NEW" + " ".repeat(halfW - 4) +
        A.reset
      );

      // Build paired rows
      const dels: DiffLine[] = [];
      const adds: DiffLine[] = [];
      const paired: Array<{ del?: DiffLine; add?: DiffLine; ctx?: DiffLine }> = [];

      for (const dl of hunk.lines) {
        if (dl.type === "del") dels.push(dl);
        else if (dl.type === "add") adds.push(dl);
        else {
          // flush pending del/add pairs
          const max = Math.max(dels.length, adds.length);
          for (let i = 0; i < max; i++) {
            paired.push({ del: dels[i], add: adds[i] });
          }
          dels.length = 0;
          adds.length = 0;
          paired.push({ ctx: dl });
        }
      }
      const max = Math.max(dels.length, adds.length);
      for (let i = 0; i < max; i++) {
        paired.push({ del: dels[i], add: adds[i] });
      }

      for (const p of paired) {
        if (p.ctx) {
          const c = truncate(p.ctx.content, colW);
          const leftNum = fmtNum(p.ctx.oldNum);
          const rightNum = fmtNum(p.ctx.newNum);
          const leftCell = ` ${leftNum} ${A.dim}${pad(c, colW)}${A.reset}`;
          const rightCell = ` ${rightNum} ${A.dim}${pad(c, colW)}${A.reset}`;
          lines.push(leftCell + A.brightBlack + "│" + A.reset + rightCell);
        } else {
          const delLine = p.del;
          const addLine = p.add;
          const leftNum = delLine ? fmtNum(delLine.oldNum) : " ".repeat(numW);
          const rightNum = addLine ? fmtNum(addLine.newNum) : " ".repeat(numW);
          const leftContent = delLine ? truncate(delLine.content, colW) : "";
          const rightContent = addLine ? truncate(addLine.content, colW) : "";
          const leftCell = delLine
            ? ` ${leftNum} ${A.brightRed}-${pad(leftContent, colW)}${A.reset}`
            : ` ${" ".repeat(numW)} ${" ".repeat(colW + 1)}`;
          const rightCell = addLine
            ? ` ${rightNum} ${A.brightGreen}+${pad(rightContent, colW)}${A.reset}`
            : ` ${" ".repeat(numW)} ${" ".repeat(colW + 1)}`;
          lines.push(leftCell + A.brightBlack + "│" + A.reset + rightCell);
        }
      }
    }
  }

  return lines;
}

function renderDiffPanel(s: State): string {
  const contentH = s.termH - HEADER_ROWS - FOOTER_ROWS;
  const panelX = FILE_PANEL_WIDTH + 1;
  const panelW = s.termW - FILE_PANEL_WIDTH;
  const file = s.files[s.selectedFile];
  let out = "";

  // Panel header: file path
  const filePath = file
    ? A.bold + A.brightWhite + " " + file.path + A.reset
    : A.brightBlack + " (no file selected)" + A.reset;
  const focusIndicator = s.focus === "diff" ? A.brightCyan + " [focused]" + A.reset : "";
  out += moveTo(HEADER_ROWS + 1, panelX) + pad(filePath + focusIndicator, panelW);

  if (!file) {
    for (let r = 0; r < contentH - 1; r++) {
      out += moveTo(HEADER_ROWS + 2 + r, panelX) + " ".repeat(panelW);
    }
    return out;
  }

  const diffLines = buildDiffLines(file, s.mode, panelW);
  const visible = diffLines.slice(s.diffScroll, s.diffScroll + contentH - 1);

  for (let i = 0; i < contentH - 1; i++) {
    const row = HEADER_ROWS + 2 + i;
    out += moveTo(row, panelX);
    if (i < visible.length) {
      const raw = visible[i];
      const vis = stripAnsi(raw);
      // render line, padding to panel width
      const padded = raw + " ".repeat(Math.max(0, panelW - vis.length));
      out += padded;
    } else {
      out += " ".repeat(panelW);
    }
  }

  // Scroll indicator
  const total = diffLines.length;
  if (total > contentH - 1) {
    const pct = Math.round((s.diffScroll / (total - contentH + 1)) * 100);
    const indicator = A.brightBlack + ` ${pct}% (${s.diffScroll + 1}/${total})` + A.reset;
    out += moveTo(s.termH - 1, panelX) + indicator;
  }

  return out;
}

function renderFooter(s: State): string {
  const help =
    A.bgBrightBlack +
    A.brightWhite +
    "  " +
    [
      `${A.brightYellow}q${A.brightWhite} quit`,
      `${A.brightYellow}t${A.brightWhite} toggle view`,
      `${A.brightYellow}Tab${A.brightWhite} switch panel`,
      `${A.brightYellow}jk${A.brightWhite} scroll`,
      `${A.brightYellow}np${A.brightWhite} next/prev file`,
      `${A.brightYellow}gG${A.brightWhite} top/bottom`,
    ].join(A.brightBlack + "  │  " + A.brightWhite) +
    "  " +
    A.reset;
  return moveTo(s.termH, 1) + pad(help, s.termW);
}

function render(s: State): string {
  return (
    hideCursor() +
    clearScreen() +
    renderHeader(s) +
    renderFileList(s) +
    renderDiffPanel(s) +
    renderFooter(s)
  );
}

// ─── Scrolling helpers ────────────────────────────────────────────────────────

function diffLineCount(s: State): number {
  const file = s.files[s.selectedFile];
  if (!file) return 0;
  return buildDiffLines(file, s.mode, s.termW - FILE_PANEL_WIDTH).length;
}

function maxDiffScroll(s: State): number {
  const contentH = s.termH - HEADER_ROWS - FOOTER_ROWS - 1;
  return Math.max(0, diffLineCount(s) - contentH);
}

function maxFileScroll(s: State): number {
  const contentH = s.termH - HEADER_ROWS - FOOTER_ROWS - 1;
  return Math.max(0, s.files.length - contentH);
}

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

function selectFile(s: State, idx: number): void {
  s.selectedFile = clamp(idx, 0, s.files.length - 1);
  s.diffScroll = 0;
  // Keep file visible in file panel
  const contentH = s.termH - HEADER_ROWS - FOOTER_ROWS - 1;
  if (s.selectedFile < s.fileScroll) s.fileScroll = s.selectedFile;
  if (s.selectedFile >= s.fileScroll + contentH)
    s.fileScroll = s.selectedFile - contentH + 1;
}

// ─── Main entry ──────────────────────────────────────────────────────────────

export async function openDiffViewer(
  workstreamName: string,
  rawDiff: string
): Promise<void> {
  const parsed = parseDiff(rawDiff);

  if (parsed.files.length === 0) {
    console.log("No changes to display.");
    return;
  }

  const state: State = {
    files: parsed.files,
    selectedFile: 0,
    diffScroll: 0,
    fileScroll: 0,
    mode: "unified",
    focus: "files",
    termW: process.stdout.columns ?? 120,
    termH: process.stdout.rows ?? 40,
    workstreamName,
  };

  const stdin = process.stdin;
  const stdout = process.stdout;

  stdout.write(enterAltScreen() + hideCursor());

  const draw = () => stdout.write(render(state));

  draw();

  // Handle resize
  const onResize = () => {
    state.termW = process.stdout.columns ?? 120;
    state.termH = process.stdout.rows ?? 40;
    draw();
  };
  process.stdout.on("resize", onResize);

  // Raw input
  stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding("utf8");

  await new Promise<void>((resolve) => {
    const cleanup = () => {
      stdin.setRawMode(false);
      stdin.pause();
      process.stdout.off("resize", onResize);
      stdout.write(showCursor() + exitAltScreen());
      resolve();
    };

    stdin.on("data", (key: string) => {
      const contentH = state.termH - HEADER_ROWS - FOOTER_ROWS - 1;

      // Quit
      if (key === "q" || key === "\x03" || key === "\x1b") {
        cleanup();
        return;
      }

      // Toggle view mode
      if (key === "t") {
        state.mode = state.mode === "unified" ? "sidebyside" : "unified";
        state.diffScroll = 0;
        draw();
        return;
      }

      // Switch focus
      if (key === "\t" || key === "l" || key === "h") {
        if (key === "h" || (key === "\t" && state.focus === "diff")) {
          state.focus = "files";
        } else {
          state.focus = "diff";
        }
        draw();
        return;
      }

      // Navigation
      if (state.focus === "files") {
        if (key === "j" || key === "\x1b[B") {
          selectFile(state, state.selectedFile + 1);
        } else if (key === "k" || key === "\x1b[A") {
          selectFile(state, state.selectedFile - 1);
        } else if (key === "g") {
          selectFile(state, 0);
        } else if (key === "G") {
          selectFile(state, state.files.length - 1);
        } else if (key === "\r" || key === " ") {
          state.focus = "diff";
        } else if (key === "n") {
          selectFile(state, state.selectedFile + 1);
        } else if (key === "p") {
          selectFile(state, state.selectedFile - 1);
        }
      } else {
        // diff panel
        const max = maxDiffScroll(state);
        if (key === "j" || key === "\x1b[B") {
          state.diffScroll = clamp(state.diffScroll + 1, 0, max);
        } else if (key === "k" || key === "\x1b[A") {
          state.diffScroll = clamp(state.diffScroll - 1, 0, max);
        } else if (key === "d" || key === "\x1b[6~") {
          state.diffScroll = clamp(state.diffScroll + Math.floor(contentH / 2), 0, max);
        } else if (key === "u" || key === "\x1b[5~") {
          state.diffScroll = clamp(state.diffScroll - Math.floor(contentH / 2), 0, max);
        } else if (key === "g") {
          state.diffScroll = 0;
        } else if (key === "G") {
          state.diffScroll = max;
        } else if (key === "n") {
          selectFile(state, state.selectedFile + 1);
        } else if (key === "p") {
          selectFile(state, state.selectedFile - 1);
        }
      }

      draw();
    });
  });
}
