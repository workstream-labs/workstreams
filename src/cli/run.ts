import { Command } from "commander";
import { loadState, saveState } from "../core/state";
import { loadConfig } from "../core/config";
import { buildGraph } from "../core/dag";
import { Executor } from "../core/executor";
import type { RunState } from "../core/types";

export function runCommand() {
  return new Command("run")
    .description("Run workstreams")
    .argument("[name]", "run a single workstream by name")
    .option("-c, --config <path>", "config file path", "workstream.yaml")
    .option("-d, --dry-run", "show what would run without executing")
    .action(async (name: string | undefined, opts: { config: string; dryRun?: boolean }) => {
      // Background mode: actually run the executor with the pre-saved state
      if (process.env.WS_BACKGROUND === "1") {
        await runExecutor(name, opts.config);
        return;
      }

      // Foreground mode: validate, set up state, spawn background worker
      const state = await loadState();
      if (!state) {
        console.error("Error: workstreams not initialized. Run `ws init` first.");
        process.exit(1);
      }

      const config = await loadConfig(opts.config);

      if (config.workstreams.length === 0) {
        console.log('No workstreams defined. Add one with: ws create <name> "<prompt>"');
        return;
      }

      if (opts.dryRun) {
        console.log("Workstreams to run (all in parallel):");
        for (const ws of config.workstreams) {
          console.log(`  ${ws.name}`);
        }
        return;
      }

      const defsToRun = name
        ? config.workstreams.filter((w) => w.name === name)
        : config.workstreams;

      if (name && defsToRun.length === 0) {
        console.error(`Error: workstream "${name}" not found in config`);
        process.exit(1);
      }

      // Persist initial run state before spawning background worker
      const runId = `run-${Date.now()}`;
      const run: RunState = {
        runId,
        startedAt: new Date().toISOString(),
        workstreams: {},
      };
      for (const def of defsToRun) {
        run.workstreams[def.name] = {
          name: def.name,
          status: "pending",
          branch: `ws/${def.name}`,
          worktreePath: `.workstreams/trees/${def.name}`,
          logFile: `.workstreams/logs/${def.name}.log`,
        };
      }
      state.currentRun = run;
      await saveState(state);

      // Spawn detached background worker
      const bgArgs = ["bun", Bun.main, "run", "-c", opts.config];
      if (name) bgArgs.push(name);
      const proc = Bun.spawn(bgArgs, {
        cwd: process.cwd(),
        env: { ...process.env, WS_BACKGROUND: "1" },
        stdin: "ignore",
        stdout: "ignore",
        stderr: "ignore",
      });
      proc.unref();

      const names = defsToRun.map((d) => d.name).join(", ");
      console.log(`Started ${defsToRun.length} workstream(s) in the background: ${names}`);
      console.log(`  Use \`ws status\` to check progress.`);
      console.log(`  Use \`ws checkout <name>\` to inspect or resume a session.`);
    });
}

async function runExecutor(name: string | undefined, configPath: string) {
  const state = await loadState();
  if (!state?.currentRun) {
    process.exit(1);
  }
  const config = await loadConfig(configPath);
  const defsToRun = name
    ? config.workstreams.filter((w) => w.name === name)
    : config.workstreams;

  const graph = buildGraph(defsToRun);
  const executor = new Executor(config, graph, state);
  await executor.execute();
}
