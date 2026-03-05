import { Command } from "commander";
import { loadState } from "../core/state";
import { resolve } from "path";

export function switchCommand() {
  return new Command("switch")
    .description("Print worktree path for a workstream (use with cd)")
    .argument("<name>", "workstream name")
    .action(async (name: string) => {
      const state = await loadState();
      if (!state?.currentRun) {
        console.error("Error: no active run");
        process.exit(1);
      }

      const ws = state.currentRun.workstreams[name];
      if (!ws) {
        console.error(`Error: workstream "${name}" not found`);
        process.exit(1);
      }

      // Print absolute path so user can: cd $(ws switch name)
      console.log(resolve(ws.worktreePath));
    });
}
