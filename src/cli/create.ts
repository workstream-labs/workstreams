import { Command } from "commander";
import { parse, stringify } from "yaml";
import { WorktreeManager } from "../core/worktree";
import { validateWorkstreamName } from "../core/config";
import { loadState, saveState, appendWorkstreamStatus } from "../core/state";

const ERR_NO_CONFIG = "Error: workstream.yaml not found. Run `ws init` first.";
const ERR_ALREADY_EXISTS = (name: string) => `Error: workstream "${name}" already exists`;

export function createCommand() {
  return new Command("create")
    .description("Add a new workstream and create its worktree")
    .argument("<name>", "workstream name (used as branch suffix: ws/<name>)")
    .option("-p, --prompt <text>", "prompt for the agent")
    .option("-b, --base <branch>", "base branch (defaults to HEAD)")
    .addHelpText("after", `
Examples:
  ws create auth -p "Add JWT authentication"
  ws create sandbox              Create a prompt-less workspace (manual work only)
`)
    .action(async (name: string, opts: { prompt?: string; base?: string }) => {
      const nameError = validateWorkstreamName(name);
      if (nameError) {
        console.error(`Error: ${nameError}`);
        process.exit(1);
      }

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

      // Add to workstream.yaml
      raw.workstreams[name] = {
        ...(opts.prompt ? { prompt: opts.prompt } : {}),
        ...(opts.base ? { base_branch: opts.base } : {}),
      };
      await Bun.write("workstream.yaml", stringify(raw));

      // Create worktree
      const wt = new WorktreeManager();
      await wt.create(name, opts.base);

      // Update state
      const state = await loadState();
      if (state) {
        if (!state.currentRun) {
          state.currentRun = {
            runId: `run-${Date.now()}`,
            startedAt: new Date().toISOString(),
            workstreams: {},
          };
        }
        if (!state.currentRun.workstreams[name]) {
          state.currentRun.workstreams[name] = {
            name,
            status: "ready" as any,
            branch: `ws/${name}`,
            worktreePath: `.workstreams/trees/${name}`,
            logFile: `.workstreams/logs/${name}.log`,
          };
        }
        await appendWorkstreamStatus(state.currentRun.workstreams[name]);
        await saveState(state);
      }

      console.log(`Created workstream "${name}" on branch ws/${name}`);
      console.log(`  Worktree: .workstreams/trees/${name}`);
    });
}
