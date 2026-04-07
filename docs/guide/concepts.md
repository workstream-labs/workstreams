# Workstreams & Switching

The desktop app is built around one simple model: every task gets a real git worktree, and the IDE treats that worktree as its own persistent workspace.

## Repository model

When you add a repository, Workstreams shows two kinds of entries:

- `local`: the repository root you already had checked out
- additional workstreams: linked git worktrees created for focused tasks

Each additional workstream has its own branch, working tree, diff stats, terminal, and editor state.

## On-disk layout

Workstreams stores its metadata under `.workstreams/` inside the repository:

```text
your-repo/
  .workstreams/
    refactor-auth/
      tree/
      workstream.json
    comments/
      refactor-auth.json
  src/
  package.json
```

Important paths:

- `.workstreams/<branch>/tree`: the linked git worktree directory
- `.workstreams/<branch>/workstream.json`: display name, branch, base branch, description, creation time
- `.workstreams/comments/<worktree>.json`: saved inline review comments for that worktree
- `<worktree>/.workstreams/images/`: screenshots or mockups attached to the initial prompt

Workstreams also makes sure `.workstreams/` is ignored in `.gitignore`.

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
