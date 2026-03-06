# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

`workstream` (CLI: `ws`) is a tool that orchestrates parallel AI coding agents using DAG-based dependency graphs. It spawns multiple AI agents (claude, codex, aider) in isolated git worktrees, coordinating execution order via a topological sort of the dependency graph defined in `workstream.yaml`.

## Commands

```bash
bun install              # install dependencies
bun test                 # run all tests
bun test tests/dag.test.ts  # run a single test file
bun run src/index.ts     # run the CLI directly
```

The CLI is invoked as `ws` (see `bin` in package.json). Key subcommands: `init`, `create`, `run`, `status`, `list`, `switch`, `diff`, `log`, `destroy`, `dashboard`.

## Architecture

**Runtime:** Bun (TypeScript, ESNext modules). Uses `bun:test` for testing, `Bun.spawn` for process management, `Bun.serve` for the dashboard server.

**Core engine** (`src/core/`):
- `config.ts` — Loads and validates `workstream.yaml` (YAML config). Supports both map and array formats for workstream definitions. Config fields use `snake_case` (`depends_on`, `base_branch`) but also accept `camelCase`.
- `dag.ts` — Builds a DAG from workstream definitions using Kahn's algorithm for topological sort. Detects cycles and missing dependencies.
- `executor.ts` — `DAGExecutor` runs the DAG: enqueues root nodes, executes in parallel, propagates failures (skipping downstream nodes), handles SIGINT/SIGTERM cleanup.
- `agent.ts` — `AgentAdapter` spawns the configured agent command in each worktree. Auto-injects accept flags per agent (`--dangerously-skip-permissions` for claude, `--full-auto` for codex, `--yes` for aider). Streams stdout/stderr to log files.
- `worktree.ts` — `WorktreeManager` wraps git worktree commands. Creates branches prefixed `ws/` in `.workstreams/trees/`.
- `state.ts` — Persists run state to `.workstreams/state.json`.
- `events.ts` — `EventBus` with typed events, wildcard listeners, and a ring buffer for replay.
- `types.ts` — All shared TypeScript interfaces and type definitions.

**CLI commands** (`src/cli/`): Each file exports a function returning a `Commander` `Command` instance. All commands are registered in `src/index.ts`.

**Dashboard** (`src/dashboard/`): SSE-based web dashboard served via `Bun.serve` on port 7890. Endpoints: `/api/state`, `/api/events` (SSE), `/api/log/:name`.

**Node types:** `"code"` (default) runs the agent to write code; `"review"` gathers upstream diffs and injects them into the prompt. Review nodes must have `depends_on`.

**State directory:** `.workstreams/` (gitignored) contains `state.json`, `trees/` (git worktrees), and `logs/` (per-workstream log files).
