# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

`workstream` (CLI: `ws`) is a tool that orchestrates parallel AI coding agents. It spawns multiple AI agents (claude, codex, aider) in isolated git worktrees, running them all in parallel. Each workstream is defined in `workstream.yaml`.

## Commands

```bash
cd apps/cli              # all commands run from apps/cli/
bun install              # install dependencies
bun link                 # make `ws` available globally
bun test                 # run all tests
bun test tests/dag.test.ts  # run a single test file
bun run src/index.ts -- --help  # run the CLI directly (note the -- separator)
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

**Project structure:**
```
apps/cli/            CLI app (the `ws` binary)
  src/core/          Core engine
  src/cli/           CLI commands
  src/ui/            TUI components
  tests/             bun:test
  docs/              VitePress documentation site
  install.sh         Install script
apps/desktop/        Desktop app (WIP)
```

**Core engine** (`apps/cli/src/core/`):
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

## Desktop App: Known Issues

**1. Editor tabs not restored after restart.** The orchestrator saves/restores open editor tabs per worktree during switches using VS Code's Editor Working Sets API (`editorParts.ts`). However, the mapping of worktree path to working set ID (`_workingSetMap` in `orchestratorService.ts`) is an in-memory `Map` that is never persisted to `StorageService`. On restart the map is empty, so `switchTo()` finds no saved set and skips editor restore. The worktree sidebar restores fine because its state is separately persisted under `orchestrator.repositoryState`. Note: the working set snapshots ARE persisted in SQLite (`StorageScope.WORKSPACE` under key `editor.workingSets`), and the `name` field is the worktree path — so the orchestrator could look them up via `getWorkingSets()` + path match instead of maintaining a separate map. Fix: persist `_workingSetMap` to `StorageService`, or look up by name on restore.

**2. Layout distortion on worktree switch (especially with terminals).** Switching worktrees corrupts the editor grid layout. Most visible with terminals; complex layouts without terminals restore correctly. Root causes in `orchestratorService.ts` `switchTo()` and `orchestratorTerminalContribution.ts`:

- **No cancellation of in-flight switches.** `switchTo` has a 1500ms `setTimeout` (line 361) inside `withProgress` that is not guarded by a cancellation token. If a second switch starts during that wait, two `withProgress` callbacks run concurrently — both calling `applyWorkingSet` on different working sets, stomping on each other's grid state.

- **`pendingTerminalRestore` guard is set too late.** It's assigned at step 6 (`onDidApplyWorktreeEditorState` listener, terminal contribution line 120), but step 0 of the next switch checks it *before* step 6 of the current switch fires. So rapid A→B→A switches bypass the guard entirely.

- **Phase 1 is sync but relies on async side effects.** `_onActiveWorktreeChanging` is not async, but `moveToBackground` (line 269) triggers async editor tab removal internally. `saveWorkingSet` at step 2 can capture a grid mid-mutation before tabs are fully removed.

- **Group index is positional, not identity-based.** Terminal restore uses array index into `getGroups(GRID_APPEARANCE)` (line 317, 343). Any group creation/removal between save and restore shifts all indices, causing `groups[groupIndex]` to overshoot and fall back to `groups[0]`. Should use group IDs instead.

- **`applyWorkingSet` return value is never checked.** `applyWorkingSet` returns `Promise<boolean>` — `false` when the working set ID isn't found or a dirty editor vetoes close (`editorParts.ts:565-567`). The orchestrator ignores this (`orchestratorService.ts:362`), so a failed restore is completely silent.

- **`showBackgroundTerminal` places terminal in ACTIVE_GROUP before correction.** Phase 2 calls `showBackgroundTerminal` (which puts the terminal in whatever group is active), then immediately moves it to the correct group via a second `openEditor` call. Between those two async calls, the terminal briefly exists in the wrong group, causing layout reflows.

- **Tab order within a group is not preserved.** Only the group index is tracked per terminal — not the tab position within that group. `openEditor` in Phase 2 is called with no index parameter, so terminals are always appended as the last tab rather than restored to their original position.

Fix approach: add a switch sequence number or `CancellationTokenSource` to `switchTo`. Cancel the previous switch's in-flight `setTimeout` + `applyWorkingSet` when a new switch starts. Make Phase 1 async and await `moveToBackground` completion before `saveWorkingSet`. Replace positional group index with group ID tracking.

**3. Worktree switch is slow.** Switching takes ~2–3 seconds minimum due to compounding delays in `orchestratorService.ts` `switchTo()`:

- **1500ms hardcoded timeout** (`orchestratorService.ts:361`). Waits blindly for the extension host to settle after `updateFolders()`. No event or observable signals readiness — the system always pays the full 1.5s even if the extension host settles in 200ms.

- **Extension host restart on every switch.** `updateFolders()` triggers a full teardown and reinitialization of all loaded extensions (git, language servers, file watchers). Typically 500ms–2s depending on extension count.

- **Sequential terminal restore.** Phase 2 restores terminals one at a time — each requires two awaited async calls (`showBackgroundTerminal` + `openEditor`). With N terminals this is O(N) serial round-trips.
