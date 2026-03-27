# Config Schema

Complete reference for `workstream.yaml`.

## Top-Level Structure

```yaml
agent:       # Required
workstreams: # Optional
```

## `agent`

| Field | Type | Required | Default | Description |
|---|---|---|---|---|
| `command` | `string` | Yes | — | Agent binary name or absolute path |
| `args` | `string[]` | No | `[]` | Arguments passed before the prompt |
| `env` | `Record<string, string>` | No | `{}` | Environment variables for the agent process |
| `timeout` | `number` | No | — | Kill agent after this many seconds |
| `acceptAll` | `boolean` | No | `true` | Auto-inject accept flags for known agents |

### Auto-Injected Flags

| Command | Flags |
|---|---|
| `claude` | `--dangerously-skip-permissions --output-format stream-json --verbose --include-partial-messages` |

## `workstreams`

Accepts either **map** or **array** format.

### Map Format

```yaml
workstreams:
  my-workstream:
    prompt: "Do something"
    base_branch: main
```

The map key becomes the workstream name.

### Array Format

```yaml
workstreams:
  - name: my-workstream
    prompt: "Do something"
    base_branch: main
```

### Workstream Fields

| Field | Type | Required | Default | Description |
|---|---|---|---|---|
| `name` | `string` | Yes (array) / No (map) | Map key | Unique identifier. Branch: `ws/<name>` |
| `prompt` | `string` | No | — | Instructions for the agent. Omit for manual workspace |
| `base_branch` | `string` | No | `HEAD` | Git ref to base the worktree on |
| `baseBranch` | `string` | No | `HEAD` | Alias for `base_branch` |

## Minimal Config

```yaml
agent:
  command: claude

workstreams:
  my-task:
    prompt: "Implement the feature"
```

## Full Config

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
    prompt: "Add unit tests for src/api/"
    base_branch: main
  dark-mode:
    prompt: "Implement dark mode toggle"
    base_branch: develop
  sandbox:
    # No prompt — workspace only
```

## Validation Rules

- `agent.command` must be present and non-empty
- Workstream names must be non-empty strings
- No duplicate workstream names allowed
- Empty workstream entries (e.g., `sandbox:` with no fields) create prompt-less workspaces
