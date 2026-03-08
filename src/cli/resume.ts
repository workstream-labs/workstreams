import { Command } from "commander";
import { loadState, saveState } from "../core/state";
import { loadConfig } from "../core/config";
import { AgentAdapter } from "../core/agent";
import { prompt, promptChoice } from "../core/prompt";
import { loadComments, clearComments, formatCommentsAsPrompt } from "../core/comments";
import type { AgentConfig, WorkstreamState } from "../core/types";

export function resumeCommand() {
  return new Command("resume")
    .description("Resume a workstream with new instructions or review comments")
    .argument("<name>", "workstream name")
    .option("-p, --prompt <text>", "prompt text to send (non-interactive)")
    .option("--comments", "use stored review comments (non-interactive)")
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
        // Interactive mode
        const choice = await promptChoice(`Resume "${name}":`, [
          "Resume with a new prompt",
          "Resume with stored review comments",
        ]);

        if (choice === 1) {
          resumePrompt = await prompt("Enter prompt: ");
          if (!resumePrompt) {
            console.log("No prompt provided. Aborting.");
            return;
          }
        } else if (choice === 2) {
          resumePrompt = await getCommentsPrompt(name);
        } else {
          console.log("Invalid choice.");
          return;
        }
      }

      if (!resumePrompt) return;

      await runResume(name, ws, config.agent, resumePrompt, state);
    });
}

async function getCommentsPrompt(name: string): Promise<string | undefined> {
  const data = await loadComments(name);
  if (data.comments.length === 0) {
    console.error(`No stored comments for "${name}". Use 'ws checkout ${name}' to add comments.`);
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

  // Build agent config with --resume flag
  const resumeAgentConfig: AgentConfig = {
    ...agentConfig,
    args: [...(agentConfig.args ?? []), "--resume", ws.sessionId!],
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

  // Clear comments on successful resume
  if (ws.status === "success") {
    await clearComments(name);
  }

  const color = ws.status === "success" ? "\x1b[32m" : "\x1b[31m";
  console.log(`${color}${name}: ${ws.status}\x1b[0m`);
}
