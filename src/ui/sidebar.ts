import { $ } from "bun";
import {
  A, C, bg256,
  moveTo, clearScreen, hideCursor, showCursor,
  enterAltScreen, exitAltScreen,
  stripAnsi, truncate, STATUS_STYLE,
} from "./ansi.js";
import type { WorkstreamEntry } from "./workstream-picker.js";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ActionOption {
  label: string;
  description: string;
}

export interface SidebarCallbacks {
  onNavigate: (name: string) => Promise<void>;
  getActions: (entry: WorkstreamEntry) => ActionOption[];
  onAction: (name: string, label: string) => Promise<void>;
}

type SidebarMode = "normal" | "action-picker";

// ─── Rendering ───────────────────────────────────────────────────────────────

const CARD_H = 3;

function renderNormal(
  entries: WorkstreamEntry[],
  selected: number,
  attachedName: string | null,
  termW: number,
  termH: number,
): string {
  const w = termW;
  let out = hideCursor() + clearScreen();

  // Header
  out += moveTo(1, 1) + A.bgBrightBlack + A.brightWhite + ` ws` + " ".repeat(Math.max(0, w - 3)) + A.reset;
  out += moveTo(2, 1) + A.brightBlack + "\u2500".repeat(w) + A.reset;

  // Cards
  const startRow = 3;
  const maxCards = Math.floor((termH - 4) / CARD_H);
  let scroll = 0;
  if (selected >= maxCards) scroll = selected - maxCards + 1;
  scroll = Math.min(scroll, Math.max(0, entries.length - maxCards));

  for (let vi = 0; vi < maxCards; vi++) {
    const idx = scroll + vi;
    const row = startRow + vi * CARD_H;

    if (idx >= entries.length) {
      for (let r = 0; r < CARD_H; r++) out += moveTo(row + r, 1) + " ".repeat(w);
      continue;
    }

    const entry = entries[idx];
    const isSel = idx === selected;
    const isAttached = entry.name === attachedName;
    const st = STATUS_STYLE[entry.status] ?? STATUS_STYLE.pending;
    const bg = isSel ? C.selectedBg : "";
    const rs = isSel ? A.reset + C.selectedBg : A.reset;

    const nameStr = truncate(entry.name, w - 6);
    const attach = isAttached ? ` ${A.brightCyan}\u2197${rs}` : "";
    const cursor = isSel ? `${A.brightCyan}\u276F${rs}` : " ";
    const line1 = bg + ` ${cursor} ${st.color}${st.icon}${rs} ` +
      (isSel ? `${A.bold}${A.brightWhite}${nameStr}${rs}` : `${A.white}${nameStr}${rs}`) + attach;

    const prompt = entry.prompt ? truncate(entry.prompt, w - 6) : `${A.brightBlack}(no prompt)`;
    const line2 = bg + `     ${A.dim}${prompt}${rs}`;

    const l1v = stripAnsi(line1).length;
    out += moveTo(row, 1) + line1 + bg + " ".repeat(Math.max(0, w - l1v)) + A.reset;
    const l2v = stripAnsi(line2).length;
    out += moveTo(row + 1, 1) + line2 + bg + " ".repeat(Math.max(0, w - l2v)) + A.reset;
    out += moveTo(row + 2, 1) + " ".repeat(w);
  }

  // Fill remaining
  const used = startRow + maxCards * CARD_H;
  for (let r = used; r < termH - 1; r++) out += moveTo(r, 1) + " ".repeat(w);

  // Footer
  const ft = `${A.brightWhite}\u2191\u2193${A.brightBlack} nav ${A.brightWhite}enter${A.brightBlack} act ${A.brightWhite}tab${A.brightBlack} \u21C6${A.reset}`;
  out += moveTo(termH, 1) + C.footerBg + ` ${ft}` +
    " ".repeat(Math.max(0, w - stripAnsi(ft).length - 1)) + A.reset;

  return out;
}

