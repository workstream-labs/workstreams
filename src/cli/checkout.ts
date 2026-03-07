import { Command } from "commander";
import { loadState } from "../core/state";
import { WorktreeManager } from "../core/worktree";
import { prompt, promptChoice } from "../core/prompt";
import { loadComments, saveComments } from "../core/comments";

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

      // Handle in-progress states
      if (ws.status === "pending" || ws.status === "queued") {
        console.log(`"${name}" has not started yet (status: ${ws.status}).`);
        console.log("Use `ws status` to check progress.");
        return;
      }

      if (ws.status === "running") {
        if (!ws.sessionId) {
          console.log(`"${name}" is still starting — session not ready yet.`);
          console.log("Try again shortly or use `ws status` to check progress.");
          return;
        }
        console.log(`Note: "${name}" is still running.`);
        const choice = await promptChoice(`Checkout "${name}":`, [
          "Resume Claude session (interactive)",
        ]);
        if (choice === 1) await sessionView(name, ws);
        return;
      }

      // Completed (success or failed)
      const choices: string[] = [];
      if (ws.sessionId) {
        choices.push("Resume Claude session (interactive)");
      }
      choices.push("View diff and add review comments");

      if (choices.length === 1 && !ws.sessionId) {
        await diffView(name, ws);
        return;
      }

      const choice = await promptChoice(`Checkout "${name}":`, choices);
      if (choice === -1) {
        console.log("Invalid choice.");
        return;
      }

      if (ws.sessionId && choice === 1) {
        await sessionView(name, ws);
      } else {
        await diffView(name, ws);
      }
    });
}

async function sessionView(name: string, ws: { sessionId?: string; worktreePath: string }) {
  if (!ws.sessionId) {
    console.error("Error: no session ID captured for this workstream.");
    console.error("Session IDs are only captured when using the Claude agent with stream-json output.");
    process.exit(1);
  }

  console.log(`\nResuming Claude session for "${name}"...`);
  console.log("(You are now in an interactive Claude session. Exit Claude to return to ws.)\n");

  const proc = Bun.spawn(["claude", "--resume", ws.sessionId], {
    cwd: ws.worktreePath,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });

  await proc.exited;
  console.log(`\nReturned from Claude session for "${name}".`);
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
