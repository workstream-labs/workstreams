import { Command } from "commander";
import { loadConfig } from "../core/config";

export function listCommand() {
  return new Command("list")
    .description("List workstreams from config")
    .option("-c, --config <path>", "config file path", "workstream.yaml")
    .action(async (opts: { config: string }) => {
      const config = await loadConfig(opts.config);

      if (config.workstreams.length === 0) {
        console.log('No workstreams defined. Add one with: ws create <name> "<prompt>"');
        return;
      }

      const nameWidth = 30;
      console.log("Name".padEnd(nameWidth) + "Prompt");
      console.log("-".repeat(nameWidth + 40));

      for (const ws of config.workstreams) {
        const prompt = ws.prompt.length > 60
          ? ws.prompt.slice(0, 57) + "..."
          : ws.prompt;
        console.log(ws.name.padEnd(nameWidth) + prompt);
      }
    });
}
