export type WorkstreamStatus =
  | "pending"
  | "queued"
  | "running"
  | "success"
  | "failed"
  | "waiting";

export interface AgentConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  timeout?: number;
  acceptAll?: boolean;
}

export interface WorkstreamDef {
  name: string;
  prompt: string;
  baseBranch?: string;
  planFirst?: boolean;
}

export interface WorkstreamConfig {
  agent: AgentConfig;
  workstreams: WorkstreamDef[];
}

export interface WorkstreamState {
  name: string;
  status: WorkstreamStatus;
  branch: string;
  worktreePath: string;
  pid?: number;
  startedAt?: string;
  finishedAt?: string;
  exitCode?: number;
  error?: string;
  logFile: string;
  sessionId?: string;
  planFirst?: boolean;
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

export type EventType =
  | "run:start"
  | "run:complete"
  | "node:queued"
  | "node:running"
  | "node:success"
  | "node:failed"
  | "node:waiting"
  | "log:line";

export interface WorkstreamEvent {
  type: EventType;
  timestamp: string;
  name?: string;
  data?: Record<string, unknown>;
}
