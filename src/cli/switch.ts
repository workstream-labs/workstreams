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
import { openSidebar } from "../ui/sidebar.js";
import type { AgentConfig, ProjectState, WorkstreamState } from "../core/types";
import {
  hasTmux,
  hasSession as hasTmuxSession,
  createSession,
  createWindow,
  respawnPane,
  selectPaneLeft,
  attachSession,
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
    const hasTmuxPane = !!wsState?.tmuxPaneId;
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

// ─── Action: Open Claude in tmux split ────────────────────────────────────────

async function actionOpenClaudeSplit(name: string, config: any, state: any): Promise<void> {
  if (!await hasTmux()) {
    console.error("tmux is required for Claude session view. Install with: brew install tmux");
    return;
  }

  const cwd = process.cwd();

  // Create tmux session
  if (!await hasTmuxSession("ws")) {
    await createSession("ws");
  }

  // Build Claude command for the selected workstream
  const ws = state?.currentRun?.workstreams?.[name];
  const worktreePath = resolve(ws?.worktreePath ?? `.workstreams/trees/${name}`);
  const claudeCmd = ws?.sessionId
    ? `claude --dangerously-skip-permissions --resume ${ws.sessionId}`
    : `claude --dangerously-skip-permissions`;

  // Create dashboard window with sidebar on the left
  const sidebarCmd = `bun run ${Bun.main} switch --tmux-sidebar --tmux-initial ${name}`;
  Bun.spawnSync(["tmux", "new-window", "-t", "ws", "-n", "dashboard", "-c", cwd, sidebarCmd]);

  // Split right pane (80%) with Claude
  Bun.spawnSync(["tmux", "split-window", "-h", "-p", "82", "-t", "ws:dashboard", "-c", worktreePath, claudeCmd]);

  // Focus sidebar (left pane)
  await selectPaneLeft();

  // Attach — blocks until user quits sidebar
  await attachSession("ws:dashboard");
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

    case "attach-session":
    case "open-session":
    case "resume-session":
      await actionOpenClaudeSplit(action.name, config, state);
      return true; // loop back to dashboard after tmux exits

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

// ─── Tmux sidebar mode ───────────────────────────────────────────────────────

async function runTmuxSidebar(config: any, state: any, initialName?: string): Promise<void> {
  const { $ } = await import("bun");
  // Hide status bar, enable mouse, bind Tab to toggle panes
  await $`tmux set -g status off`.quiet().catch(() => {});
  await $`tmux set -g mouse on`.quiet().catch(() => {});
  await $`tmux bind -n Tab select-pane -t ws:dashboard.+`.quiet().catch(() => {});

  const entries = await buildEntries(config, state);

  const buildClaudeCmd = (name: string): { cmd: string; cwd: string } => {
    const ws = state?.currentRun?.workstreams?.[name];
    const cwd = resolve(ws?.worktreePath ?? `.workstreams/trees/${name}`);
    const cmd = ws?.sessionId
      ? `claude --dangerously-skip-permissions --resume ${ws.sessionId}`
      : `claude --dangerously-skip-permissions`;
    return { cmd, cwd };
  };

  await openSidebar(entries, async (name) => {
    const { cmd, cwd } = buildClaudeCmd(name);
    await respawnPane("ws:dashboard.1", cwd, cmd);
    await selectPaneLeft();
  }, initialName);

  // Cleanup
  await $`tmux kill-session -t ws`.quiet().catch(() => {});
}

// ─── Command ─────────────────────────────────────────────────────────────────

export function switchCommand() {
  return new Command("switch")
    .description("Switch to a workstream — pick an action (editor, resume, diff, etc.)")
    .argument("[name]", "workstream name (interactive dashboard if omitted)")
    .option("-e, --editor <editor>", "open directly in editor (skip dashboard)")
    .option("--no-editor", "don't open an editor, just print the path")
    .option("--tmux-sidebar", "internal: run as tmux sidebar pane")
    .option("--tmux-initial <name>", "internal: initially selected workstream")
    .action(async (name: string | undefined, opts: { editor?: string; editor_?: boolean; tmuxSidebar?: boolean; tmuxInitial?: string }) => {
      const noEditor = opts.editor_ === false;
      const directEditor = !!opts.editor;

      const state = await loadState();
      if (!state) {
        console.error("Error: workstreams not initialized. Run `ws init` first.");
        process.exit(1);
      }

      const config = await loadConfig("workstream.yaml");

      // Internal: tmux sidebar mode (runs inside left pane)
      if (opts.tmuxSidebar) {
        await runTmuxSidebar(config, state, opts.tmuxInitial);
        return;
      }

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
        const entries = await buildEntries(config, state);
        const action = await openDashboard(entries);
        loop = await dispatchAction(action, state, config);
      }
    });
}
