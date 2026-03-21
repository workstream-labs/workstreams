import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { WorktreeManager } from "@workstreams/core";
import { mkdir, rm } from "fs/promises";
import { $ } from "bun";

const TEST_DIR = "/tmp/test-ws-worktree";

async function setupTestRepo() {
  await rm(TEST_DIR, { recursive: true, force: true });
  await mkdir(TEST_DIR, { recursive: true });
  await $`git init ${TEST_DIR}`.quiet();
  await $`git -C ${TEST_DIR} commit --allow-empty -m "init"`.quiet();
  await mkdir(`${TEST_DIR}/.workstreams/trees`, { recursive: true });
}

describe("WorktreeManager", () => {
  let mgr: WorktreeManager;

  beforeEach(async () => {
    await setupTestRepo();
    process.chdir(TEST_DIR);
    mgr = new WorktreeManager();
  });

  afterEach(async () => {
    process.chdir("/tmp");
    // Clean up worktrees before removing directory
    try {
      const result = await $`git -C ${TEST_DIR} worktree list --porcelain`.quiet();
      const output = result.stdout.toString();
      for (const line of output.split("\n")) {
        if (line.startsWith("worktree ") && !line.includes(TEST_DIR + "\n") && line.includes(".workstreams/trees")) {
          const path = line.slice(9);
          await $`git -C ${TEST_DIR} worktree remove ${path} --force`.quiet().catch(() => {});
        }
      }
    } catch {}
    await rm(TEST_DIR, { recursive: true, force: true });
  });

  it("creates a worktree with ws/ branch prefix", async () => {
    const path = await mgr.create("test-feature");
    expect(path).toBe(".workstreams/trees/test-feature");

    // Verify the branch exists
    const branches = await $`git -C ${TEST_DIR} branch`.quiet();
    const branchList = branches.stdout.toString();
    expect(branchList).toContain("ws/test-feature");
  });

  it("creates worktree with a base branch", async () => {
    // Create a base branch with a commit
    await $`git -C ${TEST_DIR} checkout -b feature-base`.quiet();
    await $`git -C ${TEST_DIR} commit --allow-empty -m "base commit"`.quiet();
    await $`git -C ${TEST_DIR} checkout -`.quiet();

    const path = await mgr.create("from-base", "feature-base");
    expect(path).toBe(".workstreams/trees/from-base");
  });

  it("remove cleans up worktree and branch", async () => {
    await mgr.create("to-remove");

    // Verify it exists
    const before = await $`git -C ${TEST_DIR} branch`.quiet();
    expect(before.stdout.toString()).toContain("ws/to-remove");

    await mgr.remove("to-remove");

    // Verify branch is gone
    const after = await $`git -C ${TEST_DIR} branch`.quiet();
    expect(after.stdout.toString()).not.toContain("ws/to-remove");
  });

  it("list returns worktrees", async () => {
    await mgr.create("list-test");
    const entries = await mgr.list();

    // Should have at least the main worktree + our new one
    expect(entries.length).toBeGreaterThanOrEqual(2);

    const ours = entries.find((e) => e.branch === "ws/list-test");
    expect(ours).toBeDefined();
  });

  it("diff returns empty for unchanged worktree", async () => {
    await mgr.create("no-changes");
    const diffOutput = await mgr.diff("no-changes");
    expect(diffOutput.trim()).toBe("");
  });

  it("create is idempotent (recreates after stale state)", async () => {
    await mgr.create("idempotent");
    // Create again — should clean up and recreate without error
    const path = await mgr.create("idempotent");
    expect(path).toBe(".workstreams/trees/idempotent");
  });

  it("throws WorktreeError on invalid base branch", async () => {
    expect(mgr.create("bad", "nonexistent-branch-xyz")).rejects.toThrow();
  });
});
