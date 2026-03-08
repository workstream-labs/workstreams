import { Command } from "commander";
import { loadState } from "../core/state";
import type { WorkstreamState, WorkstreamStatus } from "../core/types";

const STATUS_COLORS: Record<WorkstreamStatus, string> = {
  pending: "\x1b[90m",   // gray
  queued: "\x1b[36m",    // cyan
  running: "\x1b[34m",   // blue
  success: "\x1b[32m",   // green
  failed: "\x1b[31m",    // red
  waiting: "\x1b[33m",   // yellow
};
const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";

const WAITING_HINT = "Plan ready for review. Run `ws checkout <name>` to review and respond.";
const WAITING_FIX = [
  "Plan is ready. Review the log above, then either:",
  "  ws checkout <name>               (interactive — tell Claude to proceed)",
  '  ws resume <name> -p "proceed"    (non-interactive)',
];

export function statusCommand() {
  return new Command("status")
    .description("Show status of workstreams")
    .argument("[name]", "workstream name for detailed view")
    .action(async (name?: string) => {
      const state = await loadState();
      if (!state) {
        console.error("Error: workstreams not initialized. Run `ws init` first.");
        process.exit(1);
      }

      const run = state.currentRun;
      if (!run) {
        console.log("No active run. Use `ws run` to start.");
        return;
      }

      if (name) {
        const ws = run.workstreams[name];
        if (!ws) {
          console.error(`Error: workstream "${name}" not found in current run`);
          process.exit(1);
        }
        await showDetail(name, ws);
        return;
      }

      // Summary table
      console.log(`Run: ${run.runId}`);
      console.log(`Started: ${run.startedAt}`);
      if (run.finishedAt) console.log(`Finished: ${run.finishedAt}`);
      console.log();

      const nameWidth = 30;
      const statusWidth = 10;
      console.log("Name".padEnd(nameWidth) + "Status".padEnd(statusWidth) + "Duration");
      console.log("-".repeat(nameWidth + statusWidth + 12));

      for (const [n, ws] of Object.entries(run.workstreams)) {
        const color = STATUS_COLORS[ws.status];
        let duration = "";
        if (ws.startedAt) {
          const start = new Date(ws.startedAt).getTime();
          const end = ws.finishedAt ? new Date(ws.finishedAt).getTime() : Date.now();
          duration = `${Math.round((end - start) / 1000)}s`;
        }
        console.log(
          n.padEnd(nameWidth) +
            `${color}${ws.status}${RESET}`.padEnd(statusWidth + 9) +
            duration
        );
      }
    });
}

async function showDetail(name: string, ws: WorkstreamState) {
  const color = STATUS_COLORS[ws.status];

  console.log(`${BOLD}${name}${RESET}`);
  console.log(`  Status:  ${color}${ws.status}${RESET}`);
  console.log(`  Branch:  ${ws.branch}`);

  if (ws.startedAt) {
    const start = new Date(ws.startedAt).getTime();
    const end = ws.finishedAt ? new Date(ws.finishedAt).getTime() : Date.now();
    console.log(`  Duration: ${Math.round((end - start) / 1000)}s`);
  }

  if (ws.exitCode !== undefined) {
    console.log(`  Exit code: ${ws.exitCode}`);
  }

  if (ws.sessionId) {
    console.log(`  Session:  ${ws.sessionId}`);
  }

  if (ws.error) {
    console.log(`\n  ${BOLD}Error:${RESET}`);
    console.log(`  ${ws.error}`);
  }

  // Show tail of log file
  const logTail = await readLogTail(ws.logFile, 20);
  if (logTail) {
    console.log(`\n  ${BOLD}Recent log (${ws.logFile}):${RESET}`);
    for (const line of logTail) {
      console.log(`  ${line}`);
    }
  }

  if (ws.status === "waiting") {
    console.log(`\n  ${BOLD}Hint:${RESET}`);
    console.log(`  ${WAITING_HINT}`);
  }

  // Suggest a fix for failed or waiting workstreams
  if (ws.status === "failed" || ws.status === "waiting") {
    const fix = suggestFix(name, ws);
    if (fix) {
      console.log(`\n  ${BOLD}Next steps:${RESET}`);
      for (const line of fix) {
        console.log(`  ${line}`);
      }
    }
  }
}

async function readLogTail(logFile: string, lines: number): Promise<string[] | null> {
  try {
    const text = await Bun.file(logFile).text();
    const all = text.split("\n").filter((l) => l.trim());
    return all.slice(-lines);
  } catch {
    return null;
  }
}

function suggestFix(name: string, ws: WorkstreamState): string[] | null {
  if (ws.status === "waiting") {
    return WAITING_FIX.map((line) => line.replace("<name>", name));
  }

  const err = ws.error ?? "";

  if (err.includes("already exists")) {
    return [
      "The worktree directory already exists from a previous run.",
      "Clean it up and re-run:",
      `  ws destroy ${name}`,
      `  ws run ${name}`,
    ];
  }

  if (err.includes("invalid reference: HEAD") || err.includes("not a git repository")) {
    return [
      "The git repository has no commits. Make an initial commit first:",
      `  git add -A && git commit -m "initial commit"`,
      `  ws run ${name}`,
    ];
  }

  if (err.includes("not found") || err.includes("No such file or directory")) {
    return [
      "The agent binary may not be installed or not in PATH.",
      "Check that your agent command is available, then re-run:",
      `  ws run ${name}`,
    ];
  }

  if (ws.exitCode !== undefined && ws.exitCode !== 0) {
    return [
      `Agent exited with code ${ws.exitCode}.`,
      "Review the log above for details, then resume with new instructions:",
      `  ws resume ${name} -p "<revised instructions>"`,
      "Or re-run from scratch:",
      `  ws destroy ${name} && ws run ${name}`,
    ];
  }

  return [
    "Check the log above for details.",
    `  ws destroy ${name} && ws run ${name}`,
  ];
}
