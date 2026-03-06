import { mkdir, readFile, writeFile, unlink } from "fs/promises";
import { dirname } from "path";

const COMMENTS_DIR = ".workstreams/comments";

export interface ReviewComment {
  filePath: string;
  line?: number;
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

export function formatCommentsAsPrompt(data: WorkstreamComments): string {
  if (data.comments.length === 0) return "";

  const lines = data.comments.map((c) => {
    const loc = c.line ? `${c.filePath}:${c.line}` : c.filePath;
    return `- **${loc}**: ${c.text}`;
  });

  return [
    "I have the following review comments on the changes you made:",
    ...lines,
    "",
    "Please address each comment and make the necessary changes.",
  ].join("\n");
}
