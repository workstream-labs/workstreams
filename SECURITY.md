# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability, please report it privately by emailing the maintainers or using [GitHub's private vulnerability reporting](https://github.com/workstream-labs/workstreams/security/advisories/new).

Do not open a public issue for security vulnerabilities.

## Scope

`ws` spawns AI coding agents with broad filesystem access in git worktrees. By design, agents can read and write files within their worktree. The `acceptAll` flag (enabled by default) grants agents permission to run without confirmation prompts.

Users should be aware that:

- Agents run with the same permissions as your user account
- The `--dangerously-skip-permissions` flag for Claude Code bypasses all permission checks
- Workstream prompts are passed directly to agents as command-line arguments
- The install script (`install.sh`) downloads and executes a binary

## Supported Versions

Only the latest release is supported with security updates.
