import { $ } from "bun";
import type {
  ProjectState,
  RunState,
  WorkstreamConfig,
} from "./types";
import type { WorkstreamGraph } from "./dag";
import { WorktreeManager } from "./worktree";
import { AgentAdapter } from "./agent";
import { saveState } from "./state";
import type { EventBus } from "./events";
import { hasTmux, createSession, hasSession, killSession } from "./tmux";

const COLOR_SUCCESS = "\x1b[32m";
const COLOR_FAILED = "\x1b[31m";
const COLOR_OTHER = "\x1b[90m";
const COLOR_RESET = "\x1b[0m";
const COLOR_YELLOW = "\x1b[33m";

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

const TMUX_SESSION = "ws-run";

class Spinner {
  private interval: ReturnType<typeof setInterval> | null = null;
  private frame = 0;
  private label: string;

  constructor(label: string) { this.label = label; }

  start() {
    this.write();
    this.interval = setInterval(() => this.write(), 80);
  }

  stop(icon: string, color: string, message: string) {
    if (this.interval) clearInterval(this.interval);
    process.stdout.write(`\r\x1b[2K${color}${icon} ${this.label}: ${message}${COLOR_RESET}\n`);
  }

  private write() {
    const char = SPINNER_FRAMES[this.frame % SPINNER_FRAMES.length];
    process.stdout.write(`\r\x1b[2K${COLOR_YELLOW}${char}${COLOR_RESET} ${this.label}`);
    this.frame++;
  }
}

export class Executor {
  private config: WorkstreamConfig;
  private graph: WorkstreamGraph;
  private state: ProjectState;
  private run: RunState;
  private wt = new WorktreeManager();
  private agent = new AgentAdapter();
  private eventBus?: EventBus;
  private aborted = false;
  private runningProcs: Set<string> = new Set();
  private worktreeLock: Promise<void> = Promise.resolve();
  private tmuxSessionName = TMUX_SESSION;

  constructor(
    config: WorkstreamConfig,
    graph: WorkstreamGraph,
    state: ProjectState,
    eventBus?: EventBus
  ) {
    this.config = config;
    this.graph = graph;
    this.state = state;
    this.run = state.currentRun!;
    this.eventBus = eventBus;

    // Ensure all nodes have state entries
    for (const [name, node] of graph.nodes) {
      if (!this.run.workstreams[name]) {
        this.run.workstreams[name] = {
          name,
          status: "pending",
          branch: `ws/${name}`,
          worktreePath: `.workstreams/trees/${name}`,
          logFile: `.workstreams/logs/${name}.log`,
          planFirst: node.def.planFirst ?? false,
        };
      }
    }
  }

  async execute(): Promise<void> {
    this.setupSignalHandlers();
    this.emit("run:start", undefined, { runId: this.run.runId });

    // Require tmux
    if (!await hasTmux()) {
      console.error("Error: tmux is required for ws run. Install with: brew install tmux");
      process.exit(1);
    }

    // Kill stale session, create fresh one
    if (await hasSession(this.tmuxSessionName)) {
      await killSession(this.tmuxSessionName);
    }
    await createSession(this.tmuxSessionName);

    // Configure session: remain-on-exit, mouse scroll, Ctrl+Q detach, status bar
    await $`tmux set -t ${this.tmuxSessionName} remain-on-exit on`.quiet().catch(() => {});
    await $`tmux set -t ${this.tmuxSessionName} mouse on`.quiet().catch(() => {});
    await $`tmux set -t ${this.tmuxSessionName} status on`.quiet().catch(() => {});
    await $`tmux set -t ${this.tmuxSessionName} status-style bg=black`.quiet().catch(() => {});
    await $`tmux set -t ${this.tmuxSessionName} status-left ""`.quiet().catch(() => {});
    await $`tmux set -t ${this.tmuxSessionName} status-right ""`.quiet().catch(() => {});
    await $`tmux set -t ${this.tmuxSessionName} status-justify centre`.quiet().catch(() => {});
    await $`tmux bind-key -T root C-q detach-client`.quiet().catch(() => {});

    // Ensure log directory exists and clear old log files
    const { unlink, mkdir } = await import("fs/promises");
    await mkdir(".workstreams/logs", { recursive: true });
    for (const ws of Object.values(this.run.workstreams)) {
      await unlink(ws.logFile).catch(() => {});
    }

    console.log(`Starting run ${this.run.runId} with ${this.graph.nodes.size} workstreams`);
    console.log();

    // Run all workstreams in parallel
    const promises: Promise<void>[] = [];
    for (const name of this.graph.names) {
      if (this.aborted) break;
      const ws = this.run.workstreams[name];
      ws.status = "queued";
      this.emit("node:queued", name);
      promises.push(this.executeNode(name));
    }

    await Promise.allSettled(promises);

    this.run.finishedAt = new Date().toISOString();
    await saveState(this.state);
    this.emit("run:complete", undefined, { runId: this.run.runId });

    // Clean up tmux session
    await killSession(this.tmuxSessionName);

    // Print summary
    console.log();
    console.log("=== Run Complete ===");
    for (const [name, ws] of Object.entries(this.run.workstreams)) {
      const color =
        ws.status === "success" ? COLOR_SUCCESS : ws.status === "failed" ? COLOR_FAILED : COLOR_OTHER;
      console.log(`  ${color}${ws.status.padEnd(8)}${COLOR_RESET} ${name}`);
    }
  }

