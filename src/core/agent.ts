import type { AgentConfig, NodeType } from "./types";
import { AgentError } from "./errors";

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

    const args = [...(agentConfig.args ?? []), fullPrompt];
    const env = { ...process.env, ...agentConfig.env };

    const logWriter = Bun.file(logFile).writer();

    try {
      const proc = Bun.spawn([agentConfig.command, ...args], {
        cwd: workDir,
        env,
        stdout: "pipe",
        stderr: "pipe",
      });

      // Stream stdout and stderr to log file
      const streamToLog = async (
        stream: ReadableStream<Uint8Array> | null
      ) => {
        if (!stream) return;
        const reader = stream.getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          logWriter.write(value);
        }
      };

      await Promise.all([
        streamToLog(proc.stdout),
        streamToLog(proc.stderr),
      ]);

      const exitCode = await proc.exited;
      logWriter.end();
      return { exitCode };
    } catch (e: any) {
      logWriter.end();
      throw new AgentError(`Agent failed: ${e.message}`);
    }
  }
}
