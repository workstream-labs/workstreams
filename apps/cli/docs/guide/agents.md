# Agents

`ws` currently supports **Claude Code** as the AI coding agent. Additional agent support is coming soon.

## Claude Code

```yaml
agent:
  command: claude
```

**Auto-injected flags** (when `acceptAll: true`):
- `--dangerously-skip-permissions` — skip permission prompts
- `--output-format stream-json` — structured output for session capture
- `--verbose` — detailed logging
- `--include-partial-messages` — stream partial messages

**Features:**
- Session capture: `ws` extracts the session ID from Claude's stream-json output
- Resume: `ws run <name> -p "..."` continues the exact same conversation with full context
- Auto-commit: successful changes are committed automatically

### Custom Model

Pass environment variables to use a specific model:

```yaml
agent:
  command: claude
  env:
    ANTHROPIC_MODEL: claude-sonnet-4-20250514
```

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
