import type { AgentConfig, NodeType } from "./types";
import { AgentError } from "./errors";

const AUTO_ACCEPT_FLAGS: Record<string, string[]> = {
  claude: ["--dangerously-skip-permissions", "--output-format", "stream-json", "--verbose"],
  codex: ["--full-auto"],
  aider: ["--yes"],
};

function getAutoAcceptFlags(config: AgentConfig): string[] {
  if (config.acceptAll === false) return [];
  const cmd = config.command.split("/").pop() ?? config.command;
  return AUTO_ACCEPT_FLAGS[cmd] ?? [];
}

function formatStreamEvent(line: string): string | null {
  try {
    const event = JSON.parse(line);
    const ts = event.timestamp ? `[${event.timestamp}]` : "";

    switch (event.type) {
      case "assistant": {
        const content = event.message?.content ?? [];
        const parts: string[] = [];

        for (const block of content) {
          if (block.type === "text" && block.text) {
            parts.push(`${ts} [assistant] ${block.text}`);
          } else if (block.type === "tool_use") {
            const input = typeof block.input === "string" ? block.input : JSON.stringify(block.input);
            const truncated = input.length > 500 ? input.slice(0, 500) + "..." : input;
            parts.push(`${ts} [tool_call] ${block.name}: ${truncated}`);
          }
        }
        return parts.join("\n") || null;
      }
      case "result": {
        const cost = event.total_cost_usd ? ` (cost: $${event.total_cost_usd.toFixed(4)})` : "";
        const duration = event.duration_ms ? ` (${(event.duration_ms / 1000).toFixed(1)}s)` : "";
        return `${ts} [result] ${event.subtype ?? "done"}${duration}${cost}`;
      }
      case "tool_result": {
        const content = event.content ?? "";
        const text = typeof content === "string" ? content : JSON.stringify(content);
        const truncated = text.length > 1000 ? text.slice(0, 1000) + "..." : text;
        return `${ts} [tool_result] ${truncated}`;
      }
      case "system": {
        return `${ts} [system] ${event.subtype ?? ""} ${event.message ?? ""}`.trim();
      }
      default:
        return null;
    }
  } catch {
    // Not valid JSON, output raw
    return line;
  }
}

export interface AgentRunOptions {
  workDir: string;
  prompt: string;
  type: NodeType;
  logFile: string;
  agentConfig: AgentConfig;
  upstreamDiffs?: string[];
}

export interface AgentResult {
  exitCode: number;
}

export class AgentAdapter {
  async run(options: AgentRunOptions): Promise<AgentResult> {
    const { workDir, prompt, type, logFile, agentConfig, upstreamDiffs } = options;

    let fullPrompt = prompt;
    if (type === "review" && upstreamDiffs?.length) {
      const diffBlock = upstreamDiffs.join("\n\n---\n\n");
      fullPrompt = `Here are the upstream changes to review:\n\n${diffBlock}\n\n---\n\n${prompt}`;
    }

    // Inject auto-accept flags based on agent command when acceptAll is true (default)
    const autoAcceptFlags = getAutoAcceptFlags(agentConfig);
    const args = [...autoAcceptFlags, ...(agentConfig.args ?? []), fullPrompt];
    const { CLAUDECODE, ...baseEnv } = process.env;
    const env = { ...baseEnv, ...agentConfig.env };

    const { appendFile, mkdir } = await import("fs/promises");
    const { dirname } = await import("path");

    // Ensure log directory exists
    await mkdir(dirname(logFile), { recursive: true });

    const appendLog = async (data: string | Uint8Array) => {
      await appendFile(logFile, data);
    };

    const timestamp = () => new Date().toISOString();
    await appendLog(`[${timestamp()}] Agent starting: ${agentConfig.command} ${args.join(" ")}\n`);
    await appendLog(`[${timestamp()}] Working directory: ${workDir}\n`);
    await appendLog(`[${timestamp()}] Log file: ${logFile}\n---\n`);

    try {
      const proc = Bun.spawn([agentConfig.command, ...args], {
        cwd: workDir,
        env,
        stdout: "pipe",
        stderr: "pipe",
      });

      const isStreamJson = args.includes("stream-json");

      // Stream stdout and stderr to log file
      const streamToLog = async (
        stream: ReadableStream<Uint8Array> | null,
        label: string
      ) => {
        if (!stream) return;
        const reader = stream.getReader();
        let buffer = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (isStreamJson && label === "stdout") {
            buffer += new TextDecoder().decode(value);
            const lines = buffer.split("\n");
            buffer = lines.pop() ?? "";
            for (const line of lines) {
              if (!line.trim()) continue;
              const formatted = formatStreamEvent(line);
              if (formatted) await appendLog(formatted + "\n");
            }
          } else {
            await appendLog(value);
          }
        }
        // Flush remaining buffer
        if (buffer.trim() && isStreamJson && label === "stdout") {
          const formatted = formatStreamEvent(buffer);
          if (formatted) await appendLog(formatted + "\n");
        }
      };

      await Promise.all([
        streamToLog(proc.stdout, "stdout"),
        streamToLog(proc.stderr, "stderr"),
      ]);

      const exitCode = await proc.exited;
      await appendLog(`\n---\n[${timestamp()}] Agent exited with code ${exitCode}\n`);

      // Auto-commit any changes the agent made
      if (exitCode === 0) {
        await this.autoCommit(workDir, appendLog, timestamp);
      }

      return { exitCode };
    } catch (e: any) {
      await appendLog(`\n---\n[${timestamp()}] Agent error: ${e.message}\n`);
      throw new AgentError(`Agent failed: ${e.message}`);
    }
  }

  private async autoCommit(
    workDir: string,
    appendLog: (data: string | Uint8Array) => Promise<void>,
    timestamp: () => string
  ): Promise<void> {
    const { $ } = await import("bun");

    // Check if there are any uncommitted changes
    const status = await $`git -C ${workDir} status --porcelain`.quiet();
    const changes = status.stdout.toString().trim();
    if (!changes) return;

    await appendLog(`[${timestamp()}] Auto-committing changes...\n`);
    try {
      await $`git -C ${workDir} add -A`.quiet();
      await $`git -C ${workDir} commit -m "ws: apply agent changes"`.quiet();
      await appendLog(`[${timestamp()}] Changes committed\n`);
    } catch (e: any) {
      await appendLog(`[${timestamp()}] Auto-commit failed: ${e.stderr?.toString() ?? e.message}\n`);
    }
  }
}
