import { Command } from "commander";
import { loadState, saveState, defaultState } from "@workstreams/core";
import { WorktreeManager } from "@workstreams/core";
import { parse, stringify } from "yaml";
import { rm, unlink } from "fs/promises";

export function destroyCommand() {
  return new Command("destroy")
    .description("Remove a workstream (worktree, config entry, state, logs, comments)")
    .argument("[name]", "workstream name to destroy")
    .option("--all", "destroy everything: all worktrees, workstream.yaml, and .workstreams/")
    .option("-y, --yes", "skip confirmation")
    .addHelpText("after", `
Examples:
  ws destroy auth-feature    Remove the "auth-feature" workstream entirely
  ws destroy --all           Tear down all workstreams and remove config files
  ws destroy --all -y        Same as above, skip confirmation prompt
`)
    .action(async (name: string | undefined, opts: { all?: boolean; yes?: boolean }) => {
      const state = await loadState();
      if (!state) {
        console.error("Error: workstreams not initialized.");
        process.exit(1);
      }

      const run = state.currentRun;
      const wt = new WorktreeManager();

      if (opts.all) {
        // Destroy everything: all worktrees, delete workstream.yaml and .workstreams/
        const toDestroy = run ? Object.keys(run.workstreams) : [];

        if (!opts.yes) {
          const msg = toDestroy.length > 0
            ? `Destroy all workstreams (${toDestroy.join(", ")}), workstream.yaml, and .workstreams/?`
            : "Delete workstream.yaml and .workstreams/?";
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

        // Delete workstream.yaml entirely
        await unlink("workstream.yaml").catch(() => {});

        // Delete .workstreams/ directory recursively
        await rm(".workstreams", { recursive: true, force: true }).catch(() => {});

        console.log("All workstreams destroyed. workstream.yaml and .workstreams/ removed.");
        return;
      }

      // Single workstream destroy
      if (!name) {
        console.error("Error: specify a workstream name or use --all to destroy everything.");
        console.error("\nUsage:");
        console.error("  ws destroy <name>    Destroy a single workstream");
        console.error("  ws destroy --all     Destroy all workstreams and config files");
        process.exit(1);
      }

      if (!run || !run.workstreams[name]) {
        console.error(`Error: workstream "${name}" not found in current run`);
        process.exit(1);
      }

      const wsStatus = run.workstreams[name].status;
      if ((wsStatus === "running" || wsStatus === "queued") && !opts.yes) {
        console.error(`Warning: "${name}" is currently ${wsStatus}.`);
        process.stdout.write(`Destroy it anyway? [y/N] `);
        const reader = Bun.stdin.stream().getReader();
        const { value } = await reader.read();
        reader.releaseLock();
        const answer = new TextDecoder().decode(value).trim().toLowerCase();
        if (answer !== "y" && answer !== "yes") {
          console.log("Aborted.");
          return;
        }
      } else if (!opts.yes) {
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

      // Remove entry from workstream.yaml
      const configFile = Bun.file("workstream.yaml");
      if (await configFile.exists()) {
        const raw = parse(await configFile.text());
        if (raw.workstreams && raw.workstreams[name]) {
          delete raw.workstreams[name];
          await Bun.write("workstream.yaml", stringify(raw));
        }
      }

      // Delete comments and log files
      await unlink(`.workstreams/comments/${name}.json`).catch(() => {});
      await unlink(`.workstreams/logs/${name}.log`).catch(() => {});

      if (Object.keys(run.workstreams).length === 0) {
        state.currentRun = undefined;
      }
      await saveState(state);
      console.log("Cleanup complete.");
    });
}
