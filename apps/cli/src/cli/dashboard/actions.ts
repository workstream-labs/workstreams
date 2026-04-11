import { resolve } from "path";
import { saveState, appendWorkstreamStatus, validateWorkstreamName, savePendingPrompt } from "../../core";
import { WorktreeManager } from "../../core";
import { buildBgArgs } from "../../core";
import { openDiffViewer } from "../../ui/diff-viewer.js";
import { openSessionViewer } from "../../ui/session-viewer.js";
import type { ProjectState, WorkstreamState } from "../../core";
import type { DashboardAction } from "../../ui/workstream-picker.js";
import { EDITORS, openEditor, resolveEditor } from "./editors";
import { ensureWorktree } from "./worktree";

// ─── Action: Open in editor ──────────────────────────────────────────────────

export async function actionOpenEditor(name: string, state: any, config: any, editorOpt?: string): Promise<boolean> {
  const absPath = await ensureWorktree(name, state, config);

  const resolved = await resolveEditor(editorOpt, state.defaultEditor);
  if (!resolved) {
    console.log(`No editor found. Set $EDITOR or install one of: ${Object.keys(EDITORS).join(", ")}`);
    console.log(`  Worktree path: ${absPath}`);
    return false;
  }

  if (!editorOpt && !state.defaultEditor) {
    state.defaultEditor = resolved;
    await saveState(state);
  }
  const label = EDITORS[resolved]?.label ?? resolved;
  console.log(`Opening ${name} in ${label}...`);
  await openEditor(absPath, resolved);
  return true;
}

// ─── Action: Open Claude session (interactive) ───────────────────────────────

export function shellEscape(s: string): string {
  return "'" + s.replace(/'/g, "'\\''") + "'";
}

export async function actionOpenSession(name: string, ws: WorkstreamState, _state: ProjectState): Promise<boolean> {
  if (!ws.sessionId) return false;

  // Open the Claude session in a new terminal window so it doesn't conflict
  // with the dashboard's TUI (alternate screen + raw mode). The session runs
  // independently, allowing the user to keep using the dashboard.
  const absWorktreePath = resolve(ws.worktreePath);
  const shellCmd = `cd ${shellEscape(absWorktreePath)} && claude --resume ${shellEscape(ws.sessionId)}`;

  if (process.platform === "darwin") {
    // Use AppleScript to open a new Terminal.app window with the resume command
    const script = `tell application "Terminal"
  activate
  do script "${shellCmd.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"
end tell`;
    const proc = Bun.spawn(["osascript", "-e", script], { stdio: ["ignore", "pipe", "ignore"] });
    await proc.exited;
    return proc.exitCode === 0;
  } else {
    // Try common Linux terminal emulators
    const terminals = [
      ["gnome-terminal", "--", "bash", "-c", shellCmd],
      ["xterm", "-e", shellCmd],
    ];
    for (const args of terminals) {
      try {
        Bun.spawn(args, { stdio: ["ignore", "ignore", "ignore"] });
        return true;
      } catch {}
    }
    return false;
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

// ─── Action: View logs ────────────────────────────────────────────────────────

async function actionViewLogs(name: string, state: any) {
  const ws = state.currentRun?.workstreams?.[name];
  if (!ws) return;

  await openSessionViewer({
    name,
    logFile: ws.logFile,
    status: ws.status,
    startedAt: ws.startedAt,
  });
}

// ─── Action: Run (gathers pending prompt + comments) ─────────────────────────

async function actionRun(name: string, ws: WorkstreamState, state: any) {
  // Don't set status here — ws run handles validation and status updates itself
  const bgArgs = buildBgArgs(["run", name]);
  const proc = Bun.spawn(bgArgs, {
    cwd: process.cwd(),
    stdin: "ignore",
    stdout: "ignore",
    stderr: "ignore",
  });
  proc.unref();
}

// ─── Action: Set/update prompt in workstream.yaml ─────────────────────────────

export async function actionSetPrompt(name: string, prompt: string) {
  const { parse, stringify } = await import("yaml");
  const configFile = Bun.file("workstream.yaml");
  const raw = parse(await configFile.text()) as any;

  if (Array.isArray(raw.workstreams)) {
    const entry = raw.workstreams.find((w: any) => w.name === name);
    if (entry) entry.prompt = prompt;
  } else if (raw.workstreams && name in raw.workstreams) {
    if (raw.workstreams[name] == null) raw.workstreams[name] = {};
    raw.workstreams[name].prompt = prompt;
  }

  await Bun.write("workstream.yaml", stringify(raw));
}

// ─── Action: Create a new workstream in workstream.yaml ───────────────────────

export async function actionCreateWorkstream(name: string, prompt?: string) {
  const nameError = validateWorkstreamName(name);
  if (nameError) throw new Error(nameError);

  const { parse, stringify } = await import("yaml");
  const configFile = Bun.file("workstream.yaml");
  const raw = parse(await configFile.text()) as any;

  if (!raw.workstreams) raw.workstreams = {};

  // Don't overwrite existing entries
  if (Array.isArray(raw.workstreams)) {
    if (raw.workstreams.some((w: any) => w.name === name)) return;
    raw.workstreams.push({ name, ...(prompt ? { prompt } : {}) });
  } else {
    if (name in raw.workstreams) return;
    raw.workstreams[name] = prompt ? { prompt } : {};
  }

  await Bun.write("workstream.yaml", stringify(raw));
}

// ─── Dispatch dashboard action ───────────────────────────────────────────────

export async function dispatchAction(action: DashboardAction, state: any, config: any): Promise<boolean> {
  switch (action.type) {
    case "quit":
      return false;

    case "editor": {
      const opened = await actionOpenEditor(action.name, state, config);
      return !opened; // stay in dashboard if editor failed to open
    }

    case "diff":
      // Diff is now handled inline in the IDE dashboard, but keep fallback
      await actionDiffReview(action.name, state);
      return true;

    case "log":
      // Logs are now handled inline in the IDE dashboard, but keep fallback
      await actionViewLogs(action.name, state);
      return true;

    case "open-session": {
      const ws = state.currentRun?.workstreams?.[action.name];
      if (ws) await actionOpenSession(action.name, ws, state);
      return true;
    }

    case "run": {
      let ws = state.currentRun?.workstreams?.[action.name];
      if (!ws) {
        // Fresh workstream — create run state
        if (!state.currentRun) {
          state.currentRun = {
            runId: `run-${Date.now()}`,
            startedAt: new Date().toISOString(),
            workstreams: {},
          };
        }
        ws = {
          name: action.name,
          status: "queued" as const,
          branch: `ws/${action.name}`,
          worktreePath: `.workstreams/trees/${action.name}`,
          logFile: `.workstreams/logs/${action.name}.log`,
        };
        state.currentRun.workstreams[action.name] = ws;
      }
      // Clear run-level finishedAt — the run is being continued
      if (state.currentRun) {
        state.currentRun.finishedAt = undefined;
      }
      // Save BEFORE spawning so dashboard reads correct state immediately
      await appendWorkstreamStatus(ws);
      await saveState(state);
      await actionRun(action.name, ws, state);
      return true;
    }

    case "set-prompt":
      await actionSetPrompt(action.name, action.prompt);
      return true; // loop back to dashboard so updated prompt is visible

    case "save-pending-prompt":
      await savePendingPrompt(action.name, action.prompt);
      return true; // loop back to dashboard

    case "create-workstream":
      try {
        await actionCreateWorkstream(action.name, action.prompt);
      } catch (e: any) {
        console.error(`Error: ${e.message}`);
      }
      return true; // loop back to dashboard

  }
}
