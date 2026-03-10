import type { AgentConfig } from "./types";
import { AgentError } from "./errors";
import {
  createWindow,
  sendPrompt,
  isPaneDead,
  pipePaneToFile,
} from "./tmux";

const PLAN_PHASE_SUFFIX = [
  "",
  "---",
  "IMPORTANT: Start by writing a detailed step-by-step plan for implementing the above.",
  "Do not use any tools or edit any files while writing the plan.",
  "Make judicious assumptions where details are unclear — do not ask clarifying questions.",
  "After presenting your plan, immediately proceed to implement it.",
].join("\n");

const AUTO_ACCEPT_FLAGS: Record<string, string[]> = {
  claude: ["--dangerously-skip-permissions", "--output-format", "stream-json", "--verbose"],
  codex: ["--full-auto"],
  aider: ["--yes"],
};

const TMUX_AUTO_ACCEPT_FLAGS: Record<string, string[]> = {
  claude: ["--dangerously-skip-permissions", "--verbose"],
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
  logFile: string;
  agentConfig: AgentConfig;
  planFirst?: boolean;
  onSessionId?: (id: string) => void | Promise<void>;
}

export interface AgentResult {
  exitCode: number;
  sessionId?: string;
}

const STATE_DIR = "/tmp/ws-state";

function stateFilePath(workstreamName: string): string {
  return `${STATE_DIR}/${workstreamName}`;
}

export async function readAgentState(workstreamName: string): Promise<"working" | "idle" | null> {
  try {
    const { readFile } = await import("fs/promises");
    const content = (await readFile(stateFilePath(workstreamName), "utf-8")).trim();
    if (content === "working" || content === "idle") return content;
    return null;
  } catch {
    return null;
  }
}

function encodeClaudePath(absPath: string): string {
  // Claude encodes paths by replacing both / and . with -
  return absPath.replace(/[/.]/g, "-");
}

/** Check Claude's session .jsonl file mtime as a fallback for idle detection */
export async function isSessionFileStale(workDir: string, thresholdMs = 30_000): Promise<boolean> {
  const { resolve } = await import("path");
  const { readdir, stat } = await import("fs/promises");
  const { homedir } = await import("os");

  const absWorkDir = resolve(workDir);
  const encoded = encodeClaudePath(absWorkDir);
  const sessDir = `${homedir()}/.claude/projects/${encoded}`;

  try {
    const files = await readdir(sessDir);
    const jsonlFiles = files.filter(f => f.endsWith(".jsonl"));
    if (jsonlFiles.length === 0) return false;

    let newestMtime = 0;
    for (const f of jsonlFiles) {
      const s = await stat(`${sessDir}/${f}`);
      if (s.mtimeMs > newestMtime) newestMtime = s.mtimeMs;
    }

    return (Date.now() - newestMtime) > thresholdMs;
  } catch {
    return false;
  }
}

export async function setupClaudeHooks(workDir: string, workstreamName: string): Promise<void> {
  const { mkdir, writeFile } = await import("fs/promises");
  const { join } = await import("path");

  // Ensure state dir exists
  await mkdir(STATE_DIR, { recursive: true });

  const sf = stateFilePath(workstreamName);

  // Write .claude/settings.local.json in the worktree with state-tracking hooks
  const claudeDir = join(workDir, ".claude");
  await mkdir(claudeDir, { recursive: true });

  const hooks = {
    hooks: {
      Notification: [{
        matcher: "idle_prompt",
        hooks: [{ type: "command", command: `echo idle > '${sf}'` }],
      }],
      PreToolUse: [{
        matcher: "",
        hooks: [{ type: "command", command: `echo working > '${sf}'` }],
      }],
    },
  };

  await writeFile(join(claudeDir, "settings.local.json"), JSON.stringify(hooks, null, 2));
  // Initialize state file as "working"
  await writeFile(sf, "working");
}

