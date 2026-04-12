# Workstreams & Switching

The desktop app is built around one simple model: every task gets a real git worktree, and the IDE treats that worktree as its own persistent workspace.

## Repository model

When you add a repository, Workstreams shows two kinds of entries:

- `local`: the repository root you already had checked out
- additional workstreams: linked git worktrees created for focused tasks

Each additional workstream has its own branch, working tree, diff stats, terminal, and editor state.

## On-disk layout

Workstreams stores its data outside the repository under `~/.workstreams/`:

```text
~/.workstreams/
  your-repo/                       # one directory per repository
    refactor-auth/                 # one directory per branch
      your-repo/                   # the git worktree checkout
      metadata.json              # metadata
      comments.json                # inline review comments
      images/                      # attached screenshots/mockups
```

Important paths:

- `~/.workstreams/<repo>/<branch>/<repo>/`: the linked git worktree directory (named after the repo so VS Code shows the project name in the title bar)
- `~/.workstreams/<repo>/<branch>/metadata.json`: display name, branch, base branch, description, creation time
- `~/.workstreams/<repo>/<branch>/comments.json`: saved inline review comments
- `~/.workstreams/<repo>/<branch>/images/`: screenshots or mockups attached to the initial prompt

## Feature name vs branch name

The creation modal asks for both:

- **Feature name**: the label shown in the sidebar
- **Branch name**: the actual git branch created on disk

That split matters because the UI name can stay readable while the branch name stays precise.

## What switching does

Switching workstreams does more than update the file tree.

When you click a different workstream, Workstreams:

1. backgrounds the current worktree's terminals
2. saves that worktree's editor layout
3. swaps the workspace folder to the target worktree path
4. restores the target worktree's editors and terminals

That is why you can keep multiple agent branches open without losing context every time you switch.

## Diff stats

The sidebar counts additions and deletions per worktree against the repository's default branch. Those numbers update as files change on disk or terminal commands finish.

## Comment format compatibility

Inline review comments are intentionally stored in a JSON shape that remains compatible with the CLI implementation in `apps/cli`. The website no longer documents the CLI workflow, but the underlying repo format still lines up.
