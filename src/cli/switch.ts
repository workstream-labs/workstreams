import { Command } from "commander";
import { resolve } from "path";
import { loadState, saveState } from "../core/state";
import { loadConfig } from "../core/config";
import { WorktreeManager } from "../core/worktree";
import { AgentAdapter } from "../core/agent";
import { loadComments, clearComments, formatCommentsAsPrompt } from "../core/comments";
import { openDashboard, getBranchInfo, getDiffStats, type WorkstreamEntry, type DashboardAction } from "../ui/workstream-picker.js";
import { openChoicePicker, type ChoiceOption } from "../ui/choice-picker.js";
import { openDiffViewer } from "../ui/diff-viewer.js";
import type { AgentConfig, ProjectState, WorkstreamState } from "../core/types";
import {
  hasTmux,
  hasSession as hasTmuxSession,
  createSession,
  createWindow,
  attachSession,
  isPaneDead,
  selectWindow,
  killWindow,
  getPaneIds,
} from "../core/tmux";

const EDITORS: Record<string, { label: string; mac: string; linux: string }> = {
  code: { label: "VS Code", mac: "Visual Studio Code", linux: "code" },
  cursor: { label: "Cursor", mac: "Cursor", linux: "cursor" },
  zed: { label: "Zed", mac: "Zed", linux: "zed" },
  windsurf: { label: "Windsurf", mac: "Windsurf", linux: "windsurf" },
  webstorm: { label: "WebStorm", mac: "WebStorm", linux: "webstorm" },
};

async function detectInstalledEditors(): Promise<string[]> {
  const { execSync } = await import("child_process");
  const found: string[] = [];
  for (const cmd of Object.keys(EDITORS)) {
    try {
      execSync(`which ${cmd}`, { stdio: "ignore" });
      found.push(cmd);
    } catch {}
  }
  return found;
}

function openEditor(dir: string, editor: string): void {
  const isMac = process.platform === "darwin";
  const known = EDITORS[editor];

  try {
    if (isMac && known) {
      Bun.spawn(["open", "-a", known.mac, dir], { stdio: ["ignore", "ignore", "ignore"] });
    } else {
      Bun.spawn([editor, dir], { stdio: ["ignore", "ignore", "ignore"] });
    }
  } catch {
    console.error(`Could not open editor "${editor}". Is it installed and in your PATH?`);
  }
}

async function resolveEditor(explicit?: string, saved?: string): Promise<string | null> {
  if (explicit) return explicit;
  if (saved) return saved;

  const envEditor = process.env.VISUAL || process.env.EDITOR;
  if (envEditor) return envEditor.split("/").pop()!;

  const installed = await detectInstalledEditors();
  if (installed.length === 0) return null;
  if (installed.length === 1) return installed[0];

  const options: ChoiceOption[] = installed.map((cmd) => ({
    label: EDITORS[cmd]?.label ?? cmd,
    description: cmd,
  }));
  const choice = await openChoicePicker("Which editor?", options);
  if (choice === null) return null;
  return installed[choice];
}

