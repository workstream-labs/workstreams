import { Command } from "commander";
import { loadConfig } from "../core/config";
import { loadState } from "../core/state";
import { getBranchInfo, getDiffStats } from "../ui/workstream-picker.js";

const A = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  brightBlack: "\x1b[90m",
  brightGreen: "\x1b[92m",
  brightRed: "\x1b[91m",
  brightYellow: "\x1b[93m",
  brightCyan: "\x1b[96m",
  brightBlue: "\x1b[94m",
  white: "\x1b[37m",
};

const STATUS_STYLE: Record<string, { color: string; icon: string }> = {
  success: { color: A.brightGreen, icon: "✓" },
  failed: { color: A.brightRed, icon: "✗" },
  running: { color: A.brightYellow, icon: "●" },
  pending: { color: A.brightBlack, icon: "○" },
  queued: { color: A.brightCyan, icon: "◉" },
  waiting: { color: A.brightYellow, icon: "⏸" },
  workspace: { color: A.brightBlue, icon: "◇" },
};

// Column widths
const COL = {
  status: 3,   // icon + space
  name: 24,
  sync: 8,
  changes: 12,
  duration: 10,
  age: 14,
  // commit message takes the rest
};

function formatDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  if (h < 24) return rm > 0 ? `${h}h ${rm}m` : `${h}h`;
  const d = Math.floor(h / 24);
  return `${d}d`;
}

export async function listAction(configPath: string = "workstream.yaml") {
  const config = await loadConfig(configPath);
  const state = await loadState();
  const { stat } = await import("fs/promises");

  if (config.workstreams.length === 0) {
    console.log("No workstreams defined. Add one with: ws create <name>");
    return;
  }

  // Header
  const header =
    `${A.dim}  ` +
    "S".padEnd(COL.status) +
    "Name".padEnd(COL.name) +
    "Sync".padEnd(COL.sync) +
    "Changes".padEnd(COL.changes) +
    "Duration".padEnd(COL.duration) +
    "Last Commit" +
    A.reset;
  console.log(header);
  console.log(`${A.dim}  ${"─".repeat(COL.status + COL.name + COL.sync + COL.changes + COL.duration + COL.age + 20)}${A.reset}`);

  for (const def of config.workstreams) {
    const branch = `ws/${def.name}`;
    const worktreePath = `.workstreams/trees/${def.name}`;
    const hasWorktree = await stat(worktreePath).then(() => true).catch(() => false);

    // Status
    let status = "workspace";
    if (state?.currentRun?.workstreams?.[def.name]) {
      status = state.currentRun.workstreams[def.name].status;
    } else if (def.prompt) {
      status = "pending";
    }
    const st = STATUS_STYLE[status] ?? STATUS_STYLE.pending;

    // Duration from run state
    let durationStr = "";
    const ws = state?.currentRun?.workstreams?.[def.name];
    if (ws?.startedAt) {
      const start = new Date(ws.startedAt).getTime();
      const end = ws.finishedAt ? new Date(ws.finishedAt).getTime() : Date.now();
      durationStr = formatDuration(end - start);
    }

    if (hasWorktree) {
      const [info, stats] = await Promise.all([
        getBranchInfo(branch),
        getDiffStats(branch),
      ]);

      const abPlain = info.ahead || info.behind
        ? `↑${info.ahead} ↓${info.behind}`
        : "=";
      const abColor = info.ahead || info.behind
        ? `${A.brightGreen}↑${info.ahead}${A.reset} ${A.brightRed}↓${info.behind}${A.reset}`
        : `${A.brightBlack}=${A.reset}`;

      const changesPlain = stats.filesChanged > 0
        ? `+${stats.additions} -${stats.deletions}`
        : "";
      const changesColor = stats.filesChanged > 0
        ? `${A.brightGreen}+${stats.additions}${A.reset} ${A.brightRed}-${stats.deletions}${A.reset}`
        : "";

      const age = info.lastCommitAge || "";
      const msg = info.lastCommitMsg
        ? (info.lastCommitMsg.length > 40 ? info.lastCommitMsg.slice(0, 37) + "..." : info.lastCommitMsg)
        : "";

      // Pad using plain-text lengths, render with colors
      const abPad = " ".repeat(Math.max(0, COL.sync - abPlain.length));
      const changesPad = " ".repeat(Math.max(0, COL.changes - changesPlain.length));

      console.log(
        `  ${st.color}${st.icon}${A.reset} ` +
        `${A.bold}${def.name.padEnd(COL.name)}${A.reset}` +
        abColor + abPad +
        changesColor + changesPad +
        durationStr.padEnd(COL.duration) +
        `${A.brightBlack}${age.padEnd(COL.age)}${A.reset}` +
        `${A.dim}${msg}${A.reset}`
      );
    } else {
      const label = def.prompt ? "" : `  ${A.brightBlack}(workspace)${A.reset}`;
      console.log(
        `  ${st.color}${st.icon}${A.reset} ` +
        `${A.bold}${def.name.padEnd(COL.name)}${A.reset}` +
        `${A.brightBlack}no worktree${A.reset}${label}`
      );
    }
  }
}

export function listCommand() {
  return new Command("list")
    .description("List workstreams and their status")
    .option("-c, --config <path>", "config file path", "workstream.yaml")
    .action(async (opts: { config: string }) => {
      await listAction(opts.config);
    });
}
