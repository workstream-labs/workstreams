import { A, hideCursor, showCursor, stripAnsi } from "./ansi.js";

export interface InlinePickerOption {
  label: string;
  hint?: string;
}

/**
 * Claude Code CLI-style inline picker.
 * Renders a `? prompt` with `❯` cursor navigation directly in the terminal
 * (no alternate screen). Returns selected index or null on cancel.
 */
export async function openInlinePicker(
  prompt: string,
  options: InlinePickerOption[],
): Promise<number | null> {
  if (options.length === 0) return null;

  const stdin = process.stdin;
  const stdout = process.stdout;

  let selected = 0;

  const CLEAR_LINE = "\x1b[2K";
  const MOVE_UP = "\x1b[A";
  const MOVE_COL1 = "\r";

  // Number of lines we've rendered (prompt + options)
  const totalLines = 1 + options.length;

  function render(first: boolean) {
    // Move cursor to start of our block (overwrite previous render)
    if (!first) {
      stdout.write(MOVE_COL1);
      for (let i = 0; i < totalLines - 1; i++) {
        stdout.write(MOVE_UP);
      }
    }

    // Prompt line
    stdout.write(`${CLEAR_LINE}${A.dim}${A.cyan}?${A.reset} ${A.bold}${prompt}${A.reset}\n`);

    // Options
    for (let i = 0; i < options.length; i++) {
      const opt = options[i];
      const hint = opt.hint ? `${A.dim} ${opt.hint}${A.reset}` : "";

      if (i === selected) {
        stdout.write(
          `${CLEAR_LINE}  ${A.cyan}❯${A.reset} ${A.bold}${A.cyan}${opt.label}${A.reset}${hint}\n`
        );
      } else {
        stdout.write(
          `${CLEAR_LINE}    ${A.dim}${opt.label}${A.reset}${hint}\n`
        );
      }
    }
  }

  stdout.write(hideCursor());
  render(true);

  stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding("utf8");

  return new Promise<number | null>((resolve) => {
    const cleanup = (result: number | null) => {
      stdin.off("data", onData);
      stdin.setRawMode(false);
      stdin.pause();

      // Clear the picker output
      stdout.write(MOVE_COL1);
      for (let i = 0; i < totalLines - 1; i++) {
        stdout.write(MOVE_UP);
      }
      for (let i = 0; i < totalLines; i++) {
        stdout.write(`${CLEAR_LINE}\n`);
      }
      stdout.write(MOVE_COL1);
      for (let i = 0; i < totalLines - 1; i++) {
        stdout.write(MOVE_UP);
      }

      if (result !== null) {
        // Print confirmation
        const chosen = options[result].label;
        stdout.write(
          `${A.green}✔${A.reset} ${A.bold}${prompt}${A.reset} ${A.cyan}${chosen}${A.reset}\n`
        );
      }

      stdout.write(showCursor());
      resolve(result);
    };

    const onData = (key: string) => {
      // Ctrl+C or Escape — cancel
      if (key === "\x03" || key === "\x1b") {
        cleanup(null);
        return;
      }

      // Enter — confirm
      if (key === "\r") {
        cleanup(selected);
        return;
      }

      // Up arrow or k
      if (key === "\x1b[A" || key === "k") {
        if (selected > 0) {
          selected--;
          render(false);
        }
        return;
      }

      // Down arrow or j
      if (key === "\x1b[B" || key === "j") {
        if (selected < options.length - 1) {
          selected++;
          render(false);
        }
        return;
      }
    };

    stdin.on("data", onData);
  });
}
