import { homedir } from "os";
import { join } from "path";
import { readdir } from "fs/promises";

// ─── Structured message types for display ───────────────────────────────────

export type DisplayMessage =
  | { role: "user"; text: string; ts?: string }
  | { role: "assistant"; parts: AssistantPart[]; model?: string; durationMs?: number; ts?: string }
  | { role: "result"; cost?: number; duration?: number; model?: string }
  | { role: "system"; text: string };

export type AssistantPart =
  | { type: "text"; text: string }
  | { type: "thinking"; text: string }
  | { type: "tool"; id: string; name: string; input: Record<string, any>; result?: string };

/**
 * Find the JSONL file for a session ID by searching ~/.claude/projects/.
 */
export async function findSessionJsonl(sessionId: string): Promise<string | null> {
  const projectsDir = join(homedir(), ".claude", "projects");
  let projectDirs: string[];
  try { projectDirs = await readdir(projectsDir); }
  catch { return null; }
  for (const dir of projectDirs) {
    const candidate = join(projectsDir, dir, `${sessionId}.jsonl`);
    if (await Bun.file(candidate).exists()) return candidate;
  }
  return null;
}

/**
 * Parse a JSONL file into structured display messages.
 */
export async function parseSessionJsonl(filePath: string): Promise<DisplayMessage[]> {
  return parseSessionJsonlContent(await Bun.file(filePath).text());
}

/**
 * Parse raw JSONL/stream-json content into structured display messages.
 * Handles both Claude's internal JSONL format and the stream-json output format.
 * Two-pass: first collect tool results, then build messages.
 */
export function parseSessionJsonlContent(raw: string): DisplayMessage[] {
  const lines = raw.split("\n");
  const parsed: any[] = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    try { parsed.push(JSON.parse(line)); }
    catch { /* skip malformed */ }
  }

  // ─── Pass 1: collect tool results by tool_use_id ──────────────────────────

  const toolResults = new Map<string, string>();

  for (const entry of parsed) {
    // Standard format: user message with tool_result content blocks
    if (entry.type === "user") {
      const content = entry.message?.content;
      if (!Array.isArray(content)) continue;
      for (const block of content) {
        if (block.type !== "tool_result") continue;
        const id = block.tool_use_id;
        if (!id) continue;
        const result = block.content;
        if (typeof result === "string") {
          toolResults.set(id, result);
        } else if (Array.isArray(result)) {
          const texts = result.filter((r: any) => r.type === "text" && r.text).map((r: any) => r.text);
          toolResults.set(id, texts.join("\n") || JSON.stringify(result));
        } else if (result != null) {
          toolResults.set(id, JSON.stringify(result));
        }
      }
    }

    // Stream-json format: tool_result events at top level
    if (entry.type === "tool_result") {
      const id = entry.tool_use_id;
      const content = entry.content;
      if (id) {
        if (typeof content === "string") toolResults.set(id, content);
        else if (content != null) toolResults.set(id, JSON.stringify(content));
      }
    }
  }

  // ─── Pass 2: build DisplayMessage array ───────────────────────────────────

  const messages: DisplayMessage[] = [];
  const assistantMsgIndex = new Map<string, number>();
  let pendingDurationMs: number | undefined;

  const flushDuration = () => {
    if (pendingDurationMs === undefined) return;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "assistant") {
        (messages[i] as any).durationMs = pendingDurationMs;
        break;
      }
    }
    pendingDurationMs = undefined;
  };

  for (const entry of parsed) {
    if (entry.isSidechain) continue;

    switch (entry.type) {
      case "user": {
        flushDuration();
        const content = entry.message?.content;
        if (typeof content === "string") {
          messages.push({ role: "user", text: content, ts: entry.timestamp });
          break;
        }
        if (!Array.isArray(content)) break;
        if (content.some((b: any) => b.type === "tool_result")) break; // skip synthetic
        const texts = content.filter((b: any) => b.type === "text" && b.text).map((b: any) => b.text);
        if (texts.length > 0) messages.push({ role: "user", text: texts.join("\n"), ts: entry.timestamp });
        break;
      }

      case "assistant": {
        const msg = entry.message;
        const content = msg?.content;
        if (!Array.isArray(content)) break;

        const msgId: string | undefined = msg?.id;
        const parts: AssistantPart[] = [];
        for (const block of content) {
          if (block.type === "text" && block.text)
            parts.push({ type: "text", text: block.text });
          else if (block.type === "thinking" && block.thinking)
            parts.push({ type: "thinking", text: block.thinking });
          else if (block.type === "tool_use") {
            const part: AssistantPart = {
              type: "tool", id: block.id ?? "", name: block.name ?? "unknown", input: block.input ?? {},
            };
            const result = toolResults.get(block.id);
            if (result !== undefined) part.result = result;
            parts.push(part);
          }
        }
        if (parts.length === 0) break;
        const model = msg?.model as string | undefined;

        // Merge parts into existing entry for same message ID (streaming sends
        // thinking first, then text/tools in separate events with the same id).
        if (msgId && assistantMsgIndex.has(msgId)) {
          const idx = assistantMsgIndex.get(msgId)!;
          const existing = messages[idx] as Extract<DisplayMessage, { role: "assistant" }>;
          // Keep thinking parts from earlier, add new non-thinking parts
          const existingThinking = existing.parts.filter(p => p.type === "thinking");
          const newNonThinking = parts.filter(p => p.type !== "thinking");
          const newThinking = parts.filter(p => p.type === "thinking");
          const mergedThinking = newThinking.length > 0 ? newThinking : existingThinking;
          messages[idx] = { role: "assistant", parts: [...mergedThinking, ...newNonThinking], model: model ?? existing.model, ts: entry.timestamp };
        } else {
          if (msgId) assistantMsgIndex.set(msgId, messages.length);
          messages.push({ role: "assistant", parts, model, ts: entry.timestamp });
        }
        break;
      }

      case "result": {
        flushDuration();
        // Handle both JSONL format (costUSD/durationMs) and stream-json format (total_cost_usd/duration_ms)
        messages.push({
          role: "result",
          cost: entry.total_cost_usd ?? entry.costUSD,
          duration: entry.duration_ms ?? entry.durationMs,
          model: entry.model,
        });
        break;
      }

      case "system": {
        if (entry.subtype === "turn_duration" && (entry.durationMs || entry.duration_ms)) {
          pendingDurationMs = entry.durationMs ?? entry.duration_ms;
        } else if (entry.text) {
          messages.push({ role: "system", text: entry.text });
        }
        break;
      }

      default: break;
    }
  }

  flushDuration();
  return messages;
}
