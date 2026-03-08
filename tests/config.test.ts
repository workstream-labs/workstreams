import { describe, it, expect } from "bun:test";

describe("config validation", () => {
  it("parses a valid config", async () => {
    const { loadConfig } = await import("../src/core/config");
    const yaml = `
agent:
  command: echo
  args: ["-p"]
  timeout: 60

workstreams:
  task-a:
    prompt: "Do task A"
  task-b:
    prompt: "Do task B"
`;
    const tmpPath = "/tmp/test-ws-valid.yaml";
    await Bun.write(tmpPath, yaml);
    const config = await loadConfig(tmpPath);

    expect(config.agent.command).toBe("echo");
    expect(config.workstreams).toHaveLength(2);
    expect(config.workstreams[0].name).toBe("task-a");
    expect(config.workstreams[1].name).toBe("task-b");
  });

  it("rejects missing agent command", async () => {
    const { loadConfig } = await import("../src/core/config");
    const yaml = `
agent: {}
workstreams:
  foo:
    prompt: "hi"
`;
    const tmpPath = "/tmp/test-ws-no-agent.yaml";
    await Bun.write(tmpPath, yaml);
    expect(loadConfig(tmpPath)).rejects.toThrow("agent.command");
  });

  it("rejects missing prompt", async () => {
    const { loadConfig } = await import("../src/core/config");
    const yaml = `
agent:
  command: echo
workstreams:
  foo:
    type: code
`;
    const tmpPath = "/tmp/test-ws-no-prompt.yaml";
    await Bun.write(tmpPath, yaml);
    expect(loadConfig(tmpPath)).rejects.toThrow("prompt is required");
  });

  it("rejects duplicate names", async () => {
    const { loadConfig } = await import("../src/core/config");
    const yaml = `
agent:
  command: echo
workstreams:
  - name: foo
    prompt: "hi"
  - name: foo
    prompt: "hi again"
`;
    const tmpPath = "/tmp/test-ws-dup.yaml";
    await Bun.write(tmpPath, yaml);
    expect(loadConfig(tmpPath)).rejects.toThrow("Duplicate");
  });

  it("defaults acceptAll to true when not specified", async () => {
    const { loadConfig } = await import("../src/core/config");
    const yaml = `
agent:
  command: claude
  args: ["-p"]
workstreams:
  task-a:
    prompt: "Do task A"
`;
    const tmpPath = "/tmp/test-ws-acceptall-default.yaml";
    await Bun.write(tmpPath, yaml);
    const config = await loadConfig(tmpPath);
    expect(config.agent.acceptAll).toBe(true);
  });

  it("respects explicit acceptAll: false", async () => {
    const { loadConfig } = await import("../src/core/config");
    const yaml = `
agent:
  command: claude
  args: ["-p"]
  acceptAll: false
workstreams:
  task-a:
    prompt: "Do task A"
`;
    const tmpPath = "/tmp/test-ws-acceptall-false.yaml";
    await Bun.write(tmpPath, yaml);
    const config = await loadConfig(tmpPath);
    expect(config.agent.acceptAll).toBe(false);
  });

  it("allows empty workstreams object", async () => {
    const { loadConfig } = await import("../src/core/config");
    const yaml = `
agent:
  command: claude
  args: ["-p"]
workstreams: {}
`;
    const tmpPath = "/tmp/test-ws-empty.yaml";
    await Bun.write(tmpPath, yaml);
    const config = await loadConfig(tmpPath);
    expect(config.workstreams).toHaveLength(0);
  });

  it("allows missing workstreams section", async () => {
    const { loadConfig } = await import("../src/core/config");
    const yaml = `
agent:
  command: claude
  args: ["-p"]
`;
    const tmpPath = "/tmp/test-ws-missing.yaml";
    await Bun.write(tmpPath, yaml);
    const config = await loadConfig(tmpPath);
    expect(config.workstreams).toHaveLength(0);
  });
});
