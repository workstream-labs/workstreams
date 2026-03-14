# Reviewing Changes

## View Diffs

View changes from a specific workstream:

```bash
ws diff auth-feature
```

This opens an interactive diff viewer. For raw output (useful for piping):

```bash
ws diff auth --raw
ws diff                  # raw diffs for all workstreams
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

The typical review loop:

1. Run `ws diff auth` to browse changes
2. Press `c` to comment on lines that need work
3. Press `q` to exit the diff viewer
4. Run `ws run auth -p "Address review comments"` to resume — pending comments are automatically included
5. The agent addresses your feedback
6. Repeat until satisfied
7. Merge via GitHub PR or `git merge`

You can also start the review from the dashboard — select a workstream, press `Enter`, and choose "View diff & review".
