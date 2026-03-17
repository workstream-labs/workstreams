# Concepts

How `ws` works.

## Git Worktrees

A [git worktree](https://git-scm.com/docs/git-worktree) is a linked copy of your repository that shares the same `.git` directory but has its own working tree and branch. Multiple worktrees can exist at the same time without interfering with each other.

`ws` uses worktrees to give each AI agent its own isolated workspace:

```
your-repo/              # Your main working directory
  .workstreams/trees/
    add-tests/          # Worktree on branch ws/add-tests
    dark-mode/          # Worktree on branch ws/dark-mode
    fix-types/          # Worktree on branch ws/fix-types
```

Each worktree:
- Has its own branch (`ws/<name>`)
- Can be based on any ref (`base_branch` in config)
- Is isolated from other worktrees
- Shares git history with the main repo

## Parallel Execution

When you run `ws run`, all workstreams execute simultaneously:

1. Worktree creation is serialized (one at a time) to avoid git lock races
2. Agent execution is parallel: all agents start as soon as their worktree is ready
3. Each agent runs in its own process with its worktree as the working directory
4. `ws` uses `Promise.allSettled()` so one failure doesn't stop others

```
ws run
  ├─ create worktree: add-tests     (serialized)
  ├─ create worktree: dark-mode     (serialized)
  ├─ create worktree: fix-types     (serialized)
  │
  ├─ run agent: add-tests ──────────────────────►  done ✓
  ├─ run agent: dark-mode ─────────────────►  done ✓
  └─ run agent: fix-types ────────────────────────────►  done ✓
```

## State Management

`ws` tracks the state of every workstream across runs:

- `.workstreams/state.json`: project state (run history, editor preference)
- `.workstreams/logs/<name>.log`: per-workstream state markers

Each workstream goes through a lifecycle:

```
ready → queued → running → success / failed
```

| Status | Meaning |
|---|---|
| `ready` | Has a prompt, hasn't been run yet |
| `queued` | Scheduled to run in the current batch |
| `running` | Agent is actively working |
| `success` | Agent completed without errors |
| `failed` | Agent exited with an error |
| `workspace` | No prompt, manual workspace only |

## Session Capture

When using Claude, `ws` captures the session ID from the stream-json output. This lets you resume the same Claude session later with `ws run <name> -p`, so the agent keeps its full conversation context.

## Review & Resume Loop

The core workflow is iterative:

1. Run agents
2. Browse diffs, add comments
3. Resume with your comments as instructions
4. Repeat until you're happy
5. Merge

Comments and pending prompts are stored in `.workstreams/comments/` and `.workstreams/pending-prompts/`. They're automatically included when resuming and cleared on success.

## Branches

All workstream branches follow the naming convention `ws/<name>`:

- `ws/add-tests`
- `ws/dark-mode`
- `ws/fix-types`

On merge, changes are squash-merged into your current branch. Clean up the worktree and branch with `ws destroy`.