export class AgentAdapter {
  async run(options: AgentRunOptions): Promise<AgentResult> {
    const { workDir, prompt, logFile, agentConfig, planFirst } = options;

    // Inject auto-accept flags based on agent command when acceptAll is true (default)
    const autoAcceptFlags = getAutoAcceptFlags(agentConfig);
    const effectivePrompt = planFirst ? prompt + PLAN_PHASE_SUFFIX : prompt;
    const args = [...autoAcceptFlags, ...(agentConfig.args ?? []), effectivePrompt];
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
      let sessionId: string | undefined;

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
              try {
                const p = JSON.parse(line);
                if (p.session_id && !sessionId) {
                  sessionId = p.session_id;
                  if (options.onSessionId) await options.onSessionId(sessionId);
                }
              } catch {}
              const formatted = formatStreamEvent(line);
              if (formatted) await appendLog(formatted + "\n");
            }
          } else {
            await appendLog(value);
          }
        }
        // Flush remaining buffer
        if (buffer.trim() && isStreamJson && label === "stdout") {
          try {
            const p = JSON.parse(buffer);
            if (p.session_id && !sessionId) {
              sessionId = p.session_id;
              if (options.onSessionId) await options.onSessionId(sessionId);
            }
          } catch {}
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

      return { exitCode, sessionId };
    } catch (e: any) {
      await appendLog(`\n---\n[${timestamp()}] Agent error: ${e.message}\n`);
      throw new AgentError(`Agent failed: ${e.message}`);
    }
  }

  async runInTmux(options: AgentRunOptions & {
    tmuxSession: string;
    windowName: string;
    onPaneCreated?: (paneId: string) => void | Promise<void>;
  }): Promise<AgentResult & { tmuxPaneId: string }> {
    const { workDir, prompt, logFile, agentConfig, tmuxSession, windowName, planFirst } = options;

    const { appendFile, mkdir } = await import("fs/promises");
    const { dirname } = await import("path");
    await mkdir(dirname(logFile), { recursive: true });

    const ts = () => new Date().toISOString();
    const appendLog = async (data: string) => { await appendFile(logFile, data); };

    const cmd = agentConfig.command.split("/").pop() ?? agentConfig.command;
    const tmuxFlags = agentConfig.acceptAll === false
      ? []
      : (TMUX_AUTO_ACCEPT_FLAGS[cmd] ?? []);

    const effectivePrompt = planFirst ? prompt + PLAN_PHASE_SUFFIX : prompt;

    // Build interactive command — filter out -p from args (prompt sent via paste-buffer)
    const filteredArgs = (agentConfig.args ?? []).filter(a => a !== "-p");
    const cmdArgs = [
      agentConfig.command,
      ...tmuxFlags,
      ...filteredArgs,
    ];

    // Write a launcher script that captures exit code to a file
    const exitCodeFile = `/tmp/ws-exit-${windowName}-${Date.now()}`;
    const scriptFile = `/tmp/ws-launch-${windowName}-${Date.now()}.sh`;
    const scriptContent = [
      "#!/bin/bash",
      "unset CLAUDECODE CLAUDE_CODE_ENTRYPOINT",
      cmdArgs.map(a => `'${a.replace(/'/g, "'\\''")}'`).join(" "),
      `echo $? > '${exitCodeFile}'`,
    ].join("\n");
    await Bun.write(scriptFile, scriptContent);
    const { chmod } = await import("fs/promises");
    await chmod(scriptFile, 0o755);
    const claudeCmd = scriptFile;

    const { resolve } = await import("path");
    const absWorkDir = resolve(workDir);

    // Set up Claude hooks for state detection (idle_prompt / PreToolUse)
    await setupClaudeHooks(absWorkDir, windowName);

    await appendLog(`[${ts()}] Agent starting (tmux): ${claudeCmd}\n`);
    await appendLog(`[${ts()}] Working directory: ${absWorkDir}\n---\n`);

    // Create tmux window with interactive Claude
    // Note: remain-on-exit is set at the session level by the executor
    const paneId = await createWindow(tmuxSession, windowName, absWorkDir, claudeCmd);

    // Notify executor immediately so tmuxPaneId is saved to state
    if (options.onPaneCreated) await options.onPaneCreated(paneId);

    // Pipe all pane output to log file
    await pipePaneToFile(paneId, logFile);

    // Wait for Claude to initialize, then send the prompt
    // (skip if pane already died — fast commands like echo exit instantly)
    if (!await isPaneDead(paneId)) {
      await Bun.sleep(2000);
      if (!await isPaneDead(paneId)) {
        await sendPrompt(`${tmuxSession}:${windowName}`, effectivePrompt);
        await appendLog(`[${ts()}] Prompt sent\n`);
      }
    }

    // Poll for completion — pane dies when user quits Claude or process exits
    while (!await isPaneDead(paneId)) {
      await Bun.sleep(2000);
    }

    // Read exit code from file (written by launcher script)
    // Wait briefly for the file to appear — tmux pane may still be flushing
    const { readFile, unlink: unlinkFile } = await import("fs/promises");
    let exitCode = 1;
    for (let attempt = 0; attempt < 10; attempt++) {
      try {
        const raw = await readFile(exitCodeFile, "utf-8");
        exitCode = parseInt(raw.trim(), 10);
        if (isNaN(exitCode)) exitCode = 1;
        break;
      } catch {
        await Bun.sleep(200);
      }
    }
    // Clean up temp files
    await unlinkFile(exitCodeFile).catch(() => {});
    await unlinkFile(scriptFile).catch(() => {});
    await unlinkFile(stateFilePath(windowName)).catch(() => {});

    const sessionId = await this.extractSessionIdFromStorage(absWorkDir);
    if (sessionId && options.onSessionId) {
      await options.onSessionId(sessionId);
    }

    await appendLog(`\n---\n[${ts()}] Agent exited with code ${exitCode}\n`);

    // Auto-commit any changes
    if (exitCode === 0) {
      await this.autoCommit(absWorkDir, appendLog, ts);
    }

    // Kill the dead pane (cleanup remain-on-exit)
    Bun.spawnSync(["tmux", "kill-pane", "-t", paneId]);

    return { exitCode, sessionId, tmuxPaneId: paneId };
  }

  private async extractSessionIdFromStorage(workDir: string): Promise<string | undefined> {
    const { readdir, stat } = await import("fs/promises");
    const { homedir } = await import("os");

    const encoded = encodeClaudePath(workDir);
    const sessDir = `${homedir()}/.claude/projects/${encoded}`;

    try {
      const files = await readdir(sessDir);
      const jsonlFiles = files.filter(f => f.endsWith(".jsonl"));
      if (jsonlFiles.length === 0) return undefined;

      // Find the most recently modified .jsonl file
      let newest: { name: string; mtime: number } | null = null;
      for (const f of jsonlFiles) {
        const s = await stat(`${sessDir}/${f}`);
        if (!newest || s.mtimeMs > newest.mtime) {
          newest = { name: f, mtime: s.mtimeMs };
        }
      }

      if (!newest) return undefined;
      return newest.name.replace(".jsonl", "");
    } catch {
      return undefined;
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
