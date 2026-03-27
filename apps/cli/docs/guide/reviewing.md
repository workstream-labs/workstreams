# Reviewing Changes

## View Diffs

From the dashboard, select a workstream, press `Enter`, and choose "View diff & review". Or from the command line:

```bash
ws diff auth-feature             # interactive diff viewer
```

![Diff viewer](/diff-viewer.png)

```bash
ws diff auth --raw               # raw output (for piping)
ws diff                          # raw diffs for all workstreams
```

## Interactive Diff Viewer

The diff viewer has two panels: a **file list** on the left and the **diff content** on the right.

### Navigation

| Key | Action |
|---|---|
| `Tab` / `h` / `l` | Switch between file list and diff panels |
| `j` / `↓` | Scroll down |
| `k` / `↑` | Scroll up |
| `d` | Scroll down half-page |
| `u` | Scroll up half-page |
| `g` | Jump to top |
| `G` | Jump to bottom |
| `n` | Next file |
| `p` | Previous file |

### View Modes

| Key | Action |
|---|---|
| `t` | Toggle between unified and side-by-side view |

The viewer includes word-level diff highlighting to make changes easy to spot.

## Inline Comments

While browsing a diff, press `c` to add an inline comment on the current line. Comments are saved to `.workstreams/comments/<name>.json`.

Comments are shown as inline markers in the diff viewer and are automatically included when you [resume](/guide/resuming) the workstream.

## Review Workflow

1. Open the dashboard with `ws dashboard` (or run `ws diff auth` directly)
2. Select a workstream and choose "View diff & review"
3. Press `c` to comment on lines that need work
4. Press `q` to exit the diff viewer
5. Resume with `ws run auth -p "Address review comments"` — comments are included automatically
6. Repeat until satisfied
7. Merge via GitHub PR or `git merge`
