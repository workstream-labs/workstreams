import { Command } from "commander";
import { loadState, saveState } from "../core/state";
import { WorktreeManager } from "../core/worktree";

export function destroyCommand() {
  return new Command("destroy")
    .description("Remove workstream worktrees and clean state")
    .argument("[name]", "workstream name to destroy")
    .option("--all", "destroy all workstreams")
    .option("--nuke", "destroy everything including .workstreams/ and workstream.yaml")
    .option("-y, --yes", "skip confirmation")
    .action(async (name: string | undefined, opts: { all?: boolean; nuke?: boolean; yes?: boolean }) => {
      const state = await loadState();
      if (!state) {
        console.error("Error: workstreams not initialized.");
        process.exit(1);
      }

      const run = state.currentRun;
      if (!run && !opts.nuke) {
        console.log("No active run to destroy.");
        return;
      }

      const wt = new WorktreeManager();
      const toDestroy = !run
        ? []
        : opts.all || opts.nuke
        ? Object.keys(run.workstreams)
        : name
          ? [name]
          : [];

      if (toDestroy.length === 0 && !opts.nuke) {
        console.error("Specify a workstream name or use --all");
        process.exit(1);
      }

      // Validate names exist
      for (const n of toDestroy) {
        if (!run.workstreams[n]) {
          console.error(`Error: workstream "${n}" not found in current run`);
          process.exit(1);
        }
      }

      if (!opts.yes) {
        const names = toDestroy.join(", ");
        process.stdout.write(
          `Destroy workstream(s): ${names}? [y/N] `
        );
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
        delete run.workstreams[n];
        console.log(" done");
      }

      if (Object.keys(run.workstreams).length === 0) {
        state.currentRun = undefined;
      }

      await saveState(state);

      if (opts.nuke) {
        const { rm } = await import("fs/promises");
        await rm(".workstreams", { recursive: true, force: true });
        await rm("workstream.yaml", { force: true });
        console.log("Nuked .workstreams/ and workstream.yaml");
      } else {
        console.log("Cleanup complete.");
      }
    });
}
