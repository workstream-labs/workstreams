import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { defaultState, loadState, saveState } from "@core";
import { mkdir, rm } from "fs/promises";

const TEST_DIR = "/tmp/test-ws-state";

describe("state", () => {
  beforeEach(async () => {
    await rm(TEST_DIR, { recursive: true, force: true });
    await mkdir(`${TEST_DIR}/.workstreams`, { recursive: true });
    process.chdir(TEST_DIR);
  });

  afterEach(async () => {
    process.chdir("/tmp");
    await rm(TEST_DIR, { recursive: true, force: true });
  });

  it("defaultState returns correct structure", () => {
    const state = defaultState("/my/project");
    expect(state.initialized).toBe(true);
    expect(state.rootDir).toBe("/my/project");
    expect(state.history).toEqual([]);
    expect(state.currentRun).toBeUndefined();
  });

  it("loadState returns null when file does not exist", async () => {
    const state = await loadState();
    expect(state).toBeNull();
  });

  it("saveState and loadState roundtrip", async () => {
    const state = defaultState(TEST_DIR);
    state.history = [
      {
        runId: "run-1",
        startedAt: "2025-01-01T00:00:00.000Z",
        workstreams: {},
      },
    ];

    await saveState(state);
    const loaded = await loadState();

    expect(loaded).not.toBeNull();
    expect(loaded!.initialized).toBe(true);
    expect(loaded!.rootDir).toBe(TEST_DIR);
    expect(loaded!.history).toHaveLength(1);
    expect(loaded!.history[0].runId).toBe("run-1");
  });

  it("saveState overwrites existing state", async () => {
    const state1 = defaultState(TEST_DIR);
    await saveState(state1);

    const state2 = defaultState(TEST_DIR);
    state2.defaultEditor = "vim";
    await saveState(state2);

    const loaded = await loadState();
    expect(loaded!.defaultEditor).toBe("vim");
  });
});
