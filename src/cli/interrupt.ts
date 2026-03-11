import { Command } from "commander";
import { loadState, saveState } from "../core/state";

export function interruptCommand() {
  return new Command("interrupt")
    .description("Interrupt a running workstream agent")
    .argument("<name>", "workstream name")
    .addHelpText("after", `
Examples:
  ws interrupt auth-feature   Stop the running agent for "auth-feature"
`)
    .action(async (name: string) => {
      const state = await loadState();
      if (!state?.currentRun) {
        console.error("Error: no active run.");
        process.exit(1);
      }

      const ws = state.currentRun.workstreams[name];
      if (!ws) {
        console.error(`Error: workstream "${name}" not found in current run`);
        process.exit(1);
      }

      if (ws.status !== "running") {
        console.log(`Workstream "${name}" is not running (status: ${ws.status}).`);
        return;
      }

      if (!ws.pid) {
        console.log(`No PID recorded for "${name}". The agent may have already finished.`);
        // Still mark as failed so the status is consistent
        ws.status = "failed";
        ws.error = "Interrupted by user (no PID)";
        ws.finishedAt = new Date().toISOString();
        await saveState(state);
        return;
      }

      // Check if process is still alive
      let alive = false;
      try {
        process.kill(ws.pid, 0);
        alive = true;
      } catch {}

      if (alive) {
        try {
          process.kill(ws.pid, "SIGINT");
        } catch {}
        console.log(`Sent SIGINT to agent process ${ws.pid}.`);
      } else {
        console.log(`Process ${ws.pid} is no longer running.`);
      }

      ws.status = "failed";
      ws.error = "Interrupted by user";
      ws.finishedAt = new Date().toISOString();
      ws.pid = undefined;
      await saveState(state);

      console.log(`Workstream "${name}" interrupted.`);
    });
}
