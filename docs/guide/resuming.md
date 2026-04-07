# Agent Lifecycle

The desktop app tracks agent state per worktree so the sidebar tells you whether a branch is actively running, blocked, or ready for inspection.

## Lifecycle states

### `working`

The worktree is actively executing a turn. In the sidebar this appears as an animated spinner.

For Claude, Workstreams enters this state when it receives lifecycle hook events such as `Start`, `UserPromptSubmit`, or `PostToolUse`.

### `permission`

Claude asked for permission and is waiting on you. Workstreams marks the worktree as blocked and raises a notification so the sidebar stops looking like a generic long-running task.

### `review`

The worktree finished a turn while it was not the active workspace. This is the "go inspect what happened" state.

### `idle`

The worktree is not currently running. This is the default resting state for the active workspace after a turn completes or after the last managed terminal disappears.

## How Workstreams knows this

For Claude, the desktop app installs a hook script under `~/.claude/hooks/` and registers it in `~/.claude/settings.json`. That hook sends lifecycle events back to the app over a local HTTP endpoint so the sidebar can react in real time.

This is why Claude has deeper status tracking than a generic terminal command.

## Notifications

Workstreams surfaces lifecycle changes with desktop notifications:

- completed turn
- permission requested
- ready to review

These notifications are worktree-aware, so the message tells you exactly which branch needs attention.

## Important limitation

Claude has the full lifecycle integration today. Codex and Terminal workstreams still run correctly, but they do not currently provide the same hook-driven `working` / `permission` / `review` state fidelity.
