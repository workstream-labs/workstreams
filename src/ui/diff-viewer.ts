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

const bg256 = (n: number) => `\x1b[48;5;${n}m`;
const fg256 = (n: number) => `\x1b[38;5;${n}m`;

// Color palette
const C = {
  addLineBg: bg256(22),       // dark green bg for added lines
  addWordBg: bg256(28),       // brighter green bg for added words
  delLineBg: bg256(52),       // dark red bg for deleted lines
  delWordBg: bg256(88),       // brighter red bg for deleted words
  selectedBg: bg256(24),      // steel blue for selected file
  hunkBg: bg256(17),          // dark navy for hunk headers
  footerBg: bg256(235),       // very dark grey for footer
  hunkAt: fg256(67),          // muted blue for @@ markers
  hunkCtx: fg256(110),        // light blue for function context
  scrollTrack: fg256(240),    // grey for scrollbar track
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

// ─── Word-level diff (pure LCS, no deps) ────────────────────────────────────

interface Token { type: "same" | "del" | "add"; text: string; }

function tokenize(line: string): string[] {
  return line.match(/\w+|[^\w]+/g) ?? [];
}

function computeWordDiff(
  oldLine: string,
  newLine: string
): { oldTokens: Token[]; newTokens: Token[] } | null {
  const a = tokenize(oldLine);
  const b = tokenize(newLine);
  if (a.length > 150 || b.length > 150) return null;

  // LCS DP
  const m = a.length, n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--)
    for (let j = n - 1; j >= 0; j--)
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);

  const oldToks: Token[] = [];
  const newToks: Token[] = [];
  let i = 0, j = 0;
  while (i < m || j < n) {
    if (i < m && j < n && a[i] === b[j]) {
      oldToks.push({ type: "same", text: a[i] });
      newToks.push({ type: "same", text: b[j] });
      i++; j++;
    } else if (j < n && (i >= m || dp[i][j + 1] >= dp[i + 1][j])) {
      newToks.push({ type: "add", text: b[j++] });
    } else {
      oldToks.push({ type: "del", text: a[i++] });
    }
  }
  return { oldTokens: oldToks, newTokens: newToks };
}

function renderWordMarked(tokens: Token[], lineType: "add" | "del"): string {
  const wordBg = lineType === "add" ? C.addWordBg : C.delWordBg;
  const lineBg = lineType === "add" ? C.addLineBg : C.delLineBg;
  const fgColor = lineType === "add" ? A.brightGreen : A.brightRed;
  let out = "";
  for (const tok of tokens) {
    if (tok.type === "same") {
      out += lineBg + fgColor + tok.text;
    } else {
      out += wordBg + A.bold + fgColor + tok.text + A.reset + lineBg + fgColor;
    }
  }
  return out;
}

// ─── Layout constants ─────────────────────────────────────────────────────────

const FILE_PANEL_WIDTH = 34; // left panel width including border
const HEADER_ROWS = 2;       // top bar + divider
const FOOTER_ROWS = 1;       // bottom help bar

// ─── Rendering ────────────────────────────────────────────────────────────────

function renderHeader(s: State): string {
  // Compute total stats across all files
  let totalAdded = 0, totalDeleted = 0;
  for (const f of s.files) {
    const st = fileStat(f);
    totalAdded += st.added;
    totalDeleted += st.deleted;
  }

  const title = `${A.bold}${A.brightWhite} ws diff: ${A.brightCyan}${s.workstreamName}${A.reset}`;
  const centerStats =
    `${A.brightWhite}${s.files.length} file${s.files.length !== 1 ? "s" : ""} · ` +
    `${A.brightGreen}+${totalAdded}${A.brightWhite} ${A.brightRed}-${totalDeleted}${A.reset}`;
  const keys =
    `${A.brightBlack}q quit  │  jk scroll  │  np next/prev  │  Tab switch  │  t toggle  │  gG top/bot${A.reset}`;

  const titleVis = stripAnsi(title);
  const centerVis = stripAnsi(centerStats);
  const keysVis = stripAnsi(keys);

  const remaining = s.termW - 2 - titleVis.length - keysVis.length;
  const centerPad = Math.max(0, Math.floor((remaining - centerVis.length) / 2));
  const rightPad = Math.max(1, remaining - centerVis.length - centerPad);

  const row1 =
    ` ${title}` +
    " ".repeat(centerPad) + centerStats + " ".repeat(rightPad) +
    `${keys} `;

  // Divider: focused panel gets cyan segment
  const fileSegLen = FILE_PANEL_WIDTH - 1;
  const diffSegLen = s.termW - FILE_PANEL_WIDTH;
  const fileDash = s.focus === "files" ? A.cyan : A.brightBlack;
  const diffDash = s.focus === "diff" ? A.cyan : A.brightBlack;
  const divider =
    fileDash + "─".repeat(fileSegLen) + A.reset +
    A.brightBlack + "┬" + A.reset +
    diffDash + "─".repeat(diffSegLen) + A.reset;

  return moveTo(1, 1) + A.bgBrightBlack + A.brightWhite + pad(row1, s.termW) + A.reset + "\n" + divider;
}

