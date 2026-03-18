import { $ } from "bun";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface WorkstreamEntry {
  name: string;
  branch: string;
  status: string;         // "success", "failed", "running", "queued", "ready", or "workspace"
  prompt?: string;
  hasWorktree: boolean;
  ahead: number;
  behind: number;
  lastCommitAge: string;
  lastCommitMsg: string;
  filesChanged: number;
  additions: number;
  deletions: number;
  hasSession: boolean;
  commentCount: number;
  hasPendingPrompt: boolean;
  pendingPromptText?: string;
  isDirty: boolean;
  startedAt?: string;
}

export type DashboardAction =
  | { type: "editor"; name: string }
  | { type: "diff"; name: string }
  | { type: "log"; name: string }
  | { type: "open-session"; name: string }
  | { type: "run"; name: string }
  | { type: "set-prompt"; name: string; prompt: string }
  | { type: "save-pending-prompt"; name: string; prompt: string }
  | { type: "create-workstream"; name: string; prompt?: string }
  | { type: "quit" };

// ─── Git helpers ─────────────────────────────────────────────────────────────

export async function getBranchInfo(branch: string): Promise<{
  ahead: number;
  behind: number;
  lastCommitAge: string;
  lastCommitMsg: string;
}> {
  const defaults = { ahead: 0, behind: 0, lastCommitAge: "", lastCommitMsg: "" };

  try {
    const abResult = await $`git rev-list --left-right --count HEAD...${branch}`.quiet();
    const parts = abResult.stdout.toString().trim().split(/\s+/);
    const behind = parseInt(parts[0], 10) || 0;
    const ahead = parseInt(parts[1], 10) || 0;

    const msgResult = await $`git log -1 --format=%s ${branch}`.quiet();
    const lastCommitMsg = msgResult.stdout.toString().trim();

    const dateResult = await $`git log -1 --format=%cr ${branch}`.quiet();
    const lastCommitAge = dateResult.stdout.toString().trim();

    return { ahead, behind, lastCommitAge, lastCommitMsg };
  } catch {
    return defaults;
  }
}

export async function getDiffStats(branch: string, worktreePath?: string): Promise<{
  filesChanged: number;
  additions: number;
  deletions: number;
}> {
  try {
    const results = await Promise.all([
      $`git diff --numstat HEAD...${branch}`.quiet().catch(() => null),
      worktreePath
        ? $`git -C ${worktreePath} diff --numstat HEAD`.quiet().catch(() => null)
        : null,
    ]);

    const files = new Map<string, { add: number; del: number }>();

    for (const result of results) {
      if (!result) continue;
      for (const line of result.stdout.toString().trim().split("\n")) {
        if (!line) continue;
        const [a, d, file] = line.split("\t");
        if (!file) continue;
        const add = a === "-" ? 0 : parseInt(a, 10);
        const del = d === "-" ? 0 : parseInt(d, 10);
        const existing = files.get(file);
        if (existing) {
          existing.add += add;
          existing.del += del;
        } else {
          files.set(file, { add, del });
        }
      }
    }

    // Count untracked (new) files in the worktree — git diff HEAD misses them
    if (worktreePath) {
      const untracked = await $`git -C ${worktreePath} ls-files --others --exclude-standard`.quiet().catch(() => null);
      if (untracked) {
        const untrackedFiles = untracked.stdout.toString().trim().split("\n")
          .filter(f => f && !f.startsWith(".claude/"));
        for (const file of untrackedFiles) {
          if (files.has(file)) continue;
          try {
            const content = await Bun.file(`${worktreePath}/${file}`).text();
            const lineCount = content.split("\n").length - (content.endsWith("\n") ? 1 : 0);
            files.set(file, { add: Math.max(lineCount, 1), del: 0 });
          } catch {}
        }
      }
    }

    let additions = 0;
    let deletions = 0;
    for (const { add, del } of files.values()) {
      additions += add;
      deletions += del;
    }

    return { filesChanged: files.size, additions, deletions };
  } catch {
    return { filesChanged: 0, additions: 0, deletions: 0 };
  }
}
