import { mkdir, readFile, writeFile, unlink } from "fs/promises";
import { dirname } from "path";

const COMMENTS_DIR = ".workstreams/comments";

export interface ReviewComment {
  filePath: string;
  line?: number;
  side?: "old" | "new";
  lineType?: "add" | "remove" | "context";
  lineContent?: string;
  diffContext?: string;
  text: string;
  createdAt: string;
}

export interface WorkstreamComments {
  workstream: string;
  comments: ReviewComment[];
  updatedAt: string;
}

function commentsPath(name: string): string {
  return `${COMMENTS_DIR}/${name}.json`;
}

export async function loadComments(name: string): Promise<WorkstreamComments> {
  const path = commentsPath(name);
  try {
    const data = await readFile(path, "utf-8");
    return JSON.parse(data);
  } catch {
    return { workstream: name, comments: [], updatedAt: new Date().toISOString() };
  }
}

export async function saveComments(data: WorkstreamComments): Promise<void> {
  const path = commentsPath(data.workstream);
  await mkdir(dirname(path), { recursive: true });
  data.updatedAt = new Date().toISOString();
  await writeFile(path, JSON.stringify(data, null, 2));
}

export async function clearComments(name: string): Promise<void> {
  try {
    await unlink(commentsPath(name));
  } catch {}
}

export async function deleteComment(name: string, index: number): Promise<WorkstreamComments> {
  const data = await loadComments(name);
  data.comments.splice(index, 1);
  data.updatedAt = new Date().toISOString();
  await saveComments(data);
  return data;
}

export function formatCommentsAsPrompt(data: WorkstreamComments): string {
  if (data.comments.length === 0) return "";

  const sections = data.comments.map((c, i) => {
    const typeLabel = c.lineType === "add" ? "added" : c.lineType === "remove" ? "removed" : "unchanged";
    const loc = c.line
      ? `${c.filePath}:${c.line} (${typeLabel} line, ${c.side ?? "new"} side)`
      : c.filePath;

    const parts = [`### Comment ${i + 1}: ${loc}`, c.text];

    if (c.diffContext) {
      parts.push("Surrounding diff context:");
      parts.push("```diff", c.diffContext, "```");
    } else if (c.lineContent) {
      parts.push(`Line: \`${c.lineContent}\``);
    }

    return parts.join("\n");
  });

  return [
    "I have the following review comments on the changes you made. Each comment includes the file, line number, whether the line was added/removed/unchanged, and the surrounding diff for context.",
    "",
    ...sections,
    "",
    "Please address each comment. Use the diff context to understand what changed and apply the fix to the correct location in the current working tree.",
  ].join("\n");
}
