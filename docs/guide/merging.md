# Merging

Merge workstream changes into your current branch.

## Merge a Single Workstream

```bash
ws merge auth-feature
```

This performs a **squash merge** — all changes from the workstream branch are staged but not committed. Review with:

```bash
git diff --cached
```

Then commit when ready:

```bash
git commit -m "feat: add JWT authentication"
```

## Merge into a Specific Branch

```bash
ws merge auth main
```

## Merge All

Merge all successful workstreams at once:

```bash
ws merge --all
```

When merging multiple workstreams, each is auto-committed with the message `ws: <name>` to avoid merge conflicts between them.

## Keep Worktree After Merge

By default, the worktree and branch are cleaned up after merge. To keep them:

```bash
ws merge auth --no-cleanup
```

## What Happens on Merge

1. Validates no unresolved merge conflicts
2. Squash-merges the workstream branch into the target
3. Stages all changes (single workstream) or auto-commits (batch)
4. Removes worktree and deletes branch (unless `--no-cleanup`)
5. Updates state
