import { Command } from "commander";
import { loadState, saveState } from "../core/state";
import { parse, stringify } from "yaml";

export function mergeCommand() {
  return new Command("merge")
    .description("Merge workstream branch(es) into main")
    .argument("[name]", "workstream name (omit to merge all successful)")
    .argument("[into]", "target branch to merge into (default: current branch)")
    .option("--squash", "squash commits into a single commit")
    .option("--no-cleanup", "keep worktree and branch after merge")
    .action(async (name?: string, into?: string, opts?: { squash?: boolean; cleanup: boolean }) => {
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

      // Check for unresolved conflicts before doing anything
      const unmerged = (await $`git diff --name-only --diff-filter=U`.quiet()).stdout.toString().trim();
      if (unmerged) {
        const files = unmerged.split("\n");
        console.error(`\x1b[31mError: unresolved conflicts from a previous merge:\x1b[0m`);
        for (const f of files) console.error(`  ${f}`);
        console.error(`\n  Resolve them, then commit:`);
        console.error(`    git add ${files.join(" ")} && git commit`);
        console.error(`  Or abort the previous merge:`);
        console.error(`    git merge --abort`);
        process.exit(1);
      }

      // Get current branch; switch to target if specified
      const currentBranch = (await $`git rev-parse --abbrev-ref HEAD`.quiet()).stdout.toString().trim();
      const targetBranch = into ?? currentBranch;
      if (into && into !== currentBranch) {
        try {
          await $`git checkout ${into}`.quiet();
        } catch (e: any) {
          console.error(`Error: could not checkout "${into}": ${e.stderr?.toString() ?? e.message}`);
          process.exit(1);
        }
      }

      for (const n of names) {
        const branch = `ws/${n}`;
        console.log(`\x1b[34mMerging ${branch} into ${targetBranch}...\x1b[0m`);

        const mergeResult = opts?.squash
          ? await $`git merge --squash ${branch}`.nothrow()
          : await $`git merge ${branch} -m ${"ws: merge " + n}`.nothrow();

        if (mergeResult.exitCode !== 0) {
          const stderr = mergeResult.stderr.toString();
          if (stderr.includes("CONFLICT")) {
            console.error(`\x1b[31m✗ Merge conflict in ${n}\x1b[0m`);
            console.error(`  Resolve conflicts and run: git commit`);
            console.error(`  Or abort with: git merge --abort`);
            process.exit(1);
          }
          if (stderr.includes("untracked working tree files would be overwritten")) {
            const files = stderr
              .split("\n")
              .filter((l: string) => l.startsWith("\t"))
              .map((l: string) => l.trim());
            console.error(`\x1b[31m✗ Untracked files in ${targetBranch} would be overwritten:\x1b[0m`);
            for (const f of files) console.error(`  ${f}`);
            console.error(`\n  Commit or stash them first:`);
            console.error(`    git add ${files.join(" ")} && git commit -m "wip"`);
            console.error(`  Then retry: ws merge ${n}${into ? " " + into : ""}`);
            process.exit(1);
          }
          console.error(`\x1b[31m✗ Failed to merge ${n}: ${stderr || mergeResult.stdout.toString()}\x1b[0m`);
          process.exit(1);
        }

        if (opts?.squash) {
          await $`git commit -m ${"ws: " + n}`.quiet();
        }
        console.log(`\x1b[32m✓ Merged ${n}\x1b[0m`);

        // Cleanup worktree, branch, config entry, and state
        if (opts?.cleanup !== false) {
          const treePath = `.workstreams/trees/${n}`;
          await $`git worktree remove ${treePath} --force`.quiet().catch(() => {});
          await $`git branch -D ${branch}`.quiet().catch(() => {});

          // Remove from workstream.yaml
          const configFile = Bun.file("workstream.yaml");
          if (await configFile.exists()) {
            const raw = parse(await configFile.text());
            if (raw.workstreams && raw.workstreams[n] !== undefined) {
              delete raw.workstreams[n];
              await Bun.write("workstream.yaml", stringify(raw));
            }
          }

          // Remove from state
          if (state.currentRun?.workstreams[n]) {
            delete state.currentRun.workstreams[n];
            if (Object.keys(state.currentRun.workstreams).length === 0) {
              state.currentRun = undefined;
            }
            await saveState(state);
          }

          console.log(`  Cleaned up worktree and branch`);
        }
      }

      if (into && into !== currentBranch) {
        await $`git checkout ${currentBranch}`.quiet().catch(() => {});
      }
      console.log(`\nDone. ${names.length} workstream(s) merged into ${targetBranch}.`);
    });
}
