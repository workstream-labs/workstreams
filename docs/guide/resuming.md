# Resuming Work

Resume a workstream to send new instructions or review comments to the agent.

## Resume with New Instructions

```bash
ws resume auth -p "Also add refresh token support"
```

The agent continues from where it left off, with full context of its previous work.

## Resume with Review Comments

After adding inline comments in the diff viewer:

```bash
ws resume auth --comments
```

This sends all pending comments as instructions. Comments are cleared after a successful resume.

## Combined Resume

Comments, pending prompts, and the `-p` flag are all combined in order:

1. Stored review comments (from diff viewer)
2. Pending prompt (set from dashboard)
3. `-p` flag text

```bash
ws resume auth -p "And fix the edge case on line 42"
```

## Setting a Pending Prompt

From the dashboard (`ws switch`), select a workstream and choose "Set continuation prompt". This stores a prompt that will be included on the next resume.

## How Resume Works

When resuming a Claude session:

1. The stored `sessionId` is retrieved from state
2. `--resume <sessionId>` is passed to Claude
3. Your new instructions are passed via `-p`
4. The agent picks up with full conversation context
5. Any new changes are auto-committed on success

::: info
Session resume is currently supported for **Claude** only. For Codex and Aider, resume starts a fresh session in the existing worktree (changes from the previous run are still present).
:::

## Via `ws run`

If a workstream already has a session, `ws run` with `-p` automatically switches to resume mode:

```bash
ws run auth -p "Fix the failing test"
```

This is equivalent to `ws resume auth -p "Fix the failing test"`.