async function buildEntries(config: any, state: any): Promise<WorkstreamEntry[]> {
  const { stat } = await import("fs/promises");
  const { $ } = await import("bun");
  const entries: WorkstreamEntry[] = [];

  // Build all entries in parallel
  const promises = config.workstreams.map(async (def: any) => {
    const branch = `ws/${def.name}`;
    const worktreePath = `.workstreams/trees/${def.name}`;
    const hasWorktree = await stat(worktreePath).then(() => true).catch(() => false);

    let status = "workspace";
    if (state?.currentRun?.workstreams?.[def.name]) {
      status = state.currentRun.workstreams[def.name].status;
    } else if (def.prompt) {
      status = "pending";
    }

    let branchInfo = { ahead: 0, behind: 0, lastCommitAge: "", lastCommitMsg: "" };
    let diffStats = { filesChanged: 0, additions: 0, deletions: 0 };
    let isDirty = false;

    if (hasWorktree) {
      const [bi, ds, dirtyResult] = await Promise.all([
        getBranchInfo(branch),
        getDiffStats(branch),
        $`git -C ${worktreePath} status --porcelain`.quiet().catch(() => null),
      ]);
      branchInfo = bi;
      diffStats = ds;
      isDirty = !!(dirtyResult?.stdout.toString().trim());
    }

    const wsState = state?.currentRun?.workstreams?.[def.name];
    const hasSession = !!wsState?.sessionId;

    // Validate tmux pane is actually alive and detect idle status
    let hasTmuxPane = !!wsState?.tmuxPaneId;
    if (hasTmuxPane && wsState?.tmuxPaneId) {
      const dead = await isPaneDead(wsState.tmuxPaneId);
      if (dead) hasTmuxPane = false;
    }

    // Detect idle: hooks (primary) + Claude session file mtime (fallback)
    if (hasTmuxPane && (status === "running" || status === "idle")) {
      const { readAgentState, isSessionFileStale } = await import("../core/agent");
      const agentState = await readAgentState(def.name);
      if (agentState === "idle") {
        status = "idle";
      } else if (await isSessionFileStale(`.workstreams/trees/${def.name}`)) {
        // Hook didn't fire but Claude's session file hasn't been written in 30s
        status = "idle";
      }
    }

    const commentsData = await loadComments(def.name);
    const commentCount = commentsData.comments.length;

    return {
      name: def.name,
      branch,
      status,
      prompt: def.prompt,
      hasWorktree,
      ...branchInfo,
      ...diffStats,
      hasSession,
      hasTmuxPane,
      commentCount,
      isDirty,
    } as WorkstreamEntry;
  });

  // Preserve order
  for (const def of config.workstreams) {
    entries.push(await promises[config.workstreams.indexOf(def)]);
  }

  return entries;
}

// ─── Ensure worktree exists ──────────────────────────────────────────────────

async function ensureWorktree(name: string, state: any, config: any): Promise<string> {
  const worktreePath = `.workstreams/trees/${name}`;
  const absPath = resolve(worktreePath);
  const { stat } = await import("fs/promises");
  const exists = await stat(worktreePath).then(() => true).catch(() => false);

  if (!exists) {
    const def = config.workstreams.find((w: any) => w.name === name);
    const wt = new WorktreeManager();
    console.log(`Creating worktree for "${name}" on branch ws/${name}...`);
    await wt.create(name, def?.baseBranch);

    if (!state.currentRun) {
      state.currentRun = {
        runId: `run-${Date.now()}`,
        startedAt: new Date().toISOString(),
        workstreams: {},
      };
    }
    if (!state.currentRun.workstreams[name]) {
      state.currentRun.workstreams[name] = {
        name,
        status: "pending",
        branch: `ws/${name}`,
        worktreePath,
        logFile: `.workstreams/logs/${name}.log`,
      };
    }
    await saveState(state);
  }

  return absPath;
}

// ─── Action: Open in editor ──────────────────────────────────────────────────

async function actionOpenEditor(name: string, state: any, config: any, editorOpt?: string) {
  const absPath = await ensureWorktree(name, state, config);
  console.log(`Switched to ws/${name} at ${absPath}`);

  const resolved = await resolveEditor(editorOpt, state.defaultEditor);
  if (resolved) {
    if (!editorOpt && !state.defaultEditor) {
      state.defaultEditor = resolved;
      await saveState(state);
    }
    const label = EDITORS[resolved]?.label ?? resolved;
    console.log(`Opening in ${label}...`);
    openEditor(absPath, resolved);
  }
}

// ─── Action: Open or attach to a Claude tmux session ─────────────────────────
// All session actions (attach, resume, open) go through this single function.
// Each workstream gets one window in the "ws-run" tmux session. Reuses it if alive.

const WS_TMUX_SESSION = "ws-run";

