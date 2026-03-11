import { Command } from "commander";
import { parse, stringify } from "yaml";

const ERR_NO_CONFIG = "Error: workstream.yaml not found. Run `ws init` first.";
const ERR_ALREADY_EXISTS = (name: string) => `Error: workstream "${name}" already exists`;
const MSG_ADDED = (name: string) => `Added workstream "${name}" to workstream.yaml`;

export function createCommand() {
  return new Command("create")
    .description("Add a new workstream entry to workstream.yaml (does not run it)")
    .argument("<name>", "workstream name (used as branch suffix: ws/<name>)")
    .option("-p, --prompt <text>", "prompt for the agent")
    .addHelpText("after", `
Examples:
  ws create auth -p "Add JWT authentication"
  ws create sandbox              Create a prompt-less workspace (manual work only)
`)
    .action(async (name: string, opts: { prompt?: string }) => {
      const configFile = Bun.file("workstream.yaml");
      if (!(await configFile.exists())) {
        console.error(ERR_NO_CONFIG);
        process.exit(1);
      }

      const raw = parse(await configFile.text());
      if (!raw.workstreams) raw.workstreams = {};

      if (raw.workstreams[name]) {
        console.error(ERR_ALREADY_EXISTS(name));
        process.exit(1);
      }

      raw.workstreams[name] = {
        ...(opts.prompt ? { prompt: opts.prompt } : {}),
      };

      await Bun.write("workstream.yaml", stringify(raw));
      if (opts.prompt) {
        console.log(MSG_ADDED(name));
      } else {
        console.log(`Added workspace "${name}" to workstream.yaml (no prompt — use \`ws switch ${name}\` to work in it)`);
      }
    });
}
