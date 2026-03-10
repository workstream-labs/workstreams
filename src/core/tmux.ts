import { $ } from "bun";

// Dedicated tmux socket — isolates ws sessions from the user's tmux config
const L = ["-L", "ws"] as const;

export async function hasTmux(): Promise<boolean> {
  try {
    await $`which tmux`.quiet();
    return true;
  } catch {
    return false;
  }
}

export async function hasSession(name: string): Promise<boolean> {
  try {
    const proc = Bun.spawnSync(["tmux", ...L, "has-session", "-t", name]);
    return proc.exitCode === 0;
  } catch {
    return false;
  }
}

export async function createSession(name: string): Promise<void> {
  if (await hasSession(name)) return;
  Bun.spawnSync(["tmux", ...L, "new-session", "-d", "-s", name]);
}

export async function createWindow(
  session: string,
  name: string,
  cwd: string,
  cmd?: string,
): Promise<string> {
  const args = ["tmux", ...L, "new-window", "-t", session, "-n", name, "-c", cwd, "-P", "-F", "#{pane_id}"];
  if (cmd) args.push(cmd);
  const proc = Bun.spawnSync(args);
  return new TextDecoder().decode(proc.stdout).trim();
}

export async function sendPrompt(target: string, text: string): Promise<void> {
  Bun.spawnSync(["tmux", ...L, "send-keys", "-t", target, "-l", text]);
  Bun.spawnSync(["tmux", ...L, "send-keys", "-t", target, "Enter"]);
}

export async function isPaneDead(paneId: string): Promise<boolean> {
  try {
    const proc = Bun.spawnSync([
      "tmux", ...L, "list-panes", "-a",
      "-F", "#{pane_id}:#{pane_dead}",
      "-f", `#{==:#{pane_id},${paneId}}`,
    ]);
    const line = new TextDecoder().decode(proc.stdout).trim();
    if (!line) return true;
    return line.endsWith(":1");
  } catch {
    return true;
  }
}

export async function killWindow(target: string): Promise<void> {
  Bun.spawnSync(["tmux", ...L, "kill-window", "-t", target]);
}

export async function attachSession(target: string): Promise<void> {
  const proc = Bun.spawn(["tmux", ...L, "attach", "-t", target], {
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  await proc.exited;
}

export async function pipePaneToFile(paneId: string, filePath: string): Promise<void> {
  const escaped = filePath.replace(/'/g, "'\\''");
  Bun.spawnSync(["tmux", ...L, "pipe-pane", "-o", "-t", paneId, `cat >> '${escaped}'`]);
}

export async function selectWindow(session: string, windowName: string): Promise<void> {
  Bun.spawnSync(["tmux", ...L, "select-window", "-t", `${session}:${windowName}`]);
}

export async function killSession(name: string): Promise<void> {
  Bun.spawnSync(["tmux", ...L, "kill-session", "-t", name]);
}

export async function killServer(): Promise<void> {
  Bun.spawnSync(["tmux", ...L, "kill-server"]);
}

export async function getPaneIds(session: string): Promise<Map<string, string>> {
  try {
    const proc = Bun.spawnSync([
      "tmux", ...L, "list-windows", "-t", session,
      "-F", "#{window_name}:#{pane_id}",
    ]);
    const output = new TextDecoder().decode(proc.stdout).trim();
    const map = new Map<string, string>();
    for (const line of output.split("\n")) {
      if (!line) continue;
      const [name, id] = line.split(":");
      if (name && id) map.set(name, id);
    }
    return map;
  } catch {
    return new Map();
  }
}

export async function setOption(target: string, option: string, value: string): Promise<void> {
  Bun.spawnSync(["tmux", ...L, "set", "-t", target, option, value]);
}
