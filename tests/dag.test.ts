import { describe, it, expect } from "bun:test";
import { buildDAG } from "../src/core/dag";
import type { WorkstreamDef } from "../src/core/types";

describe("DAG engine", () => {
  it("builds a simple linear chain", () => {
    const defs: WorkstreamDef[] = [
      { name: "a", type: "code", prompt: "A" },
      { name: "b", type: "code", prompt: "B", dependsOn: ["a"] },
      { name: "c", type: "code", prompt: "C", dependsOn: ["b"] },
    ];

    const dag = buildDAG(defs);
    expect(dag.roots).toEqual(["a"]);
    expect(dag.order).toEqual(["a", "b", "c"]);
    expect(dag.nodes.get("a")!.dependents).toEqual(["b"]);
    expect(dag.nodes.get("b")!.dependents).toEqual(["c"]);
  });

  it("builds a diamond shape", () => {
    const defs: WorkstreamDef[] = [
      { name: "root", type: "code", prompt: "R" },
      { name: "left", type: "code", prompt: "L", dependsOn: ["root"] },
      { name: "right", type: "code", prompt: "R", dependsOn: ["root"] },
      { name: "join", type: "review", prompt: "J", dependsOn: ["left", "right"] },
    ];

    const dag = buildDAG(defs);
    expect(dag.roots).toEqual(["root"]);
    expect(dag.order[0]).toBe("root");
    expect(dag.order[dag.order.length - 1]).toBe("join");
    // left and right should both come before join
    expect(dag.order.indexOf("left")).toBeLessThan(dag.order.indexOf("join"));
    expect(dag.order.indexOf("right")).toBeLessThan(dag.order.indexOf("join"));
  });

  it("handles independent nodes", () => {
    const defs: WorkstreamDef[] = [
      { name: "a", type: "code", prompt: "A" },
      { name: "b", type: "code", prompt: "B" },
      { name: "c", type: "code", prompt: "C" },
    ];

    const dag = buildDAG(defs);
    expect(dag.roots).toHaveLength(3);
    expect(dag.order).toHaveLength(3);
  });

  it("detects a cycle", () => {
    const defs: WorkstreamDef[] = [
      { name: "a", type: "code", prompt: "A", dependsOn: ["c"] },
      { name: "b", type: "code", prompt: "B", dependsOn: ["a"] },
      { name: "c", type: "code", prompt: "C", dependsOn: ["b"] },
    ];

    expect(() => buildDAG(defs)).toThrow("Cycle detected");
  });

  it("detects missing dependency", () => {
    const defs: WorkstreamDef[] = [
      { name: "a", type: "code", prompt: "A", dependsOn: ["nonexistent"] },
    ];

    expect(() => buildDAG(defs)).toThrow("unknown node");
  });

  it("handles a complex DAG with multiple levels", () => {
    const defs: WorkstreamDef[] = [
      { name: "a", type: "code", prompt: "A" },
      { name: "b", type: "code", prompt: "B" },
      { name: "c", type: "code", prompt: "C", dependsOn: ["a"] },
      { name: "d", type: "code", prompt: "D", dependsOn: ["a", "b"] },
      { name: "e", type: "review", prompt: "E", dependsOn: ["c", "d"] },
    ];

    const dag = buildDAG(defs);
    expect(dag.roots.sort()).toEqual(["a", "b"]);
    expect(dag.order.indexOf("a")).toBeLessThan(dag.order.indexOf("c"));
    expect(dag.order.indexOf("a")).toBeLessThan(dag.order.indexOf("d"));
    expect(dag.order.indexOf("b")).toBeLessThan(dag.order.indexOf("d"));
    expect(dag.order.indexOf("c")).toBeLessThan(dag.order.indexOf("e"));
    expect(dag.order.indexOf("d")).toBeLessThan(dag.order.indexOf("e"));
  });
});
