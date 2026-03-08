import { Command } from "commander";
import { loadState, saveState, defaultState } from "../core/state";
import { WorktreeManager } from "../core/worktree";
import { stringify } from "yaml";

export function destroyCommand() {
  return new Command("destroy")
    .description("Remove workstream worktrees and reset state")
    .argument("[name]", "workstream name to destroy")
    .option("--all", "destroy all workstreams and reset workstream.yaml")
    .option("-y, --yes", "skip confirmation")
    .action(async (name: string | undefined, opts: { all?: boolean; yes?: boolean }) => {
      const state = await loadState();
      if (!state) {
        console.error("Error: workstreams not initialized.");
        process.exit(1);
      }

      const run = state.currentRun;
      const wt = new WorktreeManager();

      if (opts.all) {
        // Destroy everything: all worktrees, reset state, clear workstream.yaml
        const toDestroy = run ? Object.keys(run.workstreams) : [];

        if (!opts.yes) {
          const msg = toDestroy.length > 0
            ? `Destroy all workstreams (${toDestroy.join(", ")}) and reset config?`
            : "Reset workstream config?";
          process.stdout.write(`${msg} [y/N] `);
          const reader = Bun.stdin.stream().getReader();
          const { value } = await reader.read();
          reader.releaseLock();
          const answer = new TextDecoder().decode(value).trim().toLowerCase();
          if (answer !== "y" && answer !== "yes") {
            console.log("Aborted.");
            return;
          }
        }

        for (const n of toDestroy) {
          process.stdout.write(`Removing ${n}...`);
          await wt.remove(n);
          console.log(" done");
        }

        // Reset state
        state.currentRun = undefined;
        await saveState(state);

        // Clear workstreams from yaml
        const configFile = Bun.file("workstream.yaml");
        if (await configFile.exists()) {
          const { parse } = await import("yaml");
          const raw = parse(await configFile.text());
          raw.workstreams = {};
          await Bun.write("workstream.yaml", stringify(raw));
        }

        console.log("All workstreams destroyed. workstream.yaml reset.");
        return;
      }

      // Single workstream destroy
      if (!name) {
        console.error("Specify a workstream name or use --all");
        process.exit(1);
      }

      if (!run || !run.workstreams[name]) {
        console.error(`Error: workstream "${name}" not found in current run`);
        process.exit(1);
      }

      if (!opts.yes) {
        process.stdout.write(`Destroy workstream "${name}"? [y/N] `);
        const reader = Bun.stdin.stream().getReader();
        const { value } = await reader.read();
        reader.releaseLock();
        const answer = new TextDecoder().decode(value).trim().toLowerCase();
        if (answer !== "y" && answer !== "yes") {
          console.log("Aborted.");
          return;
        }
      }

      process.stdout.write(`Removing ${name}...`);
      await wt.remove(name);
      delete run.workstreams[name];
      console.log(" done");

      if (Object.keys(run.workstreams).length === 0) {
        state.currentRun = undefined;
      }
      await saveState(state);
      console.log("Cleanup complete.");
    });
}
