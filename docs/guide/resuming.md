# Resuming Work

Resume a workstream to send new instructions or review comments to the agent. Resuming is done via `ws run` with the `-p` flag.

## Resume with New Instructions

```bash
ws run auth -p "Also add refresh token support"
```

The agent continues from where it left off, with full context of its previous work.

## Resume with Review Comments

After adding inline comments in the [diff viewer](/guide/reviewing), resume the workstream. Pending comments are included automatically:

```bash
ws run auth -p "Address the review comments"
```

Comments are cleared after a successful resume.

## Combined Resume

When resuming, all pending context is combined in order:

1. Stored review comments (from diff viewer)
2. Pending prompt (set from dashboard)
3. `-p` flag text

```bash
ws run auth -p "And fix the edge case on line 42"
```

## Setting a Pending Prompt

From the dashboard (`ws dashboard`), select a workstream and choose "Set continuation prompt". This stores a prompt that will be included on the next resume.

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
