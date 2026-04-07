# Review Loop

The desktop review workflow is built around split diffs, inline comments, and sending those comments back to the agent without leaving the IDE.

## Add inline comments on split diffs

Open a diff editor for a changed file and use the gutter comment affordance on the changed line.

Comments are anchored to:

- file path
- line number
- diff side (`original` or `modified`)
- optional line context

They are stored per worktree in `.workstreams/comments/<worktree>.json`.

![Inline review comments](/commenting-view.png)

## Send comments back to Claude

Run this command from the Command Palette:

```text
Workstream: Send Review Comments to Claude
```

The picker shows every saved local comment for the active worktree. You can send only a subset or send everything.

When you confirm, Workstreams:

1. opens a terminal for the active worktree
2. starts the configured `claude` command
3. formats each comment into a structured prompt
4. asks Claude to fix the issues in the current working tree

Local comments that were sent are deleted afterward so the next review pass starts clean.

![Send comments to Claude](/sending-comments.png)

## Pull in GitHub PR review threads

If the active branch maps to an open GitHub pull request, Workstreams can fetch PR review threads and include them in the same picker.

To enable that flow:

1. run **Workstream: Sign in to GitHub**
2. open the worktree whose branch backs the PR
3. run **Workstream: Send Review Comments to Claude**

Unresolved GitHub threads are preselected. Resolved threads are shown but not selected by default. GitHub comments remain on GitHub after sending.

## Practical loop

The intended loop is:

1. let the agent make a pass
2. inspect the diff
3. leave precise inline comments
4. send those comments back to the agent
5. inspect the updated diff
6. open or update the PR when the branch is ready
