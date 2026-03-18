# Running Workstreams

## Basic Run

Run all workstreams in parallel:

```bash
ws run
```

This creates worktrees and branches for each workstream, then spawns agents simultaneously. Agents run in the background.

## Run a Single Workstream

```bash
ws run auth-feature
```

Only the named workstream will execute.

## Dry Run

Preview what would happen without actually running anything:

```bash
ws run --dry-run
```

## What Gets Skipped

`ws run` skips workstreams that:

- Have no `prompt` defined (workspace-only entries)
- Are already running or queued
- Already have a completed session (use `ws run <name> -p "..."` to resume)

## Monitoring Progress

Open the [dashboard](/guide/dashboard) to monitor progress:

```bash
ws dashboard
```

The dashboard refreshes automatically and shows live status with spinner animations for running workstreams. You can also use `ws list` for a quick status overview.

## How It Works

1. Config is loaded and validated
2. Worktrees are created **one at a time** (to avoid git lock races)
3. Agents are spawned **in parallel** in their respective worktrees
4. Output is streamed to log files in `.workstreams/logs/`
5. On success, any uncommitted changes are auto-committed (`ws: apply agent changes`)
6. State is saved to `.workstreams/state.json`

## Signal Handling

Press `Ctrl+C` to abort. Running workstreams are marked as `interrupted`. State is saved before exit.

## Resuming with New Instructions

If a workstream already has a session, `ws run` with `-p` automatically resumes it. Stored review comments are included automatically.

```bash
ws run auth -p "Also add refresh token support"
```

See [Resuming Work](/guide/resuming) for details.
