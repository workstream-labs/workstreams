import type { ProjectState, WorkstreamState } from "./types";
import { writeFileSync, mkdirSync, appendFileSync } from "fs";

const STATE_FILE = ".workstreams/state.json";
const WS_STATE_MARKER = "[WS:STATE] ";

export function defaultState(rootDir: string): ProjectState {
  return {
    initialized: true,
    rootDir,
    history: [],
  };
}

export async function loadState(): Promise<ProjectState | null> {
  const file = Bun.file(STATE_FILE);
  if (!(await file.exists())) return null;
  const state: ProjectState = await file.json();
  // Hydrate workstreams from log-based state markers
  if (state.currentRun) {
    const wsStates = await loadAllWorkstreamStates();
    state.currentRun.workstreams = { ...state.currentRun.workstreams, ...wsStates };
  }
  return state;
}

export async function saveState(state: ProjectState): Promise<void> {
  const toSave = { ...state };
  if (toSave.currentRun) {
    toSave.currentRun = { ...toSave.currentRun, workstreams: {} };
  }
  await Bun.write(STATE_FILE, JSON.stringify(toSave, null, 2));
}

/** Synchronous save for signal handlers where we can't await */
export function saveStateSync(state: ProjectState): void {
  const toSave = { ...state };
  if (toSave.currentRun) {
    toSave.currentRun = { ...toSave.currentRun, workstreams: {} };
  }
  writeFileSync(STATE_FILE, JSON.stringify(toSave, null, 2));
}

export async function updateState(
  mutate: (state: ProjectState) => void | Promise<void>,
): Promise<ProjectState> {
  const state = await loadState();
  if (!state) throw new Error("State file not found");
  await mutate(state);
  await saveState(state);
  return state;
}

// ─── Per-workstream state via log markers (race-free, append-only) ───────────

export async function appendWorkstreamStatus(ws: WorkstreamState): Promise<void> {
  const { appendFile, mkdir } = await import("fs/promises");
  await mkdir(".workstreams/logs", { recursive: true });
  await appendFile(ws.logFile, `${WS_STATE_MARKER}${JSON.stringify(ws)}\n`);
}

export function appendWorkstreamStatusSync(ws: WorkstreamState): void {
  mkdirSync(".workstreams/logs", { recursive: true });
  appendFileSync(ws.logFile, `${WS_STATE_MARKER}${JSON.stringify(ws)}\n`);
}

export async function readWorkstreamState(name: string): Promise<WorkstreamState | null> {
  const logFile = `.workstreams/logs/${name}.log`;
  const file = Bun.file(logFile);
  if (!(await file.exists())) return null;
  const content = await file.text();
  const lines = content.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].startsWith(WS_STATE_MARKER)) {
      try {
        return JSON.parse(lines[i].slice(WS_STATE_MARKER.length));
      } catch {
        // Partial write — skip corrupt line and keep scanning
      }
    }
  }
  return null;
}

export async function loadAllWorkstreamStates(): Promise<Record<string, WorkstreamState>> {
  const { readdir } = await import("fs/promises");
  const result: Record<string, WorkstreamState> = {};
  try {
    const files = await readdir(".workstreams/logs");
    for (const f of files) {
      if (!f.endsWith(".log")) continue;
      const name = f.slice(0, -4);
      try {
        const ws = await readWorkstreamState(name);
        if (ws) result[ws.name] = ws;
      } catch {}
    }
  } catch {}
  return result;
}
