import {
  A, C, bg256, fg256,
  moveTo, clearScreen, hideCursor, showCursor,
  enterAltScreen, exitAltScreen,
  stripAnsi, pad,
} from "./ansi.js";
import { renderModal } from "./modal.js";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ChoiceOption {
  label: string;
  description?: string;
}

// ─── Rendering ───────────────────────────────────────────────────────────────

interface State {
  title: string;
  options: ChoiceOption[];
  selected: number;
  termW: number;
  termH: number;
}

function render(s: State): string {
  const lines: string[] = [];

  for (let i = 0; i < s.options.length; i++) {
    const opt = s.options[i];
    const selected = i === s.selected;
    const desc = opt.description ? `  ${A.brightBlack}${opt.description}${A.reset}` : "";

    if (selected) {
      lines.push(
        `${A.brightCyan}\u276F${A.reset} ${A.bold}${A.brightWhite}${opt.label}${A.reset}${desc}`
      );
    } else {
      lines.push(
        `  ${A.white}${opt.label}${A.reset}${desc}`
      );
    }
  }

  return hideCursor() + clearScreen() + renderModal({
    title: s.title,
    lines,
    width: 50,
    termW: s.termW,
    termH: s.termH,
    footer: `${A.brightBlack}\u2191\u2193 select  |  enter confirm  |  q back${A.reset}`,
  });
}

// ─── Main ────────────────────────────────────────────────────────────────────

export async function openChoicePicker(
  title: string,
  options: ChoiceOption[],
): Promise<number | null> {
  if (options.length === 0) return null;

  const state: State = {
    title,
    options,
    selected: 0,
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
    draw();
  };
  process.stdout.on("resize", onResize);

  stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding("utf8");

  return new Promise<number | null>((resolve) => {
    const cleanup = (result: number | null) => {
      stdin.off("data", onData);
      stdin.setRawMode(false);
      stdin.pause();
      process.stdout.off("resize", onResize);
      stdout.write(showCursor() + exitAltScreen());
      resolve(result);
    };

    const onData = (key: string) => {
      // Quit / back
      if (key === "q" || key === "\x03" || key === "\x1b") {
        cleanup(null);
        return;
      }

      // Enter — confirm
      if (key === "\r") {
        cleanup(state.selected);
        return;
      }

      // Up
      if (key === "\x1b[A" || key === "k") {
        if (state.selected > 0) state.selected--;
        draw();
        return;
      }

      // Down
      if (key === "\x1b[B" || key === "j") {
        if (state.selected < state.options.length - 1) state.selected++;
        draw();
        return;
      }
    };

    stdin.on("data", onData);
  });
}
