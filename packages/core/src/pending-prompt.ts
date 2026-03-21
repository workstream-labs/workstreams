import { mkdir, readFile, writeFile, unlink } from "fs/promises";
import { dirname } from "path";

const PROMPTS_DIR = ".workstreams/prompts";

function promptPath(name: string): string {
  return `${PROMPTS_DIR}/${name}.txt`;
}

export async function loadPendingPrompt(name: string): Promise<string | null> {
  try {
    const text = await readFile(promptPath(name), "utf-8");
    const trimmed = text.trim();
    return trimmed || null;
  } catch {
    return null;
  }
}

export async function savePendingPrompt(name: string, text: string): Promise<void> {
  const path = promptPath(name);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, text);
}

export async function clearPendingPrompt(name: string): Promise<void> {
  try {
    await unlink(promptPath(name));
  } catch {}
}
