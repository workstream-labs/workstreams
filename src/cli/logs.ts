import { Command } from "commander";
import { loadConfig } from "../core/config.js";
import { loadState } from "../core/state.js";
import { openChoicePicker } from "../ui/choice-picker.js";
import { openLogViewer } from "../ui/log-viewer.js";
import { STATUS_STYLE } from "../ui/ansi.js";

export function logsCommand() {
  return new Command("logs")
    .description("View agent logs for a workstream (live-tails running sessions)")
    .argument("[name]", "workstream name (omit for interactive picker)")
    .option("--raw", "print raw log output instead of interactive viewer")
    .addHelpText("after", `
Examples:
  ws logs auth           Open interactive log viewer for "auth"
  ws logs                Pick a workstream interactively
  ws logs auth --raw     Print raw log output to stdout

Interactive viewer keys: j/k scroll, d/u half-page, g/G top/bottom,
  f toggle follow mode, q quit.
`)
    .action(async (name?: string, opts?: { raw?: boolean }) => {
      const state = await loadState();
      if (!state?.currentRun) {
        console.error("Error: no active run. Run `ws run` first.");
        process.exit(1);
      }

      const workstreams = state.currentRun.workstreams;
      const names = Object.keys(workstreams);

      if (names.length === 0) {
        console.error("Error: no workstreams found in current run.");
        process.exit(1);
      }

      // If no name provided, open interactive picker
      if (!name) {
        if (!process.stdout.isTTY) {
          console.error("Error: no workstream name provided and not a TTY.");
          process.exit(1);
        }

        const options = names.map(n => {
          const ws = workstreams[n];
          const st = STATUS_STYLE[ws.status] ?? STATUS_STYLE.pending;
          return {
            label: n,
            description: `${st.icon} ${ws.status}`,
          };
        });

        const idx = await openChoicePicker("Select workstream", options);
        if (idx === null) return; // user cancelled
        name = names[idx];
      }

      const ws = workstreams[name];
      if (!ws) {
        console.error(`Error: workstream "${name}" not found in current run.`);
        console.error(`Available: ${names.join(", ")}`);
        process.exit(1);
      }

      // Raw mode: just cat the log file
      if (opts?.raw || !process.stdout.isTTY) {
        try {
          const content = await Bun.file(ws.logFile).text();
          process.stdout.write(content);
        } catch {
          console.error(`Error: log file not found: ${ws.logFile}`);
          process.exit(1);
        }
        return;
      }

      // Interactive viewer
      await openLogViewer({
        name,
        logFile: ws.logFile,
        status: ws.status,
      });
    });
}
