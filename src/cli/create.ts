import { Command } from "commander";
import { parse, stringify } from "yaml";
import type { NodeType } from "../core/types";

export function createCommand() {
  return new Command("create")
    .description("Add a new workstream to workstream.yaml")
    .argument("<name>", "workstream name")
    .requiredOption("--prompt <prompt>", "prompt for the agent")
    .option("--type <type>", "node type (code or review)", "code")
    .option("--depends-on <deps>", "comma-separated dependency names")
    .action(async (name: string, opts: { prompt: string; type: string; dependsOn?: string }) => {
      const validTypes: NodeType[] = ["code", "review"];
      if (!validTypes.includes(opts.type as NodeType)) {
        console.error(`Error: type must be one of: ${validTypes.join(", ")}`);
        process.exit(1);
      }

      const configFile = Bun.file("workstream.yaml");
      if (!(await configFile.exists())) {
        console.error("Error: workstream.yaml not found. Run `ws init` first.");
        process.exit(1);
      }

      const raw = parse(await configFile.text());
      if (!raw.workstreams) raw.workstreams = {};

      if (raw.workstreams[name]) {
        console.error(`Error: workstream "${name}" already exists`);
        process.exit(1);
      }

      const entry: Record<string, any> = {
        prompt: opts.prompt,
        type: opts.type,
      };

      if (opts.dependsOn) {
        entry.depends_on = opts.dependsOn.split(",").map((s) => s.trim());
      }

      raw.workstreams[name] = entry;
      await Bun.write("workstream.yaml", stringify(raw));
      console.log(`Added workstream "${name}" to workstream.yaml`);
    });
}
