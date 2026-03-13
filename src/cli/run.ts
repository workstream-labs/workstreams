import { Command } from "commander";
import { loadState, saveState, appendWorkstreamStatus } from "../core/state";
import { loadConfig } from "../core/config";
import { buildGraph } from "../core/dag";
import { Executor } from "../core/executor";
import { AgentAdapter } from "../core/agent";
import { loadComments, clearComments, formatCommentsAsPrompt } from "../core/comments";
import { loadPendingPrompt, clearPendingPrompt } from "../core/pending-prompt";
import { notifyStatus } from "../core/notify";
import type { AgentConfig, RunState, WorkstreamState } from "../core/types";

export function runCommand() {
  return new Command("run")
    .description("Run workstreams — fresh execution or resume with new instructions")
    .argument("[name]", "run a single workstream by name")
    .option("-c, --config <path>", "config file path", "workstream.yaml")
    .option("-d, --dry-run", "show what would run without executing")
    .option("-p, --prompt <text>", "send new instructions to a workstream (resumes if session exists)")
    .addHelpText("after", `
Examples:
  ws run               Run all workstreams defined in workstream.yaml
  ws run auth-feature   Run only the "auth-feature" workstream
  ws run auth -p "Also add refresh tokens"   Resume with new instructions
  ws run --dry-run      Preview which workstreams would run

Pending review comments are automatically included when resuming.
Agents are spawned in the background. Use "ws switch" to monitor progress.
`)
    .action(async (name: string | undefined, opts: { config: string; dryRun?: boolean; prompt?: string }) => {
      // Background mode: actually run the executor or resume
      if (process.env.WS_BACKGROUND === "1") {
        if (process.env.WS_RESUME_MODE === "1") {
          await runResumeBackground(name!, opts.config, opts.prompt!);
        } else {
          await runExecutor(name, opts.config);
        }
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
        console.log("No workstreams defined. Add one with: ws create <name> -p \"<prompt>\"");
        return;
      }

      if (opts.dryRun) {
        console.log("Workstreams to run (all in parallel):");
        for (const ws of config.workstreams) {
          console.log(`  ${ws.name}`);
        }
        return;
      }

      // ─── Single workstream ────────────────────────────────────────
      if (name) {
        const def = config.workstreams.find((w) => w.name === name);
        if (!def) {
          console.error(`Error: workstream "${name}" not found in config`);
          process.exit(1);
        }

        const ws = state.currentRun?.workstreams?.[name];

        // Has an existing session → resume mode
        if (ws?.sessionId) {
          await handleResume(name, ws, state, config, opts);
          return;
        }

        // No session → fresh run
        if (!def.prompt) {
          console.error(`Error: workstream "${name}" has no prompt. Use \`ws switch ${name}\` to work in it manually.`);
          process.exit(1);
        }

        // Set up run state and spawn background
        if (!state.currentRun) {
          state.currentRun = {
            runId: `run-${Date.now()}`,
            startedAt: new Date().toISOString(),
            workstreams: {},
          };
        }
        state.currentRun.workstreams[name] = {
          name,
          status: "queued",
          branch: `ws/${name}`,
          worktreePath: `.workstreams/trees/${name}`,
          logFile: `.workstreams/logs/${name}.log`,
        };
        await appendWorkstreamStatus(state.currentRun.workstreams[name]);
        await saveState(state);

        const bgArgs = ["bun", Bun.main, "run", "-c", opts.config, name];
        const proc = Bun.spawn(bgArgs, {
          cwd: process.cwd(),
          env: { ...process.env, WS_BACKGROUND: "1" },
          stdin: "ignore",
          stdout: "ignore",
          stderr: "ignore",
        });
        proc.unref();

        console.log(`Started "${name}" in the background.`);
        console.log(`  Use \`ws switch\` to monitor progress.`);
        return;
      }

      // ─── Run all workstreams ──────────────────────────────────────
      const defsToRun = config.workstreams;

      // Filter: must have prompt, must not already have a session or be active
      const runnableDefs = defsToRun.filter((w) => {
        if (!w.prompt) return false;
        const existing = state.currentRun?.workstreams?.[w.name];
        if (existing?.sessionId) return false; // already ran, skip
        if (existing?.status === "running" || existing?.status === "queued") return false;
        return true;
      });

      // Warn about skipped workstreams
      const stuckNames = defsToRun
        .filter((w) => {
          const existing = state.currentRun?.workstreams?.[w.name];
          return existing?.status === "running" || existing?.status === "queued";
        })
        .map((w) => w.name);
      if (stuckNames.length > 0) {
        console.log(`Skipping active workstreams: ${stuckNames.join(", ")}`);
        console.log(`  If stuck, use \`ws destroy <name>\` to clean up.`);
      }

      if (runnableDefs.length === 0) {
        const skipped = defsToRun.filter((w) => state.currentRun?.workstreams?.[w.name]?.sessionId);
        if (skipped.length > 0) {
          console.log("All workstreams have already run. To continue one:");
          console.log(`  ws run <name> -p "new instructions"`);
        } else {
          console.log("No runnable workstreams (all are workspace-only with no prompts).");
        }
        return;
      }

      // Persist initial run state before spawning background worker
      const runId = `run-${Date.now()}`;
      const run: RunState = state.currentRun ?? {
        runId,
        startedAt: new Date().toISOString(),
        workstreams: {},
      };
      if (!state.currentRun) {
        run.runId = runId;
        run.startedAt = new Date().toISOString();
      }
      for (const def of runnableDefs) {
        run.workstreams[def.name] = {
          name: def.name,
          status: "queued",
          branch: `ws/${def.name}`,
          worktreePath: `.workstreams/trees/${def.name}`,
          logFile: `.workstreams/logs/${def.name}.log`,
        };
        await appendWorkstreamStatus(run.workstreams[def.name]);
      }
      state.currentRun = run;
      await saveState(state);

      // Spawn detached background worker
      const bgArgs = ["bun", Bun.main, "run", "-c", opts.config];
      const proc = Bun.spawn(bgArgs, {
        cwd: process.cwd(),
        env: { ...process.env, WS_BACKGROUND: "1" },
        stdin: "ignore",
        stdout: "ignore",
        stderr: "ignore",
      });
      proc.unref();

      const names = runnableDefs.map((d) => d.name).join(", ");
      console.log(`Started ${runnableDefs.length} workstream(s) in the background: ${names}`);
      console.log(`  Use \`ws switch\` to monitor progress.`);
    });
}

