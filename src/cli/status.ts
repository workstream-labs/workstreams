import { Command } from "commander";
import { loadState } from "../core/state";
import type { WorkstreamStatus } from "../core/types";

const STATUS_COLORS: Record<WorkstreamStatus, string> = {
  pending: "\x1b[90m",   // gray
  queued: "\x1b[36m",    // cyan
  running: "\x1b[34m",   // blue
  success: "\x1b[32m",   // green
  failed: "\x1b[31m",    // red
  skipped: "\x1b[33m",   // yellow
};
const RESET = "\x1b[0m";

export function statusCommand() {
  return new Command("status")
    .description("Show status of workstreams")
    .action(async () => {
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

      console.log(`Run: ${run.runId}`);
      console.log(`Started: ${run.startedAt}`);
      if (run.finishedAt) console.log(`Finished: ${run.finishedAt}`);
      console.log();

      // Table header
      const nameWidth = 30;
      const statusWidth = 10;
      const typeWidth = 8;
      console.log(
        "Name".padEnd(nameWidth) +
          "Status".padEnd(statusWidth) +
          "Type".padEnd(typeWidth) +
          "Duration"
      );
      console.log("-".repeat(nameWidth + statusWidth + typeWidth + 12));

      for (const [name, ws] of Object.entries(run.workstreams)) {
        const color = STATUS_COLORS[ws.status];
        let duration = "";
        if (ws.startedAt) {
          const start = new Date(ws.startedAt).getTime();
          const end = ws.finishedAt
            ? new Date(ws.finishedAt).getTime()
            : Date.now();
          const secs = Math.round((end - start) / 1000);
          duration = `${secs}s`;
        }

        console.log(
          name.padEnd(nameWidth) +
            `${color}${ws.status}${RESET}`.padEnd(statusWidth + 9) +
            ws.type.padEnd(typeWidth) +
            duration
        );
      }
    });
}
