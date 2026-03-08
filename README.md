# ws — Parallel AI Coding Agent Orchestrator

`ws` spawns multiple AI coding agents (Claude, Codex, Aider) in isolated git worktrees, running them all in parallel. Define your workstreams in a YAML file, run them, review the results, and iterate.

## Install

```bash
bun install
bun link        # makes `ws` available globally
```

Requires [Bun](https://bun.sh) and at least one AI coding agent (e.g. [Claude Code](https://claude.ai/code)) installed and available in your `$PATH`.

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

# 4. Check results
ws status
ws diff add-tests

# 5. Review and iterate
ws checkout add-tests    # view diff, add review comments, or resume Claude session
ws resume add-tests --comments   # send comments back to the agent

# 6. Merge when satisfied
ws merge add-tests
```

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
  dark-mode:
    prompt: "Implement dark mode toggle in the React frontend"
```

You can also use an array format:

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

## Commands

### `ws init`

Initialize workstreams in the current git repo. Creates `.workstreams/` directory and `workstream.yaml`.

### `ws create <name> -p <prompt> [--plan-first]`

Add a new workstream to `workstream.yaml`. Use `--plan-first` to have the agent write a plan for review before proceeding.

### `ws run [name]`

Run all workstreams in parallel (or a single one by name). Each workstream gets its own git worktree and branch (`ws/<name>`). The configured agent is spawned in each worktree with the workstream's prompt.

```bash
ws run              # run all
ws run add-tests    # run just one
ws run --dry-run    # show what would run
```

### `ws status`

Show the status of all workstreams in the current run.

### `ws list`

List workstreams defined in `workstream.yaml`.

### `ws diff [name]`

Show the git diff for a workstream's branch. Without a name, shows diffs for all workstreams.

### `ws checkout <name>`

Interactively inspect a workstream. Presents a menu:

1. **Resume Claude session** — drops you into the live Claude session (interactive, no auto-accept). Requires a captured session ID from a prior `ws run`.
2. **View diff and add comments** — shows the diff and lets you add file-level review comments (file path, optional line number, comment text). Comments are saved to `.workstreams/comments/<name>.json`.

### `ws resume <name>`

Re-run the agent hands-off with new instructions. The agent resumes from its prior session.

```bash
ws resume add-tests -p "Also add integration tests"    # with inline prompt
ws resume add-tests --comments                         # send stored review comments
ws resume add-tests                                    # interactive menu
```

Comments are cleared automatically after a successful resume.

### `ws merge [name]`

Merge a workstream's branch back into the main branch. Without a name, merges all successful workstreams.

### `ws destroy [name]`

Remove a workstream's worktree and branch.

```bash
ws destroy add-tests       # destroy one
ws destroy --all           # destroy all and reset config
ws destroy --all -y        # skip confirmation
```

## Workflow

```
ws init → ws create → ws run → ws status/diff → ws checkout → ws resume → ws merge
                                    ↑                              |
                                    └──────── iterate ─────────────┘
```

1. **Define** workstreams with prompts describing the work
2. **Run** them in parallel — each agent works in its own worktree
3. **Review** the results with `ws diff` and `ws checkout`
4. **Iterate** using `ws checkout` (interactive session) or `ws resume` (send comments/new prompt)
5. **Merge** when satisfied

## Project Structure

```
src/
  index.ts          # CLI entry point, registers all commands
  cli/              # Command implementations (one file per command)
  core/
    agent.ts        # AgentAdapter — spawns agents, streams logs, captures session IDs
    config.ts       # Loads workstream.yaml
    dag.ts          # Builds workstream graph
    executor.ts     # Parallel execution engine
    worktree.ts     # Git worktree management
    state.ts        # State persistence (.workstreams/state.json)
    events.ts       # Event bus
    types.ts        # TypeScript interfaces
    prompt.ts       # Interactive input helpers
    comments.ts     # Review comment storage
tests/              # bun:test test files
```

## State Directory

`.workstreams/` (gitignored) is created by `ws init`:

```
.workstreams/
  state.json        # Run state (status, session IDs, exit codes)
  trees/            # Git worktrees (one per workstream)
  logs/             # Agent log files (one per workstream)
  comments/         # Review comments (one JSON file per workstream)
```

## Development

```bash
bun test                        # run all tests
bun test tests/dag.test.ts      # run a single test file
bun run src/index.ts -- --help  # run CLI directly
```
