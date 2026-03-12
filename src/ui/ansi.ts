// ─── Shared ANSI utilities ───────────────────────────────────────────────────
// Extracted from workstream-picker, choice-picker, and diff-viewer to eliminate duplication.

const ESC = "\x1b";
const CSI = ESC + "[";

export const A = {
  reset: CSI + "0m",
  bold: CSI + "1m",
  dim: CSI + "2m",
  italic: CSI + "3m",
  underline: CSI + "4m",
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
  bgBlack: CSI + "40m",
  bgRed: CSI + "41m",
  bgGreen: CSI + "42m",
  bgBlue: CSI + "44m",
  bgWhite: CSI + "47m",
  bgBrightBlack: CSI + "100m",
};

export const bg256 = (n: number) => `\x1b[48;5;${n}m`;
export const fg256 = (n: number) => `\x1b[38;5;${n}m`;

export const C = {
  selectedBg: bg256(24),
  footerBg: bg256(235),
  addLineBg: bg256(22),
  addWordBg: bg256(28),
  delLineBg: bg256(52),
  delWordBg: bg256(88),
  hunkBg: bg256(17),
  hunkAt: fg256(67),
  hunkCtx: fg256(110),
  scrollTrack: fg256(240),
};

export function moveTo(row: number, col: number) {
  return `${CSI}${row};${col}H`;
}
export function clearScreen() {
  return CSI + "2J" + moveTo(1, 1);
}
export function hideCursor() {
  return ESC + "[?25l";
}
export function showCursor() {
  return ESC + "[?25h";
}
export function enterAltScreen() {
  return ESC + "[?1049h";
}
export function exitAltScreen() {
  return ESC + "[?1049l";
}

export function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;]*m/g, "");
}

export function truncate(s: string, width: number): string {
  if (s.length <= width) return s;
  return s.slice(0, width - 1) + "\u2026";
}

export function pad(str: string, width: number, align: "left" | "right" = "left"): string {
  const len = stripAnsi(str).length;
  if (len >= width) return str;
  const spaces = " ".repeat(width - len);
  return align === "right" ? spaces + str : str + spaces;
}

export const STATUS_STYLE: Record<string, { color: string; icon: string }> = {
  success: { color: A.brightGreen, icon: "\u2713" },
  failed: { color: A.brightRed, icon: "\u2717" },
  running: { color: A.brightYellow, icon: "\u25CF" },
  queued: { color: A.cyan, icon: "\u25C9" },
  ready: { color: A.brightBlack, icon: "\u25CB" },
  workspace: { color: A.brightBlue, icon: "\u25C7" },
};
