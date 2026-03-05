import { DAGError } from "./errors";
import type { DAG, DAGNode, WorkstreamDef } from "./types";

export function buildDAG(defs: WorkstreamDef[]): DAG {
  const nodes = new Map<string, DAGNode>();

  // Create all nodes
  for (const def of defs) {
    nodes.set(def.name, {
      name: def.name,
      def,
      dependencies: def.dependsOn ?? [],
      dependents: [],
      inDegree: def.dependsOn?.length ?? 0,
    });
  }

  // Validate and wire edges
  for (const node of nodes.values()) {
    for (const dep of node.dependencies) {
      const parent = nodes.get(dep);
      if (!parent) {
        throw new DAGError(
          `"${node.name}" depends on unknown node "${dep}"`
        );
      }
      parent.dependents.push(node.name);
    }
  }

  // Topological sort (Kahn's algorithm)
  const order = topologicalSort(nodes);

  const roots = [...nodes.values()]
    .filter((n) => n.dependencies.length === 0)
    .map((n) => n.name);

  return { nodes, roots, order };
}

function topologicalSort(nodes: Map<string, DAGNode>): string[] {
  const inDegree = new Map<string, number>();
  for (const [name, node] of nodes) {
    inDegree.set(name, node.inDegree);
  }

  const queue: string[] = [];
  for (const [name, deg] of inDegree) {
    if (deg === 0) queue.push(name);
  }

  const order: string[] = [];

  while (queue.length > 0) {
    const name = queue.shift()!;
    order.push(name);

    const node = nodes.get(name)!;
    for (const dep of node.dependents) {
      const newDeg = inDegree.get(dep)! - 1;
      inDegree.set(dep, newDeg);
      if (newDeg === 0) {
        queue.push(dep);
      }
    }
  }

  if (order.length !== nodes.size) {
    // Find nodes in cycle
    const inCycle = [...nodes.keys()].filter((n) => !order.includes(n));
    throw new DAGError(`Cycle detected involving: ${inCycle.join(", ")}`);
  }

  return order;
}
