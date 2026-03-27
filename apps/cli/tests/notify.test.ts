import { describe, it, expect } from "bun:test";
import { notifyStatus, notifyRunComplete } from "../src/core";
import type { WorkstreamStatus } from "../src/core";

describe("notifyStatus", () => {
  // These functions call osascript which is macOS-specific.
  // We verify they don't throw — the actual notification is fire-and-forget.

  it("does not throw for success status", () => {
    expect(() => notifyStatus("test-ws", "success")).not.toThrow();
  });

  it("does not throw for failed status", () => {
    expect(() => notifyStatus("test-ws", "failed")).not.toThrow();
  });

  it("does not throw for running status", () => {
    expect(() => notifyStatus("test-ws", "running")).not.toThrow();
  });

  it("does not throw for queued status", () => {
    expect(() => notifyStatus("test-ws", "queued")).not.toThrow();
  });
});

describe("notifyRunComplete", () => {
  it("does not throw with mixed results", () => {
    const results: Record<string, WorkstreamStatus> = {
      a: "success",
      b: "failed",
      c: "success",
    };
    expect(() => notifyRunComplete(results)).not.toThrow();
  });

  it("does not throw with all success", () => {
    expect(() => notifyRunComplete({ a: "success", b: "success" })).not.toThrow();
  });

  it("does not throw with empty results", () => {
    expect(() => notifyRunComplete({})).not.toThrow();
  });
});
