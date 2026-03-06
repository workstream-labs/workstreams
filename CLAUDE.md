# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

`workstream` (CLI: `ws`) is a tool that orchestrates parallel AI coding agents. It spawns multiple AI agents (claude, codex, aider) in isolated git worktrees, running them all in parallel. Each workstream is defined in `workstream.yaml`.

## Commands

```bash
bun install              # install dependencies
bun test                 # run all tests
bun test tests/dag.test.ts  # run a single test file
bun run src/index.ts     # run the CLI directly
```

The CLI is invoked as `ws` (see `bin` in package.json). Key subcommands: `init`, `create`, `run`, `status`, `list`, `diff`, `destroy`, `merge`, `checkout`, `resume`.

## Architecture

**Runtime:** Bun (TypeScript, ESNext modules). Uses `bun:test` for testing, `Bun.spawn` for process management.

**Core engine** (`src/core/`):
- `config.ts` — Loads and validates `workstream.yaml` (YAML config). Supports both map and array formats for workstream definitions.
- `dag.ts` — Builds a simple graph of workstream nodes from definitions.
- `executor.ts` — `Executor` runs all workstreams in parallel, handles SIGINT/SIGTERM cleanup.
- `agent.ts` — `AgentAdapter` spawns the configured agent command in each worktree. Auto-injects accept flags per agent (`--dangerously-skip-permissions` for claude, `--full-auto` for codex, `--yes` for aider). Streams stdout/stderr to log files. Extracts `session_id` from Claude's stream-json output for later resume.
- `worktree.ts` — `WorktreeManager` wraps git worktree commands. Creates branches prefixed `ws/` in `.workstreams/trees/`.
- `state.ts` — Persists run state to `.workstreams/state.json`.
- `events.ts` — `EventBus` with typed events, wildcard listeners, and a ring buffer for replay.
- `types.ts` — All shared TypeScript interfaces and type definitions.
- `prompt.ts` — Interactive input helpers (`prompt`, `promptChoice`) using Node.js readline.
- `comments.ts` — Review comment storage in `.workstreams/comments/<name>.json`. Load, save, clear, and format comments as agent prompts.

**CLI commands** (`src/cli/`): Each file exports a function returning a `Commander` `Command` instance. All commands are registered in `src/index.ts`.
- `checkout.ts` — `ws checkout <name>`: interactively resume a Claude session or view diff and add review comments.
- `resume.ts` — `ws resume <name>`: re-run the agent hands-off with a new prompt (`-p`) or stored review comments (`--comments`).

**State directory:** `.workstreams/` (gitignored) contains `state.json`, `trees/` (git worktrees), `logs/` (per-workstream log files), and `comments/` (review comments per workstream).
