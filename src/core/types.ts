export type NodeType = "code" | "review";

export type WorkstreamStatus =
  | "pending"
  | "queued"
  | "running"
  | "success"
  | "failed"
  | "skipped";

export interface AgentConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  timeout?: number;
}

export interface WorkstreamDef {
  name: string;
  type: NodeType;
  prompt: string;
  dependsOn?: string[];
  baseBranch?: string;
}

export interface WorkstreamConfig {
  agent: AgentConfig;
  workstreams: WorkstreamDef[];
}

export interface WorkstreamState {
  name: string;
  type: NodeType;
  status: WorkstreamStatus;
  branch: string;
  worktreePath: string;
  pid?: number;
  startedAt?: string;
  finishedAt?: string;
  exitCode?: number;
  error?: string;
  logFile: string;
}

export interface RunState {
  runId: string;
  startedAt: string;
  finishedAt?: string;
  workstreams: Record<string, WorkstreamState>;
}

export interface ProjectState {
  initialized: boolean;
  rootDir: string;
  currentRun?: RunState;
  history: RunState[];
}

export interface DAGNode {
  name: string;
  def: WorkstreamDef;
  dependencies: string[];
  dependents: string[];
  inDegree: number;
}

export interface DAG {
  nodes: Map<string, DAGNode>;
  roots: string[];
  order: string[];
}

export type EventType =
  | "run:start"
  | "run:complete"
  | "node:queued"
  | "node:running"
  | "node:success"
  | "node:failed"
  | "node:skipped"
  | "log:line";

export interface WorkstreamEvent {
  type: EventType;
  timestamp: string;
  name?: string;
  data?: Record<string, unknown>;
}
