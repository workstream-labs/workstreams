import { describe, it, expect } from "bun:test";
import { buildGraph } from "@core";
import type { WorkstreamDef } from "@core";

describe("buildGraph", () => {
  it("builds a graph from workstream defs", () => {
    const defs: WorkstreamDef[] = [
      { name: "a", prompt: "A" },
      { name: "b", prompt: "B" },
      { name: "c", prompt: "C" },
    ];

    const graph = buildGraph(defs);
    expect(graph.names).toEqual(["a", "b", "c"]);
    expect(graph.nodes.size).toBe(3);
    expect(graph.nodes.get("a")!.def.prompt).toBe("A");
  });

  it("handles a single node", () => {
    const defs: WorkstreamDef[] = [
      { name: "solo", prompt: "Solo task" },
    ];

    const graph = buildGraph(defs);
    expect(graph.names).toEqual(["solo"]);
    expect(graph.nodes.size).toBe(1);
  });

  it("handles empty defs", () => {
    const graph = buildGraph([]);
    expect(graph.names).toEqual([]);
    expect(graph.nodes.size).toBe(0);
  });
});
