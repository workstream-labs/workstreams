import { $ } from "bun";
import { WorktreeError } from "./errors";

const TREES_DIR = ".workstreams/trees";

export class WorktreeManager {
  async create(name: string, baseBranch?: string): Promise<string> {
    const branch = `ws/${name}`;
    const path = `${TREES_DIR}/${name}`;
    const base = baseBranch ?? "HEAD";

    try {
      await $`git worktree add -b ${branch} ${path} ${base}`.quiet();
    } catch (e: any) {
      throw new WorktreeError(
        `Failed to create worktree for "${name}": ${e.stderr?.toString() ?? e.message}`
      );
    }
    return path;
  }

  async remove(name: string): Promise<void> {
    const path = `${TREES_DIR}/${name}`;
    const branch = `ws/${name}`;

    try {
      await $`git worktree remove ${path} --force`.quiet();
    } catch {
      // worktree may already be removed
    }
    try {
      await $`git branch -D ${branch}`.quiet();
    } catch {
      // branch may already be deleted
    }
  }

  async list(): Promise<Array<{ path: string; branch: string; head: string }>> {
    const result = await $`git worktree list --porcelain`.quiet();
    const output = result.stdout.toString();
    const entries: Array<{ path: string; branch: string; head: string }> = [];
    let current: Partial<{ path: string; branch: string; head: string }> = {};

    for (const line of output.split("\n")) {
      if (line.startsWith("worktree ")) {
        if (current.path) entries.push(current as any);
        current = { path: line.slice(9) };
      } else if (line.startsWith("HEAD ")) {
        current.head = line.slice(5);
      } else if (line.startsWith("branch ")) {
        current.branch = line.slice(7).replace("refs/heads/", "");
      }
    }
    if (current.path) entries.push(current as any);
    return entries;
  }

  async diff(name: string): Promise<string> {
    const path = `${TREES_DIR}/${name}`;
    const result = await $`git -C ${path} diff HEAD`.quiet();
    return result.stdout.toString();
  }

  async diffBranch(branch: string, baseBranch?: string): Promise<string> {
    const base = baseBranch ?? "HEAD";
    const result = await $`git diff ${base}...${branch}`.quiet();
    return result.stdout.toString();
  }
}
