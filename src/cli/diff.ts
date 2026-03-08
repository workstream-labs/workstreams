import { Command } from "commander";
import { loadState } from "../core/state.js";
import { WorktreeManager } from "../core/worktree.js";
import { openDiffViewer } from "../ui/diff-viewer.js";

export function diffCommand() {
  return new Command("diff")
    .description("Show git diff for workstream(s)")
    .argument("[name]", "workstream name (omit for all)")
    .option("--raw", "print raw diff without the interactive viewer")
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
          const allWorkstreams = Object.keys(state.currentRun.workstreams);
          await openDiffViewer(n, diff, { workstreams: allWorkstreams });
        } catch (e: any) {
          console.error(`Error: ${e.message}`);
          process.exit(1);
        }
        return;
      }

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
