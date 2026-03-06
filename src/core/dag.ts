import type { WorkstreamDef } from "./types";

export interface WorkstreamNode {
  name: string;
  def: WorkstreamDef;
}

export interface WorkstreamGraph {
  nodes: Map<string, WorkstreamNode>;
  names: string[];
}

export function buildGraph(defs: WorkstreamDef[]): WorkstreamGraph {
  const nodes = new Map<string, WorkstreamNode>();

  for (const def of defs) {
    nodes.set(def.name, { name: def.name, def });
  }

  const names = defs.map((d) => d.name);

  return { nodes, names };
}
