import { loadComments, loadPendingPrompt } from "../../core";
import { getBranchInfo, getDiffStats, type WorkstreamEntry } from "../../ui/workstream-picker.js";

export async function buildEntries(config: any, state: any): Promise<WorkstreamEntry[]> {
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
        getDiffStats(branch, worktreePath),
        $`git -C ${worktreePath} status --porcelain`.quiet().catch(() => null),
      ]);
      branchInfo = bi;
      diffStats = ds;
      isDirty = !!(dirtyResult?.stdout.toString().trim());
    }

    const hasSession = !!state?.currentRun?.workstreams?.[def.name]?.sessionId;
    const commentsData = await loadComments(def.name);
    const commentCount = commentsData.comments.length + (commentsData.overallComment ? 1 : 0);
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
      startedAt: state?.currentRun?.workstreams?.[def.name]?.startedAt,
    } as WorkstreamEntry;
  });

  // Preserve order
  for (const def of config.workstreams) {
    entries.push(await promises[config.workstreams.indexOf(def)]);
  }

  return entries;
}
