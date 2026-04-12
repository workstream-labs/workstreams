# Agent Options

The desktop app currently recognizes `Claude`, `Codex`, and `Terminal` in the workstream creation flow.

## Claude

Claude is the most integrated option today.

Use Claude when you want:

- lifecycle tracking in the sidebar
- permission notifications
- review comments sent back through **Workstream: Send Review Comments to Claude**
- Claude hooks auto-wired into the desktop experience

The default startup command is:

```text
claude
```

## Codex

Codex is available when the `codex` command is installed and discoverable on your machine.

The default startup command is:

```text
codex
```

Codex launches inside the new worktree terminal, but it does not currently have the same hook-based lifecycle integration as Claude.

## Terminal

Terminal is the fallback for manual workflows.

If you choose **Terminal**, Workstreams still creates the isolated git worktree and switches the IDE into it, but it does not auto-run any agent command. This is useful when you want to drive the branch yourself or launch a custom tool by hand.

## Custom startup commands

Each detected agent can have its startup command overridden from the creation modal.

Examples:

- `claude --model sonnet`
- `codex --profile work`

Workstreams stores the chosen command per agent and reuses it the next time you create a workstream.

## Image attachments

The creation modal accepts dropped images. Workstreams writes those files into the branch directory at `~/.workstreams/<repo>/<branch>/images/` and appends their file paths to the initial prompt.

That makes desktop workflows useful for screenshot-driven UI tasks, bug reports, and design polish where the agent should inspect a visual reference.