function renderFileList(s: State): string {
  const contentH = s.termH - HEADER_ROWS - FOOTER_ROWS;
  const panelW = FILE_PANEL_WIDTH - 1; // subtract border char
  let out = "";

  // Compute totals for footer
  let totalAdded = 0, totalDeleted = 0;
  for (const f of s.files) {
    const st = fileStat(f);
    totalAdded += st.added;
    totalDeleted += st.deleted;
  }

  const header = A.bold + A.brightWhite + ` Files (${s.files.length})` + A.reset;
  out += moveTo(HEADER_ROWS + 1, 1) + pad(header, panelW) + A.brightBlack + "│" + A.reset;

  // Status icons
  const statusIcon: Record<string, string> = {
    A: A.brightGreen + "✚" + A.reset,
    D: A.brightRed + "✖" + A.reset,
    M: A.brightYellow + "●" + A.reset,
    R: A.cyan + "➜" + A.reset,
    "?": A.brightBlack + "?" + A.reset,
  };

  const listRows = contentH - 2; // reserve last row for footer
  for (let i = 0; i < listRows; i++) {
    const fileIdx = s.fileScroll + i;
    const file = s.files[fileIdx];
    const row = HEADER_ROWS + 2 + i;

    if (!file) {
      out += moveTo(row, 1) + " ".repeat(panelW) + A.brightBlack + "│" + A.reset;
      continue;
    }

    const selected = fileIdx === s.selectedFile;
    const focused = selected && s.focus === "files";
    const stat = fileStat(file);
    const addDelVis = `+${stat.added}-${stat.deleted}`;

    // Smart path: dim dir/, bright filename
    const parts = file.path.split("/");
    const fname = parts.pop() ?? file.path;
    const dir = parts.length > 0 ? parts.join("/") + "/" : "";
    const maxName = panelW - addDelVis.length - 5;
    const dirTrunc = truncate(dir, Math.max(0, maxName - fname.length));
    const nameTrunc = truncate(fname, maxName - dirTrunc.length);

    const icon = statusIcon[file.status] ?? statusIcon["?"];
    const addDelStr =
      A.brightGreen + `+${stat.added}` + A.reset +
      A.brightBlack + "-" + A.reset +
      A.brightRed + `${stat.deleted}` + A.reset;

    const prefixVis = ` ${selected ? "▶" : " "} ${file.status} ${dirTrunc}${nameTrunc} `;
    const gap = Math.max(0, panelW - prefixVis.length - addDelVis.length);

    let line: string;
    if (focused) {
      const pathStr =
        C.selectedBg + A.brightWhite + A.dim + dirTrunc + A.reset +
        C.selectedBg + A.bold + A.brightWhite + nameTrunc + A.reset;
      line =
        C.selectedBg + ` ${A.brightCyan}▶${A.reset}${C.selectedBg} ${icon}${C.selectedBg} ` +
        pathStr +
        C.selectedBg + " ".repeat(gap) + addDelStr +
        A.reset;
    } else if (selected) {
      const pathStr = A.dim + dirTrunc + A.reset + A.bold + A.brightWhite + nameTrunc + A.reset;
      line =
        ` ${A.brightCyan}▶${A.reset} ${icon} ` + pathStr +
        " ".repeat(gap) + addDelStr;
    } else {
      const pathStr = A.dim + dirTrunc + A.reset + A.white + nameTrunc + A.reset;
      line = `  ${icon} ` + pathStr + " ".repeat(gap) + addDelStr;
    }

    // Pad to panel width
    const lineVis = stripAnsi(` ${selected ? "▶" : " "} ${file.status} `) + dirTrunc + nameTrunc + " ".repeat(gap) + addDelVis;
    const trailing = Math.max(0, panelW - lineVis.length);
    const bgClose = focused ? C.selectedBg + " ".repeat(trailing) + A.reset : " ".repeat(trailing);
    out += moveTo(row, 1) + line + bgClose + A.brightBlack + "│" + A.reset;
  }

  // Footer summary row
  const footerRow = HEADER_ROWS + 2 + listRows;
  const summaryStr =
    A.brightGreen + `+${totalAdded}` + A.reset + " " +
    A.brightRed + `-${totalDeleted}` + A.reset;
  const summaryVis = `+${totalAdded} -${totalDeleted}`;
  const summaryPad = Math.max(0, panelW - summaryVis.length - 1);
  out +=
    moveTo(footerRow, 1) +
    A.brightBlack + " ".repeat(summaryPad) + A.reset +
    summaryStr +
    A.brightBlack + "│" + A.reset;

  return out;
}

