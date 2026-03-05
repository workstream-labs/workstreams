import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { DAGExecutor } from "../src/core/executor";
import { buildDAG } from "../src/core/dag";
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

describe("DAG executor", () => {
  beforeEach(async () => {
    await setupTestRepo();
    process.chdir(TEST_DIR);
  });

  afterEach(async () => {
    process.chdir("/tmp");
    await rm(TEST_DIR, { recursive: true, force: true });
  });

  it("executes independent nodes in parallel", async () => {
    const config: WorkstreamConfig = {
      agent: { command: "echo", args: ["done"] },
      workstreams: [
        { name: "a", type: "code", prompt: "A" },
        { name: "b", type: "code", prompt: "B" },
      ],
    };

    const dag = buildDAG(config.workstreams);
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

    const executor = new DAGExecutor(config, dag, state);
    await executor.execute();

    expect(run.workstreams["a"].status).toBe("success");
    expect(run.workstreams["b"].status).toBe("success");
  });

  it("respects dependency order", async () => {
    const config: WorkstreamConfig = {
      agent: { command: "echo", args: ["done"] },
      workstreams: [
        { name: "a", type: "code", prompt: "A" },
        { name: "b", type: "code", prompt: "B", dependsOn: ["a"] },
      ],
    };

    const dag = buildDAG(config.workstreams);
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

    const executor = new DAGExecutor(config, dag, state);
    await executor.execute();

    expect(run.workstreams["a"].status).toBe("success");
    expect(run.workstreams["b"].status).toBe("success");

    // b should have finished after a
    const aFinish = new Date(run.workstreams["a"].finishedAt!).getTime();
    const bStart = new Date(run.workstreams["b"].startedAt!).getTime();
    expect(bStart).toBeGreaterThanOrEqual(aFinish);
  });

  it("skips downstream on failure", async () => {
    const config: WorkstreamConfig = {
      agent: { command: "false" }, // exits with code 1
      workstreams: [
        { name: "a", type: "code", prompt: "A" },
        { name: "b", type: "code", prompt: "B", dependsOn: ["a"] },
      ],
    };

    const dag = buildDAG(config.workstreams);
    const run: RunState = {
      runId: "test-3",
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

    const executor = new DAGExecutor(config, dag, state);
    await executor.execute();

    expect(run.workstreams["a"].status).toBe("failed");
    expect(run.workstreams["b"].status).toBe("skipped");
  });
});
