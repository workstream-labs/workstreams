import { $ } from "bun";
import { unlink } from "fs/promises";

const SESSION = "ws";

export async function hasTmux(): Promise<boolean> {
  try {
    await $`which tmux`.quiet();
    return true;
  } catch {
    return false;
  }
}

export async function hasSession(name: string = SESSION): Promise<boolean> {
  try {
    await $`tmux has-session -t ${name}`.quiet();
    return true;
  } catch {
    return false;
  }
}

export async function createSession(name: string = SESSION): Promise<void> {
  if (await hasSession(name)) return;
  await $`tmux new-session -d -s ${name}`.quiet();
}

export async function createWindow(
  session: string,
  name: string,
  cwd: string,
  cmd?: string,
): Promise<string> {
  const spawnArgs = ["tmux", "new-window", "-t", session, "-n", name, "-c", cwd, "-P", "-F", "#{pane_id}"];
  if (cmd) spawnArgs.push(cmd);
  const proc = Bun.spawnSync(spawnArgs);
  return new TextDecoder().decode(proc.stdout).trim();
}

export async function sendPrompt(target: string, text: string): Promise<void> {
  const tmpFile = `/tmp/ws-prompt-${Date.now()}.txt`;
  await Bun.write(tmpFile, text);
  try {
    await $`tmux load-buffer ${tmpFile}`.quiet();
    await $`tmux paste-buffer -t ${target}`.quiet();
    await $`tmux send-keys -t ${target} Enter`.quiet();
  } finally {
    await unlink(tmpFile).catch(() => {});
  }
}

export async function joinPane(
  paneId: string,
  target: string,
  sizePercent: number,
): Promise<void> {
  await $`tmux join-pane -s ${paneId} -t ${target} -h -l ${sizePercent}%`.quiet();
}

export async function breakPane(paneId: string): Promise<void> {
  try {
    await $`tmux break-pane -d -s ${paneId}`.quiet();
  } catch {
    // Pane may already be in its own window
  }
}

export async function respawnPane(target: string, cwd: string, cmd: string): Promise<void> {
  Bun.spawnSync(["tmux", "respawn-pane", "-k", "-t", target, "-c", cwd, cmd]);
}

export async function isPaneDead(paneId: string): Promise<boolean> {
  try {
    const result = await $`tmux list-panes -a -F #{pane_id}:#{pane_dead} -f #{==:#{pane_id},${paneId}}`.quiet();
    const line = result.stdout.toString().trim();
    if (!line) return true; // pane not found = destroyed
    return line.endsWith(":1");
  } catch {
    return true;
  }
}

export async function selectPaneRight(): Promise<void> {
  await $`tmux select-pane -R`.quiet();
}

export async function selectPaneLeft(): Promise<void> {
  await $`tmux select-pane -L`.quiet();
}

export async function killWindow(target: string): Promise<void> {
  try {
    await $`tmux kill-window -t ${target}`.quiet();
  } catch {}
}

export async function splitWindow(
  target: string,
  sizePercent: number,
  cmd: string,
): Promise<string> {
  const result =
    await $`tmux split-window -h -l ${sizePercent}% -t ${target} -P -F #{pane_id} ${cmd}`.quiet();
  return result.stdout.toString().trim();
}

export async function attachSession(target: string): Promise<void> {
  const proc = Bun.spawn(["tmux", "attach", "-t", target], {
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  await proc.exited;
}

export async function getPaneIds(session: string = SESSION): Promise<Map<string, string>> {
  try {
    const result = await $`tmux list-windows -t ${session} -F #{window_name}:#{pane_id}`.quiet();
    const map = new Map<string, string>();
    for (const line of result.stdout.toString().trim().split("\n")) {
      if (!line) continue;
      const [name, id] = line.split(":");
      if (name && id) map.set(name, id);
    }
    return map;
  } catch {
    return new Map();
  }
}
