import { Command } from "commander";
import { parse, stringify } from "yaml";
import { prompt as promptInput } from "../core/prompt";

const ERR_NO_CONFIG = "Error: workstream.yaml not found. Run `ws init` first.";
const ERR_NOT_FOUND = (name: string) => `Error: workstream "${name}" not found in workstream.yaml`;

export function promptCommand() {
  return new Command("prompt")
    .description("Set or update the prompt for an existing workstream")
    .argument("<name>", "workstream name")
    .option("-p, --prompt <text>", "prompt text (omit for interactive input)")
    .addHelpText("after", `
Examples:
  ws prompt auth -p "Add JWT authentication"
  ws prompt sandbox -p "Implement the login page"
  ws prompt dark-mode                          Interactive prompt input
`)
    .action(async (name: string, opts: { prompt?: string }) => {
      const configFile = Bun.file("workstream.yaml");
      if (!(await configFile.exists())) {
        console.error(ERR_NO_CONFIG);
        process.exit(1);
      }

      const raw = parse(await configFile.text()) as any;
      if (!raw.workstreams) raw.workstreams = {};

      if (Array.isArray(raw.workstreams)) {
        const entry = raw.workstreams.find((w: any) => w.name === name);
        if (!entry) {
          console.error(ERR_NOT_FOUND(name));
          process.exit(1);
        }
        const text = opts.prompt ?? (await promptInput("Enter prompt: "));
        if (!text.trim()) {
          console.log("No prompt provided. Aborting.");
          return;
        }
        entry.prompt = text.trim();
      } else {
        if (!(name in raw.workstreams)) {
          console.error(ERR_NOT_FOUND(name));
          process.exit(1);
        }
        const text = opts.prompt ?? (await promptInput("Enter prompt: "));
        if (!text.trim()) {
          console.log("No prompt provided. Aborting.");
          return;
        }
        if (raw.workstreams[name] == null) {
          raw.workstreams[name] = {};
        }
        raw.workstreams[name].prompt = text.trim();
      }

      await Bun.write("workstream.yaml", stringify(raw));
      console.log(`Updated prompt for "${name}".`);
    });
}
