import { Command } from "commander";
import { resolve } from "path";
import { loadState, saveState } from "../core/state";
import { loadConfig } from "../core/config";
import { WorktreeManager } from "../core/worktree";
import { promptChoice } from "../core/prompt";
import { openWorkstreamPicker, getBranchInfo, getDiffStats, type WorkstreamEntry } from "../ui/workstream-picker.js";

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

  const labels = installed.map((cmd) => EDITORS[cmd]?.label ?? cmd);
  const choice = await promptChoice("Which editor should ws open?", labels);
  if (choice === -1) return null;
  return installed[choice - 1];
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

async function switchTo(
  name: string,
  state: any,
  config: any,
  editor?: string,
  noEditor?: boolean,
) {
  const def = config.workstreams.find((w: any) => w.name === name);
  if (!def) {
    console.error(`Error: workstream "${name}" not found in workstream.yaml`);
    process.exit(1);
  }

  const wt = new WorktreeManager();
  const worktreePath = `.workstreams/trees/${name}`;
  const absPath = resolve(worktreePath);

  const { stat } = await import("fs/promises");
  const exists = await stat(worktreePath).then(() => true).catch(() => false);

  if (!exists) {
    console.log(`Creating worktree for "${name}" on branch ws/${name}...`);
    await wt.create(name, def.baseBranch);

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

  console.log(`Switched to ws/${name} at ${absPath}`);

  if (!noEditor) {
    const resolved = await resolveEditor(editor, state.defaultEditor);
    if (resolved) {
      if (!editor && !state.defaultEditor) {
        state.defaultEditor = resolved;
        await saveState(state);
      }
      const label = EDITORS[resolved]?.label ?? resolved;
      console.log(`Opening in ${label}...`);
      openEditor(absPath, resolved);
    }
  }
}

export function switchCommand() {
  return new Command("switch")
    .description("Switch to a workstream's worktree and open in your editor")
    .argument("[name]", "workstream name (interactive picker if omitted)")
    .option("-e, --editor <editor>", "editor to open (code, cursor, zed, vim, etc.)")
    .option("--no-editor", "don't open an editor, just print the path")
    .action(async (name: string | undefined, opts: { editor?: string; editor_?: boolean }) => {
      const noEditor = opts.editor_ === false;

      const state = await loadState();
      if (!state) {
        console.error("Error: workstreams not initialized. Run `ws init` first.");
        process.exit(1);
      }

      const config = await loadConfig("workstream.yaml");

      // If name provided, switch directly
      if (name) {
        await switchTo(name, state, config, opts.editor, noEditor);
        return;
      }

      // No name — open interactive picker
      if (config.workstreams.length === 0) {
        console.log("No workstreams defined. Add one with: ws create <name>");
        return;
      }

      const entries = await buildEntries(config, state);
      const selected = await openWorkstreamPicker(entries);

      if (!selected) return; // user pressed q

      await switchTo(selected.name, state, config, opts.editor, noEditor);
    });
}
