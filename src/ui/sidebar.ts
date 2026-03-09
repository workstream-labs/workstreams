import { $ } from "bun";
import {
  A, C,
  moveTo, clearScreen, hideCursor, showCursor,
  enterAltScreen, exitAltScreen,
  stripAnsi, truncate, STATUS_STYLE,
} from "./ansi.js";
import type { WorkstreamEntry } from "./workstream-picker.js";

// ─── Rendering ───────────────────────────────────────────────────────────────

const CARD_H = 3;

function render(
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
  const ft = `${A.brightWhite}\u2191\u2193${A.brightBlack} nav ${A.brightWhite}enter${A.brightBlack} open ${A.brightWhite}tab${A.brightBlack} \u21C6${A.reset}`;
  out += moveTo(termH, 1) + C.footerBg + ` ${ft}` +
    " ".repeat(Math.max(0, w - stripAnsi(ft).length - 1)) + A.reset;

  return out;
}

// ─── Main entry ──────────────────────────────────────────────────────────────

export async function openSidebar(
  entries: WorkstreamEntry[],
  onSelect: (name: string) => Promise<void>,
  initialName?: string,
): Promise<void> {
  if (entries.length === 0) return;

  let selected = initialName ? Math.max(0, entries.findIndex(e => e.name === initialName)) : 0;
  let attachedName: string | null = initialName ?? null;
  let termW = process.stdout.columns ?? 30;
  let termH = process.stdout.rows ?? 40;

  const stdin = process.stdin;
  const stdout = process.stdout;

  stdout.write(enterAltScreen() + hideCursor());

  const draw = () => {
    stdout.write(render(entries, selected, attachedName, termW, termH));
  };
  draw();

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
      // Quit
      if (key === "q" || key === "\x1b" || key === "\x03") {
        cleanup();
        return;
      }

      // Navigate
      if (key === "\x1b[B") {
        if (selected < entries.length - 1) selected++;
        draw();
        return;
      }
      if (key === "\x1b[A") {
        if (selected > 0) selected--;
        draw();
        return;
      }

      // Tab — focus the right pane
      if (key === "\t") {
        $`tmux select-pane -R`.quiet().catch(() => {});
        return;
      }

      // Enter — switch Claude session to selected workstream
      if (key === "\r") {
        const entry = entries[selected];
        if (entry) {
          attachedName = entry.name;
          draw();
          await onSelect(entry.name);
        }
        return;
      }
    };

    stdin.on("data", onData);
  });
}
