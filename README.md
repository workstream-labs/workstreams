# ws — Parallel AI Coding Agent Orchestrator

`ws` spawns multiple AI coding agents (Claude, Codex, Aider) in isolated git worktrees, running them all in parallel inside tmux. Define your workstreams in a YAML file, run them, review changes in a full-screen TUI, and iterate until you're satisfied.

## Install

```bash
bun install
bun link        # makes `ws` available globally
```

Requires:
- [Bun](https://bun.sh)
- [tmux](https://github.com/tmux/tmux) — `brew install tmux` (macOS) / `apt install tmux` (Linux)
- At least one AI coding agent (e.g. [Claude Code](https://claude.ai/code)) installed and available in your `$PATH`

## Quick Start

```bash
# 1. Initialize in any git repo
cd my-project
ws init

# 2. Add workstreams
ws create add-tests -p "Add unit tests for the API routes using pytest"
ws create dark-mode -p "Implement dark mode toggle in the React frontend"

# 3. Run all workstreams in parallel
ws run

# 4. Open the interactive dashboard
ws switch
```

After `ws run`, each agent works autonomously in its own git worktree and tmux window. Use `ws switch` to monitor progress, attach to live sessions, review diffs, and send feedback — all from one dashboard.

## How It Works

```
ws init → ws create → ws run → ws switch (dashboard) → ws merge
                                    │
                         ┌──────────┼──────────┐
                         │          │          │
                    attach to   view diff   resume with
                    session     & review    new prompt
                         │          │          │
                         └──────────┼──────────┘
                                    │
                              iterate until
                               satisfied
```

1. **Define** workstreams with natural language prompts
2. **Run** them in parallel — each agent gets its own worktree and tmux window
3. **Monitor** with the dashboard — see real-time status, attach to sessions, review diffs
4. **Iterate** — add review comments, send new prompts, or attach and work alongside the agent
5. **Merge** when satisfied — branch, worktree, and config are cleaned up automatically

## Configuration

Workstreams are defined in `workstream.yaml` at the project root:

```yaml
agent:
  command: claude
  args:
    - -p
  acceptAll: true     # auto-inject --dangerously-skip-permissions (claude), --full-auto (codex), --yes (aider)
  timeout: 600

workstreams:
  add-tests:
    prompt: "Add unit tests for the API routes using pytest"
    base_branch: main       # optional; defaults to HEAD
  dark-mode:
    prompt: "Implement dark mode toggle in the React frontend"
```

Array format is also supported:

```yaml
workstreams:
  - name: add-tests
    prompt: "Add unit tests for the API routes using pytest"
  - name: dark-mode
    prompt: "Implement dark mode toggle in the React frontend"
```

### Agent configuration

| Field | Description | Default |
|---|---|---|
| `command` | Agent binary name or path | — (required) |
| `args` | Extra args passed before the prompt | `[]` |
| `env` | Extra environment variables | `{}` |
| `timeout` | Timeout in seconds | none |
| `acceptAll` | Auto-inject accept/auto-approve flags | `true` |

If `claude` isn't in your `$PATH`, use the full path:

```yaml
agent:
  command: /Users/you/.npm/bin/claude
```

### Workspace-only workstreams

Omit the `prompt` field to create a workspace without running an agent. This sets up the worktree and branch so you can work in it manually via `ws switch`.

```yaml
workstreams:
  experiment:
    # no prompt — manual workspace only
```

## Commands

### `ws init`

Initialize workstreams in the current git repo. Creates `.workstreams/` directory and `workstream.yaml`.

### `ws create <name> -p <prompt> [--plan-first]`

Add a new workstream to `workstream.yaml`. Use `--plan-first` to have the agent write a plan before implementing.

### `ws run [name]`

Run all workstreams in parallel (or a single one by name). Each workstream gets its own git worktree (`ws/<name>` branch) and tmux window. The configured agent is spawned with the workstream's prompt.

```bash
ws run              # run all
ws run add-tests    # run just one
ws run --dry-run    # show what would run
```

Output:

```
  ✓ Started 2 workstreams in tmux
    › dark-mode
    › db-sql

  ws list      check progress
  ws switch    attach to sessions
```

Prompt-less workstreams (workspace-only) are skipped automatically.

### `ws list`

List all workstreams with status, sync info, diff stats, duration, and last commit.

### `ws switch [name]`

Open the interactive dashboard. This is the main interface for monitoring and interacting with workstreams.

```bash
ws switch              # open dashboard
ws switch add-tests    # open directly in editor
ws switch add-tests -e cursor   # open in a specific editor
```

See [Dashboard](#dashboard) below for details.

### `ws diff [name]`

Show the git diff for a workstream's branch. Without a name, shows diffs for all workstreams.

### `ws resume <name>`

Re-run the agent with new instructions. The agent resumes from its prior session.

```bash
ws resume add-tests -p "Also add integration tests"    # with inline prompt
ws resume add-tests --comments                         # send stored review comments
```

Comments are cleared automatically after a successful resume.

### `ws merge [name]`

Merge a workstream's branch into the current branch.

```bash
ws merge add-tests          # merge one
ws merge                    # merge all successful workstreams
ws merge add-tests --squash # squash commits into one
ws merge --no-cleanup       # keep worktree and branch after merge
```

By default, merge cleans up the worktree, branch, `workstream.yaml` entry, and state entry.

### `ws destroy [name]`

Remove a workstream's worktree, branch, comments, and log.

```bash
ws destroy add-tests       # destroy one
ws destroy --all           # destroy everything: kill tmux, remove all worktrees, reset config
ws destroy --all -y        # skip confirmation
```

## Dashboard

`ws switch` opens a full-screen TUI dashboard showing all workstreams with real-time status updates.

### Workstream statuses

| Icon | Status | Meaning |
|---|---|---|
| `○` | pending | Defined but not yet run |
| `◉` | queued | About to start |
| `●` | running | Agent actively working (animated spinner in dashboard) |
| `⏸` | idle | Agent finished, waiting at prompt |
| `✓` | success | Agent exited cleanly |
| `✗` | failed | Agent exited with error |
| `◇` | workspace | No prompt, manual workspace only |

### Dashboard keybindings

| Key | Action |
|---|---|
| `j` / `k` / arrows | Navigate workstreams |
| `Enter` | Open action menu for selected workstream |
| `d` | View diff & review |
| `r` | Resume session |
| `p` | Enter new prompt |
| `c` | Send stored review comments |
| `/` | Fuzzy search |
| `?` | Help overlay |
| `g` / `G` | Jump to top / bottom |
| `q` / `Esc` | Quit |

### Action menu

When you press `Enter` on a workstream, the available actions depend on its state:

| Action | Available when |
|---|---|
| **Open in editor** | Always |
| **Attach to session** | Running or idle, tmux pane alive |
| **Resume Claude session** | Not active, has prior session ID |
| **Open Claude session** | Not active, no prior session, has worktree |
| **View diff & review** | Has worktree with changes (committed or uncommitted) |
| **Resume with new prompt** | Not active, has prior session ID |
| **Resume with comments** | Not running (includes idle), has stored comments |

### Diff viewer

The diff viewer (`d` key or action menu) is a full-screen split-pane browser:

| Key | Action |
|---|---|
| `Tab` / `h` / `l` | Switch between file list and diff panel |
| `j` / `k` | Scroll |
| `n` / `p` | Next / previous file |
| `t` | Toggle unified / side-by-side view |
| `d` / `u` | Half-page down / up |
| `g` / `G` | Top / bottom |
| `q` | Back to dashboard |

Review comments added in the diff viewer are stored per-workstream and can be sent to the agent via `c` from the dashboard.

### Auto-refresh

The dashboard polls every 500ms for status changes. Running workstreams show an animated braille spinner. Status transitions (running → idle → success) are reflected in real time.

## tmux Integration

All agent sessions run inside tmux on a dedicated socket (`-L ws`), completely isolated from your personal tmux sessions.

- **Attach to a live session** from the dashboard to watch or interact with the agent
- **`ctrl+q`** detaches back to the dashboard
- Status bar shows the workstream name (left) and `ctrl+q back` hint (center)
- Custom config at `/tmp/ws-tmux.conf` — clean minimal status bar, mouse support

## Idle Detection

`ws` detects when Claude is idle (finished working, waiting for input) using two mechanisms:

1. **Claude Code hooks** (primary) — a `Notification` hook on `idle_prompt` writes state to `/tmp/ws-state/<name>`
2. **Session file staleness** (fallback) — if Claude's `.jsonl` session file hasn't been written in 30+ seconds, the workstream is marked idle

This allows the dashboard to show `⏸ idle` status so you know when to review and respond.

## State Directory

`.workstreams/` (gitignored) is created by `ws init`:

```
.workstreams/
  state.json        # Run state (status, session IDs, tmux pane IDs, exit codes)
  trees/            # Git worktrees (one per workstream)
  logs/             # Agent log files (one per workstream)
  comments/         # Review comments (one JSON file per workstream)
```

## Architecture

**Runtime:** Bun (TypeScript, ESNext modules). Uses `bun:test` for testing, `Bun.spawn` for process management.

**Core engine** (`src/core/`):
- `config.ts` — Loads and validates `workstream.yaml`
- `dag.ts` — Builds a dependency graph of workstream nodes
- `executor.ts` — Runs workstreams in parallel with a worktree creation mutex
- `agent.ts` — Spawns agents in tmux, parses stream-json for session IDs, manages Claude hooks for idle detection
- `worktree.ts` — Git worktree lifecycle (create, remove, diff)
- `tmux.ts` — tmux operations on dedicated `-L ws` socket (sessions, windows, panes, attach/detach)
- `state.ts` — Persists run state to `.workstreams/state.json`
- `events.ts` — Typed event bus with wildcard listeners and ring buffer replay
- `comments.ts` — Review comment storage per workstream

**TUI layer** (`src/ui/`): All components use raw ANSI escape sequences — no external TUI library.
- `workstream-picker.ts` — Interactive dashboard with card layout, action menu, fuzzy search, help overlay
- `diff-viewer.ts` — Full-screen diff browser with file list + diff panel, unified and side-by-side modes, word-level highlighting
- `diff-parser.ts` — Parses raw `git diff` output into structured data
- `choice-picker.ts` — Modal overlay picker
- `modal.ts` — Reusable modal renderer with Unicode box-drawing
- `ansi.ts` — Shared color constants, cursor/screen helpers, status styling
- `fuzzy.ts` — Multi-term AND fuzzy matching

**CLI commands** (`src/cli/`): Each file exports a Commander `Command` instance registered in `src/index.ts`.

## Development

```bash
bun test                        # run all tests
bun test tests/dag.test.ts      # run a single test file
bun run src/index.ts -- --help  # run CLI directly
```
