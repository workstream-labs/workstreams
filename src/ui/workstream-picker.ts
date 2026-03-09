import { $ } from "bun";
import {
  A, C, bg256, fg256,
  moveTo, clearScreen, hideCursor, showCursor,
  enterAltScreen, exitAltScreen,
  stripAnsi, truncate, pad, STATUS_STYLE,
} from "./ansi.js";
import { fuzzyFilter } from "./fuzzy.js";
import { renderModal, renderInputModal } from "./modal.js";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface WorkstreamEntry {
  name: string;
  branch: string;
  status: string;         // "success", "failed", "running", "pending", or "workspace"
  prompt?: string;
  hasWorktree: boolean;
  ahead: number;
  behind: number;
  lastCommitAge: string;
  lastCommitMsg: string;
  filesChanged: number;
  additions: number;
  deletions: number;
  hasSession: boolean;
  commentCount: number;
  isDirty: boolean;
}

export type DashboardAction =
  | { type: "editor"; name: string }
  | { type: "diff"; name: string }
  | { type: "resume-session"; name: string }
  | { type: "resume-prompt"; name: string; prompt: string }
  | { type: "resume-comments"; name: string }
  | { type: "quit" };

type DashboardMode = "normal" | "search" | "prompt-input" | "help";

interface DashboardState {
  entries: WorkstreamEntry[];
  filteredIndices: number[];
  selected: number;          // index into filteredIndices
  scroll: number;            // first visible card index (into filteredIndices)
  mode: DashboardMode;
  searchQuery: string;
  promptInput: string;
  termW: number;
  termH: number;
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
    const abResult = await $`git rev-list --left-right --count HEAD...${branch}`.quiet();
    const parts = abResult.stdout.toString().trim().split(/\s+/);
    const behind = parseInt(parts[0], 10) || 0;
    const ahead = parseInt(parts[1], 10) || 0;

