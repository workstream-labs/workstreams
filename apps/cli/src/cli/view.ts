import { Command } from "commander";
import { loadState, saveState } from "@workstreams/core";
import { loadConfig } from "@workstreams/core";
import { EDITORS, openEditor, resolveEditor, ensureWorktree } from "./dashboard";

export function viewCommand() {
  return new Command("view")
    .description("Open a workstream in your editor or print its worktree path")
    .argument("<name>", "workstream name")
    .option("-e, --editor <editor>", "open in a specific editor (e.g. code, cursor, zed)")
    .option("--no-editor", "print the worktree path without opening an editor")
    .addHelpText("after", `
Examples:
  ws view auth-feature     Open "auth-feature" in your default editor
  ws view auth -e cursor   Open in Cursor specifically
  ws view auth --no-editor Just print the worktree path
`)
    .action(async (name: string, opts: { editor?: string; editor_?: boolean }) => {
      const noEditor = opts.editor_ === false;

      const state = await loadState();
      if (!state) {
        console.error("Error: workstreams not initialized. Run `ws init` first.");
        process.exit(1);
      }

      const config = await loadConfig("workstream.yaml");

      const def = config.workstreams.find((w) => w.name === name);
      if (!def) {
        console.error(`Error: workstream "${name}" not found in workstream.yaml`);
        process.exit(1);
      }

      const absPath = await ensureWorktree(name, state, config);

      if (noEditor) {
        console.log(absPath);
        return;
      }

      const resolved = await resolveEditor(opts.editor, state.defaultEditor);
      if (!resolved) {
        console.log(`No editor found. Set $EDITOR or install one of: ${Object.keys(EDITORS).join(", ")}`);
        console.log(`  Worktree path: ${absPath}`);
        return;
      }

      if (!opts.editor && !state.defaultEditor) {
        state.defaultEditor = resolved;
        await saveState(state);
      }

      const label = EDITORS[resolved]?.label ?? resolved;
      console.log(`Opening ${name} in ${label}...`);
      await openEditor(absPath, resolved);
    });
}
