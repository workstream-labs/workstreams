import { Command } from "commander";
import { loadState } from "../core/state";
import { WorktreeManager } from "../core/worktree";

export function diffCommand() {
  return new Command("diff")
    .description("Show git diff for workstream(s)")
    .argument("[name]", "workstream name (omit for all)")
    .action(async (name?: string) => {
      const state = await loadState();
      if (!state?.currentRun) {
        console.error("Error: no active run");
        process.exit(1);
      }

      const wt = new WorktreeManager();
      const names = name
        ? [name]
        : Object.keys(state.currentRun.workstreams);

      for (const n of names) {
        const ws = state.currentRun.workstreams[n];
        if (!ws) {
          console.error(`Warning: workstream "${n}" not found, skipping`);
          continue;
        }

        if (ws.status !== "success" && ws.status !== "running") continue;

        try {
          const diff = await wt.diff(n);
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