// ─── Resume handling (foreground validation + background spawn) ──────────────

async function handleResume(
  name: string,
  ws: WorkstreamState,
  state: any,
  config: any,
  opts: { config: string; prompt?: string },
) {
  // Check status
  if (ws.status === "running") {
    console.error(`Error: "${name}" is currently running. Use \`ws switch\` to interrupt it.`);
    process.exit(1);
  }

  if (ws.status === "queued") {
    console.error(`Error: "${name}" is in a stale state (${ws.status}). Use \`ws destroy ${name}\` to clean up.`);
    process.exit(1);
  }

  // Gather comments (auto, always)
  const commentsData = await loadComments(name);
  const commentsPrompt = formatCommentsAsPrompt(commentsData);

  // Gather pending prompt (auto, always)
  const pendingPrompt = await loadPendingPrompt(name);

  // Combine prompts: comments first, then pending prompt, then -p
  const parts: string[] = [];
  if (commentsPrompt) parts.push(commentsPrompt);
  if (pendingPrompt) parts.push(pendingPrompt);
  if (opts.prompt) parts.push(opts.prompt);

  if (parts.length === 0) {
    console.error(`Error: "${name}" already ran. Provide new instructions to continue:`);
    console.error(`  ws run ${name} -p "your instructions here"`);
    console.error(`  Or add review comments / a pending prompt via \`ws switch\`.`);
    process.exit(1);
  }

  const combinedPrompt = parts.join("\n\n---\n\n");

  // Update state
  ws.status = "running";
  ws.startedAt = new Date().toISOString();
  ws.finishedAt = undefined;
  ws.exitCode = undefined;
  ws.error = undefined;
  if (state.currentRun) {
    state.currentRun.finishedAt = undefined;
  }
  await appendWorkstreamStatus(ws);
  await saveState(state);

  // Spawn background worker for resume
  const bgArgs = ["bun", Bun.main, "run", name, "-c", opts.config, "-p", combinedPrompt];
  const proc = Bun.spawn(bgArgs, {
    cwd: process.cwd(),
    env: { ...process.env, WS_BACKGROUND: "1", WS_RESUME_MODE: "1" },
    stdin: "ignore",
    stdout: "ignore",
    stderr: "ignore",
  });
  proc.unref();

  const commentInfo = commentsData.comments.length > 0
    ? ` (${commentsData.comments.length} comment${commentsData.comments.length !== 1 ? "s" : ""} included)`
    : "";
  console.log(`Resuming "${name}" in the background${commentInfo}.`);
  console.log(`  Use \`ws switch\` to monitor progress.`);
}

