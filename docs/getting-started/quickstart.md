# Quickstart

Get from zero to parallel AI agents in a few steps.

## 1. Initialize

Navigate to any git repository and run:

```bash
ws init
```

This creates a `.workstreams/` directory and a `workstream.yaml` config file.

## 2. Define Workstreams

Edit `workstream.yaml` to define your agent and workstreams:

```yaml
agent:
  command: claude

workstreams:
  add-tests:
    prompt: "Add unit tests for all API routes in src/api/"
  fix-types:
    prompt: "Fix all TypeScript type errors in the project"
  add-docs:
    prompt: "Add JSDoc comments to all exported functions"
```

## 3. Run

Launch all workstreams in parallel:

```bash
ws run
```

Each workstream gets its own git worktree and branch (`ws/add-tests`, `ws/fix-types`, `ws/add-docs`). The agents run simultaneously in the background.

## 4. Monitor

Check status with the list command or open the interactive dashboard:

```bash
ws list        # quick status overview
ws dashboard   # interactive dashboard
```

The dashboard lets you browse diffs, view logs, add review comments, and resume agents — all with keyboard shortcuts.

## 5. Navigate to a Workstream

Each workstream lives on a `ws/`-prefixed branch. Use `ws checkout` to jump into a worktree:

```bash
cd $(ws checkout add-tests)   # navigate to the ws/add-tests worktree
git log --oneline -5           # inspect the branch
```

Or open it directly in your editor:

```bash
ws view add-tests              # open in default editor
ws view add-tests -e cursor    # open in Cursor
```

You can also do this from the dashboard — select a workstream, press `Enter`, and choose "Open in editor".

## 6. Sync with Main and Resolve Conflicts

If `main` has moved ahead while your workstream was running, pull in the latest changes:

```bash
cd $(ws checkout add-tests)    # enter the worktree
git merge main                 # merge main into ws/add-tests
```

If there are conflicts, resolve them in your editor:

```bash
ws view add-tests              # opens the worktree in your editor — fix conflicts there
```

Then complete the merge:

```bash
cd $(ws checkout add-tests)
git add .
git commit -m "merge: resolve conflicts with main"
```

Alternatively, you can resume the agent to handle conflicts for you:

```bash
ws run add-tests -p "Resolve the merge conflicts with main"
```

## 7. Merge into Main

When a workstream looks good, switch back to `main` and merge:

```bash
cd /path/to/your-repo          # return to the main working directory
git checkout main
git merge ws/add-tests          # or: git merge --squash ws/add-tests
```

Or create a GitHub PR from the `ws/add-tests` branch for code review.

After merging, clean up the workstream:

```bash
ws destroy add-tests            # removes worktree and branch
```

## What Just Happened?

In a few minutes, three AI agents worked on your codebase simultaneously:

- Each ran in an **isolated git worktree** — no conflicts between agents
- Each created its own **branch** (`ws/<name>`) — clean git history
- Results live on **branches** (`ws/<name>`) — merge via GitHub PR or git

## Next Steps

- [Configuration](/getting-started/configuration) — full `workstream.yaml` reference
- [Concepts](/guide/concepts) — understand the architecture
- [Dashboard](/guide/dashboard) — master the interactive TUI