async function ensureTmuxSession(): Promise<void> {
  if (await hasTmuxSession(WS_TMUX_SESSION)) return;

  // Create session on dedicated ws socket with clean config
  const tmuxConf = "/tmp/ws-tmux.conf";
  const { stat } = await import("fs/promises");
  const confExists = await stat(tmuxConf).then(() => true).catch(() => false);

  if (!confExists) {
    await Bun.write(tmuxConf, [
      "set -g remain-on-exit on",
      "set -g mouse on",
      "set -g status on",
      "set -g status-position bottom",
      "set -g status-style 'bg=colour235'",
      "set -g status-justify centre",
      "set -g status-left '#[fg=brightwhite,bold] #{window_name}'",
      "set -g status-left-length 30",
      "set -g status-right ''",
      "set -g status-right-length 0",
      "set -g window-status-format ''",
      "set -g window-status-current-format '#[fg=brightwhite]ctrl+q #[fg=colour245]back'",
      "bind-key -T root C-q detach-client",
    ].join("\n"));
  }

  Bun.spawnSync(["tmux", "-L", "ws", "-f", tmuxConf, "new-session", "-d", "-s", WS_TMUX_SESSION]);
}

// Status-left uses #{window_name} — set at session level, resolves per window. No per-window call needed.

async function actionOpenClaudeSession(name: string, state: any): Promise<void> {
  if (!await hasTmux()) {
    console.error("tmux is required. Install with: brew install tmux");
    return;
  }

  const { $ } = await import("bun");
  await ensureTmuxSession();

  const ws = state?.currentRun?.workstreams?.[name];
  const worktreePath = resolve(ws?.worktreePath ?? `.workstreams/trees/${name}`);

  // Check if this workstream already has a live window in the ws-run session
  const paneIds = await getPaneIds(WS_TMUX_SESSION);
  const existingPane = paneIds.get(name);
  let needsNewWindow = true;

  if (existingPane && !await isPaneDead(existingPane)) {
    // Alive window exists — attach to it
    needsNewWindow = false;
  } else if (existingPane) {
    // Dead window — clean up
    await killWindow(`${WS_TMUX_SESSION}:${name}`);
  }

  let paneId: string | undefined;

  if (needsNewWindow) {
    // Build Claude command — unset Claude env vars to prevent nested-session detection
    const claudeCmd = ws?.sessionId
      ? `unset CLAUDECODE CLAUDE_CODE_ENTRYPOINT; claude --dangerously-skip-permissions --resume ${ws.sessionId}`
      : `unset CLAUDECODE CLAUDE_CODE_ENTRYPOINT; claude --dangerously-skip-permissions`;

    // Set up Claude hooks for state detection before launching
    const { setupClaudeHooks: setupHooks } = await import("../core/agent");
    await setupHooks(worktreePath, name);

    paneId = await createWindow(WS_TMUX_SESSION, name, worktreePath, claudeCmd);

    // Set status line for this window
    // Update state to track the pane
    if (ws) {
      ws.tmuxSession = WS_TMUX_SESSION;
      ws.tmuxPaneId = paneId;
      ws.status = "running";
      ws.startedAt = ws.startedAt ?? new Date().toISOString();
      ws.finishedAt = undefined;
      await saveState(state);
    }
  }

  // Select the window and attach
  await selectWindow(WS_TMUX_SESSION, name).catch(() => {});
  await attachSession(WS_TMUX_SESSION);

  // After detach — check if Claude exited while we were attached
  const checkPaneId = paneId ?? existingPane;
  if (ws && checkPaneId) {
    const dead = await isPaneDead(checkPaneId);
    if (dead) {
      ws.tmuxPaneId = undefined;
      ws.status = "success";
      ws.finishedAt = new Date().toISOString();
      await saveState(state);
    }
  }
}

// ─── Action: View diff ───────────────────────────────────────────────────────