// ─── Background: fresh run via executor ─────────────────────────────────────

async function runExecutor(name: string | undefined, configPath: string) {
  const state = await loadState();
  if (!state?.currentRun) {
    process.exit(1);
  }
  const config = await loadConfig(configPath);
  const defsToRun = name
    ? config.workstreams.filter((w) => w.name === name)
    : config.workstreams.filter((w) => {
        // Only run workstreams that are in the current run and pending
        const ws = state.currentRun!.workstreams[w.name];
        return ws && ws.status === "queued";
      });

  const graph = buildGraph(defsToRun);
  const executor = new Executor(config, graph, state);
  await executor.execute();
}

// ─── Background: resume with agent ──────────────────────────────────────────

async function runResumeBackground(name: string, configPath: string, resumePrompt: string) {
  const { appendFile } = await import("fs/promises");
  const state = await loadState();
  if (!state?.currentRun) {
    process.exit(1);
  }

  const ws = state.currentRun.workstreams[name];
  if (!ws) {
    process.exit(1);
  }

  const config = await loadConfig(configPath);
  const agent = new AgentAdapter();

  const logLine = async (msg: string) => {
    const ts = new Date().toISOString();
    await appendFile(ws.logFile, `[${ts}] ${msg}\n`);
  };

  // Guard: if sessionId is missing, we can't resume — fail early with a clear message
  if (!ws.sessionId) {
    ws.status = "failed";
    ws.error = "No session ID available for resume";
    ws.finishedAt = new Date().toISOString();
    await logLine(`FAILED: ${ws.error}`);
    await appendWorkstreamStatus(ws);
    process.exit(1);
  }

  // Build agent config with --resume flag
  // Insert --resume before -p to handle wrapper commands (e.g. aifx agent run claude --resume <id> ... -p)
  const baseArgs = config.agent.args ?? [];
  const pIndex = baseArgs.lastIndexOf("-p");
  const resumeArgs = pIndex >= 0
    ? [...baseArgs.slice(0, pIndex), "--resume", ws.sessionId, ...baseArgs.slice(pIndex)]
    : [...baseArgs, "--resume", ws.sessionId];
  const resumeAgentConfig: AgentConfig = {
    ...config.agent,
    args: resumeArgs,
  };

  // Preserve the original session ID — Claude's --resume creates a new
  // session that is NOT itself resumable. We must always resume from the
  // original session so subsequent prompts keep working.
  const originalSessionId = ws.sessionId;
  await logLine(`Resuming workstream "${name}" (session ${originalSessionId})`);

  try {
    const result = await agent.run({
      workDir: ws.worktreePath,
      prompt: resumePrompt,
      logFile: ws.logFile,
      agentConfig: resumeAgentConfig,
      onSessionId: async (id) => {
        // Don't overwrite the original session ID — the new ID from a
        // resumed session is not resumable by Claude's --resume flag.
        await appendWorkstreamStatus(ws);
        await logLine(`Session ID captured: ${id}`);
      },
      onPid: async (pid) => {
        ws.pid = pid;
        await appendWorkstreamStatus(ws);
        await logLine(`Agent PID: ${pid}`);
      },
    });

    ws.exitCode = result.exitCode;
    ws.status = result.exitCode === 0 ? "success" : "failed";
    // Keep original session ID for future resumes
    ws.sessionId = originalSessionId;
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
  ws.pid = undefined;
  await logLine(`Resume of "${name}" finished with status: ${ws.status}`);
  await appendWorkstreamStatus(ws);

  await clearComments(name);
  await clearPendingPrompt(name);

  notifyStatus(name, ws.status);
}
