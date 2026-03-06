import { Command } from "commander";
import { loadState } from "../core/state";

export function mergeCommand() {
  return new Command("merge")
    .description("Merge workstream branch(es) into main")
    .argument("[name]", "workstream name (omit to merge all successful)")
    .option("--squash", "squash commits into a single commit")
    .option("--no-cleanup", "keep worktree and branch after merge")
    .action(async (name?: string, opts?: { squash?: boolean; cleanup: boolean }) => {
      const { $ } = await import("bun");

      const state = await loadState();
      if (!state?.currentRun) {
        console.error("Error: no active run");
        process.exit(1);
      }

      // Determine which workstreams to merge
      const names = name
        ? [name]
        : Object.entries(state.currentRun.workstreams)
            .filter(([, ws]) => ws.status === "success")
            .map(([n]) => n);

      if (names.length === 0) {
        console.log("No successful workstreams to merge.");
        return;
      }

      // Validate all requested workstreams exist
      for (const n of names) {
        const ws = state.currentRun.workstreams[n];
        if (!ws) {
          console.error(`Error: workstream "${n}" not found`);
          process.exit(1);
        }
        if (name && ws.status !== "success") {
          console.log(`Warning: "${n}" status is "${ws.status}", proceeding anyway`);
        }
      }

      // Get current branch to return to after merging
      const currentBranch = (await $`git rev-parse --abbrev-ref HEAD`.quiet()).stdout.toString().trim();

      for (const n of names) {
        const branch = `ws/${n}`;
        console.log(`\x1b[34mMerging ${branch} into ${currentBranch}...\x1b[0m`);

        try {
          if (opts?.squash) {
            await $`git merge --squash ${branch}`.quiet();
            await $`git commit -m ${"ws: " + n}`.quiet();
          } else {
            await $`git merge ${branch} -m ${"ws: merge " + n}`.quiet();
          }
          console.log(`\x1b[32m✓ Merged ${n}\x1b[0m`);

          // Cleanup worktree and branch
          if (opts?.cleanup !== false) {
            const treePath = `.workstreams/trees/${n}`;
            await $`git worktree remove ${treePath} --force`.quiet().catch(() => {});
            await $`git branch -D ${branch}`.quiet().catch(() => {});
            console.log(`  Cleaned up worktree and branch`);
          }
        } catch (e: any) {
          const stderr = e.stderr?.toString() ?? e.message;
          if (stderr.includes("CONFLICT")) {
            console.error(`\x1b[31m✗ Merge conflict in ${n}\x1b[0m`);
            console.error(`  Resolve conflicts and run: git commit`);
            console.error(`  Or abort with: git merge --abort`);
            process.exit(1);
          }
          console.error(`\x1b[31m✗ Failed to merge ${n}: ${stderr}\x1b[0m`);
          process.exit(1);
        }
      }

      console.log(`\nDone. ${names.length} workstream(s) merged into ${currentBranch}.`);
    });
}
