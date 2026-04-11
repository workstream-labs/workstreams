import { Command } from "commander";
import { resolve } from "path";
import { loadState, saveState, loadConfig, appendWorkstreamStatus } from "../../core";
import { WorktreeManager } from "../../core";
import { loadComments } from "../../core";
import { notifyStatus, buildBgArgs } from "../../core";
import { openIdeDashboard, type IdeDashboardOptions } from "../../ui/ide-dashboard.js";
import { openEditor, resolveEditor } from "./editors";
import { buildEntries } from "./entries";
import { ensureWorktree } from "./worktree";
import { actionOpenSession, actionSetPrompt, actionCreateWorkstream, dispatchAction } from "./actions";

export function dashboardCommand() {
  return new Command("dashboard")
    .description("Open the interactive TUI dashboard")
    .addHelpText("after", `
Examples:
  ws dashboard   Open the interactive dashboard

Dashboard keys: Enter=editor, d=diff, r=resume session, p=prompt agent,
  c=comments, /=search, ?=help, q=quit.
`)
    .action(async () => {
      const state = await loadState();
      if (!state) {
        console.error("Error: workstreams not initialized. Run `ws init` first.");
        process.exit(1);
      }

      const config = await loadConfig("workstream.yaml");

      // Dashboard loop: IDE dashboard handles logs/diff inline,
      // only exits for editor/run/session/prompt actions
      let loop = true;
      while (loop) {
        const freshState = await loadState() ?? state;
        const freshConfig = await loadConfig("workstream.yaml");
        const entries = await buildEntries(freshConfig, freshState);
        const wt = new WorktreeManager();
        const dashboardOpts: IdeDashboardOptions = {
          onRefresh: async () => {
            const s = await loadState() ?? state;
            const c = await loadConfig("workstream.yaml");
            return buildEntries(c, s);
          },
          getLogFile: (name: string) => {
            return freshState.currentRun?.workstreams?.[name]?.logFile ?? `.workstreams/logs/${name}.log`;
          },
          getWorkstreamStatus: (name: string) => {
            return freshState.currentRun?.workstreams?.[name]?.status ?? "ready";
          },
          getDiff: async (name: string) => {
            const [branchDiff, uncommittedDiff] = await Promise.all([
              wt.diffBranch(`ws/${name}`).catch(() => ""),
              wt.diff(name).catch(() => ""),
            ]);
            return branchDiff + uncommittedDiff;
          },
          onOpenEditor: async (name: string): Promise<boolean> => {
            const absPath = await ensureWorktree(name, freshState, freshConfig);
            const resolved = await resolveEditor(undefined, freshState.defaultEditor);
            if (!resolved) return false;
            if (!freshState.defaultEditor) {
              freshState.defaultEditor = resolved;
              await saveState(freshState);
            }
            await openEditor(absPath, resolved);
            return true;
          },
          onOpenSession: async (name: string): Promise<boolean> => {
            const s = await loadState() ?? freshState;
            const ws = s.currentRun?.workstreams?.[name];
            if (!ws) return false;
            return actionOpenSession(name, ws, s);
          },
          onCreateWorkstream: async (name: string): Promise<boolean> => {
            try {
              await actionCreateWorkstream(name);
              // Also create the worktree
              await ensureWorktree(name, freshState, freshConfig);
              return true;
            } catch {
              return false;
            }
          },
          onDestroy: async (name: string): Promise<boolean> => {
            try {
              const { parse, stringify } = await import("yaml");
              const { unlink } = await import("fs/promises");
              const wtm = new WorktreeManager();

              // Remove worktree and branch
              await wtm.remove(name);

              // Remove from workstream.yaml
              const configFile = Bun.file("workstream.yaml");
              if (await configFile.exists()) {
                const raw = parse(await configFile.text());
                if (raw.workstreams && raw.workstreams[name]) {
                  delete raw.workstreams[name];
                  await Bun.write("workstream.yaml", stringify(raw));
                }
              }

              // Delete log and comment files
              await unlink(`.workstreams/comments/${name}.json`).catch(() => {});
              await unlink(`.workstreams/logs/${name}.log`).catch(() => {});

              // Remove from state
              const s = await loadState();
              if (s?.currentRun?.workstreams?.[name]) {
                delete s.currentRun.workstreams[name];
                if (Object.keys(s.currentRun.workstreams).length === 0) {
                  s.currentRun = undefined;
                }
                await saveState(s);
              }
              return true;
            } catch {
              return false;
            }
          },
          onSendPrompt: async (name: string, prompt: string): Promise<boolean> => {
            // Load fresh state every time (dashboard stays open)
            const s = await loadState() ?? state;
            const ws = s.currentRun?.workstreams?.[name];

            // Don't send if agent is already active
            if (ws?.status === "running" || ws?.status === "queued") return false;

            const hasSession = !!ws?.sessionId;

            // Ensure run state exists
            if (!s.currentRun) {
              s.currentRun = {
                runId: `run-${Date.now()}`,
                startedAt: new Date().toISOString(),
                workstreams: {},
              };
            }
            if (!s.currentRun.workstreams[name]) {
              s.currentRun.workstreams[name] = {
                name,
                status: "queued" as const,
                branch: `ws/${name}`,
                worktreePath: `.workstreams/trees/${name}`,
                logFile: `.workstreams/logs/${name}.log`,
              };
            }

            s.currentRun.finishedAt = undefined;

            // Ensure worktree exists before spawning the agent — the
            // onCreateWorkstream callback is fire-and-forget so the auto-refresh
            // may expose the workstream before its worktree is ready.
            const cfg = await loadConfig("workstream.yaml");
            await ensureWorktree(name, s, cfg);

            if (hasSession) {
              // Resume: send only the user's prompt (comments are sent
              // separately via the explicit "resume with comments" action)
              const wsState = s.currentRun.workstreams[name];
              wsState.status = "running";
              wsState.startedAt = new Date().toISOString();
              wsState.finishedAt = undefined;
              wsState.exitCode = undefined;
              wsState.error = undefined;
              await appendWorkstreamStatus(wsState);
              await saveState(s);

              // Spawn background resume worker directly
              const bgArgs = buildBgArgs(["run", name, "-c", "workstream.yaml", "-p", prompt]);
              const proc = Bun.spawn(bgArgs, {
                cwd: process.cwd(),
                env: { ...process.env, WS_BACKGROUND: "1", WS_RESUME_MODE: "1" },
                stdin: "ignore",
                stdout: "ignore",
                stderr: "ignore",
              });
              proc.unref();
            } else {
              // Fresh run: save prompt to workstream.yaml, spawn executor directly
              await actionSetPrompt(name, prompt);

              const wsState = s.currentRun.workstreams[name];
              wsState.status = "queued";
              await appendWorkstreamStatus(wsState);
              await saveState(s);

              // Spawn background executor directly
              const bgArgs = buildBgArgs(["run", "-c", "workstream.yaml", name]);
              const proc = Bun.spawn(bgArgs, {
                cwd: process.cwd(),
                env: { ...process.env, WS_BACKGROUND: "1" },
                stdin: "ignore",
                stdout: "ignore",
                stderr: "ignore",
              });
              proc.unref();
            }
            return true;
          },
          onInterrupt: async (name: string) => {
            // Load fresh state to get current PID
            const s = await loadState();
            const ws = s?.currentRun?.workstreams?.[name];
            if (ws?.pid) {
              try { process.kill(ws.pid, "SIGINT"); } catch {}
              ws.status = "interrupted";
              ws.finishedAt = new Date().toISOString();
              ws.pid = undefined;
              await appendWorkstreamStatus(ws);
              await saveState(s!);
              // Append interrupted marker to log file so it shows in the log viewer
              const { appendFile, mkdir } = await import("fs/promises");
              const logFile = ws.logFile ?? `.workstreams/logs/${name}.log`;
              await mkdir(".workstreams/logs", { recursive: true }).catch(() => {});
              await appendFile(logFile, JSON.stringify({ type: "system", text: "Interrupted" }) + "\n").catch(() => {});
              notifyStatus(name, "interrupted");
            }
          },
        };
        const action = await openIdeDashboard(entries, dashboardOpts);
        loop = await dispatchAction(action, freshState, freshConfig);
      }
    });
}
