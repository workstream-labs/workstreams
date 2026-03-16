import { resolve } from "path";
import type { AgentConfig } from "./types";
import { AgentError } from "./errors";

const AUTO_ACCEPT_FLAGS: Record<string, string[]> = {
  claude: [
    "--dangerously-skip-permissions",
    "--output-format", "stream-json",
    "--verbose",
    "--include-partial-messages",
  ],
  codex: ["--full-auto"],
  aider: ["--yes"],
};

function getAutoAcceptFlags(config: AgentConfig): string[] {
  if (config.acceptAll === false) return [];
  const cmd = config.command.split("/").pop() ?? config.command;
  return AUTO_ACCEPT_FLAGS[cmd] ?? [];
}

export interface AgentRunOptions {
  workDir: string;
  prompt: string;
  logFile: string;
  agentConfig: AgentConfig;
  expectedBranch?: string;
  onSessionId?: (id: string) => void | Promise<void>;
  onPid?: (pid: number) => void | Promise<void>;
}

export interface AgentResult {
  exitCode: number;
  sessionId?: string;
}

export class AgentAdapter {
  async run(options: AgentRunOptions): Promise<AgentResult> {
    const { workDir, prompt, logFile, agentConfig } = options;
    const absWorkDir = resolve(workDir);

    const autoAcceptFlags = getAutoAcceptFlags(agentConfig);
    const args = [...autoAcceptFlags, ...(agentConfig.args ?? []), prompt];
    const { CLAUDECODE, ...baseEnv } = process.env;
    const env = { ...baseEnv, ...agentConfig.env };

    const { appendFile, mkdir } = await import("fs/promises");
    const { dirname } = await import("path");

    await mkdir(dirname(logFile), { recursive: true });

    const appendLog = async (data: string | Uint8Array) => {
      await appendFile(logFile, data);
    };

    // Write the prompt as a synthetic user message so it shows up in the session viewer
    const syntheticUserMsg = JSON.stringify({
      type: "user",
      message: { content: prompt },
      timestamp: new Date().toISOString(),
    });
    await appendLog(syntheticUserMsg + "\n");

    // ── Pre-flight: guarantee we are on the expected worktree branch ──
    if (options.expectedBranch) {
      const { $ } = await import("bun");
      const headResult = await $`git -C ${absWorkDir} rev-parse --abbrev-ref HEAD`.quiet().catch(() => null);
      const currentBranch = headResult?.stdout.toString().trim();

      if (currentBranch !== options.expectedBranch) {
        // Attempt to checkout the correct branch inside the worktree
        try {
          await $`git -C ${absWorkDir} checkout ${options.expectedBranch}`.quiet();
        } catch {
          throw new AgentError(
            `Worktree at ${absWorkDir} is on branch "${currentBranch}" instead of "${options.expectedBranch}" and checkout failed. ` +
            `Refusing to run agent to avoid writing to the wrong branch.`,
          );
        }
      }
    }

    try {
      const proc = Bun.spawn([agentConfig.command, ...args], {
        cwd: absWorkDir,
        env,
        stdout: "pipe",
        stderr: "pipe",
      });

      if (options.onPid) await options.onPid(proc.pid);

      let sessionId: string | undefined;

      // Stream stdout to log file as raw stream-json.
      // Also extract session_id from init/result events.
      const streamStdout = async (stream: ReadableStream<Uint8Array> | null) => {
        if (!stream) return;
        const reader = stream.getReader();
        let buffer = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          await appendLog(value);

          // Parse for session_id
          if (!sessionId) {
            buffer += new TextDecoder().decode(value);
            const lines = buffer.split("\n");
            buffer = lines.pop() ?? "";
            for (const line of lines) {
              if (!line.trim()) continue;
              try {
                const e = JSON.parse(line);
                const sid = e.session_id ?? e.message?.session_id;
                if (sid && !sessionId) {
                  sessionId = sid;
                  if (options.onSessionId) await options.onSessionId(sid);
                }
              } catch {}
            }
          }
        }
        // Flush buffer
        if (!sessionId && buffer.trim()) {
          try {
            const e = JSON.parse(buffer);
            const sid = e.session_id ?? e.message?.session_id;
            if (sid) {
              sessionId = sid;
              if (options.onSessionId) await options.onSessionId(sid);
            }
          } catch {}
        }
      };

      // Stream stderr to log file as-is
      const streamStderr = async (stream: ReadableStream<Uint8Array> | null) => {
        if (!stream) return;
        const reader = stream.getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          await appendLog(value);
        }
      };

      await Promise.all([
        streamStdout(proc.stdout),
        streamStderr(proc.stderr),
      ]);

      const exitCode = await proc.exited;

      // Auto-commit any changes the agent made
      if (exitCode === 0) {
        await this.autoCommit(absWorkDir, appendLog);
      }

      return { exitCode, sessionId };
    } catch (e: any) {
      throw new AgentError(`Agent failed: ${e.message}`);
    }
  }

  private async autoCommit(
    workDir: string,
    appendLog: (data: string | Uint8Array) => Promise<void>,
  ): Promise<void> {
    const { $ } = await import("bun");

    const status = await $`git -C ${workDir} status --porcelain`.quiet();
    const changes = status.stdout.toString().trim();
    if (!changes) return;

    try {
      await $`git -C ${workDir} add -A`.quiet();
      await $`git -C ${workDir} commit -m "ws: apply agent changes"`.quiet();
    } catch {}
  }
}
