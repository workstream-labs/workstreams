# Installation

## Prerequisites

- **[Bun](https://bun.sh)** v1.0 or later
- **Git** 2.20 or later (for worktree support)
- At least one AI coding agent installed:
  - [Claude Code](https://docs.anthropic.com/en/docs/claude-code) (recommended)
  - [Codex](https://github.com/openai/codex)
  - [Aider](https://aider.chat)

## Install from Source

Clone the repository and install globally:

```bash
git clone https://github.com/workstream-labs/workstreams.git
cd workstreams
bun install
bun link
```

This makes the `ws` command available globally.

## Verify Installation

```bash
ws --help
```

You should see the list of available commands:

```
Usage: ws [options] [command]

Orchestrate parallel AI coding agents in isolated git worktrees

Commands:
  init              Initialize workstreams in this repo
  create <name>     Add a new workstream
  run [name]        Run workstreams
  list              Show workstream status
  dashboard         Open interactive dashboard
  view <name>       Open a workstream in your editor
  diff [name]       View workstream changes
  destroy [name]    Remove a workstream
  prompt <name>     Set or update a workstream prompt
  checkout <name>   Print the worktree path for a workstream
```

## Next Steps

Head to the [Quickstart](/getting-started/quickstart) to run your first parallel workstream.
