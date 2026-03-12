import { Command } from "commander";
import { loadConfig } from "../core/config";
import { loadState } from "../core/state";
import { getBranchInfo, getDiffStats } from "../ui/workstream-picker.js";
import { A, STATUS_STYLE, pad } from "../ui/ansi.js";
import { loadComments } from "../core/comments";

function formatDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  if (h < 24) return rm > 0 ? `${h}h${rm}m` : `${h}h`;
  const d = Math.floor(h / 24);
  return `${d}d`;
}

export async function listAction(configPath: string = "workstream.yaml") {
  const config = await loadConfig(configPath);
  const state = await loadState();
  const { stat } = await import("fs/promises");

  if (config.workstreams.length === 0) {
    console.log(`\n  ${A.dim}No workstreams defined.${A.reset} Add one with: ${A.cyan}ws create <name>${A.reset}\n`);
    return;
  }

  // Collect all row data first for dynamic column sizing
  interface RowData {
    status: string;
    name: string;
    prompt: string;
    sync: string; syncPlain: string;
    changes: string; changesPlain: string;
    duration: string;
    comments: string; commentsPlain: string;
    commit: string;
    hasWorktree: boolean;
  }

  const rows: RowData[] = [];

  for (const def of config.workstreams) {
    const branch = `ws/${def.name}`;
    const worktreePath = `.workstreams/trees/${def.name}`;
    const hasWorktree = await stat(worktreePath).then(() => true).catch(() => false);

    let status = "workspace";
    if (state?.currentRun?.workstreams?.[def.name]) {
      status = state.currentRun.workstreams[def.name].status;
    } else if (def.prompt) {
      status = "ready";
    }

    let durationStr = "";
    const ws = state?.currentRun?.workstreams?.[def.name];
    if (ws?.startedAt) {
      const start = new Date(ws.startedAt).getTime();
      const end = ws.finishedAt ? new Date(ws.finishedAt).getTime() : Date.now();
      durationStr = formatDuration(end - start);
    }

    const commentsData = await loadComments(def.name);
    const commentCount = commentsData.comments.length;
    const commentsStr = commentCount > 0
      ? `${A.brightYellow}${commentCount} comment${commentCount > 1 ? "s" : ""}${A.reset}`
      : "";
    const commentsPlain = commentCount > 0 ? `${commentCount} comment${commentCount > 1 ? "s" : ""}` : "";

    if (hasWorktree) {
      const [info, stats] = await Promise.all([
        getBranchInfo(branch),
        getDiffStats(branch),
      ]);

      const syncPlain = info.ahead || info.behind ? `↑${info.ahead} ↓${info.behind}` : "·";
      const syncColor = info.ahead || info.behind
        ? `${A.green}↑${info.ahead}${A.reset} ${A.red}↓${info.behind}${A.reset}`
        : `${A.dim}·${A.reset}`;

      const changesPlain = stats.filesChanged > 0 ? `+${stats.additions} −${stats.deletions}` : "";
      const changesColor = stats.filesChanged > 0
        ? `${A.brightGreen}+${stats.additions}${A.reset} ${A.brightRed}−${stats.deletions}${A.reset}`
        : "";

      const age = info.lastCommitAge ? `${info.lastCommitAge}` : "";
      const msg = info.lastCommitMsg
        ? (info.lastCommitMsg.length > 36 ? info.lastCommitMsg.slice(0, 33) + "…" : info.lastCommitMsg)
        : "";
      const commitStr = age && msg ? `${age} ${A.dim}·${A.reset} ${msg}` : age || msg;

      rows.push({
        status, name: def.name,
        prompt: def.prompt ?? "",
        sync: syncColor, syncPlain,
        changes: changesColor, changesPlain,
        duration: durationStr,
        comments: commentsStr, commentsPlain,
        commit: commitStr,
        hasWorktree: true,
      });
    } else {
      rows.push({
        status, name: def.name,
        prompt: def.prompt ?? "",
        sync: "", syncPlain: "",
        changes: "", changesPlain: "",
        duration: "",
        comments: commentsStr, commentsPlain,
        commit: def.prompt ? "" : `${A.dim}workspace${A.reset}`,
        hasWorktree: false,
      });
    }
  }

  // Dynamic column widths
  const nameW = Math.max(6, ...rows.map(r => r.name.length)) + 2;
  const syncW = Math.max(4, ...rows.map(r => r.syncPlain.length)) + 2;
  const changesW = Math.max(7, ...rows.map(r => r.changesPlain.length)) + 2;
  const durW = Math.max(4, ...rows.map(r => r.duration.length)) + 2;
  const commW = Math.max(0, ...rows.map(r => r.commentsPlain.length)) + 2;

  // Summary counts
  const total = rows.length;
  const succeeded = rows.filter(r => r.status === "success").length;
  const failed = rows.filter(r => r.status === "failed").length;
  const running = rows.filter(r => r.status === "running").length;
  const pending = rows.filter(r => r.status === "ready" || r.status === "queued").length;

  console.log("");

  // Rows
  for (const row of rows) {
    const st = STATUS_STYLE[row.status] ?? STATUS_STYLE.ready;

    const icon = `${st.color}${st.icon}${A.reset}`;
    const name = `${A.bold}${A.white}${row.name}${A.reset}`;
    const namePadded = pad(name, nameW);

    if (!row.hasWorktree) {
      const extra = row.commit ? `  ${row.commit}` : "";
      console.log(`  ${icon} ${namePadded}${A.dim}no worktree${A.reset}${extra}`);
      if (row.prompt) {
        const truncated = row.prompt.length > 60 ? row.prompt.slice(0, 57) + "…" : row.prompt;
        console.log(`      ${A.dim}${truncated}${A.reset}`);
      }
      continue;
    }

    const syncPadded = pad(row.sync || `${A.dim}·${A.reset}`, syncW);
    const changesPadded = row.changesPlain ? pad(row.changes, changesW) : " ".repeat(changesW);
    const durPadded = row.duration ? pad(`${A.dim}${row.duration}${A.reset}`, durW) : " ".repeat(durW);
    const commentsPadded = row.commentsPlain ? pad(row.comments, commW) : " ".repeat(commW);
    const commit = row.commit ? `${A.dim}${row.commit}${A.reset}` : "";

    console.log(`  ${icon} ${namePadded}${syncPadded}${changesPadded}${durPadded}${commentsPadded}${commit}`);
    if (row.prompt) {
      const truncated = row.prompt.length > 60 ? row.prompt.slice(0, 57) + "…" : row.prompt;
      console.log(`      ${A.dim}${truncated}${A.reset}`);
    }
  }

  // Footer summary
  const parts: string[] = [];
  if (succeeded) parts.push(`${A.green}${STATUS_STYLE.success.icon} ${succeeded} passed${A.reset}`);
  if (failed) parts.push(`${A.red}${STATUS_STYLE.failed.icon} ${failed} failed${A.reset}`);
  if (running) parts.push(`${A.brightYellow}${STATUS_STYLE.running.icon} ${running} running${A.reset}`);
  if (pending) parts.push(`${A.dim}${STATUS_STYLE.ready.icon} ${pending} ready${A.reset}`);

  if (parts.length > 0) {
    console.log("");
    console.log(`  ${parts.join(`${A.dim}  ·  ${A.reset}`)}`);
  }
  console.log("");
}

export function listCommand() {
  return new Command("list")
    .description("Show all workstreams with status, branch info, and diff stats")
    .option("-c, --config <path>", "config file path", "workstream.yaml")
    .addHelpText("after", `
Examples:
  ws list                Show status of all workstreams
  ws list -c custom.yaml Use a custom config file

Statuses: ready, queued, running, success, failed, workspace (no prompt).
`)
    .action(async (opts: { config: string }) => {
      await listAction(opts.config);
    });
}