async function actionDiffReview(name: string, state: any) {
  const wt = new WorktreeManager();
  const [branchDiff, uncommittedDiff] = await Promise.all([
    wt.diffBranch(`ws/${name}`),
    wt.diff(name),
  ]);
  const diff = branchDiff + uncommittedDiff;
  if (!diff.trim()) {
    console.log("  (no changes)");
    return;
  }

  await openDiffViewer(name, diff, {
    returnLabel: "back to dashboard",
    workstreams: Object.keys(state.currentRun?.workstreams ?? {}),
  });
}

// ─── Action: Resume with new prompt (hands-off) ─────────────────────────────

async function actionResumeWithPrompt(name: string, prompt: string, ws: WorkstreamState, config: any, state: any) {
  await runResume(name, ws, config.agent, prompt, state);
}

// ─── Action: Resume with review comments ─────────────────────────────────────

async function actionResumeWithComments(name: string, ws: WorkstreamState, config: any, state: any) {
  const data = await loadComments(name);
  if (data.comments.length === 0) {
    console.error(`No stored comments for "${name}".`);
    return;
  }
  const formatted = formatCommentsAsPrompt(data);
  console.log(`Loaded ${data.comments.length} comment(s) for "${name}".`);
  await runResume(name, ws, config.agent, formatted, state);
}

// ─── Shared resume runner ────────────────────────────────────────────────────

async function runResume(
  name: string,
  ws: WorkstreamState,
  agentConfig: AgentConfig,
  resumePrompt: string,
  state: any,
) {
  const { appendFile } = await import("fs/promises");
  const agent = new AgentAdapter();

  const logLine = async (msg: string) => {
    const ts = new Date().toISOString();
    await appendFile(ws.logFile, `[${ts}] ${msg}\n`);
  };

  const resumeAgentConfig: AgentConfig = {
    ...agentConfig,
    args: [...(agentConfig.args ?? []), "--resume", ws.sessionId!],
  };

  ws.status = "running";
  ws.startedAt = new Date().toISOString();
  ws.finishedAt = undefined;
  ws.exitCode = undefined;
  ws.error = undefined;
  await saveState(state);

  console.log(`Resuming "${name}" with agent...`);
  await logLine(`Resuming workstream "${name}"`);

  try {
    const result = await agent.run({
      workDir: ws.worktreePath,
      prompt: resumePrompt,
      logFile: ws.logFile,
      agentConfig: resumeAgentConfig,
    });

    ws.exitCode = result.exitCode;
    ws.status = result.exitCode === 0 ? "success" : "failed";
    if (result.sessionId) ws.sessionId = result.sessionId;
    if (result.exitCode !== 0) {
      ws.error = `Agent exited with code ${result.exitCode}`;
      await logLine(`FAILED: ${ws.error}`);
    }
  } catch (e: any) {
    ws.status = "failed";
    ws.error = e.message;
    await logLine(`ERROR: ${e.message}`);
  }

  ws.finishedAt = new Date().toISOString();
  await logLine(`Resume of "${name}" finished with status: ${ws.status}`);
  await saveState(state);

  if (ws.status === "success") {
    await clearComments(name);
  }

  const color = ws.status === "success" ? "\x1b[32m" : "\x1b[31m";
  console.log(`${color}${name}: ${ws.status}\x1b[0m`);
}

// ─── Dispatch dashboard action ───────────────────────────────────────────────

async function dispatchAction(action: DashboardAction, state: any, config: any): Promise<boolean> {
  switch (action.type) {
    case "quit":
      return false;

    case "editor":
      await actionOpenEditor(action.name, state, config);
      return false;

    case "diff":
      await actionDiffReview(action.name, state);
      return true; // loop back to dashboard

    case "attach-session": {
      // Attach directly to the known-alive tmux window — don't re-validate
      const ws = state.currentRun?.workstreams?.[action.name];
      if (ws?.tmuxSession) {
        await ensureTmuxSession();
        await selectWindow(ws.tmuxSession, action.name).catch(() => {});
        await attachSession(ws.tmuxSession);
      } else {
        await actionOpenClaudeSession(action.name, state);
      }
      return true;
    }

    case "open-session":
    case "resume-session":
      await actionOpenClaudeSession(action.name, state);
      return true;

    case "resume-prompt": {
      const ws = state.currentRun?.workstreams?.[action.name];
      if (ws) await actionResumeWithPrompt(action.name, action.prompt, ws, config, state);
      return false;
    }

    case "resume-comments": {
      const ws = state.currentRun?.workstreams?.[action.name];
      if (ws) await actionResumeWithComments(action.name, ws, config, state);
      return false;
    }
  }
}

