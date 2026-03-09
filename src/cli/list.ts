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

export function listCommand() {
  return new Command("list")
    .description("List workstreams from config")
    .option("-c, --config <path>", "config file path", "workstream.yaml")
    .action(async (opts: { config: string }) => {
      const config = await loadConfig(opts.config);
      const state = await loadState();
      const { stat } = await import("fs/promises");

      if (config.workstreams.length === 0) {
        console.log('No workstreams defined. Add one with: ws create <name>');
        return;
      }

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

        if (hasWorktree) {
          const [info, stats] = await Promise.all([
            getBranchInfo(branch),
            getDiffStats(branch),
          ]);

          const ab = info.ahead || info.behind
            ? `${A.brightGreen}↑${info.ahead}${A.reset} ${A.brightRed}↓${info.behind}${A.reset}`
            : `${A.brightBlack}=${A.reset}`;

          const diffStr = stats.filesChanged > 0
            ? `  ${A.brightGreen}+${stats.additions}${A.reset} ${A.brightRed}-${stats.deletions}${A.reset}`
            : "";

          const age = info.lastCommitAge ? `  ${A.brightBlack}${info.lastCommitAge}${A.reset}` : "";
          const msg = info.lastCommitMsg
            ? `  ${A.dim}${info.lastCommitMsg.length > 50 ? info.lastCommitMsg.slice(0, 47) + "..." : info.lastCommitMsg}${A.reset}`
            : "";

          console.log(
            `${st.color}${st.icon}${A.reset} ${A.bold}${def.name}${A.reset}` +
            `  ${ab}${diffStr}${age}${msg}`
          );
        } else {
          const label = def.prompt ? "" : `  ${A.brightBlack}(workspace)${A.reset}`;
          console.log(
            `${st.color}${st.icon}${A.reset} ${A.bold}${def.name}${A.reset}` +
            `  ${A.brightBlack}no worktree${A.reset}${label}`
          );
        }
      }
    });
}