function renderActionPicker(
  entryName: string,
  actions: ActionOption[],
  pickerSelected: number,
  termW: number,
  termH: number,
): string {
  const w = termW;
  let out = hideCursor() + clearScreen();

  // Header — workstream name
  const header = ` ${truncate(entryName, w - 2)}`;
  out += moveTo(1, 1) + A.bgBrightBlack + A.bold + A.brightWhite +
    header + " ".repeat(Math.max(0, w - stripAnsi(header).length)) + A.reset;
  out += moveTo(2, 1) + A.brightBlack + "\u2500".repeat(w) + A.reset;

  // Action list
  let row = 4;
  for (let i = 0; i < actions.length; i++) {
    const isSel = i === pickerSelected;
    const bg = isSel ? C.selectedBg : "";
    const rs = isSel ? A.reset + C.selectedBg : A.reset;

    const cursor = isSel ? `${A.brightCyan}\u276F${rs}` : " ";
    const label = truncate(actions[i].label, w - 4);
    const line1 = bg + ` ${cursor} ` +
      (isSel ? `${A.bold}${A.brightWhite}${label}${rs}` : `${A.white}${label}${rs}`);

    const l1v = stripAnsi(line1).length;
    out += moveTo(row, 1) + line1 + bg + " ".repeat(Math.max(0, w - l1v)) + A.reset;
    out += moveTo(row + 1, 1) + " ".repeat(w);
    row += 2;
  }

  // Fill remaining
  for (let r = row; r < termH - 1; r++) out += moveTo(r, 1) + " ".repeat(w);

  // Footer
  const ft = `${A.brightWhite}\u2191\u2193${A.brightBlack} nav  ${A.brightWhite}enter${A.brightBlack} ok  ${A.brightWhite}esc${A.brightBlack} back${A.reset}`;
  out += moveTo(termH, 1) + C.footerBg + ` ${ft}` +
    " ".repeat(Math.max(0, w - stripAnsi(ft).length - 1)) + A.reset;

  return out;
}

// ─── Main entry ──────────────────────────────────────────────────────────────

export async function openSidebar(
  entries: WorkstreamEntry[],
  callbacks: SidebarCallbacks,
): Promise<void> {
  if (entries.length === 0) return;

  let mode: SidebarMode = "normal";
  let selected = 0;
  let attachedName: string | null = null;
  let pickerActions: ActionOption[] = [];
  let pickerSelected = 0;
  let termW = process.stdout.columns ?? 30;
  let termH = process.stdout.rows ?? 40;

  const stdin = process.stdin;
  const stdout = process.stdout;

  stdout.write(enterAltScreen() + hideCursor());

  const draw = () => {
    if (mode === "action-picker") {
      const name = entries[selected]?.name ?? "";
      stdout.write(renderActionPicker(name, pickerActions, pickerSelected, termW, termH));
    } else {
      stdout.write(renderNormal(entries, selected, attachedName, termW, termH));
    }
  };

  const showEntry = async (idx: number) => {
    const entry = entries[idx];
    if (entry) {
      attachedName = entry.name;
      draw();
      await callbacks.onNavigate(entry.name);
    }
  };

  // Show the first workstream immediately
  await showEntry(0);

  const onResize = () => {
    termW = process.stdout.columns ?? 30;
    termH = process.stdout.rows ?? 40;
    draw();
  };
  process.stdout.on("resize", onResize);

  stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding("utf8");

  return new Promise<void>((resolve) => {
    const cleanup = () => {
      stdin.off("data", onData);
      stdin.setRawMode(false);
      stdin.pause();
      process.stdout.off("resize", onResize);
      stdout.write(showCursor() + exitAltScreen());
      resolve();
    };

    const onData = async (key: string) => {
      // ── Action picker mode ──────────────────────────────────────
      if (mode === "action-picker") {
        if (key === "\x1b" || key === "q" || key === "\x03") {
          mode = "normal";
          draw();
          return;
        }
        if (key === "\x1b[B") {
          if (pickerSelected < pickerActions.length - 1) pickerSelected++;
          draw();
          return;
        }
        if (key === "\x1b[A") {
          if (pickerSelected > 0) pickerSelected--;
          draw();
          return;
        }
        if (key === "\r") {
          const action = pickerActions[pickerSelected];
          const entry = entries[selected];
          if (action && entry) {
            mode = "normal";
            draw();
            await callbacks.onAction(entry.name, action.label);
            draw();
          }
          return;
        }
        return;
      }

      // ── Normal mode ─────────────────────────────────────────────
      if (key === "q" || key === "\x1b" || key === "\x03") {
        cleanup();
        return;
      }

      // Navigate — swap Claude session on the right
      if (key === "\x1b[B") {
        if (selected < entries.length - 1) {
          selected++;
          await showEntry(selected);
        }
        return;
      }
      if (key === "\x1b[A") {
        if (selected > 0) {
          selected--;
          await showEntry(selected);
        }
        return;
      }

      // Tab — focus the right pane
      if (key === "\t") {
        $`tmux select-pane -R`.quiet().catch(() => {});
        return;
      }

      // Enter — open inline action picker
      if (key === "\r") {
        const entry = entries[selected];
        if (entry) {
          pickerActions = callbacks.getActions(entry);
          if (pickerActions.length > 0) {
            pickerSelected = 0;
            mode = "action-picker";
            draw();
          }
        }
        return;
      }
    };

    stdin.on("data", onData);
  });
}
