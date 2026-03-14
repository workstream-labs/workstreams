import { Command } from "commander";
import { resolve } from "path";
import { loadState, saveState, appendWorkstreamStatus } from "../core/state";
import { loadConfig, validateWorkstreamName } from "../core/config";
import { WorktreeManager } from "../core/worktree";
import { loadComments, formatCommentsAsPrompt } from "../core/comments";
import { loadPendingPrompt, savePendingPrompt } from "../core/pending-prompt";
import { notifyStatus } from "../core/notify";
import { getBranchInfo, getDiffStats, type WorkstreamEntry, type DashboardAction } from "../ui/workstream-picker.js";
import { openChoicePicker, type ChoiceOption } from "../ui/choice-picker.js";
import { openDiffViewer } from "../ui/diff-viewer.js";
import { openSessionViewer } from "../ui/session-viewer.js";
import { openIdeDashboard, type IdeDashboardOptions } from "../ui/ide-dashboard.js";
import type { ProjectState, WorkstreamState } from "../core/types";

export const EDITORS: Record<string, { label: string; mac: string; linux: string }> = {
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

export async function openEditor(dir: string, editor: string): Promise<void> {
  // Use Node's child_process with a real system shell — Bun's built-in
  // shell doesn't work correctly with editor CLI wrapper scripts.
  const { execFileSync } = await import("child_process");
  try {
    execFileSync(editor, [dir], { stdio: "inherit" });
  } catch (e: any) {
    console.error(`Could not open editor "${editor}": ${e.message}`);
  }
}

export async function resolveEditor(explicit?: string, saved?: string): Promise<string | null> {
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
      status = "ready";
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

    const hasSession = !!state?.currentRun?.workstreams?.[def.name]?.sessionId;
    const commentsData = await loadComments(def.name);
    const commentCount = commentsData.comments.length;
    const pendingPromptText = await loadPendingPrompt(def.name);

    return {
      name: def.name,
      branch,
      status,
      prompt: def.prompt,
      hasWorktree,
      ...branchInfo,
      ...diffStats,
      hasSession,
      commentCount,
      hasPendingPrompt: !!pendingPromptText,
      pendingPromptText: pendingPromptText ?? undefined,
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

export async function ensureWorktree(name: string, state: any, config: any): Promise<string> {
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
        status: "ready",
        branch: `ws/${name}`,
        worktreePath,
        logFile: `.workstreams/logs/${name}.log`,
      };
    }
    await appendWorkstreamStatus(state.currentRun.workstreams[name]);
    await saveState(state);
  }

  return absPath;
}

// ─── Action: Open in editor ──────────────────────────────────────────────────

async function actionOpenEditor(name: string, state: any, config: any, editorOpt?: string): Promise<boolean> {
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

async function actionOpenSession(name: string, ws: WorkstreamState, state: ProjectState) {
  if (!ws.sessionId) {
    console.error("Error: no session ID captured for this workstream.");
    return;
  }

  const proc = Bun.spawn(["claude", "--dangerously-skip-permissions", "--resume", ws.sessionId], {
    cwd: ws.worktreePath,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });

  const exitCode = await proc.exited;
  console.log(`\nReturned from Claude session for "${name}".`);

  const { $ } = await import("bun");
  const gitStatus = await $`git -C ${ws.worktreePath} status --porcelain`.quiet().catch(() => null);
  const changes = gitStatus?.stdout.toString().trim();
  if (changes) {
    await $`git -C ${ws.worktreePath} add -A`.quiet().catch(() => {});
    await $`git -C ${ws.worktreePath} commit -m "ws: apply agent changes"`.quiet().catch(() => {});
  }

  ws.status = exitCode === 0 ? "success" : "failed";
  ws.finishedAt = new Date().toISOString();
  await appendWorkstreamStatus(ws);
  console.log(`Status updated to: ${ws.status}`);
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
  });
}

// ─── Action: Run (gathers pending prompt + comments) ─────────────────────────

