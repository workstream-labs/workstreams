import { Command } from "commander";
import { loadState, saveState } from "../core/state";
import { loadConfig } from "../core/config";
import { buildDAG } from "../core/dag";
import { DAGExecutor } from "../core/executor";
import { WorktreeManager } from "../core/worktree";
import { AgentAdapter } from "../core/agent";
import type { RunState, WorkstreamState } from "../core/types";

export function runCommand() {
  return new Command("run")
    .description("Run workstreams")
    .argument("[name]", "run a single workstream by name")
    .option("-c, --config <path>", "config file path", "workstream.yaml")
    .option("-d, --dry-run", "show what would run without executing")
    .action(async (name: string | undefined, opts: { config: string; dryRun?: boolean }) => {
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

      const dag = buildDAG(config.workstreams);

      if (opts.dryRun) {
        console.log("Execution order:");
        for (const nodeName of dag.order) {
          const node = dag.nodes.get(nodeName)!;
          const deps = node.dependencies.length
            ? ` (after: ${node.dependencies.join(", ")})`
            : " (root)";
          console.log(`  ${nodeName} [${node.def.type}]${deps}`);
        }
        return;
      }

      // If a specific name is given, run only that workstream
      const defsToRun = name
        ? config.workstreams.filter((w) => w.name === name)
        : config.workstreams;

      if (name && defsToRun.length === 0) {
        console.error(`Error: workstream "${name}" not found in config`);
        process.exit(1);
      }

      // Build run state
      const runId = `run-${Date.now()}`;
      const run: RunState = {
        runId,
        startedAt: new Date().toISOString(),
        workstreams: {},
      };

      for (const def of defsToRun) {
        run.workstreams[def.name] = {
          name: def.name,
          type: def.type,
          status: "pending",
          branch: `ws/${def.name}`,
          worktreePath: `.workstreams/trees/${def.name}`,
          logFile: `.workstreams/logs/${def.name}.log`,
        };
      }

      state.currentRun = run;
      await saveState(state);

      if (name) {
        // Single workstream execution
        await runSingle(name, config.agent, run, state);
      } else {
        // Full DAG execution
        const executor = new DAGExecutor(config, dag, state);
        await executor.execute();
      }
    });
}

async function runSingle(
  name: string,
  agentConfig: any,
  run: RunState,
  state: any
) {
  const { saveState: save } = await import("../core/state");
  const { appendFile, mkdir } = await import("fs/promises");
  const wt = new WorktreeManager();
  const agent = new AgentAdapter();
  const ws = run.workstreams[name];

  const logLine = async (msg: string) => {
    const ts = new Date().toISOString();
    await appendFile(ws.logFile, `[${ts}] ${msg}\n`);
  };

  await mkdir(".workstreams/logs", { recursive: true });

  console.log(`Creating worktree for ${name}...`);
  ws.status = "running";
  ws.startedAt = new Date().toISOString();
  await save(state);
  await logLine(`Workstream "${name}" starting (type: ${ws.type})`);

  try {
    await logLine("Creating git worktree...");
    await wt.create(name);
    await logLine(`Worktree created at ${ws.worktreePath} on branch ${ws.branch}`);

    console.log(`Running agent for ${name}...`);
    await logLine("Launching agent...");

    const result = await agent.run({
      workDir: ws.worktreePath,
      prompt: (await loadConfig("workstream.yaml")).workstreams.find(
        (w) => w.name === name
      )!.prompt,
      type: ws.type,
      logFile: ws.logFile,
      agentConfig,
    });

    ws.exitCode = result.exitCode;
    ws.status = result.exitCode === 0 ? "success" : "failed";
    if (result.exitCode !== 0) {
      ws.error = `Agent exited with code ${result.exitCode}`;
      await logLine(`FAILED: ${ws.error}`);
    }
  } catch (e: any) {
    ws.status = "failed";
    ws.error = e.message;
    await logLine(`ERROR: ${e.message}`);
  }

  ws.finishedAt = new Date().toISOString();
  run.finishedAt = new Date().toISOString();
  await logLine(`Workstream "${name}" finished with status: ${ws.status}`);
  await save(state);

  const color = ws.status === "success" ? "\x1b[32m" : "\x1b[31m";
  console.log(`${color}${name}: ${ws.status}\x1b[0m`);
}
