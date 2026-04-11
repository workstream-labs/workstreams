import { resolve } from "path";
import { WorktreeManager, appendWorkstreamStatus, saveState } from "../../core";

export async function ensureWorktree(name: string, state: any, config: any): Promise<string> {
  const worktreePath = `.workstreams/trees/${name}`;
  const absPath = resolve(worktreePath);
  const { stat } = await import("fs/promises");
  const dirExists = await stat(worktreePath).then(() => true).catch(() => false);
  // A plain directory without a .git entry is not a valid worktree — git
  // commands inside it would resolve to the parent repo (the base branch).
  const isValidWorktree = dirExists &&
    await stat(`${worktreePath}/.git`).then(() => true).catch(() => false);

  if (!isValidWorktree) {
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
