import { Command } from "commander";
import { parse, stringify } from "yaml";

const ERR_NO_CONFIG = "Error: workstream.yaml not found. Run `ws init` first.";
const ERR_ALREADY_EXISTS = (name: string) => `Error: workstream "${name}" already exists`;
const MSG_ADDED = (name: string) => `Added workstream "${name}" to workstream.yaml`;

export function createCommand() {
  return new Command("create")
    .description("Add a new workstream to workstream.yaml")
    .argument("<name>", "workstream name")
    .requiredOption("-p, --prompt <text>", "prompt for the agent")
    .option("--plan-first", "pause for review after planning phase")
    .action(async (name: string, opts: { prompt: string; planFirst?: boolean }) => {
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
        prompt: opts.prompt,
        ...(opts.planFirst ? { plan_first: true } : {}),
      };

      await Bun.write("workstream.yaml", stringify(raw));
      console.log(MSG_ADDED(name));
    });
}
