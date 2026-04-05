# Workstreams

A VS Code-based IDE for parallel AI coding agents in isolated git worktrees.

## Desktop App

The main application is a VS Code fork (`apps/desktop`) with built-in support for orchestrating multiple AI coding agents, each running in its own git worktree. It includes a worktree sidebar, inline review comments, and a sessions layer for agentic workflows.

### Setup

A single script handles everything — nvm, Node 22, npm install, Electron, and compilation:

```bash
cd apps/desktop
bash install.sh
./scripts/code.sh   # launch the app
```

## CLI (CLR)

The CLI (`apps/cli`) was the original interface for workstreams. It provides the `ws` command for creating and running workstreams from the terminal:

```bash
ws init                                        # set up in any git repo
ws create add-tests -p "Add unit tests"        # define tasks
ws create dark-mode -p "Implement dark mode"
ws run                                         # run all in parallel
ws dashboard                                   # review diffs, leave comments, resume
```

### Install

```bash
curl -fsSL https://raw.githubusercontent.com/workstream-labs/workstreams/main/install.sh | bash
```

Or from source (requires [Bun](https://bun.sh)):

```bash
git clone https://github.com/workstream-labs/workstreams.git
cd workstreams
bun install && bun link
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[Elastic License 2.0 (ELv2)](LICENSE)
