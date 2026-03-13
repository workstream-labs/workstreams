# CLI Commands

Complete reference for every `ws` command.

## `ws init`

Initialize workstreams in the current git repository.

```bash
ws init [options]
```

| Option | Description |
|---|---|
| `-f, --force` | Reinitialize even if already set up |

Creates `.workstreams/` directory structure, `workstream.yaml` template, and updates `.gitignore`.

---

## `ws create <name>`

Add a new workstream entry to `workstream.yaml`.

```bash
ws create <name> [options]
```

| Argument | Description |
|---|---|
| `name` | Workstream name (becomes branch `ws/<name>`) |

| Option | Description |
|---|---|
| `-p, --prompt <text>` | Prompt for the agent |

Creates the config entry only — does not run the agent or create a worktree. Omit `-p` to create a prompt-less workspace.

---

## `ws run [name]`

Run workstreams.

```bash
ws run [name] [options]
```

| Argument | Description |
|---|---|
| `name` | Run only this workstream (omit to run all) |

| Option | Description |
|---|---|
| `-c, --config <path>` | Config file path (default: `workstream.yaml`) |
| `-d, --dry-run` | Show what would run without executing |
| `-p, --prompt <text>` | New instructions (auto-resumes if session exists) |

Skips workstreams that have no prompt, are already running, or already have a session (unless `-p` is provided for resume).

---

## `ws list`

Show status of all workstreams.

```bash
ws list [options]
```

| Option | Description |
|---|---|
| `-c, --config <path>` | Config file path (default: `workstream.yaml`) |

Displays: status icon, name, sync status (ahead/behind), diff stats, duration, comment count, last commit, and prompt.

---

## `ws switch [name]`

Open interactive dashboard or jump to a workstream in your editor.

```bash
ws switch [name] [options]
```

| Argument | Description |
|---|---|
| `name` | Open this workstream directly (skip dashboard) |

| Option | Description |
|---|---|
| `-e, --editor <editor>` | Editor to use (`code`, `cursor`, `zed`, `windsurf`, `webstorm`) |
| `--no-editor` | Print worktree path instead of opening editor |

Without a name, opens the interactive dashboard. See [Dashboard](/guide/dashboard) for keyboard shortcuts.

---

## `ws diff [name]`

View changes made by a workstream.

```bash
ws diff [name] [options]
```

| Argument | Description |
|---|---|
| `name` | Show diff for this workstream (omit for all) |

| Option | Description |
|---|---|
| `--raw` | Print raw diff output instead of interactive viewer |

Opens the interactive diff viewer for a single workstream. Shows raw diffs for multiple workstreams or when piped. See [Reviewing Changes](/guide/reviewing) for viewer shortcuts.

---

## `ws resume <name>`

Resume a workstream with new instructions.

```bash
ws resume <name> [options]
```

| Argument | Description |
|---|---|
| `name` | Workstream to resume |

| Option | Description |
|---|---|
| `-p, --prompt <text>` | New instructions for the agent |
| `--comments` | Include stored review comments |

Combines comments + pending prompt + `-p` text. Clears comments and pending prompts on success.

---

## `ws destroy [name]`

Remove a workstream completely.

```bash
ws destroy [name] [options]
```

| Argument | Description |
|---|---|
| `name` | Workstream to destroy |

| Option | Description |
|---|---|
| `--all` | Destroy everything (all worktrees, config, state) |
| `-y, --yes` | Skip confirmation prompt |

Removes: worktree, branch, config entry, state, logs, and comments.

---

## `ws prompt <name>`

Set or update the prompt for a workstream.

```bash
ws prompt <name> [options]
```

| Argument | Description |
|---|---|
| `name` | Workstream to update |

| Option | Description |
|---|---|
| `-p, --prompt <text>` | Prompt text (omit for interactive input) |

Updates the prompt in `workstream.yaml`.