/** Precompute word diffs for paired del/add sequences within a hunk */
function precomputeWordDiffs(hunkLines: DiffLine[]): Map<DiffLine, string> {
  const result = new Map<DiffLine, string>();
  const dels: DiffLine[] = [];
  const adds: DiffLine[] = [];

  const flush = () => {
    const pairCount = Math.min(dels.length, adds.length);
    for (let i = 0; i < pairCount; i++) {
      const wd = computeWordDiff(dels[i].content, adds[i].content);
      if (wd) {
        result.set(dels[i], renderWordMarked(wd.oldTokens, "del"));
        result.set(adds[i], renderWordMarked(wd.newTokens, "add"));
      }
    }
    dels.length = 0;
    adds.length = 0;
  };

  for (const dl of hunkLines) {
    if (dl.type === "del") dels.push(dl);
    else if (dl.type === "add") adds.push(dl);
    else flush();
  }
  flush();
  return result;
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

  const numW = 4; // width per line-number column
  // Dual line numbers: "oldNum │ newNum " = numW + 3 + numW = 11 chars prefix, then " " + sigil
  const dualNumW = numW + 1 + numW; // "1234│5678"
  const prefixW = dualNumW + 2; // " oldNum│newNum " (leading space + trailing space)

  function fmtDualNum(oldN: number | undefined, newN: number | undefined): string {
    const oldStr = oldN !== undefined ? String(oldN).padStart(numW) : " ".repeat(numW);
    const newStr = newN !== undefined ? String(newN).padStart(numW) : " ".repeat(numW);
    return A.brightBlack + oldStr + "│" + newStr + A.reset;
  }

  // Hunk header styling: extract @@ part and context
  function styleHunkHeader(header: string, width: number): string {
    const m = header.match(/^(@@ [^@]+ @@)(.*)?$/);
    const atPart = m ? m[1] : header;
    const ctxPart = m ? (m[2] ?? "") : "";
    const content =
      C.hunkBg + " ╔ " +
      C.hunkAt + atPart + A.reset +
      C.hunkBg + C.hunkCtx + ctxPart + A.reset;
    const vis = " ╔ " + atPart + ctxPart;
    const pad_amt = Math.max(0, width - vis.length);
    return content + C.hunkBg + " ".repeat(pad_amt) + A.reset;
  }

  for (const hunk of file.hunks) {
    lines.push(styleHunkHeader(hunk.header, panelW));

    if (mode === "unified") {
      const wordDiffs = precomputeWordDiffs(hunk.lines);
      const contentW = panelW - prefixW - 2; // 1 sigil + 1 space

      for (const dl of hunk.lines) {
        const nums = fmtDualNum(dl.oldNum, dl.newNum);
        const prerendered = wordDiffs.get(dl);

        if (dl.type === "add") {
          const rawContent = truncate(dl.content, contentW);
          const colored = prerendered
            ? (C.addLineBg + A.brightGreen + prerendered + A.reset)
            : (C.addLineBg + A.brightGreen + rawContent + A.reset);
          const vis = rawContent;
          const trail = Math.max(0, contentW - vis.length);
          lines.push(
            ` ${nums} ${C.addLineBg}${A.brightGreen}+${colored}` +
            C.addLineBg + " ".repeat(trail) + A.reset
          );
        } else if (dl.type === "del") {
          const rawContent = truncate(dl.content, contentW);
          const colored = prerendered
            ? (C.delLineBg + A.brightRed + prerendered + A.reset)
            : (C.delLineBg + A.brightRed + rawContent + A.reset);
          const vis = rawContent;
          const trail = Math.max(0, contentW - vis.length);
          lines.push(
            ` ${nums} ${C.delLineBg}${A.brightRed}-${colored}` +
            C.delLineBg + " ".repeat(trail) + A.reset
          );
        } else {
          const content = truncate(dl.content, contentW);
          lines.push(` ${nums} ${A.brightBlack} ${A.reset}${A.dim}${content}${A.reset}`);
        }
      }
    } else {
      // Side-by-side
      const halfW = Math.floor((panelW - 1) / 2);
      const colNumW = 4;
      const colW = halfW - colNumW - 3;

      function fmtSideNum(n: number | undefined): string {
        if (n === undefined) return " ".repeat(colNumW);
        return A.brightBlack + String(n).padStart(colNumW) + A.reset;
      }

      lines.push(
        A.bold + A.brightBlack +
        " OLD" + " ".repeat(halfW - 4) + "│" +
        " NEW" + " ".repeat(halfW - 4) +
        A.reset
      );

      const dels: DiffLine[] = [];
      const adds: DiffLine[] = [];
      const paired: Array<{ del?: DiffLine; add?: DiffLine; ctx?: DiffLine }> = [];

      for (const dl of hunk.lines) {
        if (dl.type === "del") dels.push(dl);
        else if (dl.type === "add") adds.push(dl);
        else {
          const max = Math.max(dels.length, adds.length);
          for (let i = 0; i < max; i++) paired.push({ del: dels[i], add: adds[i] });
          dels.length = 0; adds.length = 0;
          paired.push({ ctx: dl });
        }
      }
      const max = Math.max(dels.length, adds.length);
      for (let i = 0; i < max; i++) paired.push({ del: dels[i], add: adds[i] });

      for (const p of paired) {
        if (p.ctx) {
          const c = truncate(p.ctx.content, colW);
          const leftCell = ` ${fmtSideNum(p.ctx.oldNum)} ${A.dim}${pad(c, colW)}${A.reset}`;
          const rightCell = ` ${fmtSideNum(p.ctx.newNum)} ${A.dim}${pad(c, colW)}${A.reset}`;
          lines.push(leftCell + A.brightBlack + "│" + A.reset + rightCell);
        } else {
          const delLine = p.del;
          const addLine = p.add;
          const wd = delLine && addLine ? computeWordDiff(delLine.content, addLine.content) : null;
          const leftContent = delLine ? truncate(delLine.content, colW) : "";
          const rightContent = addLine ? truncate(addLine.content, colW) : "";
          const leftBody = wd
            ? renderWordMarked(wd.oldTokens, "del")
            : (C.delLineBg + A.brightRed + leftContent);
          const rightBody = wd
            ? renderWordMarked(wd.newTokens, "add")
            : (C.addLineBg + A.brightGreen + rightContent);
          const leftBg = delLine ? C.delLineBg : "";
          const rightBg = addLine ? C.addLineBg : "";
          const leftTrail = Math.max(0, colW - leftContent.length);
          const rightTrail = Math.max(0, colW - rightContent.length);
          const leftCell = delLine
            ? ` ${fmtSideNum(delLine.oldNum)} ${leftBg}${A.brightRed}-${leftBody}${leftBg}${" ".repeat(leftTrail)}${A.reset}`
            : ` ${" ".repeat(colNumW)} ${" ".repeat(colW + 1)}`;
          const rightCell = addLine
            ? ` ${fmtSideNum(addLine.newNum)} ${rightBg}${A.brightGreen}+${rightBody}${rightBg}${" ".repeat(rightTrail)}${A.reset}`
            : ` ${" ".repeat(colNumW)} ${" ".repeat(colW + 1)}`;
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
  // Reserve 1 char for scrollbar on the right
  const panelW = s.termW - FILE_PANEL_WIDTH;
  const innerW = panelW - 1; // usable width excluding scrollbar column
  const file = s.files[s.selectedFile];
  let out = "";

  // Panel header: file path
  const filePath = file
    ? A.bold + A.brightWhite + " " + file.path + A.reset
    : A.brightBlack + " (no file selected)" + A.reset;
  out += moveTo(HEADER_ROWS + 1, panelX) + pad(filePath, panelW);

  if (!file) {
    for (let r = 0; r < contentH - 1; r++) {
      out += moveTo(HEADER_ROWS + 2 + r, panelX) + " ".repeat(panelW);
    }
    return out;
  }

  const diffLines = buildDiffLines(file, s.mode, innerW);
  const viewH = contentH - 1;
  const visible = diffLines.slice(s.diffScroll, s.diffScroll + viewH);

  // Scrollbar geometry
  const total = diffLines.length;
  const hasScroll = total > viewH;
  const thumbH = hasScroll ? Math.max(1, Math.round((viewH / total) * viewH)) : viewH;
  const thumbTop = hasScroll
    ? Math.round((s.diffScroll / (total - viewH)) * (viewH - thumbH))
    : 0;

  for (let i = 0; i < viewH; i++) {
    const row = HEADER_ROWS + 2 + i;
    out += moveTo(row, panelX);
    if (i < visible.length) {
      const raw = visible[i];
      const vis = stripAnsi(raw);
      const trailing = Math.max(0, innerW - vis.length);
      out += raw + " ".repeat(trailing);
    } else {
      out += " ".repeat(innerW);
    }
    // Scrollbar column
    if (hasScroll) {
      const inThumb = i >= thumbTop && i < thumbTop + thumbH;
      out += C.scrollTrack + (inThumb ? "█" : "│") + A.reset;
    } else {
      out += " ";
    }
  }

  // Scroll indicator in bottom-right of diff area
  if (total > viewH) {
    const pct = Math.round((s.diffScroll / (total - viewH)) * 100);
    const indicator = A.brightBlack + ` ${pct}% (${s.diffScroll + 1}/${total})` + A.reset;
    const indicatorVis = ` ${pct}% (${s.diffScroll + 1}/${total})`;
    const indicatorX = panelX + innerW - indicatorVis.length;
    out += moveTo(s.termH - 1, indicatorX) + indicator;
  }

  return out;
}

function renderFooter(s: State): string {
  const sep = A.brightBlack + "  │  " + A.brightWhite;
  const help =
    C.footerBg +
    A.brightWhite +
    "  " +
    [
      `${A.brightYellow}q${A.brightWhite} quit`,
      `${A.brightYellow}jk${A.brightWhite} / ${A.brightYellow}↑↓${A.brightWhite} scroll`,
      `${A.brightYellow}np${A.brightWhite} next/prev`,
      `${A.brightYellow}Tab${A.brightWhite} switch`,
      `${A.brightYellow}t${A.brightWhite} toggle view`,
      `${A.brightYellow}gG${A.brightWhite} top/bottom`,
    ].join(sep) +
    "  " +
    A.reset;
  return moveTo(s.termH, 1) + C.footerBg + pad(help, s.termW) + A.reset;
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
  // innerW = panelW - 1 (scrollbar column)
  const innerW = (s.termW - FILE_PANEL_WIDTH) - 1;
  return buildDiffLines(file, s.mode, innerW).length;
}

function maxDiffScroll(s: State): number {
  const contentH = s.termH - HEADER_ROWS - FOOTER_ROWS - 1;
  return Math.max(0, diffLineCount(s) - contentH);
}

function maxFileScroll(s: State): number {
  // contentH minus 1 for file list header row, minus 1 for footer summary row
  const listRows = s.termH - HEADER_ROWS - FOOTER_ROWS - 2;
  return Math.max(0, s.files.length - listRows);
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
