# Quickstart

Get from zero to parallel AI agents in 5 steps.

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

## 5. Merge

When a workstream looks good, merge it using standard git workflows — create a GitHub PR from the `ws/<name>` branch, or merge locally with `git merge`.

## What Just Happened?

In a few minutes, three AI agents worked on your codebase simultaneously:

- Each ran in an **isolated git worktree** — no conflicts between agents
- Each created its own **branch** (`ws/<name>`) — clean git history
- Results live on **branches** (`ws/<name>`) — merge via GitHub PR or git

## Next Steps

- [Configuration](/getting-started/configuration) — full `workstream.yaml` reference
- [Concepts](/guide/concepts) — understand the architecture
- [Dashboard](/guide/dashboard) — master the interactive TUI
