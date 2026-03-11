import { describe, it, expect } from "bun:test";
import {
  WorkstreamError,
  ConfigError,
  AgentError,
  WorktreeError,
} from "../src/core/errors";

describe("error classes", () => {
  it("WorkstreamError has correct name and message", () => {
    const err = new WorkstreamError("something broke");
    expect(err.message).toBe("something broke");
    expect(err.name).toBe("WorkstreamError");
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(WorkstreamError);
  });

  it("ConfigError extends WorkstreamError", () => {
    const err = new ConfigError("bad config");
    expect(err.message).toBe("bad config");
    expect(err.name).toBe("ConfigError");
    expect(err).toBeInstanceOf(WorkstreamError);
    expect(err).toBeInstanceOf(Error);
  });

  it("AgentError extends WorkstreamError", () => {
    const err = new AgentError("agent crashed");
    expect(err.message).toBe("agent crashed");
    expect(err.name).toBe("AgentError");
    expect(err).toBeInstanceOf(WorkstreamError);
  });

  it("WorktreeError extends WorkstreamError", () => {
    const err = new WorktreeError("git issue");
    expect(err.message).toBe("git issue");
    expect(err.name).toBe("WorktreeError");
    expect(err).toBeInstanceOf(WorkstreamError);
  });

  it("errors have proper stack traces", () => {
    const err = new ConfigError("test");
    expect(err.stack).toBeDefined();
    expect(err.stack).toContain("ConfigError");
  });
});
