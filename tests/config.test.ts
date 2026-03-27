import { describe, it, expect } from "bun:test";
import { validateWorkstreamName } from "@core";

describe("config validation", () => {
  it("parses a valid config", async () => {
    const { loadConfig } = await import("@core");
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
    const { loadConfig } = await import("@core");
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

  it("allows missing prompt (workspace-only node)", async () => {
    const { loadConfig } = await import("@core");
    const yaml = `
agent:
  command: echo
workstreams:
  foo:
    type: code
`;
    const tmpPath = "/tmp/test-ws-no-prompt.yaml";
    await Bun.write(tmpPath, yaml);
    const config = await loadConfig(tmpPath);
    expect(config.workstreams[0].name).toBe("foo");
    expect(config.workstreams[0].prompt).toBeUndefined();
  });

  it("rejects duplicate names", async () => {
    const { loadConfig } = await import("@core");
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
    const { loadConfig } = await import("@core");
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
    const { loadConfig } = await import("@core");
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
    const { loadConfig } = await import("@core");
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
    const { loadConfig } = await import("@core");
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

  it("rejects workstream names with spaces", async () => {
    const { loadConfig } = await import("@core");
    const yaml = `
agent:
  command: echo
workstreams:
  - name: "my task"
    prompt: "hi"
`;
    const tmpPath = "/tmp/test-ws-spaces.yaml";
    await Bun.write(tmpPath, yaml);
    expect(loadConfig(tmpPath)).rejects.toThrow("Invalid workstream name");
  });

  it("rejects workstream names with special characters", async () => {
    const { loadConfig } = await import("@core");
    const yaml = `
agent:
  command: echo
workstreams:
  "my~task":
    prompt: "hi"
`;
    const tmpPath = "/tmp/test-ws-special.yaml";
    await Bun.write(tmpPath, yaml);
    expect(loadConfig(tmpPath)).rejects.toThrow("Invalid workstream name");
  });
});

describe("validateWorkstreamName", () => {
  it("accepts valid names", () => {
    expect(validateWorkstreamName("add-tests")).toBeNull();
    expect(validateWorkstreamName("dark-mode")).toBeNull();
    expect(validateWorkstreamName("feature_123")).toBeNull();
    expect(validateWorkstreamName("v2.0")).toBeNull();
    expect(validateWorkstreamName("A")).toBeNull();
  });

  it("rejects empty names", () => {
    expect(validateWorkstreamName("")).toContain("non-empty");
  });

  it("rejects names with spaces", () => {
    expect(validateWorkstreamName("my task")).toContain("Invalid");
    expect(validateWorkstreamName("add tests")).toContain("Invalid");
  });

  it("rejects names with leading/trailing spaces", () => {
    expect(validateWorkstreamName(" foo")).toContain("leading or trailing spaces");
    expect(validateWorkstreamName("foo ")).toContain("leading or trailing spaces");
  });

  it("rejects names with special characters", () => {
    expect(validateWorkstreamName("my~task")).toContain("Invalid");
    expect(validateWorkstreamName("my:task")).toContain("Invalid");
    expect(validateWorkstreamName("my*task")).toContain("Invalid");
    expect(validateWorkstreamName("my?task")).toContain("Invalid");
    expect(validateWorkstreamName("my[task")).toContain("Invalid");
    expect(validateWorkstreamName("my\\task")).toContain("Invalid");
  });

  it("rejects names starting with a dash or dot", () => {
    expect(validateWorkstreamName("-foo")).toContain("Invalid");
    expect(validateWorkstreamName(".foo")).toContain("Invalid");
  });

  it("rejects names ending with .lock", () => {
    expect(validateWorkstreamName("foo.lock")).toContain(".lock");
  });

  it("rejects names with consecutive dots", () => {
    expect(validateWorkstreamName("foo..bar")).toContain("..");
  });

  it("rejects names exceeding 100 characters", () => {
    expect(validateWorkstreamName("a".repeat(101))).toContain("too long");
  });
});
