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
        };
      }
    }
  }

  async execute(): Promise<void> {
    this.setupSignalHandlers();
    this.emit("run:start", undefined, { runId: this.run.runId });

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

    // Print summary
    console.log();
    console.log("=== Run Complete ===");
    for (const [name, ws] of Object.entries(this.run.workstreams)) {
      const color =
        ws.status === "success"
          ? "\x1b[32m"
          : ws.status === "failed"
            ? "\x1b[31m"
            : "\x1b[90m";
      console.log(`  ${color}${ws.status.padEnd(8)}\x1b[0m ${name}`);
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

    console.log(`\x1b[34m▶ Starting: ${name}\x1b[0m`);
    await logLine(`Workstream "${name}" starting`);

    try {
      // Serialize worktree creation to avoid git lock races
      await logLine("Creating git worktree...");
      await this.acquireWorktreeLock(async () => {
        await this.wt.create(name, node.def.baseBranch);
      });
      await logLine(`Worktree created at ${ws.worktreePath} on branch ${ws.branch}`);

      await logLine("Launching agent...");
      const result = await this.agent.run({
        workDir: ws.worktreePath,
        prompt: node.def.prompt,
        logFile: ws.logFile,
        agentConfig: this.config.agent,
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
    this.runningProcs.delete(name);
    await logLine(`Workstream "${name}" finished with status: ${ws.status}`);
    await saveState(this.state);

    const icon = ws.status === "success" ? "✓" : "✗";
    const color = ws.status === "success" ? "\x1b[32m" : "\x1b[31m";
    console.log(`${color}${icon} ${name}: ${ws.status}\x1b[0m`);

    this.emit(
      ws.status === "success" ? "node:success" : "node:failed",
      name,
      { exitCode: ws.exitCode, error: ws.error }
    );
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
      }
      this.run.finishedAt = new Date().toISOString();
      saveState(this.state);
    };

    process.on("SIGINT", cleanup);
    process.on("SIGTERM", cleanup);
  }
}
