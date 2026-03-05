import { Command } from "commander";
import { loadState } from "../core/state";

export function logCommand() {
  return new Command("log")
    .description("Show log output for a workstream")
    .argument("<name>", "workstream name")
    .option("-f, --follow", "follow log output (live tail)")
    .action(async (name: string, opts: { follow?: boolean }) => {
      const state = await loadState();
      if (!state?.currentRun) {
        console.error("Error: no active run");
        process.exit(1);
      }

      const ws = state.currentRun.workstreams[name];
      if (!ws) {
        console.error(`Error: workstream "${name}" not found`);
        process.exit(1);
      }

      const logFile = Bun.file(ws.logFile);
      if (!(await logFile.exists())) {
        console.error(`No log file found for "${name}"`);
        process.exit(1);
      }

      if (opts.follow) {
        // Live tail using file watcher
        let offset = 0;
        const read = async () => {
          const file = Bun.file(ws.logFile);
          const size = file.size;
          if (size > offset) {
            const slice = file.slice(offset, size);
            const text = await slice.text();
            process.stdout.write(text);
            offset = size;
          }
        };

        await read();

        // Poll for changes
        const interval = setInterval(read, 500);
        process.on("SIGINT", () => {
          clearInterval(interval);
          process.exit(0);
        });

        // Keep alive
        await new Promise(() => {});
      } else {
        const content = await logFile.text();
        console.log(content);
      }
    });
}
