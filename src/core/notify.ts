import type { WorkstreamStatus } from "./types";

const STATUS_ICONS: Record<string, string> = {
  success: "✓",
  failed: "✗",
  interrupted: "■",
  running: "▶",
};

export function notify(title: string, message: string): void {
  try {
    const escaped = message.replace(/"/g, '\\"');
    const escapedTitle = title.replace(/"/g, '\\"');
    Bun.spawn(
      ["osascript", "-e", `display notification "${escaped}" with title "${escapedTitle}"`],
      { stdio: ["ignore", "ignore", "ignore"] },
    );
  } catch {}
}

export function notifyStatus(name: string, status: WorkstreamStatus): void {
  const icon = STATUS_ICONS[status] ?? status;
  const message = status === "success"
    ? `${icon} ${name} completed successfully`
    : status === "failed"
      ? `${icon} ${name} failed`
      : status === "interrupted"
        ? `${icon} ${name} was interrupted`
        : `${icon} ${name} is ${status}`;
  notify("ws", message);
}

export function notifyRunComplete(results: Record<string, WorkstreamStatus>): void {
  const entries = Object.values(results);
  const succeeded = entries.filter(s => s === "success").length;
  const failed = entries.filter(s => s === "failed").length;

  const parts: string[] = [];
  if (succeeded > 0) parts.push(`${succeeded} succeeded`);
  if (failed > 0) parts.push(`${failed} failed`);

  notify("ws", `Run complete: ${parts.join(", ")}`);
}
