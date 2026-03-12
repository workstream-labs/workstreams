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
ws switch      # interactive dashboard
```

The dashboard lets you browse diffs, view logs, add review comments, and resume agents — all with keyboard shortcuts.

## 5. Merge

When a workstream looks good, merge it into your branch:

```bash
ws merge add-tests
```

This squash-merges the changes and stages them for your review. Run `git diff --cached` to inspect, then commit.

## What Just Happened?

In a few minutes, three AI agents worked on your codebase simultaneously:

- Each ran in an **isolated git worktree** — no conflicts between agents
- Each created its own **branch** (`ws/<name>`) — clean git history
- Results are **squash-merged** — one clean commit per workstream

## Next Steps

- [Configuration](/getting-started/configuration) — full `workstream.yaml` reference
- [Concepts](/guide/concepts) — understand the architecture
- [Dashboard](/guide/dashboard) — master the interactive TUI
