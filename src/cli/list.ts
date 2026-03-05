import { Command } from "commander";
import { loadConfig } from "../core/config";

export function listCommand() {
  return new Command("list")
    .description("List workstreams from config")
    .option("-c, --config <path>", "config file path", "workstream.yaml")
    .action(async (opts: { config: string }) => {
      const config = await loadConfig(opts.config);

      const nameWidth = 30;
      const typeWidth = 8;
      console.log(
        "Name".padEnd(nameWidth) +
          "Type".padEnd(typeWidth) +
          "Dependencies"
      );
      console.log("-".repeat(nameWidth + typeWidth + 20));

      for (const ws of config.workstreams) {
        const deps = ws.dependsOn?.join(", ") ?? "-";
        console.log(
          ws.name.padEnd(nameWidth) +
            ws.type.padEnd(typeWidth) +
            deps
        );
      }
    });
}
