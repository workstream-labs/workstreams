import { $ } from "bun";
import {
  A, C, bg256,
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
  status: string;         // "success", "failed", "running", "queued", "ready", or "workspace"
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
  hasPendingPrompt: boolean;
  pendingPromptText?: string;
  isDirty: boolean;
  startedAt?: string;
}

export type DashboardAction =
  | { type: "editor"; name: string }
  | { type: "diff"; name: string }
  | { type: "log"; name: string }
  | { type: "open-session"; name: string }
  | { type: "run"; name: string }
  | { type: "set-prompt"; name: string; prompt: string }
  | { type: "save-pending-prompt"; name: string; prompt: string }
  | { type: "create-workstream"; name: string; prompt?: string }
  | { type: "quit" };

interface ActionOption {
  label: string;
  description: string;
  action: DashboardAction["type"] | "set-prompt-input" | "pending-prompt-input";
}

function buildActionOptions(entry: WorkstreamEntry): ActionOption[] {
  const options: ActionOption[] = [];

  options.push({
    label: "Open in editor",
    description: "Create worktree if needed and open in your editor",
    action: "editor",
  });

  // ─── No session (pre-first-run) ─────────────────────────────────
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

  // ─── Has session, finished ──────────────────────────────────────
  if (entry.hasSession && !isActive) {
    options.push({
      label: "Open session",
      description: "Continue in an interactive terminal session",
      action: "open-session",
    });

    // Set/edit prompt to continue with
    options.push({
      label: entry.hasPendingPrompt ? "Edit prompt" : "Set prompt",
      description: "Set instructions to continue with",
      action: "pending-prompt-input",
    });

    // Run — only if there's something pending to send
    if (entry.hasPendingPrompt || entry.commentCount > 0) {
      const pending: string[] = [];
      if (entry.commentCount > 0) pending.push(`${entry.commentCount} comment${entry.commentCount !== 1 ? "s" : ""}`);
      if (entry.hasPendingPrompt) pending.push("prompt");
      options.push({
        label: `Run`,
        description: `Send ${pending.join(" + ")} to the agent`,
        action: "run",
      });
    }
  }

  // ─── Common: view diff, logs ────────────────────────────────────
  if (entry.hasWorktree && entry.filesChanged > 0) {
    options.push({
      label: "View diff & review",
      description: "Browse changes and add review comments",
      action: "diff",
    });
  }

  if (entry.status === "queued" || entry.status === "running" || entry.status === "success" || entry.status === "failed") {
    options.push({
      label: "View logs",
      description: "View agent output logs" + (entry.status === "running" ? " (live)" : entry.status === "queued" ? " (starting)" : ""),
      action: "log",
    });
  }

  // ─── Running ────────────────────────────────────────────────────
  return options;
}

type DashboardMode = "normal" | "search" | "set-prompt-input" | "pending-prompt-input" | "help" | "action-picker";

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

