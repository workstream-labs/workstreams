// Core — re-exports all core modules

// Types
export type {
  WorkstreamStatus,
  AgentConfig,
  WorkstreamDef,
  WorkstreamConfig,
  WorkstreamState,
  RunState,
  ProjectState,
  EventType,
  WorkstreamEvent,
} from "./types";

// Config
export { validateWorkstreamName, loadConfig } from "./config";

// DAG
export { buildGraph } from "./dag";
export type { WorkstreamNode, WorkstreamGraph } from "./dag";

// Executor
export { Executor } from "./executor";

// Agent
export { AgentAdapter } from "./agent";
export type { AgentRunOptions, AgentResult } from "./agent";

// Worktree
export { WorktreeManager } from "./worktree";

// State
export {
  defaultState,
  loadState,
  saveState,
  saveStateSync,
  updateState,
  appendWorkstreamStatus,
  appendWorkstreamStatusSync,
  readWorkstreamState,
  loadAllWorkstreamStates,
} from "./state";

// Events
export { EventBus } from "./events";

// Errors
export {
  WorkstreamError,
  ConfigError,
  AgentError,
  WorktreeError,
} from "./errors";

// Notifications
export { notify, notifyStatus, notifyRunComplete } from "./notify";

// Comments
export {
  loadComments,
  saveComments,
  clearComments,
  deleteComment,
  formatCommentsAsPrompt,
} from "./comments";
export type { ReviewComment, WorkstreamComments } from "./comments";

// Pending Prompts
export {
  loadPendingPrompt,
  savePendingPrompt,
  clearPendingPrompt,
} from "./pending-prompt";

// Prompt
export { prompt } from "./prompt";

// Session Reader
export {
  findSessionJsonl,
  parseSessionJsonl,
  parseSessionJsonlContent,
} from "./session-reader";
export type { DisplayMessage, AssistantPart } from "./session-reader";

// Spawn Args
export { buildBgArgs } from "./spawn-args";

// Diff Parser
export { parseDiff, fileStat } from "./diff-parser";
export type {
  LineType,
  DiffLine,
  Hunk,
  FileStatus,
  FileDiff,
  ParsedDiff,
} from "./diff-parser";
