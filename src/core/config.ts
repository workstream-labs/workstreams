import { parse } from "yaml";
import { ConfigError } from "./errors";
import type { AgentConfig, WorkstreamConfig, WorkstreamDef } from "./types";

const VALID_NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;

export function validateWorkstreamName(name: string): string | null {
  if (!name) return "Workstream name must be a non-empty string";
  if (name !== name.trim()) return `Workstream name must not have leading or trailing spaces: "${name}"`;
  if (name.length > 100) return `Workstream name is too long (max 100 characters): "${name}"`;
  if (!VALID_NAME_RE.test(name))
    return `Invalid workstream name "${name}". Names must start with a letter or number and contain only letters, numbers, hyphens, underscores, or dots.`;
  if (name.endsWith(".lock") || name.endsWith("."))
    return `Workstream name must not end with ".lock" or ".": "${name}"`;
  if (name.includes(".."))
    return `Workstream name must not contain "..": "${name}"`;
  return null;
}

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
    const nameError = validateWorkstreamName(name);
    if (nameError) {
      throw new ConfigError(nameError);
    }
    if (names.has(name)) {
      throw new ConfigError(`Duplicate workstream name: "${name}"`);
    }
    names.add(name);

    // Handle bare entries like `fix-auth:` (YAML parses value as null)
    if (def === null || def === undefined) {
      defs.push({ name });
      continue;
    }

    if (typeof def !== "object") {
      throw new ConfigError(`Workstream "${name}" must be an object`);
    }

    const d = def as Record<string, any>;

    if (d.prompt !== undefined && typeof d.prompt !== "string") {
      throw new ConfigError(`Workstream "${name}": prompt must be a string`);
    }

    defs.push({
      name,
      prompt: d.prompt,
      baseBranch: d.base_branch ?? d.baseBranch,
    });
  }

  return { agent, workstreams: defs };
}
