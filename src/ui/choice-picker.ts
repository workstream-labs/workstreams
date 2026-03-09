// ─── ANSI helpers ────────────────────────────────────────────────────────────

const ESC = "\x1b";
const CSI = ESC + "[";

const A = {
  reset: CSI + "0m",
  bold: CSI + "1m",
  dim: CSI + "2m",
  brightBlack: CSI + "90m",
  brightWhite: CSI + "97m",
  brightCyan: CSI + "96m",
  brightYellow: CSI + "93m",
  bgBrightBlack: CSI + "100m",
};

const bg256 = (n: number) => `\x1b[48;5;${n}m`;
const fg256 = (n: number) => `\x1b[38;5;${n}m`;

const C = {
  selectedBg: bg256(24),
  footerBg: bg256(235),
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

function pad(str: string, width: number): string {
  const len = stripAnsi(str).length;
  if (len >= width) return str;
  return str + " ".repeat(width - len);
}

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
  scroll: number;
  termW: number;
  termH: number;
}

function renderHeader(s: State): string {
  const title = `${A.bold}${A.brightWhite} ${s.title}${A.reset}`;
  const count = `${A.brightBlack}${s.options.length} option${s.options.length !== 1 ? "s" : ""}${A.reset}`;
  const keys = `${A.brightBlack}↑↓ select  │  enter confirm  │  q back${A.reset}`;
  const row1 = ` ${title}  ${count}${"  "}${keys} `;
  const divider = A.brightBlack + "─".repeat(s.termW) + A.reset;
  return moveTo(1, 1) + A.bgBrightBlack + A.brightWhite + pad(row1, s.termW) + A.reset + "\n" + divider;
}

function renderOptions(s: State): string {
  const contentH = s.termH - 3; // header(2) + footer(1)
  let out = "";

  for (let i = 0; i < contentH; i++) {
    const idx = s.scroll + i;
    const opt = s.options[idx];
    const row = 3 + i;

    if (!opt) {
      out += moveTo(row, 1) + " ".repeat(s.termW);
      continue;
    }

    const selected = idx === s.selected;
    const desc = opt.description ? `  ${A.brightBlack}${opt.description}${A.reset}` : "";

    let line: string;
    if (selected) {
      const cursor = `${A.brightCyan}▶${A.reset}`;
      line =
        C.selectedBg + ` ${cursor}${C.selectedBg} ` +
        A.bold + A.brightWhite + opt.label + A.reset +
        C.selectedBg + desc + C.selectedBg;
      const visLen = stripAnsi(` ▶ ${opt.label}` + (opt.description ? `  ${opt.description}` : "")).length;
      const trailing = Math.max(0, s.termW - visLen);
      line += " ".repeat(trailing) + A.reset;
    } else {
      line =
        `   ${A.brightWhite}${opt.label}${A.reset}` + desc;
      const visLen = stripAnsi(`   ${opt.label}` + (opt.description ? `  ${opt.description}` : "")).length;
      const trailing = Math.max(0, s.termW - visLen);
      line += " ".repeat(trailing);
    }

    out += moveTo(row, 1) + line;
  }

  return out;
}

function renderFooter(s: State): string {
  const sep = A.brightBlack + "  │  " + A.brightWhite;
  const items = [
    `${A.brightYellow}↑↓${A.brightWhite} select`,
    `${A.brightYellow}enter${A.brightWhite} confirm`,
    `${A.brightYellow}q${A.brightWhite} back`,
  ];
  const help = C.footerBg + A.brightWhite + "  " + items.join(sep) + "  " + A.reset;
  return moveTo(s.termH, 1) + C.footerBg + pad(help, s.termW) + A.reset;
}

function render(s: State): string {
  return (
    hideCursor() +
    clearScreen() +
    renderHeader(s) +
    renderOptions(s) +
    renderFooter(s)
  );
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
    scroll: 0,
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
      const contentH = state.termH - 3;
      const maxScroll = Math.max(0, state.options.length - contentH);

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
        if (state.selected > 0) {
          state.selected--;
          if (state.selected < state.scroll) state.scroll = state.selected;
        }
        draw();
        return;
      }

      // Down
      if (key === "\x1b[B" || key === "j") {
        if (state.selected < state.options.length - 1) {
          state.selected++;
          if (state.selected >= state.scroll + contentH) state.scroll = state.selected - contentH + 1;
        }
        draw();
        return;
      }
    };

    stdin.on("data", onData);
  });
}
