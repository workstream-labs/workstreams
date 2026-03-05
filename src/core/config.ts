import { parse } from "yaml";
import { ConfigError } from "./errors";
import type { AgentConfig, NodeType, WorkstreamConfig, WorkstreamDef } from "./types";

const VALID_TYPES: NodeType[] = ["code", "review"];

export async function loadConfig(path: string): Promise<WorkstreamConfig> {
  const file = Bun.file(path);
  if (!(await file.exists())) {
    throw new ConfigError(`Config file not found: ${path}`);
  }

  const raw = parse(await file.text());
  return validateConfig(raw);
}

function validateConfig(raw: any): WorkstreamConfig {
  if (!raw || typeof raw !== "object") {
    throw new ConfigError("Config must be a YAML object");
  }

  // Validate agent
  if (!raw.agent || typeof raw.agent !== "object") {
    throw new ConfigError("Missing 'agent' section");
  }
  if (!raw.agent.command || typeof raw.agent.command !== "string") {
    throw new ConfigError("agent.command is required and must be a string");
  }

  const agent: AgentConfig = {
    command: raw.agent.command,
    args: raw.agent.args,
    env: raw.agent.env,
    timeout: raw.agent.timeout,
    acceptAll: raw.agent.acceptAll ?? true,
  };

  // Validate workstreams — allow empty or missing
  if (raw.workstreams !== undefined && raw.workstreams !== null && typeof raw.workstreams !== "object") {
    throw new ConfigError("'workstreams' must be an object or array");
  }

  const defs: WorkstreamDef[] = [];
  const names = new Set<string>();

  // If workstreams is empty/null/undefined, return early with empty list
  if (!raw.workstreams || (typeof raw.workstreams === "object" && !Array.isArray(raw.workstreams) && Object.keys(raw.workstreams).length === 0)) {
    return { agent, workstreams: defs };
  }

  // Support both map and array formats
  const entries = Array.isArray(raw.workstreams)
    ? raw.workstreams.map((w: any) => [w.name, w])
    : Object.entries(raw.workstreams);

  for (const [name, def] of entries) {
    if (typeof name !== "string" || !name) {
      throw new ConfigError("Workstream name must be a non-empty string");
    }
    if (names.has(name)) {
      throw new ConfigError(`Duplicate workstream name: "${name}"`);
    }
    names.add(name);

    if (!def || typeof def !== "object") {
      throw new ConfigError(`Workstream "${name}" must be an object`);
    }

    const d = def as Record<string, any>;

    if (!d.prompt || typeof d.prompt !== "string") {
      throw new ConfigError(`Workstream "${name}": prompt is required`);
    }

    const type: NodeType = d.type ?? "code";
    if (!VALID_TYPES.includes(type)) {
      throw new ConfigError(
        `Workstream "${name}": type must be one of: ${VALID_TYPES.join(", ")}`
      );
    }

    const dependsOn = d.depends_on ?? d.dependsOn ?? undefined;
    if (dependsOn !== undefined && !Array.isArray(dependsOn)) {
      throw new ConfigError(
        `Workstream "${name}": depends_on must be an array`
      );
    }

    if (type === "review" && (!dependsOn || dependsOn.length === 0)) {
      throw new ConfigError(
        `Workstream "${name}": review nodes must have depends_on`
      );
    }

    defs.push({
      name,
      type,
      prompt: d.prompt,
      dependsOn,
      baseBranch: d.base_branch ?? d.baseBranch,
    });
  }

  // Validate dependsOn references
  for (const def of defs) {
    if (def.dependsOn) {
      for (const dep of def.dependsOn) {
        if (!names.has(dep)) {
          throw new ConfigError(
            `Workstream "${def.name}": depends_on references unknown workstream "${dep}"`
          );
        }
      }
    }
  }

  return { agent, workstreams: defs };
}
