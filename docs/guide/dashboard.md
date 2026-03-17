# Dashboard

The interactive dashboard is the central hub for managing workstreams.

```bash
ws dashboard
```

![Dashboard](/dashboard.png)

## Layout

The dashboard displays workstreams as compact cards:

```
  ✓ add-tests
    Add unit tests for all API routes
    +142 −3  ·  3 files  ·  2 min ago: test: add route coverage

  ⠋ dark-mode
    Implement dark mode toggle
    running...

  ○ fix-types
    Fix all TypeScript type errors
    ready
```

Each card shows:
- **Line 1:** Status icon + workstream name
- **Line 2:** Prompt (dimmed)
- **Line 3:** Diff stats, commit info, comments count, resume status

## Status Icons

| Icon | Status | Meaning |
|---|---|---|
| `✓` | success | Agent completed |
| `✗` | failed | Agent errored |
| `⠋` | running | Agent working (animated) |
| `○` | queued | Scheduled to run |
| `○` | ready | Has prompt, not run yet |
| `⊙` | workspace | Manual workspace, no prompt |

## Navigation

| Key | Action |
|---|---|
| `j` / `↓` | Select next workstream |
| `k` / `↑` | Select previous workstream |
| `g` | Jump to first |
| `G` | Jump to last |
| `Enter` | Open action picker |
| `/` | Search workstreams |
| `?` | Toggle help overlay |
| `q` / `Esc` | Quit |

## Action Picker

Press `Enter` on a workstream to see context-sensitive actions:

**Before first run:**
- Open in editor
- Set/Edit prompt
- Run agent

**After successful run:**
- Open in editor
- Open session (interactive terminal)
- Set continuation prompt
- View diff & review
- View logs

**If changes exist:**
- View diff & review: opens the [diff viewer](/guide/reviewing)

## Search

Press `/` to enter search mode. Type to filter workstreams. Matching uses multi-term AND logic:

- `auth pass` finds workstreams matching both "auth" and "pass"
- Search checks names, prompts, and status

Press `Enter` to confirm the filter, `Esc` to clear.

## Opening in Your Editor

Use `ws view` to open a workstream directly in your editor:

```bash
ws view auth-feature              # Open in default editor
ws view auth -e cursor            # Open in Cursor
ws view auth --no-editor          # Just print the worktree path
```

Supported editors: VS Code (`code`), Cursor, Zed, Windsurf, WebStorm. Your choice is remembered for future sessions.
