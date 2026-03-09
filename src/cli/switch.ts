import { Command } from "commander";
import { resolve } from "path";
import { loadState, saveState } from "../core/state";
import { loadConfig } from "../core/config";
import { WorktreeManager } from "../core/worktree";
import { AgentAdapter } from "../core/agent";
import { prompt as promptText } from "../core/prompt";
import { loadComments, clearComments, formatCommentsAsPrompt } from "../core/comments";
import { openWorkstreamPicker, getBranchInfo, getDiffStats, type WorkstreamEntry } from "../ui/workstream-picker.js";
import { openChoicePicker, type ChoiceOption } from "../ui/choice-picker.js";
import { openDiffViewer } from "../ui/diff-viewer.js";
import type { AgentConfig, ProjectState, WorkstreamState } from "../core/types";

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

  // Use choice picker for editor selection
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
  const entries: WorkstreamEntry[] = [];

  for (const def of config.workstreams) {
    const branch = `ws/${def.name}`;
    const worktreePath = `.workstreams/trees/${def.name}`;
    const hasWorktree = await stat(worktreePath).then(() => true).catch(() => false);

    // Get status from state
    let status = "workspace";
    if (state?.currentRun?.workstreams?.[def.name]) {
      status = state.currentRun.workstreams[def.name].status;
    } else if (def.prompt) {
      status = "pending";
    }

    let branchInfo = { ahead: 0, behind: 0, lastCommitAge: "", lastCommitMsg: "" };
    let diffStats = { filesChanged: 0, additions: 0, deletions: 0 };

    if (hasWorktree) {
      [branchInfo, diffStats] = await Promise.all([
        getBranchInfo(branch),
        getDiffStats(branch),
      ]);
    }

    entries.push({
      name: def.name,
      branch,
      status,
      prompt: def.prompt,
      hasWorktree,
      ...branchInfo,
      ...diffStats,
    });
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

// ─── Action: Resume Claude session (interactive) ─────────────────────────────

async function actionResumeSession(name: string, ws: WorkstreamState, state: ProjectState) {
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

  // Auto-commit and update status
  const { $ } = await import("bun");
  const gitStatus = await $`git -C ${ws.worktreePath} status --porcelain`.quiet().catch(() => null);
  const changes = gitStatus?.stdout.toString().trim();
  if (changes) {
    await $`git -C ${ws.worktreePath} add -A`.quiet().catch(() => {});
    await $`git -C ${ws.worktreePath} commit -m "ws: apply agent changes"`.quiet().catch(() => {});
  }

  ws.status = exitCode === 0 ? "success" : "failed";
  ws.finishedAt = new Date().toISOString();
  await saveState(state);
  console.log(`Status updated to: ${ws.status}`);
}

// ─── Action: View diff & review ──────────────────────────────────────────────

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

  const workstreams = state.currentRun
    ? Object.keys(state.currentRun.workstreams)
    : undefined;
  await openDiffViewer(name, diff, { workstreams });
}

// ─── Action: Resume with new prompt (hands-off) ─────────────────────────────

async function actionResumeWithPrompt(name: string, ws: WorkstreamState, config: any, state: any) {
  const text = await promptText("Enter prompt: ");
  if (!text) {
    console.log("No prompt provided. Aborting.");
    return;
  }
  await runResume(name, ws, config.agent, text, state);
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

// ─── Action picker ───────────────────────────────────────────────────────────

async function showActionPicker(name: string, state: any, config: any) {
  const ws: WorkstreamState | undefined = state.currentRun?.workstreams?.[name];
  const { stat } = await import("fs/promises");
  const worktreePath = `.workstreams/trees/${name}`;
  const hasWorktree = await stat(worktreePath).then(() => true).catch(() => false);
  const hasSession = !!ws?.sessionId;
  const commentsData = await loadComments(name);
  const hasComments = commentsData.comments.length > 0;

  // Build contextual actions
  type Action = { option: ChoiceOption; run: () => Promise<void> };
  const actions: Action[] = [];

  // 1. Open in editor — always available
  actions.push({
    option: { label: "Open in editor", description: "Create worktree if needed and open in your editor" },
    run: () => actionOpenEditor(name, state, config),
  });

  // 2. Resume Claude session — only if sessionId exists
  if (hasSession) {
    actions.push({
      option: { label: "Resume Claude session", description: "Interactive session resume" },
      run: () => actionResumeSession(name, ws!, state),
    });
  }

  // 3. View diff & review — only if worktree exists
  if (hasWorktree) {
    actions.push({
      option: { label: "View diff & review", description: "Browse changes and add review comments" },
      run: () => actionDiffReview(name, state),
    });
  }

  // 4. Resume with new prompt — only if sessionId exists
  if (hasSession) {
    actions.push({
      option: { label: "Resume with new prompt", description: "Send new instructions to the agent" },
      run: () => actionResumeWithPrompt(name, ws!, config, state),
    });
  }

  // 5. Resume with review comments — only if comments exist
  if (hasComments) {
    actions.push({
      option: { label: "Resume with review comments", description: `${commentsData.comments.length} comment(s) stored` },
      run: () => actionResumeWithComments(name, ws!, config, state),
    });
  }

  const choice = await openChoicePicker(`ws switch ${name}`, actions.map((a) => a.option));
  if (choice === null) return;

  await actions[choice].run();
}

// ─── Command ─────────────────────────────────────────────────────────────────

export function switchCommand() {
  return new Command("switch")
    .description("Switch to a workstream — pick an action (editor, resume, diff, etc.)")
    .argument("[name]", "workstream name (interactive picker if omitted)")
    .option("-e, --editor <editor>", "open directly in editor (skip action picker)")
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

      // If -e flag or --no-editor, go directly to editor flow (old behavior)
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

      // If name provided, go straight to action picker
      if (name) {
        const def = config.workstreams.find((w: any) => w.name === name);
        if (!def) {
          console.error(`Error: workstream "${name}" not found in workstream.yaml`);
          process.exit(1);
        }
        await showActionPicker(name, state, config);
        return;
      }

      // No name — open interactive workstream picker first
      if (config.workstreams.length === 0) {
        console.log("No workstreams defined. Add one with: ws create <name>");
        return;
      }

      const entries = await buildEntries(config, state);
      const selected = await openWorkstreamPicker(entries);

      if (!selected) return; // user pressed q

      await showActionPicker(selected.name, state, config);
    });
}
