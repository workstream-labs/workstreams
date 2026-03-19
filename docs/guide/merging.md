# Merging

Each workstream lives on a `ws/<name>` branch. When you're done iterating, merge it like any other branch.

## Commit changes on the workstream branch

Before merging, make sure all changes on the workstream branch are committed:

```bash
cd $(ws checkout add-tests)
git add .
git commit -m "finalize changes"
```

::: tip
If the agent completed successfully, changes are auto-committed. This step is only needed if you made manual edits in the worktree.
:::

## Merge into main

```bash
git checkout main
git merge ws/add-tests
```

Or squash if you want a single commit:

```bash
git checkout main
git merge --squash ws/add-tests
git commit -m "add unit tests for API routes"
```

## Open a PR instead

The `ws/` branches are regular git branches. Push and open a PR the usual way:

```bash
git push origin ws/add-tests
# then open a PR on GitHub targeting main
```

## Clean up

After merging, remove the worktree and branch:

```bash
ws destroy add-tests
```

Or clean up everything at once:

```bash
ws destroy --all -y
```
