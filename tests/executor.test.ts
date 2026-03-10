import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Executor } from "../src/core/executor";
import { buildGraph } from "../src/core/dag";
import { saveState } from "../src/core/state";
import type { ProjectState, RunState, WorkstreamConfig } from "../src/core/types";
import { mkdir, rm } from "fs/promises";
import { $ } from "bun";

// Set up a test git repo for worktree operations
const TEST_DIR = "/tmp/test-ws-executor";

async function setupTestRepo() {
  await rm(TEST_DIR, { recursive: true, force: true });
  await mkdir(TEST_DIR, { recursive: true });
  await $`git init ${TEST_DIR}`.quiet();
  await $`git -C ${TEST_DIR} commit --allow-empty -m "init"`.quiet();
  await mkdir(`${TEST_DIR}/.workstreams/trees`, { recursive: true });
  await mkdir(`${TEST_DIR}/.workstreams/logs`, { recursive: true });
}

describe("Executor", () => {
  beforeEach(async () => {
    await setupTestRepo();
    process.chdir(TEST_DIR);
  });

  afterEach(async () => {
    process.chdir("/tmp");
    await $`tmux kill-session -t ws-run`.quiet().catch(() => {});
    await rm(TEST_DIR, { recursive: true, force: true });
  });

  it("executes all nodes in parallel", async () => {
    const config: WorkstreamConfig = {
      agent: { command: "echo", args: ["done"] },
      workstreams: [
        { name: "a", prompt: "A" },
        { name: "b", prompt: "B" },
      ],
    };

    const graph = buildGraph(config.workstreams);
    const run: RunState = {
      runId: "test-1",
      startedAt: new Date().toISOString(),
      workstreams: {},
    };
    const state: ProjectState = {
      initialized: true,
      rootDir: TEST_DIR,
      currentRun: run,
      history: [],
    };
    await saveState(state);

    const executor = new Executor(config, graph, state);
    await executor.execute();

    expect(run.workstreams["a"].status).toBe("success");
    expect(run.workstreams["b"].status).toBe("success");
  }, 15000);

  it("marks failed nodes correctly", async () => {
    const config: WorkstreamConfig = {
      agent: { command: "false" }, // exits with code 1
      workstreams: [
        { name: "a", prompt: "A" },
      ],
    };

    const graph = buildGraph(config.workstreams);
    const run: RunState = {
      runId: "test-2",
      startedAt: new Date().toISOString(),
      workstreams: {},
    };
    const state: ProjectState = {
      initialized: true,
      rootDir: TEST_DIR,
      currentRun: run,
      history: [],
    };
    await saveState(state);

    const executor = new Executor(config, graph, state);
    await executor.execute();

    expect(run.workstreams["a"].status).toBe("failed");
  }, 15000);
});
