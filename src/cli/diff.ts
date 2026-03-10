import { Command } from "commander";
import { loadState } from "../core/state.js";
import { WorktreeManager } from "../core/worktree.js";
import { openDiffViewer } from "../ui/diff-viewer.js";

export function diffCommand() {
  return new Command("diff")
    .description("View changes made by a workstream (interactive viewer for single, raw for multiple)")
    .argument("[name]", "workstream name (omit to show all diffs as raw output)")
    .option("--raw", "print raw diff output instead of interactive viewer")
    .addHelpText("after", `
Examples:
  ws diff auth-feature   Open interactive diff viewer for "auth-feature"
  ws diff                Print raw diffs for all workstreams
  ws diff auth --raw     Print raw diff instead of interactive viewer

Interactive viewer keys: j/k scroll, Tab switch panels, t toggle side-by-side,
  n/p next/prev file, d/u half-page, g/G top/bottom, q quit.
`)
    .action(async (name?: string, opts?: { raw?: boolean }) => {
      const state = await loadState();
      if (!state?.currentRun) {
        console.error("Error: no active run");
        process.exit(1);
      }

      const wt = new WorktreeManager();
      const names = name
        ? [name]
        : Object.keys(state.currentRun.workstreams);

      const useViewer = !opts?.raw && process.stdout.isTTY && names.length === 1;

      if (useViewer) {
        const n = names[0];
        const ws = state.currentRun.workstreams[n];
        if (!ws) {
          console.error(`Error: workstream "${n}" not found`);
          process.exit(1);
        }
        try {
          const diff = await wt.diffBranch(`ws/${n}`);
          await openDiffViewer(n, diff);
        } catch (e: any) {
          console.error(`Error: ${e.message}`);
          process.exit(1);
        }
        return;
      }

      // Multi-workstream or raw mode: print plain diff
      for (const n of names) {
        const ws = state.currentRun.workstreams[n];
        if (!ws) {
          console.error(`Warning: workstream "${n}" not found, skipping`);
          continue;
        }

        if (ws.status !== "success" && ws.status !== "running") continue;

        try {
          const diff = await wt.diffBranch(`ws/${n}`);
          if (diff.trim()) {
            console.log(`\x1b[1m=== ${n} ===\x1b[0m`);
            console.log(diff);
            console.log();
          }
        } catch {
          // Worktree may not exist yet
        }
      }
    });
}