    const msgResult = await $`git log -1 --format=%s ${branch}`.quiet();
    const lastCommitMsg = msgResult.stdout.toString().trim();

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

// ─── Layout constants ────────────────────────────────────────────────────────

const HEADER_ROWS = 2;
const FOOTER_ROWS = 1;
const CARD_HEIGHT = 4; // 3 content lines + 1 blank separator

// ─── Card rendering ─────────────────────────────────────────────────────────

function renderCard(entry: WorkstreamEntry, isSelected: boolean, cardW: number): string[] {
  const st = STATUS_STYLE[entry.status] ?? STATUS_STYLE.pending;
  const sel = isSelected ? C.selectedBg : "";
  const selReset = isSelected ? A.reset + C.selectedBg : A.reset;
  const cursor = isSelected ? `${A.brightCyan}\u25B6${selReset}` : " ";

  // Line 1: cursor + status icon + name ... ahead/behind +/- age
  const nameStr = truncate(entry.name, Math.max(10, cardW - 40));

  let rightInfo = "";
  let rightVisLen = 0;
  if (entry.hasWorktree && (entry.ahead || entry.behind || entry.filesChanged)) {
    const ab = entry.ahead || entry.behind
      ? `${A.brightGreen}\u2191${entry.ahead}${selReset} ${A.brightRed}\u2193${entry.behind}${selReset}`
      : "";
    const abVis = entry.ahead || entry.behind ? `\u2191${entry.ahead} \u2193${entry.behind}` : "";
    const stats = entry.filesChanged > 0
      ? `${A.brightGreen}+${entry.additions}${selReset} ${A.brightRed}-${entry.deletions}${selReset}`
      : "";
    const statsVis = entry.filesChanged > 0 ? `+${entry.additions} -${entry.deletions}` : "";
    const age = entry.lastCommitAge ? truncate(entry.lastCommitAge, 10) : "";

    const parts = [abVis, statsVis, age].filter(Boolean);
    rightVisLen = parts.join("  ").length;
    const colorParts = [ab, stats, age ? `${A.brightBlack}${age}${selReset}` : ""].filter(Boolean);
    rightInfo = colorParts.join("  ");
  } else if (!entry.hasWorktree) {
    rightInfo = `${A.brightBlack}(no changes)${selReset}`;
    rightVisLen = "(no changes)".length;
  } else {
    rightInfo = `${A.brightBlack}=${selReset}`;
    rightVisLen = 1;
  }

  const nameVisLen = ` \u25B6 ${st.icon} ${stripAnsi(nameStr)}`.length;
  const gap1 = Math.max(1, cardW - nameVisLen - rightVisLen - 2);

  const line1 =
    sel + ` ${cursor} ${st.color}${st.icon}${selReset}` +
    (isSelected ? ` ${A.bold}${A.brightWhite}${nameStr}${selReset}` : ` ${A.white}${nameStr}${selReset}`) +
    " ".repeat(gap1) + rightInfo;

  // Line 2: prompt (dimmed, indented)
  const promptText = entry.prompt
    ? truncate(entry.prompt, cardW - 6)
    : `${A.brightBlack}(no prompt)${selReset}`;
  const line2 = sel + `    ${A.dim}${promptText}${selReset}`;

  // Line 3: session | comments | dirty | last commit
  const meta: string[] = [];
  const metaVis: string[] = [];

  if (entry.hasSession) {
    meta.push(`${A.brightGreen}session: yes${selReset}`);
    metaVis.push("session: yes");
  } else if (entry.hasWorktree) {
    meta.push(`${A.brightBlack}no session${selReset}`);
    metaVis.push("no session");
  }

  if (entry.commentCount > 0) {
    meta.push(`${A.brightYellow}${entry.commentCount} comment${entry.commentCount !== 1 ? "s" : ""}${selReset}`);
    metaVis.push(`${entry.commentCount} comment${entry.commentCount !== 1 ? "s" : ""}`);
  } else if (entry.hasWorktree) {
    meta.push(`${A.brightBlack}0 comments${selReset}`);
    metaVis.push("0 comments");
  }

  if (entry.hasWorktree) {
    if (entry.isDirty) {
      meta.push(`${A.brightYellow}dirty${selReset}`);
      metaVis.push("dirty");
    } else {
      meta.push(`${A.brightBlack}clean${selReset}`);
      metaVis.push("clean");
    }
  }

  if (entry.lastCommitMsg && entry.hasWorktree) {
    const maxMsg = cardW - 6 - metaVis.join("  |  ").length - 6;
    if (maxMsg > 8) {
      meta.push(`${A.dim}${truncate(entry.lastCommitMsg, maxMsg)}${selReset}`);
    }
  } else if (!entry.hasWorktree && !entry.prompt) {
    meta.push(`${A.brightBlack}no worktree${selReset}`);
  } else if (!entry.hasWorktree) {
    meta.push(`${A.brightBlack}no worktree${selReset}`);
  }

  const sep = `${A.brightBlack}  |  ${selReset}`;
  const line3 = sel + `    ${meta.join(sep)}`;

  return [line1, line2, line3];
}

// ─── Header ──────────────────────────────────────────────────────────────────

function renderHeader(s: DashboardState): string {
  const count = s.filteredIndices.length;
  const total = s.entries.length;
  const countStr = count === total
    ? `${A.brightBlack}${total} workstream${total !== 1 ? "s" : ""}`
    : `${A.brightBlack}${count}/${total} workstreams`;

  const title = `${A.bold}${A.brightWhite} ws switch${A.reset}  ${countStr}${A.reset}`;
  const hints = `${A.brightBlack}/ search  ? help  q quit${A.reset}`;

  const titleVis = ` ws switch  ` + (count === total ? `${total} workstream${total !== 1 ? "s" : ""}` : `${count}/${total} workstreams`);
  const hintsVis = "/ search  ? help  q quit";
  const gap = Math.max(1, s.termW - titleVis.length - hintsVis.length - 2);

  const row1 = ` ${title}` + " ".repeat(gap) + hints + " ";
  const divider = A.brightBlack + "\u2500".repeat(s.termW) + A.reset;

  return moveTo(1, 1) + A.bgBrightBlack + A.brightWhite + pad(row1, s.termW) + A.reset + "\n" + divider;
}

// ─── Cards ───────────────────────────────────────────────────────────────────

function renderCards(s: DashboardState): string {
  const contentH = s.termH - HEADER_ROWS - FOOTER_ROWS;
  const visibleCards = Math.floor(contentH / CARD_HEIGHT);
  let out = "";

  for (let vi = 0; vi < visibleCards; vi++) {
    const fi = s.scroll + vi; // index into filteredIndices
    const baseRow = HEADER_ROWS + 1 + vi * CARD_HEIGHT;

    if (fi >= s.filteredIndices.length) {
      // Empty rows
      for (let r = 0; r < CARD_HEIGHT; r++) {
        out += moveTo(baseRow + r, 1) + " ".repeat(s.termW);
      }
      continue;
    }

    const entryIdx = s.filteredIndices[fi];
    const entry = s.entries[entryIdx];
    const isSelected = fi === s.selected;
    const cardLines = renderCard(entry, isSelected, s.termW - 2);

    for (let r = 0; r < 3; r++) {
      const row = baseRow + r;
      const line = cardLines[r] ?? "";
      const bg = isSelected ? C.selectedBg : "";
      const visLen = stripAnsi(line).length;
      const trail = Math.max(0, s.termW - visLen);
      out += moveTo(row, 1) + line + bg + " ".repeat(trail) + A.reset;
    }
    // Separator line (blank)
    out += moveTo(baseRow + 3, 1) + " ".repeat(s.termW);
  }

  // Fill remaining rows
  const usedRows = visibleCards * CARD_HEIGHT;
  for (let r = usedRows; r < contentH; r++) {
    out += moveTo(HEADER_ROWS + 1 + r, 1) + " ".repeat(s.termW);
  }

  return out;
}

// ─── Footer ──────────────────────────────────────────────────────────────────

function renderFooter(s: DashboardState): string {
  if (s.filteredIndices.length === 0) {
    const hint = `${A.brightBlack}No matching workstreams${A.reset}`;
    return moveTo(s.termH, 1) + C.footerBg + pad(`  ${hint}`, s.termW) + A.reset;
  }

  const entryIdx = s.filteredIndices[s.selected];
  const entry = s.entries[entryIdx];
  if (!entry) {
    return moveTo(s.termH, 1) + C.footerBg + " ".repeat(s.termW) + A.reset;
  }

  const sep = `${A.brightBlack}  \u2502  ${A.brightWhite}`;
  const items: string[] = [];

  // enter editor — always available
  items.push(`${A.brightYellow}enter${A.brightWhite} editor`);

  // d diff — only if worktree with changes
  if (entry.hasWorktree && entry.filesChanged > 0) {
    items.push(`${A.brightYellow}d${A.brightWhite} diff`);
  }

  // r resume — only if session exists
  if (entry.hasSession) {
    items.push(`${A.brightYellow}r${A.brightWhite} resume`);
  }

  // p prompt — only if session exists (resume with new prompt)
  if (entry.hasSession) {
    items.push(`${A.brightYellow}p${A.brightWhite} prompt`);
  }

  const help = C.footerBg + A.brightWhite + "  " + items.join(sep) + A.reset;
  const quitHint = `${A.brightBlack}q quit${A.reset}`;
  const helpVis = stripAnsi("  " + items.map(s => stripAnsi(s)).join("  |  "));
  const quitVisLen = "q quit".length;
  const gap = Math.max(1, s.termW - helpVis.length - quitVisLen - 4);

  return moveTo(s.termH, 1) + C.footerBg +
    help + C.footerBg + " ".repeat(gap) + quitHint +
    C.footerBg + "  " + A.reset;
}

// ─── Search overlay ──────────────────────────────────────────────────────────

function renderSearchBar(s: DashboardState): string {
  const barW = Math.min(50, s.termW - 4);
  const col = Math.floor((s.termW - barW) / 2) + 1;
  const row = 3; // just below header

  const inputW = barW - 6; // "/ " + cursor + padding
  const displayVal = s.searchQuery.length > inputW
    ? s.searchQuery.slice(s.searchQuery.length - inputW)
    : s.searchQuery;
  const cursor = "\u2588";

  const bg = bg256(237);
  const line =
    bg + ` ${A.brightCyan}/${A.reset}${bg} ${A.brightWhite}${displayVal}${A.brightCyan}${cursor}${A.reset}`;
  const visLen = 2 + 1 + displayVal.length + 1; // "/ " + val + cursor
  const trail = Math.max(0, barW - visLen);

  return moveTo(row, col) + line + bg + " ".repeat(trail) + A.reset;
}

// ─── Help overlay ────────────────────────────────────────────────────────────

function renderHelpOverlay(s: DashboardState): string {
  const lines = [
    "",
    `${A.brightYellow}j${A.reset}/${A.brightYellow}\u2193${A.reset}      Select next workstream`,
    `${A.brightYellow}k${A.reset}/${A.brightYellow}\u2191${A.reset}      Select previous workstream`,
    `${A.brightYellow}g${A.reset}          Jump to first`,
    `${A.brightYellow}G${A.reset}          Jump to last`,
    `${A.brightYellow}Enter${A.reset}      Open in editor`,
    `${A.brightYellow}d${A.reset}          View diff`,
    `${A.brightYellow}r${A.reset}          Resume Claude session`,
    `${A.brightYellow}p${A.reset}          Resume with prompt`,
    `${A.brightYellow}c${A.reset}          Resume with comments`,
    `${A.brightYellow}/${A.reset}          Search workstreams`,
    `${A.brightYellow}?${A.reset}          Toggle this help`,
    `${A.brightYellow}q${A.reset}/${A.brightYellow}Esc${A.reset}      Quit`,
    "",
  ];

  return renderModal({
    title: "Keyboard Shortcuts",
    lines,
    width: 44,
    termW: s.termW,
    termH: s.termH,
    footer: `${A.brightBlack}Press any key to dismiss${A.reset}`,
  });
}

// ─── Prompt modal ────────────────────────────────────────────────────────────

function renderPromptModal(s: DashboardState): string {
  return renderInputModal({
    title: "Enter prompt",
    value: s.promptInput,
    cursorPos: s.promptInput.length,
    termW: s.termW,
    termH: s.termH,
    footer: "Enter submit  |  Esc cancel",
  });
}

// ─── Full render ─────────────────────────────────────────────────────────────

function render(s: DashboardState): string {
  let out = hideCursor() + clearScreen() +
    renderHeader(s) +
    renderCards(s) +
    renderFooter(s);

  if (s.mode === "search") out += renderSearchBar(s);
  if (s.mode === "prompt-input") out += renderPromptModal(s);
  if (s.mode === "help") out += renderHelpOverlay(s);

  return out;
}

// ─── Scroll helpers ──────────────────────────────────────────────────────────

function visibleCards(s: DashboardState): number {
  const contentH = s.termH - HEADER_ROWS - FOOTER_ROWS;
  return Math.floor(contentH / CARD_HEIGHT);
}

function clampScroll(s: DashboardState): void {
  const vc = visibleCards(s);
  if (s.selected < s.scroll) s.scroll = s.selected;
  if (s.selected >= s.scroll + vc) s.scroll = s.selected - vc + 1;
  s.scroll = Math.max(0, Math.min(s.scroll, Math.max(0, s.filteredIndices.length - vc)));
}

function refilter(s: DashboardState): void {
  s.filteredIndices = fuzzyFilter(
    s.entries,
    s.searchQuery,
    (e) => `${e.name} ${e.prompt ?? ""} ${e.status}`,
  );
  s.selected = Math.min(s.selected, Math.max(0, s.filteredIndices.length - 1));
  clampScroll(s);
}

// ─── Main entry ──────────────────────────────────────────────────────────────

export async function openDashboard(
  entries: WorkstreamEntry[],
): Promise<DashboardAction> {
  if (entries.length === 0) {
    console.log("No workstreams found.");
    return { type: "quit" };
  }

  const state: DashboardState = {
    entries,
    filteredIndices: entries.map((_, i) => i),
    selected: 0,
    scroll: 0,
    mode: "normal",
    searchQuery: "",
    promptInput: "",
    termW: process.stdout.columns ?? 120,
    termH: process.stdout.rows ?? 40,
  };

  const stdin = process.stdin;
  const stdout = process.stdout;

  stdout.write(enterAltScreen() + hideCursor());

  const draw = () => stdout.write(render(state));
  draw();

  const onResize = () => {
    state.termW = process.stdout.columns ?? 120;
    state.termH = process.stdout.rows ?? 40;
    clampScroll(state);
    draw();
  };
  process.stdout.on("resize", onResize);

  stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding("utf8");

  return new Promise<DashboardAction>((resolve) => {
    const cleanup = (result: DashboardAction) => {
      stdin.off("data", onData);
      stdin.setRawMode(false);
      stdin.pause();
      process.stdout.off("resize", onResize);
      stdout.write(showCursor() + exitAltScreen());
      resolve(result);
    };

    const selectedEntry = (): WorkstreamEntry | undefined => {
      if (state.filteredIndices.length === 0) return undefined;
      return state.entries[state.filteredIndices[state.selected]];
    };

    const onData = (key: string) => {
      // ─── Help mode ────────────────────────────────────────────────
      if (state.mode === "help") {
        state.mode = "normal";
        draw();
        return;
      }

      // ─── Prompt input mode ────────────────────────────────────────
      if (state.mode === "prompt-input") {
        if (key === "\x1b") { // Esc
          state.mode = "normal";
          state.promptInput = "";
          draw();
          return;
        }
        if (key === "\r") { // Enter
          const entry = selectedEntry();
          const prompt = state.promptInput.trim();
          if (entry && prompt) {
            cleanup({ type: "resume-prompt", name: entry.name, prompt });
          } else {
            state.mode = "normal";
            state.promptInput = "";
            draw();
          }
          return;
        }
        if (key === "\x7f" || key === "\b") { // Backspace
          state.promptInput = state.promptInput.slice(0, -1);
          draw();
          return;
        }
        if (key === "\x03") { // Ctrl+C
          state.mode = "normal";
          state.promptInput = "";
          draw();
          return;
        }
        // Printable characters
        if (key.length === 1 && key.charCodeAt(0) >= 32) {
          state.promptInput += key;
          draw();
          return;
        }
        // Multi-byte characters (e.g. pasted text)
        if (key.length > 1 && !key.startsWith("\x1b")) {
          state.promptInput += key;
          draw();
          return;
        }
        return;
      }

      // ─── Search mode ──────────────────────────────────────────────
      if (state.mode === "search") {
        if (key === "\x1b") { // Esc — clear search
          state.searchQuery = "";
          state.mode = "normal";
          refilter(state);
          draw();
          return;
        }
        if (key === "\r") { // Enter — accept filter
          state.mode = "normal";
          draw();
          return;
        }
        if (key === "\x7f" || key === "\b") { // Backspace
          state.searchQuery = state.searchQuery.slice(0, -1);
          refilter(state);
          draw();
          return;
        }
        if (key === "\x03") { // Ctrl+C
          state.searchQuery = "";
          state.mode = "normal";
          refilter(state);
          draw();
          return;
        }
        // Arrow keys navigate within search
        if (key === "\x1b[B" || key === "\x1b[A") {
          if (key === "\x1b[B" && state.selected < state.filteredIndices.length - 1) {
            state.selected++;
          } else if (key === "\x1b[A" && state.selected > 0) {
            state.selected--;
          }
          clampScroll(state);
          draw();
          return;
        }
        // Printable
        if (key.length === 1 && key.charCodeAt(0) >= 32) {
          state.searchQuery += key;
          refilter(state);
          draw();
          return;
        }
        if (key.length > 1 && !key.startsWith("\x1b")) {
          state.searchQuery += key;
          refilter(state);
          draw();
          return;
        }
        return;
      }

      // ─── Normal mode ──────────────────────────────────────────────

      // Quit
      if (key === "q" || key === "\x03") {
        cleanup({ type: "quit" });
        return;
      }
      if (key === "\x1b") {
        cleanup({ type: "quit" });
        return;
      }

      // Enter — open editor
      if (key === "\r") {
        const entry = selectedEntry();
        if (entry) cleanup({ type: "editor", name: entry.name });
        return;
      }

      // d — diff
      if (key === "d") {
        const entry = selectedEntry();
        if (entry && entry.hasWorktree && entry.filesChanged > 0) {
          cleanup({ type: "diff", name: entry.name });
        }
        return;
      }

      // r — resume session
      if (key === "r") {
        const entry = selectedEntry();
        if (entry && entry.hasSession) {
          cleanup({ type: "resume-session", name: entry.name });
        }
        return;
      }

      // p — prompt input modal
      if (key === "p") {
        const entry = selectedEntry();
        if (entry && entry.hasSession) {
          state.mode = "prompt-input";
          state.promptInput = "";
          draw();
        }
        return;
      }

      // c — resume with comments
      if (key === "c") {
        const entry = selectedEntry();
        if (entry && entry.commentCount > 0) {
          cleanup({ type: "resume-comments", name: entry.name });
        }
        return;
      }

      // / — search
      if (key === "/") {
        state.mode = "search";
        state.searchQuery = "";
        draw();
        return;
      }

      // ? — help
      if (key === "?") {
        state.mode = "help";
        draw();
        return;
      }

      // Navigation
      if (key === "j" || key === "\x1b[B") {
        if (state.selected < state.filteredIndices.length - 1) {
          state.selected++;
          clampScroll(state);
        }
        draw();
        return;
      }
      if (key === "k" || key === "\x1b[A") {
        if (state.selected > 0) {
          state.selected--;
          clampScroll(state);
        }
        draw();
        return;
      }
      if (key === "g") {
        state.selected = 0;
        clampScroll(state);
        draw();
        return;
      }
      if (key === "G") {
        state.selected = Math.max(0, state.filteredIndices.length - 1);
        clampScroll(state);
        draw();
        return;
      }
    };

    stdin.on("data", onData);
  });
}
