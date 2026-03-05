import type {
  DAG,
  ProjectState,
  RunState,
  WorkstreamConfig,
  WorkstreamState,
} from "./types";
import { WorktreeManager } from "./worktree";
import { AgentAdapter } from "./agent";
import { saveState } from "./state";
import type { EventBus } from "./events";

export class DAGExecutor {
  private config: WorkstreamConfig;
  private dag: DAG;
  private state: ProjectState;
  private run: RunState;
  private wt = new WorktreeManager();
  private agent = new AgentAdapter();
  private eventBus?: EventBus;
  private aborted = false;
  private runningProcs: Set<string> = new Set();

  constructor(
    config: WorkstreamConfig,
    dag: DAG,
    state: ProjectState,
    eventBus?: EventBus
  ) {
    this.config = config;
    this.dag = dag;
    this.state = state;
    this.run = state.currentRun!;
    this.eventBus = eventBus;

    // Ensure all nodes have state entries
    for (const [name, node] of dag.nodes) {
      if (!this.run.workstreams[name]) {
        this.run.workstreams[name] = {
          name,
          type: node.def.type,
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

    // Clear old log files
    const { unlink } = await import("fs/promises");
    for (const ws of Object.values(this.run.workstreams)) {
      await unlink(ws.logFile).catch(() => {});
    }

    console.log(`Starting run ${this.run.runId} with ${this.dag.nodes.size} workstreams`);
    console.log(`Execution order: ${this.dag.order.join(" → ")}`);
    console.log();

    // Ready-queue approach
    const completed = new Set<string>();
    const inFlight = new Map<string, Promise<void>>();
    const inDegree = new Map<string, number>();

    for (const [name, node] of this.dag.nodes) {
      inDegree.set(name, node.inDegree);
    }

    // Enqueue roots
    const enqueue = (name: string) => {
      if (this.aborted) return;
      const ws = this.run.workstreams[name];
      ws.status = "queued";
      this.emit("node:queued", name);

      const promise = this.executeNode(name).then(() => {
        completed.add(name);
        inFlight.delete(name);
        this.runningProcs.delete(name);

        // Check dependents
        const node = this.dag.nodes.get(name)!;
        for (const depName of node.dependents) {
          const newDeg = inDegree.get(depName)! - 1;
          inDegree.set(depName, newDeg);

          // Skip if upstream failed
          const depNode = this.dag.nodes.get(depName)!;
          const upstreamFailed = depNode.dependencies.some(
            (d) => this.run.workstreams[d].status === "failed"
          );

          if (upstreamFailed) {
            this.run.workstreams[depName].status = "skipped";
            this.run.workstreams[depName].error = "Upstream dependency failed";
            this.emit("node:skipped", depName);
            completed.add(depName);

            // Propagate skip to further dependents
            const skipNode = this.dag.nodes.get(depName)!;
            for (const s of skipNode.dependents) {
              inDegree.set(s, inDegree.get(s)! - 1);
            }
          } else if (newDeg === 0) {
            enqueue(depName);
          }
        }
      });

      inFlight.set(name, promise);
    };

    // Start roots
    for (const root of this.dag.roots) {
      enqueue(root);
    }

    // Wait for all to complete
    while (inFlight.size > 0) {
      await Promise.race(inFlight.values());
    }

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
            : ws.status === "skipped"
              ? "\x1b[33m"
              : "\x1b[90m";
      console.log(`  ${color}${ws.status.padEnd(8)}\x1b[0m ${name}`);
    }
  }

  private async executeNode(name: string): Promise<void> {
    const ws = this.run.workstreams[name];
    const node = this.dag.nodes.get(name)!;

    ws.status = "running";
    ws.startedAt = new Date().toISOString();
    this.runningProcs.add(name);
    this.emit("node:running", name);
    await saveState(this.state);

    console.log(`\x1b[34m▶ Starting: ${name}\x1b[0m`);

    try {
      await this.wt.create(name, node.def.baseBranch);

      // For review nodes, gather upstream diffs
      let upstreamDiffs: string[] | undefined;
      if (node.def.type === "review" && node.dependencies.length > 0) {
        upstreamDiffs = [];
        for (const dep of node.dependencies) {
          const diff = await this.wt.diffBranch(`ws/${dep}`);
          if (diff) upstreamDiffs.push(`=== Changes from ${dep} ===\n${diff}`);
        }
      }

      const result = await this.agent.run({
        workDir: ws.worktreePath,
        prompt: node.def.prompt,
        type: node.def.type,
        logFile: ws.logFile,
        agentConfig: this.config.agent,
        upstreamDiffs,
      });

      ws.exitCode = result.exitCode;
      ws.status = result.exitCode === 0 ? "success" : "failed";
      if (result.exitCode !== 0) {
        ws.error = `Agent exited with code ${result.exitCode}`;
      }
    } catch (e: any) {
      ws.status = "failed";
      ws.error = e.message;
    }

    ws.finishedAt = new Date().toISOString();
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
