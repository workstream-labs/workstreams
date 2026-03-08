import type { ProjectState } from "./types";

const STATE_FILE = ".workstreams/state.json";

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
  return file.json();
}

export async function saveState(state: ProjectState): Promise<void> {
  await Bun.write(STATE_FILE, JSON.stringify(state, null, 2));
}
