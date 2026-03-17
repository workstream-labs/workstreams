# Contributing

## Setup

```bash
git clone https://github.com/workstream-labs/workstreams.git
cd workstreams
bun install
bun link
```

## Development

```bash
bun test                           # run all tests
bun test tests/dag.test.ts         # run one test
bun run src/index.ts -- --help     # run CLI without building
```

## Project layout

```
src/
  index.ts       CLI entry point
  cli/           One file per command (init, create, run, list, dashboard, etc.)
  core/          Engine — config loading, executor, agent spawning, worktree management, state
  ui/            TUI components — all raw ANSI, no external TUI library
tests/           bun:test
```

Runtime state goes in `.workstreams/` (gitignored): worktrees, logs, comments, state JSON.

## Submitting changes

1. Fork and branch from `main`.
2. Add tests if you're adding functionality.
3. `bun test` should pass.
4. Open a PR.

Keep PRs small. If the change is large, open an issue first.

## Bugs

File at [github.com/workstream-labs/workstreams/issues](https://github.com/workstream-labs/workstreams/issues). Include what you did, what happened, and your OS / Bun version.
