export type LineType = "context" | "add" | "del" | "hunk" | "binary";

export interface DiffLine {
  type: LineType;
  content: string;
  oldNum?: number;
  newNum?: number;
}

export interface Hunk {
  header: string;
  oldStart: number;
  newStart: number;
  lines: DiffLine[];
}

export type FileStatus = "M" | "A" | "D" | "R" | "?";

export interface FileDiff {
  path: string;
  oldPath?: string;
  status: FileStatus;
  binary: boolean;
  hunks: Hunk[];
}

export interface ParsedDiff {
  files: FileDiff[];
}

export function parseDiff(raw: string): ParsedDiff {
  const lines = raw.split("\n");
  const files: FileDiff[] = [];
  let current: FileDiff | null = null;
  let currentHunk: Hunk | null = null;
  let oldNum = 0;
  let newNum = 0;

  const pushHunk = () => {
    if (currentHunk && current) {
      current.hunks.push(currentHunk);
      currentHunk = null;
    }
  };

  const pushFile = () => {
    pushHunk();
    if (current) files.push(current);
    current = null;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // New file header
    if (line.startsWith("diff --git ")) {
      pushFile();
      // Extract paths from "diff --git a/foo b/foo"
      const m = line.match(/^diff --git a\/(.*) b\/(.*)$/);
      const path = m ? m[2] : line.slice(11);
      const oldPath = m ? m[1] : undefined;
      current = { path, oldPath, status: "M", binary: false, hunks: [] };
      continue;
    }

    if (!current) continue;

    if (line.startsWith("new file mode")) {
      current.status = "A";
      continue;
    }
    if (line.startsWith("deleted file mode")) {
      current.status = "D";
      continue;
    }
    if (line.startsWith("rename from ")) {
      current.status = "R";
      current.oldPath = line.slice(12);
      continue;
    }
    if (line.startsWith("rename to ")) {
      current.path = line.slice(10);
      continue;
    }
    if (line.startsWith("Binary files")) {
      current.binary = true;
      continue;
    }

    // Hunk header: @@ -oldStart,oldCount +newStart,newCount @@
    if (line.startsWith("@@")) {
      pushHunk();
      const m = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      oldNum = m ? parseInt(m[1], 10) : 1;
      newNum = m ? parseInt(m[2], 10) : 1;
      currentHunk = { header: line, oldStart: oldNum, newStart: newNum, lines: [] };
      continue;
    }

    // Skip index/--- /+++ lines (file header metadata)
    if (
      line.startsWith("index ") ||
      line.startsWith("--- ") ||
      line.startsWith("+++ ")
    ) {
      continue;
    }

    if (!currentHunk) continue;

    if (line.startsWith("+")) {
      currentHunk.lines.push({ type: "add", content: line.slice(1), newNum: newNum++ });
    } else if (line.startsWith("-")) {
      currentHunk.lines.push({ type: "del", content: line.slice(1), oldNum: oldNum++ });
    } else {
      // context (starts with " " or is empty at end of hunk)
      currentHunk.lines.push({
        type: "context",
        content: line.startsWith(" ") ? line.slice(1) : line,
        oldNum: oldNum++,
        newNum: newNum++,
      });
    }
  }

  pushFile();
  return { files };
}

/** Total +/- line counts for a file */
export function fileStat(file: FileDiff): { added: number; deleted: number } {
  let added = 0;
  let deleted = 0;
  for (const hunk of file.hunks) {
    for (const line of hunk.lines) {
      if (line.type === "add") added++;
      else if (line.type === "del") deleted++;
    }
  }
  return { added, deleted };
}