// ─── Command ─────────────────────────────────────────────────────────────────

export function switchCommand() {
  return new Command("switch")
    .description("Switch to a workstream — pick an action (editor, resume, diff, etc.)")
    .argument("[name]", "workstream name (interactive dashboard if omitted)")
    .option("-e, --editor <editor>", "open directly in editor (skip dashboard)")
    .option("--no-editor", "don't open an editor, just print the path")
    .action(async (name: string | undefined, opts: { editor?: string; editor_?: boolean }) => {
      const noEditor = opts.editor_ === false;
      const directEditor = !!opts.editor;

      const state = await loadState();
      if (!state) {
        console.error("Error: workstreams not initialized. Run `ws init` first.");
        process.exit(1);
      }

      const config = await loadConfig("workstream.yaml");

      // If -e flag or --no-editor, go directly to editor flow
      if (name && (directEditor || noEditor)) {
        const absPath = await ensureWorktree(name, state, config);
        console.log(`Switched to ws/${name} at ${absPath}`);
        if (!noEditor) {
          const resolved = await resolveEditor(opts.editor, state.defaultEditor);
          if (resolved) {
            if (!state.defaultEditor) {
              state.defaultEditor = resolved;
              await saveState(state);
            }
            const label = EDITORS[resolved]?.label ?? resolved;
            console.log(`Opening in ${label}...`);
            openEditor(absPath, resolved);
          }
        }
        return;
      }

      // If name provided, open editor directly (shortcut)
      if (name) {
        const def = config.workstreams.find((w: any) => w.name === name);
        if (!def) {
          console.error(`Error: workstream "${name}" not found in workstream.yaml`);
          process.exit(1);
        }
        await actionOpenEditor(name, state, config);
        return;
      }

      // No name — open interactive dashboard
      if (config.workstreams.length === 0) {
        console.log("No workstreams defined. Add one with: ws create <name>");
        return;
      }

      // Dashboard loop: after diff/tmux, return to dashboard
      let loop = true;
      while (loop) {
        // Reload state from disk each iteration — background executor may have updated it
        const freshState = await loadState() ?? state;
        Object.assign(state, freshState);
        const entries = await buildEntries(config, state);

        // Lightweight refresh: only update status fields (no git ops)
        const onRefresh = async () => {
          const s = await loadState() ?? state;
          Object.assign(state, s);
          const { readAgentState, isSessionFileStale } = await import("../core/agent");
          const updated = entries.map(e => ({ ...e }));
          for (const entry of updated) {
            const wsState = s.currentRun?.workstreams?.[entry.name];
            if (!wsState) continue;

            // Update base status from state
            let st = wsState.status as string;

            // Check pane liveness
            let paneAlive = !!wsState.tmuxPaneId;
            if (paneAlive && wsState.tmuxPaneId) {
              paneAlive = !await isPaneDead(wsState.tmuxPaneId);
            }
            entry.hasTmuxPane = paneAlive;

            // Detect idle
            if (paneAlive && (st === "running" || st === "idle")) {
              const agentState = await readAgentState(entry.name);
              if (agentState === "idle") {
                st = "idle";
              } else if (await isSessionFileStale(`.workstreams/trees/${entry.name}`)) {
                st = "idle";
              }
            }
            entry.status = st;
            entry.hasSession = !!wsState.sessionId;
          }
          return updated;
        };

        const action = await openDashboard(entries, onRefresh);
        loop = await dispatchAction(action, state, config);
      }
    });
}