interface DashboardState {
  entries: WorkstreamEntry[];
  filteredIndices: number[];
  selected: number;          // index into filteredIndices
  scroll: number;            // first visible card index (into filteredIndices)
  mode: DashboardMode;
  searchQuery: string;
  promptInput: string;
  actionPickerOptions: ActionOption[];
  actionPickerSelected: number;
  termW: number;
  termH: number;
  spinnerFrame: number;
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

export async function getDiffStats(branch: string, worktreePath?: string): Promise<{
  filesChanged: number;
  additions: number;
  deletions: number;
}> {
  try {
    const results = await Promise.all([
      $`git diff --numstat HEAD...${branch}`.quiet().catch(() => null),
      worktreePath
        ? $`git -C ${worktreePath} diff --numstat HEAD`.quiet().catch(() => null)
        : null,
    ]);

    const files = new Map<string, { add: number; del: number }>();

    for (const result of results) {
      if (!result) continue;
      for (const line of result.stdout.toString().trim().split("\n")) {
        if (!line) continue;
        const [a, d, file] = line.split("\t");
        if (!file) continue;
        const add = a === "-" ? 0 : parseInt(a, 10);
        const del = d === "-" ? 0 : parseInt(d, 10);
        const existing = files.get(file);
        if (existing) {
          existing.add += add;
          existing.del += del;
        } else {
          files.set(file, { add, del });
        }
      }
    }

    let additions = 0;
    let deletions = 0;
    for (const { add, del } of files.values()) {
      additions += add;
      deletions += del;
    }

    return { filesChanged: files.size, additions, deletions };
  } catch {
    return { filesChanged: 0, additions: 0, deletions: 0 };
  }
}

// ─── Layout constants ────────────────────────────────────────────────────────

const HEADER_ROWS = 2;
const FOOTER_ROWS = 1;
const CARD_HEIGHT = 4; // 3 content lines + 1 blank separator

// ─── Card rendering ─────────────────────────────────────────────────────────

function renderCard(entry: WorkstreamEntry, isSelected: boolean, cardW: number, spinnerFrame?: number): string[] {
  const st = STATUS_STYLE[entry.status] ?? STATUS_STYLE.ready;
  const icon = entry.status === "running" && spinnerFrame !== undefined
    ? SPINNER_FRAMES[spinnerFrame % SPINNER_FRAMES.length]
    : st.icon;
  const sel = isSelected ? C.selectedBg : "";
  const selReset = isSelected ? A.reset + C.selectedBg : A.reset;

  // Line 1: status icon + name
  const nameStr = truncate(entry.name, Math.max(10, cardW - 8));
  const line1 =
    sel + `  ${st.color}${icon}${selReset}` +
    (isSelected ? ` ${A.bold}${A.brightWhite}${nameStr}${selReset}` : ` ${A.white}${nameStr}${selReset}`);

  // Line 2: prompt (dimmed, indented)
  const promptText = entry.prompt
    ? truncate(entry.prompt, cardW - 6)
    : `${A.brightBlack}(no prompt)${selReset}`;
  const line2 = sel + `    ${A.dim}${promptText}${selReset}`;

  // Line 3: all metadata in one line — stats + resumable + comments + last commit
  const meta: string[] = [];
  const metaVis: string[] = [];

  if (entry.hasWorktree && entry.filesChanged > 0) {
    const stats = `${A.brightGreen}+${entry.additions}${selReset} ${A.brightRed}−${entry.deletions}${selReset}`;
    meta.push(stats);
    metaVis.push(`+${entry.additions} −${entry.deletions}`);
  }

  if (entry.hasSession) {
    meta.push(`${A.brightGreen}resumable${selReset}`);
    metaVis.push("resumable");
  }

  if (entry.commentCount > 0) {
    meta.push(`${A.brightYellow}${entry.commentCount} comment${entry.commentCount !== 1 ? "s" : ""}${selReset}`);
    metaVis.push(`${entry.commentCount} comment${entry.commentCount !== 1 ? "s" : ""}`);
  }

  if (entry.lastCommitMsg && entry.hasWorktree) {
    const usedLen = metaVis.join("  ·  ").length;
    const maxMsg = cardW - 6 - usedLen - (usedLen > 0 ? 5 : 0) - 2;
    if (maxMsg > 8) {
      const age = entry.lastCommitAge ? `${entry.lastCommitAge} · ` : "";
      meta.push(`${A.dim}${age}${truncate(entry.lastCommitMsg, maxMsg)}${selReset}`);
    }
  } else if (!entry.hasWorktree) {
    meta.push(`${A.brightBlack}no worktree${selReset}`);
  }

  const sep = `${A.brightBlack}  ·  ${selReset}`;
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

  const title = `${A.bold}${A.brightWhite} ws dashboard${A.reset}  ${countStr}${A.reset}`;
  const hints = `${A.brightBlack}/ search  ? help  q quit${A.reset}`;

  const titleVis = ` ws dashboard  ` + (count === total ? `${total} workstream${total !== 1 ? "s" : ""}` : `${count}/${total} workstreams`);
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
    const cardLines = renderCard(entry, isSelected, s.termW - 2, s.spinnerFrame);

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

  const items = [
    `${A.brightWhite}enter${A.brightBlack} select`,
    `${A.brightWhite}/${A.brightBlack} search`,
    `${A.brightWhite}?${A.brightBlack} help`,
    `${A.brightWhite}q${A.brightBlack} quit`,
  ];

  const sep = `  ${A.brightBlack}`;
  const content = items.join(sep);
  const contentVis = stripAnsi(items.map(i => stripAnsi(i)).join("  "));
  const leftPad = Math.max(0, Math.floor((s.termW - contentVis.length) / 2));

  return moveTo(s.termH, 1) + C.footerBg +
    " ".repeat(leftPad) + A.brightBlack + content +
    " ".repeat(Math.max(0, s.termW - leftPad - contentVis.length)) + A.reset;
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
    `${A.brightYellow}Enter${A.reset}      Open action picker`,
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
  let title = "Enter prompt";
  if (s.mode === "set-prompt-input") {
    const entry = s.entries[s.filteredIndices[s.selected]];
    title = entry?.prompt ? "Edit prompt" : "Set prompt";
  } else if (s.mode === "pending-prompt-input") {
    const entry = s.entries[s.filteredIndices[s.selected]];
    title = entry?.hasPendingPrompt ? "Edit prompt" : "Set prompt";
  }
  return renderInputModal({
    title,
    value: s.promptInput,
    cursorPos: s.promptInput.length,
    termW: s.termW,
    termH: s.termH,
    footer: "Enter submit  |  Esc cancel",
  });
}

// ─── Action picker overlay ───────────────────────────────────────────────

function renderActionPicker(s: DashboardState): string {
  const entry = s.entries[s.filteredIndices[s.selected]];
  if (!entry) return "";

  const lines: string[] = [""];

  for (let i = 0; i < s.actionPickerOptions.length; i++) {
    const opt = s.actionPickerOptions[i];
    const isSel = i === s.actionPickerSelected;

    if (isSel) {
      lines.push(`${A.brightCyan}\u276F${A.reset} ${A.bold}${A.brightWhite}${opt.label}${A.reset}`);
    } else {
      lines.push(`  ${A.white}${opt.label}${A.reset}`);
    }
    lines.push(`  ${A.dim}${opt.description}${A.reset}`);
    lines.push("");
  }

  return renderModal({
    title: entry.name,
    lines,
    width: 55,
    termW: s.termW,
    termH: s.termH,
    footer: `${A.brightBlack}\u2191\u2193 select  enter confirm  esc back${A.reset}`,
  });
}

// ─── Full render ─────────────────────────────────────────────────────────────

function render(s: DashboardState): string {
  let out = hideCursor() + clearScreen() +
    renderHeader(s) +
    renderCards(s) +
    renderFooter(s);

  if (s.mode === "search") out += renderSearchBar(s);
  if (s.mode === "set-prompt-input") out += renderPromptModal(s);
  if (s.mode === "pending-prompt-input") out += renderPromptModal(s);
  if (s.mode === "help") out += renderHelpOverlay(s);
  if (s.mode === "action-picker") out += renderActionPicker(s);

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

export interface DashboardOptions {
  /** Called periodically to refresh entries while the dashboard is open. */
  onRefresh?: () => Promise<WorkstreamEntry[]>;
  /** Refresh interval in milliseconds (default: 3000). */
  refreshInterval?: number;
}

export async function openDashboard(
  entries: WorkstreamEntry[],
  options?: DashboardOptions,
): Promise<DashboardAction> {
  const state: DashboardState = {
    entries,
    filteredIndices: entries.map((_, i) => i),
    selected: 0,
    scroll: 0,
    mode: "normal",
    searchQuery: "",
    promptInput: "",
    actionPickerOptions: [],
    actionPickerSelected: 0,
    termW: process.stdout.columns ?? 120,
    termH: process.stdout.rows ?? 40,
    spinnerFrame: 0,
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

  // Spinner animation for running workstreams
  const hasRunning = () => state.entries.some(e => e.status === "running");
  let spinnerTimer: ReturnType<typeof setInterval> | null = null;
  if (hasRunning()) {
    spinnerTimer = setInterval(() => {
      if (!hasRunning()) { clearInterval(spinnerTimer!); spinnerTimer = null; return; }
      state.spinnerFrame++;
      draw();
    }, 80);
  }

  // Poll for status updates from background agents
  let refreshTimer: ReturnType<typeof setInterval> | null = null;
  if (options?.onRefresh) {
    const interval = options.refreshInterval ?? 3000;
    const doRefresh = options.onRefresh;
    refreshTimer = setInterval(async () => {
      try {
        const updated = await doRefresh();
        // Update entries in-place, preserving selection
        const selectedName = state.filteredIndices.length > 0
          ? state.entries[state.filteredIndices[state.selected]]?.name
          : undefined;
        state.entries = updated;
        refilter(state);
        // Restore selection by name
        if (selectedName) {
          const idx = state.filteredIndices.findIndex(i => state.entries[i]?.name === selectedName);
          if (idx >= 0) state.selected = idx;
        }
        clampScroll(state);
        // Start/stop spinner based on running state
        if (hasRunning() && !spinnerTimer) {
          spinnerTimer = setInterval(() => {
            if (!hasRunning()) { clearInterval(spinnerTimer!); spinnerTimer = null; return; }
            state.spinnerFrame++;
            draw();
          }, 80);
        }
        draw();
      } catch {}
    }, interval);
  }

  stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding("utf8");

  return new Promise<DashboardAction>((resolve) => {
    const cleanup = (result: DashboardAction) => {
      if (spinnerTimer) clearInterval(spinnerTimer);
      if (refreshTimer) clearInterval(refreshTimer);
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

      // ─── Action picker mode ──────────────────────────────────────
      if (state.mode === "action-picker") {
        if (key === "\x1b" || key === "q") {
          state.mode = "normal";
          draw();
          return;
        }
        if (key === "j" || key === "\x1b[B") {
          if (state.actionPickerSelected < state.actionPickerOptions.length - 1) {
            state.actionPickerSelected++;
            draw();
          }
          return;
        }
        if (key === "k" || key === "\x1b[A") {
          if (state.actionPickerSelected > 0) {
            state.actionPickerSelected--;
            draw();
          }
          return;
        }
        if (key === "\r") {
          const entry = selectedEntry();
          if (!entry) return;
          const opt = state.actionPickerOptions[state.actionPickerSelected];
          if (!opt) return;
          if (opt.action === "set-prompt-input") {
            state.mode = "set-prompt-input";
            const currentEntry = selectedEntry();
            state.promptInput = currentEntry?.prompt ?? "";
            draw();
            return;
          }
          if (opt.action === "pending-prompt-input") {
            state.mode = "pending-prompt-input";
            const currentEntry = selectedEntry();
            state.promptInput = currentEntry?.pendingPromptText ?? "";
            draw();
            return;
          }
          if (opt.action === "quit") {
            cleanup({ type: "quit" });
            return;
          }
          cleanup({ type: opt.action, name: entry.name } as DashboardAction);
          return;
        }
        if (key === "\x03") { // Ctrl+C
          state.mode = "normal";
          draw();
          return;
        }
        return;
      }

      // ─── Set-prompt input mode ─────────────────────────────────────
      if (state.mode === "set-prompt-input") {
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
            cleanup({ type: "set-prompt", name: entry.name, prompt });
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

      // ─── Pending-prompt input mode ──────────────────────────────────
      if (state.mode === "pending-prompt-input") {
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
            cleanup({ type: "save-pending-prompt", name: entry.name, prompt });
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

      // Enter — open action picker
      if (key === "\r") {
        const entry = selectedEntry();
        if (entry) {
          state.actionPickerOptions = buildActionOptions(entry);
          state.actionPickerSelected = 0;
          state.mode = "action-picker";
          draw();
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
