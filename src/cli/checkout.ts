import { Command } from "commander";
import { resolve } from "path";
import { loadConfig } from "../core/config";
import { loadState, saveState, defaultState } from "../core/state";
import { WorktreeManager } from "../core/worktree";
import { openInlinePicker, type InlinePickerOption } from "../ui/inline-picker.js";
import { A, STATUS_STYLE } from "../ui/ansi.js";
import { getBranchInfo, getDiffStats } from "../ui/workstream-picker.js";

export function checkoutCommand() {
  return new Command("checkout")
    .description("Switch into a workstream worktree")
    .argument("[name]", "workstream name to check out")
    .option("-c, --config <path>", "config file path", "workstream.yaml")
    .action(async (name: string | undefined, opts: { config: string }) => {
      const config = await loadConfig(opts.config);
      let state = await loadState();

      if (!state) {
        state = defaultState(process.cwd());
      }

      if (config.workstreams.length === 0) {
        console.log(
          `\n  ${A.dim}No workstreams defined.${A.reset} Add one with: ${A.cyan}ws create <name>${A.reset}\n`
        );
        return;
      }

      // If name not given, show inline picker
      if (!name) {
        const { stat } = await import("fs/promises");

        const options: InlinePickerOption[] = await Promise.all(
          config.workstreams.map(async (def) => {
            const branch = `ws/${def.name}`;
            const worktreePath = `.workstreams/trees/${def.name}`;
            const hasWorktree = await stat(worktreePath)
              .then(() => true)
              .catch(() => false);

            let status = "workspace";
            if (state!.currentRun?.workstreams?.[def.name]) {
              status = state!.currentRun.workstreams[def.name].status;
            } else if (def.prompt) {
              status = "pending";
            }

            const st = STATUS_STYLE[status] ?? STATUS_STYLE.pending;
            let hint = `${st.icon} ${status}`;

            if (hasWorktree) {
              const stats = await getDiffStats(branch);
              if (stats.filesChanged > 0) {
                hint += `  +${stats.additions} -${stats.deletions}`;
              }
            } else {
              hint += "  (no worktree)";
            }

            return { label: def.name, hint };
          })
        );

        const choice = await openInlinePicker("Select a workstream", options);
        if (choice === null) return;
        name = config.workstreams[choice].name;
      }

      // Validate the name
      const def = config.workstreams.find((w) => w.name === name);
      if (!def) {
        console.error(
          `${A.red}Error:${A.reset} workstream "${name}" not found in ${opts.config}`
        );
        process.exit(1);
      }

      // Ensure worktree exists
      const worktreePath = `.workstreams/trees/${name}`;
      const absPath = resolve(worktreePath);
      const { stat } = await import("fs/promises");
      const exists = await stat(worktreePath)
        .then(() => true)
        .catch(() => false);

      if (!exists) {
        const wt = new WorktreeManager();
        console.log(
          `${A.dim}Creating worktree for${A.reset} ${A.cyan}${name}${A.reset} ${A.dim}on branch${A.reset} ${A.cyan}ws/${name}${A.reset}${A.dim}...${A.reset}`
        );
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
            status: "pending",
            branch: `ws/${name}`,
            worktreePath,
            logFile: `.workstreams/logs/${name}.log`,
          };
        }
        await saveState(state);
      }

      // Spawn a subshell in the worktree directory
      const shell = process.env.SHELL || "/bin/zsh";
      console.log(
        `${A.green}✔${A.reset} Checked out ${A.bold}${A.cyan}${name}${A.reset} at ${A.dim}${absPath}${A.reset}`
      );
      console.log(
        `${A.dim}Spawning shell in worktree. Type${A.reset} ${A.bold}exit${A.reset} ${A.dim}to return.${A.reset}`
      );

      const child = Bun.spawn([shell], {
        cwd: absPath,
        stdin: "inherit",
        stdout: "inherit",
        stderr: "inherit",
        env: {
          ...process.env,
          WS_WORKSTREAM: name,
        },
      });

      await child.exited;
    });
}
