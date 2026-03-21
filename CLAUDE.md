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
bun run apps/cli/src/index.ts -- --help  # run the CLI directly (note the -- separator)
```

The CLI is invoked as `ws`. Key subcommands: `init`, `create`, `run`, `list`, `dashboard`, `diff`, `view`, `checkout`, `destroy`.

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

**Monorepo structure:**
```
packages/core/       Shared engine (published as @workstreams/core)
apps/cli/            CLI app (the `ws` binary)
apps/desktop/        Desktop app (WIP)
tests/               bun:test
```

**Core engine** (`packages/core/src/`):
- `config.ts` — Loads and validates `workstream.yaml`. Accepts both map and array `workstreams` formats; `base_branch` and `baseBranch` are both valid keys.
- `dag.ts` — Builds a graph of workstream nodes from definitions.
- `executor.ts` — `Executor` runs all workstreams in parallel. Serializes worktree creation via a mutex (`worktreeLock`) to prevent git lock races. Handles SIGINT/SIGTERM cleanup.
- `agent.ts` — `AgentAdapter` spawns the configured agent in each worktree. Auto-injects accept flags per agent (`--dangerously-skip-permissions --output-format stream-json --verbose --include-partial-messages` for claude, `--full-auto` for codex, `--yes` for aider). Strips `CLAUDECODE` from the environment before spawning child agents. Parses Claude's stream-json stdout to extract `session_id` for later resume. Auto-commits any uncommitted changes after a successful agent run (`ws: apply agent changes`).
- `worktree.ts` — `WorktreeManager` wraps git worktree commands. Creates branches prefixed `ws/` in `.workstreams/trees/`. `diff(name)` diffs against HEAD within the worktree; `diffBranch(branch, base)` diffs the branch against a base ref from the main repo.
- `state.ts` — Persists run state to `.workstreams/state.json`.
- `events.ts` — `EventBus` with typed events, wildcard listeners, and a ring buffer for replay.
- `types.ts` — All shared TypeScript interfaces and type definitions.
- `errors.ts` — Error hierarchy: `WorkstreamError` → `ConfigError`, `AgentError`, `WorktreeError`.
- `prompt.ts` — Interactive input helpers (`prompt`, `promptChoice`) using Node.js readline.
- `comments.ts` — Review comment storage in `.workstreams/comments/<name>.json`. Load, save, clear, and format comments as agent prompts.
- `pending-prompt.ts` — Persistent pending prompts in `.workstreams/pending-prompts/`. Auto-loaded on resume.
- `notify.ts` — Desktop notifications for agent completion.
- `session-reader.ts` — Parses agent session logs to extract state markers.
- `diff-parser.ts` — Pure parser: `parseDiff(raw)` converts raw `git diff` output into `ParsedDiff` (files -> hunks -> lines with old/new line numbers and type).

**CLI commands** (`apps/cli/src/cli/`): Each file exports a function returning a `Commander` `Command` instance. All commands are registered in `apps/cli/src/index.ts`.
- `run.ts` — `ws run [name]`: run all (or one) workstream(s). Supports `--dry-run` and `-p <prompt>` for resuming with new instructions. Skips prompt-less workstreams. Auto-includes stored review comments and pending prompts when resuming.
- `dashboard.ts` — `ws dashboard`: IDE-style TUI dashboard with inline log viewer, diff viewer, review comments, pending prompts, create/destroy, and resume. Fuzzy search (`/`), help overlay (`?`), context-sensitive footer.
- `destroy.ts` — `ws destroy [name]`: remove worktree and branch. Supports `--all` and `-y`.
- `diff.ts` — `ws diff [name]`: show git diff for one or all workstream branches. Opens interactive viewer for single workstream, plain output with `--raw`.
- `view.ts` — `ws view <name>`: open worktree in editor (`-e <editor>`, `--no-editor` for path only).
- `checkout.ts` — `ws checkout <name>`: print worktree path for use with `cd $(ws checkout name)`. Auto-creates worktree if missing.
- `create.ts` — `ws create <name>`: add a new workstream. Supports `-p <prompt>` and `-b <branch>` for base branch.
- `list.ts` — `ws list`: status overview with diff stats, branch sync info, comment count, and duration.

**TUI layer** (`apps/cli/src/ui/`): All TUI components use raw ANSI escape sequences directly — no external TUI library. They enter the alternate screen, set raw mode, and handle terminal resize.
- `ansi.ts` — Shared ANSI utilities: color constants (`A`, `C`), `bg256`/`fg256`, cursor/screen helpers, `stripAnsi`, `truncate`, `pad`, `STATUS_STYLE`. Used by all UI files and `list.ts`.
- `fuzzy.ts` — Simple multi-term AND matching: `fuzzyFilter(items, query, getText)` returns matching indices.
- `modal.ts` — Reusable modal overlay renderer: `renderModal(opts)` and `renderInputModal(opts)` using Unicode box-drawing, centered on screen.
- `choice-picker.ts` — `openChoicePicker(title, options)`: modal overlay picker. Returns selected index or `null`. Keys: `j`/`k`/arrows navigate, `enter` confirm, `q`/`ESC` cancel.
- `workstream-picker.ts` — `openDashboard(entries)`: single-screen dashboard with 3-line card layout, search/prompt/help modals. Returns `DashboardAction`. Also exports `getBranchInfo`, `getDiffStats`, `getBranchDiff` git helpers. `WorkstreamEntry` includes `hasSession`, `commentCount`, `isDirty`.
- `diff-viewer.ts` — `openDiffViewer(name, rawDiff, options?)`: full-screen diff browser with file list panel + diff panel. Supports unified and side-by-side modes, word-level LCS diff highlighting. Optional `returnLabel` shown in footer. Keys: `Tab`/`h`/`l` switch focus, `t` toggle unified/side-by-side, `n`/`p` next/prev file, `j`/`k` scroll, `g`/`G` top/bottom, `d`/`u` half-page.

**State directory:** `.workstreams/` (gitignored) contains `state.json`, `trees/` (git worktrees), `logs/` (per-workstream log files), `comments/` (review comments per workstream), and `pending-prompts/` (continuation prompts).
