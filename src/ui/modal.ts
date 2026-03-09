import { A, moveTo, stripAnsi, pad } from "./ansi.js";
import { bg256, fg256 } from "./ansi.js";

const modalBg = bg256(236);
const borderColor = fg256(245);

export interface ModalOptions {
  title: string;
  lines: string[];
  width?: number;
  termW: number;
  termH: number;
  footer?: string;
}

export interface InputModalOptions {
  title: string;
  value: string;
  cursorPos: number;
  termW: number;
  termH: number;
  footer?: string;
}

function boxLine(left: string, fill: string, right: string, innerW: number): string {
  return borderColor + left + fill.repeat(innerW) + right + A.reset;
}

export function renderModal(opts: ModalOptions): string {
  const innerW = Math.min(opts.width ?? 60, opts.termW - 4);
  const totalW = innerW + 2; // +2 for border chars
  const contentH = opts.lines.length + (opts.footer ? 2 : 0);
  const totalH = contentH + 2; // +2 for top/bottom border

  const startCol = Math.max(1, Math.floor((opts.termW - totalW) / 2) + 1);
  const startRow = Math.max(1, Math.floor((opts.termH - totalH) / 2) + 1);

  let out = "";

  // Title bar
  const titleVis = ` ${stripAnsi(opts.title)} `;
  const titlePad = innerW - titleVis.length;
  const titleLeft = Math.floor(titlePad / 2);
  const titleRight = titlePad - titleLeft;
  out += moveTo(startRow, startCol) +
    borderColor + "\u250C" +
    "\u2500".repeat(titleLeft) +
    A.reset + A.bold + A.brightWhite + titleVis + A.reset +
    borderColor + "\u2500".repeat(titleRight) +
    "\u2510" + A.reset;

  // Content lines
  for (let i = 0; i < opts.lines.length; i++) {
    const line = opts.lines[i];
    out += moveTo(startRow + 1 + i, startCol) +
      borderColor + "\u2502" + A.reset +
      modalBg + pad(` ${line}`, innerW) + A.reset +
      borderColor + "\u2502" + A.reset;
  }

  // Footer separator + footer
  if (opts.footer) {
    const sepRow = startRow + 1 + opts.lines.length;
    out += moveTo(sepRow, startCol) +
      borderColor + "\u251C" + "\u2500".repeat(innerW) + "\u2524" + A.reset;
    out += moveTo(sepRow + 1, startCol) +
      borderColor + "\u2502" + A.reset +
      modalBg + pad(` ${opts.footer}`, innerW) + A.reset +
      borderColor + "\u2502" + A.reset;
  }

  // Bottom border
  const bottomRow = startRow + totalH - 1;
  out += moveTo(bottomRow, startCol) +
    borderColor + "\u2514" + "\u2500".repeat(innerW) + "\u2518" + A.reset;

  return out;
}

export function renderInputModal(opts: InputModalOptions): string {
  const innerW = Math.min(60, opts.termW - 4);
  const totalW = innerW + 2;
  const totalH = 5 + (opts.footer ? 2 : 0); // title + input + padding + bottom + footer

  const startCol = Math.max(1, Math.floor((opts.termW - totalW) / 2) + 1);
  const startRow = Math.max(1, Math.floor((opts.termH - totalH) / 2) + 1);

  let out = "";

  // Title bar
  const titleVis = ` ${stripAnsi(opts.title)} `;
  const titlePad = innerW - titleVis.length;
  const titleLeft = Math.floor(titlePad / 2);
  const titleRight = titlePad - titleLeft;
  out += moveTo(startRow, startCol) +
    borderColor + "\u250C" +
    "\u2500".repeat(titleLeft) +
    A.reset + A.bold + A.brightWhite + titleVis + A.reset +
    borderColor + "\u2500".repeat(titleRight) +
    "\u2510" + A.reset;

  // Empty line
  out += moveTo(startRow + 1, startCol) +
    borderColor + "\u2502" + A.reset +
    modalBg + " ".repeat(innerW) + A.reset +
    borderColor + "\u2502" + A.reset;

  // Input line with cursor
  const inputW = innerW - 4; // 2 padding + 2 for "> "
  const displayVal = opts.value.length > inputW
    ? opts.value.slice(opts.value.length - inputW)
    : opts.value;
  const inputLine = `${A.brightCyan}> ${A.reset}${A.brightWhite}${displayVal}${A.reset}`;
  const cursorBlock = "\u2588"; // block cursor
  const lineWithCursor = inputLine + A.brightCyan + cursorBlock + A.reset;
  const visLen = 2 + displayVal.length + 1; // "> " + value + cursor
  const trail = Math.max(0, innerW - visLen - 1);

  out += moveTo(startRow + 2, startCol) +
    borderColor + "\u2502" + A.reset +
    modalBg + " " + lineWithCursor + modalBg + " ".repeat(trail) + A.reset +
    borderColor + "\u2502" + A.reset;

  // Empty line
  out += moveTo(startRow + 3, startCol) +
    borderColor + "\u2502" + A.reset +
    modalBg + " ".repeat(innerW) + A.reset +
    borderColor + "\u2502" + A.reset;

  // Footer
  if (opts.footer) {
    out += moveTo(startRow + 4, startCol) +
      borderColor + "\u251C" + "\u2500".repeat(innerW) + "\u2524" + A.reset;
    out += moveTo(startRow + 5, startCol) +
      borderColor + "\u2502" + A.reset +
      modalBg + pad(` ${A.brightBlack}${opts.footer}${A.reset}`, innerW) + A.reset +
      borderColor + "\u2502" + A.reset;
    out += moveTo(startRow + 6, startCol) +
      borderColor + "\u2514" + "\u2500".repeat(innerW) + "\u2518" + A.reset;
  } else {
    out += moveTo(startRow + 4, startCol) +
      borderColor + "\u2514" + "\u2500".repeat(innerW) + "\u2518" + A.reset;
  }

  return out;
}
