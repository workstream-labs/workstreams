import { Command } from "commander";
import { loadState } from "../core/state";

export function initCommand() {
  return new Command("init")
    .description("Initialize workstreams in the current git repo")
    .action(async () => {
      const { $ } = await import("bun");

      // Check we're in a git repo
      try {
        await $`git rev-parse --git-dir`.quiet();
      } catch {
        console.error("Error: not a git repository");
        process.exit(1);
      }

      // Check not already initialized
      const existing = await loadState();
      if (existing) {
        console.error("Error: workstreams already initialized");
        process.exit(1);
      }

      // Create directories
      const { mkdir } = await import("fs/promises");
      await mkdir(".workstreams/trees", { recursive: true });
      await mkdir(".workstreams/logs", { recursive: true });

      // Init state
      const { saveState, defaultState } = await import("../core/state");
      const cwd = process.cwd();
      await saveState(defaultState(cwd));

      // Add .workstreams to .gitignore if not already there
      const gitignoreFile = Bun.file(".gitignore");
      let gitignore = "";
      if (await gitignoreFile.exists()) {
        gitignore = await gitignoreFile.text();
      }
      if (!gitignore.includes(".workstreams")) {
        gitignore += "\n.workstreams/\n";
        await Bun.write(".gitignore", gitignore);
      }

      // Create workstream.yaml if none exists
      const configFile = Bun.file("workstream.yaml");
      if (!(await configFile.exists())) {
        await Bun.write(
          "workstream.yaml",
          `agent:
  command: "claude"
  args: ["-p"]
  acceptAll: true
  timeout: 600

workstreams: {}
`
        );
      }

      console.log("Initialized workstreams in", cwd);
      console.log("  Created .workstreams/ directory");
      console.log("  Created workstream.yaml");
      console.log('Add workstreams with: ws create <name> "<prompt>"');
    });
}
