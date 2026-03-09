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
  const innerW = Math.min(80, opts.termW - 4);
  const textW = innerW - 4; // 2 padding each side
  const textRows = 6;       // visible lines for input text
  const contentRows = 1 + textRows + 1; // top pad + text + bottom pad
  const totalH = 1 + contentRows + (opts.footer ? 2 : 0) + 1; // title + content + footer + bottom border

  const startCol = Math.max(1, Math.floor((opts.termW - (innerW + 2)) / 2) + 1);
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

  // Empty line above text
  let row = startRow + 1;
  out += moveTo(row, startCol) +
    borderColor + "\u2502" + A.reset +
    modalBg + " ".repeat(innerW) + A.reset +
    borderColor + "\u2502" + A.reset;
  row++;

  // Wrap input value into lines of textW width
  const val = opts.value;
  const wrappedLines: string[] = [];
  for (let i = 0; i < val.length; i += textW) {
    wrappedLines.push(val.slice(i, i + textW));
  }
  if (wrappedLines.length === 0) wrappedLines.push("");

  // Show the last textRows lines (scroll to cursor)
  const visStart = Math.max(0, wrappedLines.length - textRows);
  const cursorBlock = "\u2588";

  for (let r = 0; r < textRows; r++) {
    const li = visStart + r;
    const isFirstVisible = r === 0 && visStart === 0;
    const isLastLine = li === wrappedLines.length - 1;
    const lineText = li < wrappedLines.length ? wrappedLines[li] : "";

    let rendered: string;
    if (isFirstVisible && r === 0) {
      // First row gets the "> " prefix
      if (isLastLine) {
        rendered = `${A.brightCyan}> ${A.reset}${A.brightWhite}${lineText}${A.brightCyan}${cursorBlock}${A.reset}`;
        const visLen = 2 + lineText.length + 1;
        const trail = Math.max(0, innerW - visLen - 2);
        out += moveTo(row, startCol) +
          borderColor + "\u2502" + A.reset +
          modalBg + " " + rendered + modalBg + " ".repeat(trail) + " " + A.reset +
          borderColor + "\u2502" + A.reset;
      } else {
        rendered = `${A.brightCyan}> ${A.reset}${A.brightWhite}${lineText}${A.reset}`;
        const visLen = 2 + lineText.length;
        const trail = Math.max(0, innerW - visLen - 2);
        out += moveTo(row, startCol) +
          borderColor + "\u2502" + A.reset +
          modalBg + " " + rendered + modalBg + " ".repeat(trail) + " " + A.reset +
          borderColor + "\u2502" + A.reset;
      }
    } else if (isLastLine && li < wrappedLines.length) {
      // Last line with cursor
      rendered = `${A.brightWhite}${lineText}${A.brightCyan}${cursorBlock}${A.reset}`;
      const visLen = 2 + lineText.length + 1; // indent + text + cursor
      const trail = Math.max(0, innerW - visLen - 2);
      out += moveTo(row, startCol) +
        borderColor + "\u2502" + A.reset +
        modalBg + "   " + rendered + modalBg + " ".repeat(trail) + " " + A.reset +
        borderColor + "\u2502" + A.reset;
    } else if (li < wrappedLines.length) {
      // Middle wrapped line
      rendered = `${A.brightWhite}${lineText}${A.reset}`;
      const visLen = 2 + lineText.length;
      const trail = Math.max(0, innerW - visLen - 2);
      out += moveTo(row, startCol) +
        borderColor + "\u2502" + A.reset +
        modalBg + "   " + rendered + modalBg + " ".repeat(trail) + " " + A.reset +
        borderColor + "\u2502" + A.reset;
    } else {
      // Empty row
      out += moveTo(row, startCol) +
        borderColor + "\u2502" + A.reset +
        modalBg + " ".repeat(innerW) + A.reset +
        borderColor + "\u2502" + A.reset;
    }
    row++;
  }

  // Empty line below text
  out += moveTo(row, startCol) +
    borderColor + "\u2502" + A.reset +
    modalBg + " ".repeat(innerW) + A.reset +
    borderColor + "\u2502" + A.reset;
  row++;

  // Footer
  if (opts.footer) {
    out += moveTo(row, startCol) +
      borderColor + "\u251C" + "\u2500".repeat(innerW) + "\u2524" + A.reset;
    row++;
    out += moveTo(row, startCol) +
      borderColor + "\u2502" + A.reset +
      modalBg + pad(` ${A.brightBlack}${opts.footer}${A.reset}`, innerW) + A.reset +
      borderColor + "\u2502" + A.reset;
    row++;
  }

  // Bottom border
  out += moveTo(row, startCol) +
    borderColor + "\u2514" + "\u2500".repeat(innerW) + "\u2518" + A.reset;

  return out;
}
