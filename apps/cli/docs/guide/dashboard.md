# Dashboard

The dashboard is the recommended way to interact with your workstreams. It shows all workstreams at a glance and lets you view diffs, review changes, resume agents, and open editors — all from a single screen.

```bash
ws dashboard
```

![Dashboard](/dashboard.png)

## Status Icons

| Icon | Status | Meaning |
|---|---|---|
| `✓` | success | Agent completed |
| `✗` | failed | Agent errored |
| `■` | interrupted | Agent was interrupted (e.g. Ctrl+C) |
| `●` | running | Agent working (animated) |
| `◉` | queued | Scheduled to run |
| `○` | ready | Has prompt, not run yet |
| `◇` | workspace | Manual workspace, no prompt |

## Navigation

| Key | Action |
|---|---|
| `j` / `↓` | Select next workstream |
| `k` / `↑` | Select previous workstream |
| `g` | Jump to first |
| `G` | Jump to last |
| `Enter` | Open action picker |
| `q` / `Esc` | Quit |

## Action Picker

Press `Enter` on a workstream to see context-sensitive actions:

**Before first run:**
- Open in editor
- Run agent

**After successful run:**
- Open in editor
- Open session (interactive terminal)
- View diff & review
- View logs

**If changes exist:**
- View diff & review — opens the [diff viewer](/guide/reviewing)

## Opening in Your Editor

Use `ws view` to open a workstream directly in your editor:

```bash
ws view auth-feature              # Open in default editor
ws view auth -e cursor            # Open in Cursor
ws view auth --no-editor          # Just print the worktree path
```

Supported editors: VS Code (`code`), Cursor, Zed, Windsurf, WebStorm. Your choice is remembered for future sessions.
