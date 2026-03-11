import { Command } from "commander";
import { loadState, saveState } from "../core/state";
import { loadConfig } from "../core/config";
import { AgentAdapter } from "../core/agent";
import { loadComments, clearComments, formatCommentsAsPrompt } from "../core/comments";
import type { AgentConfig, WorkstreamState } from "../core/types";

export function resumeCommand() {
  return new Command("resume")
    .description("Resume a workstream agent non-interactively with a new prompt or stored comments")
    .argument("<name>", "workstream name")
    .option("-p, --prompt <text>", "prompt text to send to the agent")
    .option("--comments", "resume using stored review comments from the dashboard")
    .addHelpText("after", `
Examples:
  ws resume auth -p "Also add refresh token support"
  ws resume auth --comments        Use comments added via "ws switch"

For interactive resume (with a live terminal), use "ws switch <name>" instead.
`)
    .action(async (name: string, opts: { prompt?: string; comments?: boolean }) => {
      const state = await loadState();
      if (!state?.currentRun) {
        console.error("Error: no active run. Run `ws run` first.");
        process.exit(1);
      }

      const ws = state.currentRun.workstreams[name];
      if (!ws) {
        console.error(`Error: workstream "${name}" not found in current run`);
        process.exit(1);
      }

      if (!ws.sessionId) {
        console.error(`Error: no session ID for "${name}". Cannot resume without a prior session.`);
        process.exit(1);
      }

      const config = await loadConfig("workstream.yaml");
      let resumePrompt: string | undefined;

      if (opts.prompt) {
        resumePrompt = opts.prompt;
      } else if (opts.comments) {
        resumePrompt = await getCommentsPrompt(name);
      } else {
        console.log(`Usage: ws resume ${name} -p "text"  or  ws resume ${name} --comments`);
        console.log(`Use "ws switch ${name}" for interactive mode.`);
        return;
      }

      if (!resumePrompt) return;

      await runResume(name, ws, config.agent, resumePrompt, state);
    });
}

async function getCommentsPrompt(name: string): Promise<string | undefined> {
  const data = await loadComments(name);
  if (data.comments.length === 0) {
    console.error(`No stored comments for "${name}". Use "ws switch ${name}" to add comments.`);
    return undefined;
  }
  const formatted = formatCommentsAsPrompt(data);
  console.log(`Loaded ${data.comments.length} comment(s) for "${name}".`);
  return formatted;
}

async function runResume(
  name: string,
  ws: WorkstreamState,
  agentConfig: AgentConfig,
  resumePrompt: string,
  state: any
) {
  const { appendFile } = await import("fs/promises");
  const agent = new AgentAdapter();

  const logLine = async (msg: string) => {
    const ts = new Date().toISOString();
    await appendFile(ws.logFile, `[${ts}] ${msg}\n`);
  };

  // Build agent config with --resume flag (before other args so it precedes -p)
  const resumeAgentConfig: AgentConfig = {
    ...agentConfig,
    args: ["--resume", ws.sessionId!, ...(agentConfig.args ?? [])],
  };

  ws.status = "running";
  ws.startedAt = new Date().toISOString();
  ws.finishedAt = undefined;
  ws.exitCode = undefined;
  ws.error = undefined;
  await saveState(state);

  console.log(`Resuming "${name}" with agent...`);
  await logLine(`Resuming workstream "${name}"`);

  try {
    const result = await agent.run({
      workDir: ws.worktreePath,
      prompt: resumePrompt,
      logFile: ws.logFile,
      agentConfig: resumeAgentConfig,
    });

    ws.exitCode = result.exitCode;
    ws.status = result.exitCode === 0 ? "success" : "failed";
    if (result.sessionId) ws.sessionId = result.sessionId;
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
  await logLine(`Resume of "${name}" finished with status: ${ws.status}`);
  await saveState(state);

  await clearComments(name);

  const color = ws.status === "success" ? "\x1b[32m" : "\x1b[31m";
  console.log(`${color}${name}: ${ws.status}\x1b[0m`);
}