async function actionRun(name: string, ws: WorkstreamState, state: any) {
  // Don't set status here — ws run handles validation and status updates itself
  const bgArgs = ["bun", Bun.main, "run", name];
  const proc = Bun.spawn(bgArgs, {
    cwd: process.cwd(),
    stdin: "ignore",
    stdout: "ignore",
    stderr: "ignore",
  });
  proc.unref();
}

// ─── Action: Set/update prompt in workstream.yaml ─────────────────────────────

async function actionSetPrompt(name: string, prompt: string) {
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

async function actionCreateWorkstream(name: string, prompt?: string) {
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

async function dispatchAction(action: DashboardAction, state: any, config: any): Promise<boolean> {
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
      return false;
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

// ─── Command ─────────────────────────────────────────────────────────────────

export function dashboardCommand() {
  return new Command("dashboard")
    .description("Open the interactive TUI dashboard")
    .addHelpText("after", `
Examples:
  ws dashboard   Open the interactive dashboard

Dashboard keys: Enter=editor, d=diff, r=resume session, p=prompt agent,
  c=comments, /=search, ?=help, q=quit.
`)
    .action(async () => {
      const state = await loadState();
      if (!state) {
        console.error("Error: workstreams not initialized. Run `ws init` first.");
        process.exit(1);
      }

      const config = await loadConfig("workstream.yaml");

      // Dashboard loop: IDE dashboard handles logs/diff inline,
      // only exits for editor/run/session/prompt actions
      let loop = true;
      while (loop) {
        const freshState = await loadState() ?? state;
        const freshConfig = await loadConfig("workstream.yaml");
        const entries = await buildEntries(freshConfig, freshState);
        const wt = new WorktreeManager();
        const dashboardOpts: IdeDashboardOptions = {
          onRefresh: async () => {
            const s = await loadState() ?? state;
            const c = await loadConfig("workstream.yaml");
            return buildEntries(c, s);
          },
          getLogFile: (name: string) => {
            return freshState.currentRun?.workstreams?.[name]?.logFile ?? `.workstreams/logs/${name}.log`;
          },
          getWorkstreamStatus: (name: string) => {
            return freshState.currentRun?.workstreams?.[name]?.status ?? "ready";
          },
          getDiff: async (name: string) => {
            const [branchDiff, uncommittedDiff] = await Promise.all([
              wt.diffBranch(`ws/${name}`).catch(() => ""),
              wt.diff(name).catch(() => ""),
            ]);
            return branchDiff + uncommittedDiff;
          },
          onOpenEditor: async (name: string): Promise<boolean> => {
            const absPath = await ensureWorktree(name, freshState, freshConfig);
            const resolved = await resolveEditor(undefined, freshState.defaultEditor);
            if (!resolved) return false;
            if (!freshState.defaultEditor) {
              freshState.defaultEditor = resolved;
              await saveState(freshState);
            }
            await openEditor(absPath, resolved);
            return true;
          },
          onCreateWorkstream: async (name: string): Promise<boolean> => {
            try {
              await actionCreateWorkstream(name);
              // Also create the worktree
              await ensureWorktree(name, freshState, freshConfig);
              return true;
            } catch {
              return false;
            }
          },
          onDestroy: async (name: string): Promise<boolean> => {
            try {
              const { parse, stringify } = await import("yaml");
              const { unlink } = await import("fs/promises");
              const wtm = new WorktreeManager();

              // Remove worktree and branch
              await wtm.remove(name);

              // Remove from workstream.yaml
              const configFile = Bun.file("workstream.yaml");
              if (await configFile.exists()) {
                const raw = parse(await configFile.text());
                if (raw.workstreams && raw.workstreams[name]) {
                  delete raw.workstreams[name];
                  await Bun.write("workstream.yaml", stringify(raw));
                }
              }

              // Delete log and comment files
              await unlink(`.workstreams/comments/${name}.json`).catch(() => {});
              await unlink(`.workstreams/logs/${name}.log`).catch(() => {});

              // Remove from state
              const s = await loadState();
              if (s?.currentRun?.workstreams?.[name]) {
                delete s.currentRun.workstreams[name];
                if (Object.keys(s.currentRun.workstreams).length === 0) {
                  s.currentRun = undefined;
                }
                await saveState(s);
              }
              return true;
            } catch {
              return false;
            }
          },
          onSendPrompt: async (name: string, prompt: string): Promise<boolean> => {
            // Load fresh state every time (dashboard stays open)
            const s = await loadState() ?? state;
            const ws = s.currentRun?.workstreams?.[name];

            // Don't send if agent is already active
            if (ws?.status === "running" || ws?.status === "queued") return false;

            const hasSession = !!ws?.sessionId;

            // Ensure run state exists
            if (!s.currentRun) {
              s.currentRun = {
                runId: `run-${Date.now()}`,
                startedAt: new Date().toISOString(),
                workstreams: {},
              };
            }
            if (!s.currentRun.workstreams[name]) {
              s.currentRun.workstreams[name] = {
                name,
                status: "queued" as const,
                branch: `ws/${name}`,
                worktreePath: `.workstreams/trees/${name}`,
                logFile: `.workstreams/logs/${name}.log`,
              };
            }

            s.currentRun.finishedAt = undefined;

            if (hasSession) {
              // Resume: send only the user's prompt (comments are sent
              // separately via the explicit "resume with comments" action)
              const wsState = s.currentRun.workstreams[name];
              wsState.status = "running";
              wsState.startedAt = new Date().toISOString();
              wsState.finishedAt = undefined;
              wsState.exitCode = undefined;
              wsState.error = undefined;
              await appendWorkstreamStatus(wsState);
              await saveState(s);

              // Spawn background resume worker directly
              const bgArgs = ["bun", Bun.main, "run", name, "-c", "workstream.yaml", "-p", prompt];
              const proc = Bun.spawn(bgArgs, {
                cwd: process.cwd(),
                env: { ...process.env, WS_BACKGROUND: "1", WS_RESUME_MODE: "1" },
                stdin: "ignore",
                stdout: "ignore",
                stderr: "ignore",
              });
              proc.unref();
            } else {
              // Fresh run: save prompt to workstream.yaml, spawn executor directly
              await actionSetPrompt(name, prompt);

              const wsState = s.currentRun.workstreams[name];
              wsState.status = "queued";
              await appendWorkstreamStatus(wsState);
              await saveState(s);

              // Spawn background executor directly
              const bgArgs = ["bun", Bun.main, "run", "-c", "workstream.yaml", name];
              const proc = Bun.spawn(bgArgs, {
                cwd: process.cwd(),
                env: { ...process.env, WS_BACKGROUND: "1" },
                stdin: "ignore",
                stdout: "ignore",
                stderr: "ignore",
              });
              proc.unref();
            }
            return true;
          },
          onInterrupt: async (name: string) => {
            // Load fresh state to get current PID
            const s = await loadState();
            const ws = s?.currentRun?.workstreams?.[name];
            if (ws?.pid) {
              try { process.kill(ws.pid, "SIGINT"); } catch {}
              ws.status = "interrupted";
              ws.finishedAt = new Date().toISOString();
              ws.pid = undefined;
              await appendWorkstreamStatus(ws);
              await saveState(s!);
              // Append interrupted marker to log file so it shows in the log viewer
              const { appendFile, mkdir } = await import("fs/promises");
              const logFile = ws.logFile ?? `.workstreams/logs/${name}.log`;
              await mkdir(".workstreams/logs", { recursive: true }).catch(() => {});
              await appendFile(logFile, JSON.stringify({ type: "system", text: "Interrupted" }) + "\n").catch(() => {});
              notifyStatus(name, "interrupted");
            }
          },
        };
        const action = await openIdeDashboard(entries, dashboardOpts);
        loop = await dispatchAction(action, freshState, freshConfig);
      }
    });
}
