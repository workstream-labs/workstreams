import { Command } from "commander";
import { resolve } from "path";
import { loadConfig } from "../core/config";
import { loadState, saveState, appendWorkstreamStatus } from "../core/state";
import { WorktreeManager } from "../core/worktree";

export function checkoutCommand() {
  return new Command("checkout")
    .description("Print the worktree path for a workstream (use with: cd $(ws checkout <name>))")
    .argument("<name>", "workstream name")
    .addHelpText("after", `
Examples:
  cd $(ws checkout auth)     Navigate to the auth workstream worktree
  ws checkout auth           Print the absolute worktree path

Tip: Add a shell alias for convenience:
  alias wscd='cd $(ws checkout "$1")'
`)
    .action(async (name: string) => {
      const state = await loadState();
      if (!state) {
        console.error("Error: workstreams not initialized. Run \`ws init\` first.");
        process.exit(1);
      }

      const config = await loadConfig("workstream.yaml");
      const def = config.workstreams.find((w) => w.name === name);
      if (!def) {
        console.error(`Error: workstream "${name}" not found in workstream.yaml`);
        process.exit(1);
      }

      const worktreePath = `.workstreams/trees/${name}`;
      const { stat } = await import("fs/promises");
      const exists = await stat(worktreePath).then(() => true).catch(() => false);

      if (!exists) {
        const wt = new WorktreeManager();
        await wt.create(name, def.baseBranch);

        if (!state.currentRun) {
          state.currentRun = {
            runId: `run-${Date.now()}`,
            startedAt: new Date().toISOString(),
            workstreams: {},
          };
        }
        if (!state.currentRun.workstreams[name]) {
          state.currentRun.workstreams[name] = {
            name,
            status: "queued" as const,
            branch: `ws/${name}`,
            worktreePath,
            logFile: `.workstreams/logs/${name}.log`,
          };
        }
        await appendWorkstreamStatus(state.currentRun.workstreams[name]);
        await saveState(state);
      }

      // Print only the absolute path to stdout so it works with cd $(ws checkout <name>)
      console.log(resolve(worktreePath));
    });
}
