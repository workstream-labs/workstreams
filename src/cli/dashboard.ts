import { Command } from "commander";
import { loadState } from "../core/state";
import { EventBus } from "../core/events";
import { createDashboardServer } from "../dashboard/server";

export function dashboardCommand() {
  return new Command("dashboard")
    .description("Open the DAG dashboard in the browser")
    .option("-p, --port <port>", "server port", "7890")
    .option("--no-open", "don't open the browser")
    .action(async (opts: { port: string; open: boolean }) => {
      const state = await loadState();
      if (!state) {
        console.error("Error: workstreams not initialized. Run `ws init` first.");
        process.exit(1);
      }

      const port = parseInt(opts.port);
      const eventBus = new EventBus();
      const server = createDashboardServer(eventBus, port);

      const url = `http://localhost:${port}`;
      console.log(`Dashboard running at ${url}`);

      if (opts.open) {
        const { $ } = await import("bun");
        try {
          await $`open ${url}`.quiet();
        } catch {
          // open command may not exist on all platforms
        }
      }

      console.log("Press Ctrl+C to stop");

      // Keep alive
      await new Promise(() => {});
    });
}
