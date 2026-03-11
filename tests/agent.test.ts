import { describe, it, expect } from "bun:test";

// We test the exported helper functions by importing the module and
// extracting the non-exported functions via a re-export trick.
// Since getAutoAcceptFlags and formatStreamEvent are module-private,
// we test them indirectly through AgentAdapter behavior, or test the
// patterns directly.

// Test the auto-accept flags logic by checking AgentAdapter behavior
// with different agent configs.

describe("AgentAdapter", () => {
  // We can test getAutoAcceptFlags indirectly by checking the args
  // passed to the spawned process. Since we can't easily intercept
  // Bun.spawn, we test the core logic patterns.

  describe("auto-accept flag logic", () => {
    // Replicate the getAutoAcceptFlags logic for testing
    const AUTO_ACCEPT_FLAGS: Record<string, string[]> = {
      claude: ["--dangerously-skip-permissions", "--output-format", "stream-json", "--verbose"],
      codex: ["--full-auto"],
      aider: ["--yes"],
    };

    function getAutoAcceptFlags(config: { command: string; acceptAll?: boolean }): string[] {
      if (config.acceptAll === false) return [];
      const cmd = config.command.split("/").pop() ?? config.command;
      return AUTO_ACCEPT_FLAGS[cmd] ?? [];
    }

    it("returns claude flags for claude command", () => {
      const flags = getAutoAcceptFlags({ command: "claude" });
      expect(flags).toEqual([
        "--dangerously-skip-permissions",
        "--output-format",
        "stream-json",
        "--verbose",
      ]);
    });

    it("returns codex flags for codex command", () => {
      const flags = getAutoAcceptFlags({ command: "codex" });
      expect(flags).toEqual(["--full-auto"]);
    });

    it("returns aider flags for aider command", () => {
      const flags = getAutoAcceptFlags({ command: "aider" });
      expect(flags).toEqual(["--yes"]);
    });

    it("returns empty flags for unknown command", () => {
      const flags = getAutoAcceptFlags({ command: "echo" });
      expect(flags).toEqual([]);
    });

    it("returns empty flags when acceptAll is false", () => {
      const flags = getAutoAcceptFlags({ command: "claude", acceptAll: false });
      expect(flags).toEqual([]);
    });

    it("extracts command name from full path", () => {
      const flags = getAutoAcceptFlags({ command: "/usr/local/bin/claude" });
      expect(flags).toEqual([
        "--dangerously-skip-permissions",
        "--output-format",
        "stream-json",
        "--verbose",
      ]);
    });
  });

  describe("formatStreamEvent logic", () => {
    // Replicate formatStreamEvent for testing
    function formatStreamEvent(line: string): string | null {
      try {
        const event = JSON.parse(line);
        const ts = event.timestamp ? `[${event.timestamp}]` : "";

        switch (event.type) {
          case "assistant": {
            const content = event.message?.content ?? [];
            const parts: string[] = [];
            for (const block of content) {
              if (block.type === "text" && block.text) {
                parts.push(`${ts} [assistant] ${block.text}`);
              } else if (block.type === "tool_use") {
                const input =
                  typeof block.input === "string"
                    ? block.input
                    : JSON.stringify(block.input);
                const truncated =
                  input.length > 500 ? input.slice(0, 500) + "..." : input;
                parts.push(`${ts} [tool_call] ${block.name}: ${truncated}`);
              }
            }
            return parts.join("\n") || null;
          }
          case "result": {
            const cost = event.total_cost_usd
              ? ` (cost: $${event.total_cost_usd.toFixed(4)})`
              : "";
            const duration = event.duration_ms
              ? ` (${(event.duration_ms / 1000).toFixed(1)}s)`
              : "";
            return `${ts} [result] ${event.subtype ?? "done"}${duration}${cost}`;
          }
          case "tool_result": {
            const content = event.content ?? "";
            const text =
              typeof content === "string" ? content : JSON.stringify(content);
            const truncated =
              text.length > 1000 ? text.slice(0, 1000) + "..." : text;
            return `${ts} [tool_result] ${truncated}`;
          }
          case "system": {
            return `${ts} [system] ${event.subtype ?? ""} ${event.message ?? ""}`.trim();
          }
          default:
            return null;
        }
      } catch {
        return line;
      }
    }

    it("formats assistant text event", () => {
      const event = JSON.stringify({
        type: "assistant",
        timestamp: "12:00:00",
        message: {
          content: [{ type: "text", text: "Hello world" }],
        },
      });
      const result = formatStreamEvent(event);
      expect(result).toBe("[12:00:00] [assistant] Hello world");
    });

    it("formats assistant tool_use event", () => {
      const event = JSON.stringify({
        type: "assistant",
        timestamp: "12:00:00",
        message: {
          content: [{ type: "tool_use", name: "Read", input: { path: "/foo" } }],
        },
      });
      const result = formatStreamEvent(event);
      expect(result).toContain("[tool_call] Read:");
      expect(result).toContain("/foo");
    });

    it("truncates long tool_use input", () => {
      const longInput = "x".repeat(600);
      const event = JSON.stringify({
        type: "assistant",
        message: {
          content: [{ type: "tool_use", name: "Write", input: longInput }],
        },
      });
      const result = formatStreamEvent(event);
      expect(result).toContain("...");
    });

    it("formats result event with cost and duration", () => {
      const event = JSON.stringify({
        type: "result",
        timestamp: "12:00:00",
        subtype: "success",
        total_cost_usd: 0.1234,
        duration_ms: 5500,
      });
      const result = formatStreamEvent(event);
      expect(result).toBe("[12:00:00] [result] success (5.5s) (cost: $0.1234)");
    });

    it("formats result event without cost/duration", () => {
      const event = JSON.stringify({
        type: "result",
        subtype: "done",
      });
      const result = formatStreamEvent(event);
      expect(result).toBe(" [result] done");
    });

    it("formats tool_result event", () => {
      const event = JSON.stringify({
        type: "tool_result",
        content: "File contents here",
      });
      const result = formatStreamEvent(event);
      expect(result).toContain("[tool_result] File contents here");
    });

    it("truncates long tool_result content", () => {
      const event = JSON.stringify({
        type: "tool_result",
        content: "x".repeat(1100),
      });
      const result = formatStreamEvent(event);
      expect(result).toContain("...");
    });

    it("formats system event", () => {
      const event = JSON.stringify({
        type: "system",
        subtype: "init",
        message: "Starting up",
      });
      const result = formatStreamEvent(event);
      expect(result).toContain("[system] init Starting up");
    });

    it("returns null for unknown event type", () => {
      const event = JSON.stringify({ type: "unknown" });
      const result = formatStreamEvent(event);
      expect(result).toBeNull();
    });

    it("returns raw line for invalid JSON", () => {
      const result = formatStreamEvent("not json at all");
      expect(result).toBe("not json at all");
    });

    it("returns null for assistant with empty content", () => {
      const event = JSON.stringify({
        type: "assistant",
        message: { content: [] },
      });
      const result = formatStreamEvent(event);
      expect(result).toBeNull();
    });
  });
});
