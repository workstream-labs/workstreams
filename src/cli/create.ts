import { Command } from "commander";
import { parse, stringify } from "yaml";

export function createCommand() {
  return new Command("create")
    .description("Add a new workstream to workstream.yaml")
    .argument("<name>", "workstream name")
    .argument("<prompt>", "prompt for the agent")
    .action(async (name: string, prompt: string) => {
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

      raw.workstreams[name] = { prompt };

      await Bun.write("workstream.yaml", stringify(raw));
      console.log(`Added workstream "${name}" to workstream.yaml`);
    });
}
