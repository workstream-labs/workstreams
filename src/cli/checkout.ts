import { Command } from "commander";
import { loadState, saveState } from "../core/state";
import type { ProjectState, WorkstreamState } from "../core/types";
import { WorktreeManager } from "../core/worktree";
import { prompt } from "../core/prompt";
import { loadComments, saveComments } from "../core/comments";

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const STATUS_COLOR: Record<string, string> = {
  running: "\x1b[33m",
  waiting: "\x1b[36m",
  success: "\x1b[32m",
  failed: "\x1b[31m",
};

export function checkoutCommand() {
  return new Command("checkout")
    .description("Interactively inspect a workstream (session or diff)")
    .argument("<name>", "workstream name")
    .action(async (name: string) => {
      const state = await loadState();
      if (!state?.currentRun) {
        console.error("Error: no active run. Run `ws run` first.");
        process.exit(1);
      }

      const ws = state.currentRun.workstreams[name];
      if (!ws) {
        console.error(`Error: workstream "${name}" not found in current run`);
        process.exit(1);
      }

      if (ws.status === "pending" || ws.status === "queued") {
        console.log(`"${name}" has not started yet (status: ${ws.status}).`);
        console.log("Use `ws status` to check progress.");
        return;
      }

      if (ws.status === "running" && !ws.sessionId) {
        console.log(`"${name}" is still starting — session not ready yet.`);
        console.log("Try again shortly or use `ws status` to check progress.");
        return;
      }

      if (ws.status === "running") {
        console.log(`"${name}" is still running. Wait for it to finish before checking out.`);
        console.log("Use `ws status` to check progress.");
        return;
      }

      if (ws.sessionId) {
        await sessionView(name, ws, state, true);
      } else {
        await diffView(name, ws);
      }
    });
}

async function showContextHeader(name: string, ws: WorkstreamState) {
  const color = STATUS_COLOR[ws.status] ?? "";
  console.log(`\n${BOLD}ws/${name}${RESET}  ${color}${ws.status}${RESET}  ${DIM}${ws.branch}${RESET}`);

  const wt = new WorktreeManager();
  try {
    const diff = await wt.diffBranch(`ws/${name}`);
    if (diff.trim()) {
      const changedFiles = diff
        .split("\n")
        .filter((l) => l.startsWith("diff --git "))
        .map((l) => l.replace(/^diff --git a\//, "").split(" b/")[0]);
      if (changedFiles.length > 0) {
        console.log(`${DIM}Changed: ${changedFiles.join(", ")}${RESET}`);
      }
    } else {
      console.log(`${DIM}(no changes yet)${RESET}`);
    }
  } catch {
    // worktree may not be set up yet
  }
  console.log();
}

async function sessionView(
  name: string,
  ws: { sessionId?: string; worktreePath: string; status: string; finishedAt?: string },
  state: ProjectState,
  updateStatus: boolean
) {
  if (!ws.sessionId) {
    console.error("Error: no session ID captured for this workstream.");
    console.error("Session IDs are only captured when using the Claude agent with stream-json output.");
    process.exit(1);
  }

  const proc = Bun.spawn(["claude", "--dangerously-skip-permissions", "--resume", ws.sessionId], {
    cwd: ws.worktreePath,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });

  const exitCode = await proc.exited;
  console.log(`\nReturned from Claude session for "${name}".`);

  if (updateStatus) {
    const { $ } = await import("bun");
    const gitStatus = await $`git -C ${ws.worktreePath} status --porcelain`.quiet().catch(() => null);
    const changes = gitStatus?.stdout.toString().trim();
    if (changes) {
      await $`git -C ${ws.worktreePath} add -A`.quiet().catch(() => {});
      await $`git -C ${ws.worktreePath} commit -m "ws: apply agent changes"`.quiet().catch(() => {});
    }

    (ws as any).status = exitCode === 0 ? "success" : "failed";
    (ws as any).finishedAt = new Date().toISOString();
    await saveState(state);
    console.log(`Status updated to: ${(ws as any).status}`);
  }
}

async function diffView(name: string, ws: { worktreePath: string }) {
  const wt = new WorktreeManager();

  console.log(`\nDiff for "${name}":\n`);
  const diff = await wt.diffBranch(`ws/${name}`);
  if (!diff.trim()) {
    console.log("  (no changes)");
    return;
  }
  console.log(diff);

  console.log("\n--- Add review comments (enter 'done' to finish) ---\n");

  const data = await loadComments(name);

  while (true) {
    const filePath = await prompt("File path (or 'done'): ");
    if (filePath.toLowerCase() === "done" || !filePath) break;

    const lineStr = await prompt("Line number (optional, press enter to skip): ");
    const line = lineStr ? parseInt(lineStr, 10) : undefined;

    const text = await prompt("Comment: ");
    if (!text) continue;

    data.comments.push({
      filePath,
      line: line && !isNaN(line) ? line : undefined,
      text,
      createdAt: new Date().toISOString(),
    });

    await saveComments(data);
    console.log(`  Comment added. (${data.comments.length} total)\n`);
  }

  if (data.comments.length > 0) {
    console.log(`\n${data.comments.length} comment(s) saved.`);
    console.log(`Use 'ws resume ${name}' to send comments to the agent.`);
  }
}
