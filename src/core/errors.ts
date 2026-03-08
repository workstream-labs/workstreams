export class WorkstreamError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkstreamError";
  }
}

export class ConfigError extends WorkstreamError {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

export class AgentError extends WorkstreamError {
  constructor(message: string) {
    super(message);
    this.name = "AgentError";
  }
}

export class WorktreeError extends WorkstreamError {
  constructor(message: string) {
    super(message);
    this.name = "WorktreeError";
  }
}
