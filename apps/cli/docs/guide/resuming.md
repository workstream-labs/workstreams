# Resuming Work

Resume a workstream to send new instructions or review feedback to the agent. Use `ws run` with the `-p` flag.

## Resume with New Instructions

```bash
ws run auth -p "Also add refresh token support"
```

The agent continues from where it left off, with full context of its previous work.

## Resume with Review Comments

After adding inline comments in the [diff viewer](/guide/reviewing), resume the workstream. Comments are included automatically:

```bash
ws run auth -p "Address the review comments"
```

Comments are cleared after a successful resume.

## How Resume Works

1. The stored `session_id` is retrieved from state
2. `--resume <sessionId>` is passed to Claude
3. Any stored review comments are included in the prompt
4. Your `-p` text is appended
5. The agent picks up with full conversation context
6. New changes are auto-committed on success
