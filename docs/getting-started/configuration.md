# Configuration

All configuration lives in `workstream.yaml` at the root of your repository.

## Full Example

```yaml
agent:
  command: claude
  args: [-p]
  env:
    ANTHROPIC_MODEL: claude-sonnet-4-20250514
  timeout: 600
  acceptAll: true

workstreams:
  add-tests:
    prompt: "Add unit tests for the API routes"
    base_branch: main
  dark-mode:
    prompt: "Implement dark mode toggle in the settings page"
  sandbox:
    # No prompt — creates a workspace for manual work
```

## Agent Section

The `agent` block configures which AI coding agent to use.

| Field | Type | Default | Description |
|---|---|---|---|
| `command` | `string` | — | **Required.** Binary name or full path (`claude`, `codex`, `aider`, or a custom command). |
| `args` | `string[]` | `[]` | Extra arguments passed before the prompt. |
| `env` | `object` | `{}` | Extra environment variables for the agent process. |
| `timeout` | `number` | — | Timeout in seconds. Agent is killed if it exceeds this. |
| `acceptAll` | `boolean` | `true` | Auto-inject accept/auto-approve flags for known agents. |

### Auto-Injected Flags

When `acceptAll` is `true` (the default), `ws` automatically adds flags based on the agent:

| Agent | Flags |
|---|---|
| `claude` | `--dangerously-skip-permissions --output-format stream-json --verbose --include-partial-messages` |
| `codex` | `--full-auto` |
| `aider` | `--yes` |
| Other | No flags injected |

Set `acceptAll: false` to disable this behavior and control flags manually via `args`.

## Workstreams Section

Workstreams can be defined in **map** or **array** format.

### Map Format (recommended)

```yaml
workstreams:
  add-tests:
    prompt: "Add unit tests"
    base_branch: main
  dark-mode:
    prompt: "Implement dark mode"
```

### Array Format

```yaml
workstreams:
  - name: add-tests
    prompt: "Add unit tests"
    base_branch: main
  - name: dark-mode
    prompt: "Implement dark mode"
```

### Workstream Fields

| Field | Type | Default | Description |
|---|---|---|---|
| `name` | `string` | map key | Workstream identifier. Used as branch suffix: `ws/<name>`. |
| `prompt` | `string` | — | Instructions for the agent. Omit to create a prompt-less workspace. |
| `base_branch` | `string` | `HEAD` | Git ref to base the worktree on. Also accepted as `baseBranch`. |

### Prompt-less Workspaces

Omit the `prompt` field to create a workspace without running an agent:

```yaml
workstreams:
  sandbox:
    # No prompt — just creates a worktree for manual work
```

These workspaces show as status `workspace` and are skipped by `ws run`. Use them to open an editor via `ws view sandbox -e cursor` for manual work.

## Directory Structure

After running `ws init`, your project will have:

```
your-repo/
  workstream.yaml          # Your config
  .workstreams/            # Managed by ws (gitignored)
    state.json             # Run state
    trees/                 # Git worktrees
      add-tests/
      dark-mode/
    logs/                  # Agent output logs
      add-tests.log
      dark-mode.log
    comments/              # Review comments
      add-tests.json
    pending-prompts/       # Continuation prompts
      add-tests.txt
```

The `.workstreams/` directory is automatically added to `.gitignore`.

## Validation

`ws` validates your config on every command. Common errors:

- Missing `agent.command`: the agent binary is required
- Duplicate workstream names: each name must be unique
- Invalid YAML: check syntax with a YAML linter

## Next Steps

- [Concepts](/guide/concepts): how worktrees, agents, and parallel execution work
- [Agents](/guide/agents): agent configuration for Claude, Codex, and Aider
