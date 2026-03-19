# Installation

## Prerequisites

- **[Bun](https://bun.sh)** v1.0 or later
- **Git** 2.20 or later (for worktree support)
- **[Claude Code](https://docs.anthropic.com/en/docs/claude-code)** installed

## Install

```bash
curl -fsSL https://raw.githubusercontent.com/workstream-labs/workstreams/main/install.sh | bash
```

This downloads a standalone binary to `/usr/local/bin/ws`. To install elsewhere:

```bash
WS_INSTALL_DIR=~/.local/bin curl -fsSL https://raw.githubusercontent.com/workstream-labs/workstreams/main/install.sh | bash
```

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
  checkout <name>   Print the worktree path for a workstream
```

## Uninstall

### Remove the binary

If you installed via the install script:

```bash
sudo rm /usr/local/bin/ws
```

Or if you used a custom install directory:

```bash
rm "$WS_INSTALL_DIR/ws"
```

### Remove from source

If you installed from source with `bun link`:

```bash
cd workstreams
bun unlink
```

Then optionally delete the cloned repo.

### Clean up a project

Remove all workstreams, worktrees, and state from a project:

```bash
ws destroy --all -y     # removes all worktrees and branches
rm -rf .workstreams     # removes state directory
rm workstream.yaml      # removes config
```

## Next Steps

- [Quickstart](/getting-started/quickstart): run your first parallel workstream