  private async executeNode(name: string): Promise<void> {
    const ws = this.run.workstreams[name];
    const node = this.graph.nodes.get(name)!;
    const { appendFile } = await import("fs/promises");

    const logLine = async (msg: string) => {
      const ts = new Date().toISOString();
      await appendFile(ws.logFile, `[${ts}] ${msg}\n`);
    };

    ws.status = "running";
    ws.startedAt = new Date().toISOString();
    this.runningProcs.add(name);
    this.emit("node:running", name);
    await saveState(this.state);

    const spinner = new Spinner(name);
    spinner.start();
    await logLine(`Workstream "${name}" starting`);

    try {
      // Serialize worktree creation to avoid git lock races
      await logLine("Creating git worktree...");
      await this.acquireWorktreeLock(async () => {
        await this.wt.create(name, node.def.baseBranch);
      });
      await logLine(`Worktree created at ${ws.worktreePath} on branch ${ws.branch}`);

      await logLine("Launching agent in tmux...");

      const result = await this.agent.runInTmux({
        workDir: ws.worktreePath,
        prompt: node.def.prompt!,
        logFile: ws.logFile,
        agentConfig: this.config.agent,
        planFirst: ws.planFirst,
        tmuxSession: this.tmuxSessionName,
        windowName: name,
        onPaneCreated: async (paneId) => {
          ws.tmuxSession = this.tmuxSessionName;
          ws.tmuxPaneId = paneId;
          await saveState(this.state);
          // Set status line for this window
          const statusText = `ws/${name}  ·  Ctrl+Q detach`;
          await $`tmux set -t ${this.tmuxSessionName}:${name} status-format[0] ${`#[align=centre,fg=white,dim] ${statusText}`}`.quiet().catch(() => {});
        },
        onSessionId: async (id) => {
          ws.sessionId = id;
          await saveState(this.state);
          await logLine(`Session ID captured: ${id}`);
          // Update status line with session ID
          const statusText = `ws/${name}  session:${id.slice(0, 8)}  ·  Ctrl+Q detach`;
          await $`tmux set -t ${this.tmuxSessionName}:${name} status-format[0] ${`#[align=centre,fg=white,dim] ${statusText}`}`.quiet().catch(() => {});
        },
      });

      ws.exitCode = result.exitCode;
      if (result.sessionId) ws.sessionId = result.sessionId;
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
    ws.tmuxPaneId = undefined;
    this.runningProcs.delete(name);
    await logLine(`Workstream "${name}" finished with status: ${ws.status}`);
    await saveState(this.state);

    const icon = ws.status === "success" ? "✓" : "✗";
    const color = ws.status === "success" ? COLOR_SUCCESS : COLOR_FAILED;
    spinner.stop(icon, color, ws.status);

    const eventType = ws.status === "success" ? "node:success" : "node:failed";
    this.emit(eventType, name, { exitCode: ws.exitCode, error: ws.error });
  }

  private emit(type: string, name?: string, data?: Record<string, unknown>) {
    this.eventBus?.emit({
      type: type as any,
      timestamp: new Date().toISOString(),
      name,
      data,
    });
  }

  private async acquireWorktreeLock(fn: () => Promise<void>): Promise<void> {
    const prev = this.worktreeLock;
    let resolve: () => void;
    this.worktreeLock = new Promise((r) => (resolve = r));
    await prev;
    try {
      await fn();
    } finally {
      resolve!();
    }
  }

  private setupSignalHandlers() {
    const cleanup = () => {
      this.aborted = true;
      console.log("\nAborting... cleaning up running workstreams");
      for (const name of this.runningProcs) {
        const ws = this.run.workstreams[name];
        ws.status = "failed";
        ws.error = "Aborted by user";
        ws.finishedAt = new Date().toISOString();
        if (ws.tmuxPaneId) {
          Bun.spawnSync(["tmux", "kill-pane", "-t", ws.tmuxPaneId]);
        }
      }
      this.run.finishedAt = new Date().toISOString();
      saveState(this.state);
      // Kill the tmux session
      Bun.spawnSync(["tmux", "kill-session", "-t", this.tmuxSessionName]);
    };

    process.on("SIGINT", cleanup);
    process.on("SIGTERM", cleanup);
  }
}
