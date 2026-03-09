# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

`workstream` (CLI: `ws`) is a tool that orchestrates parallel AI coding agents. It spawns multiple AI agents (claude, codex, aider) in isolated git worktrees, running them all in parallel. Each workstream is defined in `workstream.yaml`.

## Commands

```bash
bun install              # install dependencies
bun link                 # make `ws` available globally
bun test                 # run all tests
bun test tests/dag.test.ts  # run a single test file
bun run src/index.ts -- --help  # run the CLI directly (note the -- separator)
```

The CLI is invoked as `ws`. Key subcommands: `init`, `create`, `run`, `status`, `list`, `diff`, `destroy`, `merge`, `checkout`, `resume`, `switch`.

## workstream.yaml Config Format

```yaml
agent:
  command: claude          # binary name or full path
  args: [-p]               # extra args passed before the prompt
  env: {}                  # extra environment variables
  timeout: 600             # timeout in seconds (optional)
  acceptAll: true          # auto-inject accept flags (default: true)

workstreams:               # map format
  add-tests:
    prompt: "Add unit tests for the API routes"
    base_branch: main      # optional; defaults to HEAD
  dark-mode:
    prompt: "Implement dark mode toggle"
```

Array format is also supported (`workstreams: [{name: ..., prompt: ...}]`).

## Architecture

**Runtime:** Bun (TypeScript, ESNext modules). Uses `bun:test` for testing, `Bun.spawn` for process management.

**Core engine** (`src/core/`):
- `config.ts` — Loads and validates `workstream.yaml`. Accepts both map and array `workstreams` formats; `base_branch` and `baseBranch` are both valid keys.
- `dag.ts` — Builds a graph of workstream nodes from definitions.
- `executor.ts` — `Executor` runs all workstreams in parallel. Serializes worktree creation via a mutex (`worktreeLock`) to prevent git lock races. Handles SIGINT/SIGTERM cleanup.
- `agent.ts` — `AgentAdapter` spawns the configured agent in each worktree. Auto-injects accept flags per agent (`--dangerously-skip-permissions --output-format stream-json --verbose` for claude, `--full-auto` for codex, `--yes` for aider). Strips `CLAUDECODE` from the environment before spawning child agents. Parses Claude's stream-json stdout to extract `session_id` for later resume. Auto-commits any uncommitted changes after a successful agent run (`ws: apply agent changes`).
- `worktree.ts` — `WorktreeManager` wraps git worktree commands. Creates branches prefixed `ws/` in `.workstreams/trees/`. `diff(name)` diffs against HEAD within the worktree; `diffBranch(branch, base)` diffs the branch against a base ref from the main repo.
- `state.ts` — Persists run state to `.workstreams/state.json`.
- `events.ts` — `EventBus` with typed events, wildcard listeners, and a ring buffer for replay.
- `types.ts` — All shared TypeScript interfaces and type definitions.
- `errors.ts` — Error hierarchy: `WorkstreamError` → `ConfigError`, `AgentError`, `WorktreeError`.
- `prompt.ts` — Interactive input helpers (`prompt`, `promptChoice`) using Node.js readline.
- `comments.ts` — Review comment storage in `.workstreams/comments/<name>.json`. Load, save, clear, and format comments as agent prompts.

**CLI commands** (`src/cli/`): Each file exports a function returning a `Commander` `Command` instance. All commands are registered in `src/index.ts`.
- `run.ts` — `ws run [name]`: run all (or one) workstream(s). Supports `--dry-run`. Skips prompt-less workstreams.
- `checkout.ts` — `ws checkout <name>`: interactively resume a Claude session or view diff and add review comments.
- `resume.ts` — `ws resume <name>`: re-run the agent hands-off with a new prompt (`-p`) or stored review comments (`--comments`). Clears stored comments on success.
- `switch.ts` — `ws switch <name>`: switch to a workstream's worktree. Creates the worktree if it doesn't exist. Prints the absolute path for shell `cd`.
- `merge.ts` — `ws merge [name]`: merge into the current branch. Supports `--squash` and `--no-cleanup`.
- `destroy.ts` — `ws destroy [name]`: remove worktree and branch. Supports `--all` and `-y`.
- `diff.ts` — `ws diff [name]`: show git diff for one or all workstream branches.

**State directory:** `.workstreams/` (gitignored) contains `state.json`, `trees/` (git worktrees), `logs/` (per-workstream log files), and `comments/` (review comments per workstream).
