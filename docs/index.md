---
layout: home

hero:
  name: Workstreams
  text: Desktop IDE for Parallel AI Coding
  tagline: Run Claude, Codex, or a raw terminal in isolated git worktrees. Review changes inline, send feedback back to the agent, and keep every workspace stateful in one app.
  image:
    src: /session-view.png
    alt: Workstreams desktop IDE
  actions:
    - theme: brand
      text: Download for macOS
      link: https://github.com/workstream-labs/workstreams/releases/latest
    - theme: alt
      text: Quickstart
      link: /getting-started/quickstart

features:
  - icon: "\U0001F332"
    title: Stateful Worktrees
    details: Each task gets its own git worktree, branch, terminal, and editor state. Switching is instant because the app restores the workspace for that worktree.
  - icon: "\U0001F4CA"
    title: Live Sidebar
    details: The Projects sidebar shows every repository, active worktree, and live diff stats so you can see what changed without leaving the IDE.
  - icon: "\U0001F4AC"
    title: Inline Review Loop
    details: Comment directly on split diffs, then send those comments back to Claude as a structured fix-up prompt.
  - icon: "\U0001F517"
    title: GitHub Thread Import
    details: If your branch backs an open PR, Workstreams can pull GitHub review threads into the same send-to-Claude flow.
  - icon: "\U0001F916"
    title: Agent-Agnostic
    details: Launch Claude, Codex, or a plain terminal. The desktop app is the control plane; the agent command is configurable per tool.
  - icon: "\U0001F4E6"
    title: Desktop-First
    details: Workstreams ships as a macOS app with built-in updates. The docs now focus on that workflow instead of the legacy CLI surface.
---

> These docs focus on the desktop app. The CLI still lives in `apps/cli`, but it is not the primary workflow described here.
