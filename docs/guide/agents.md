# Agents

`ws` supports multiple AI coding agents. Configure your preferred agent in the `agent` section of `workstream.yaml`.

## Claude (Default)

```yaml
agent:
  command: claude
```

**Auto-injected flags** (when `acceptAll: true`):
- `--dangerously-skip-permissions` — skip permission prompts
- `--output-format stream-json` — structured output for session capture
- `--verbose` — detailed logging

**Features with Claude:**
- **Session capture** — `ws` extracts the session ID from Claude's stream-json output
- **True resume** — `ws resume` continues the exact same conversation with full context
- **Auto-commit** — successful changes are committed automatically

### Custom Model

Pass environment variables to use a specific model:

```yaml
agent:
  command: claude
  env:
    ANTHROPIC_MODEL: claude-sonnet-4-20250514
```

## Codex

```yaml
agent:
  command: codex
```

**Auto-injected flags:** `--full-auto`

Codex does not support session resume. When resumed, a fresh session runs in the existing worktree with previous changes intact.

## Aider

```yaml
agent:
  command: aider
```

**Auto-injected flags:** `--yes`

Like Codex, Aider does not support session resume. Fresh sessions pick up where the previous one left off via the existing worktree state.

## Custom Agents

Use any command-line tool as an agent:

```yaml
agent:
  command: /path/to/my-agent
  args: ["--some-flag"]
  acceptAll: false    # No auto-injected flags for custom agents
```

The agent receives the prompt as the last argument. It runs with the worktree directory as the working directory.

## Disabling Auto-Accept Flags

Set `acceptAll: false` to prevent `ws` from injecting any flags:

```yaml
agent:
  command: claude
  acceptAll: false
  args: ["--output-format", "stream-json", "-p"]
```

This gives you full control over the agent's command line.

## Environment Variables

Extra environment variables for the agent process:

```yaml
agent:
  command: claude
  env:
    ANTHROPIC_API_KEY: sk-ant-...
    CUSTOM_VAR: value
```

::: warning
The `CLAUDECODE` environment variable is automatically stripped from child agent processes to prevent recursive spawning.
:::

## Timeout

Kill agents that run too long:

```yaml
agent:
  command: claude
  timeout: 300    # 5 minutes
```

The agent process is terminated after the timeout. The workstream is marked as `failed`.
