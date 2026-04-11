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
  return { files: splitFileChunks(raw.split("\n")).map(parseFileDiff) };
}

/** Split raw lines at each "diff --git" boundary into per-file chunks. */
function splitFileChunks(lines: string[]): string[][] {
  const chunks: string[][] = [];
  let chunk: string[] = [];
  for (const line of lines) {
    if (line.startsWith("diff --git ")) {
      if (chunk.length > 0) chunks.push(chunk);
      chunk = [];
    }
    chunk.push(line);
  }
  // Only push the final chunk if it started with a diff header
  if (chunk.length > 0 && chunk[0].startsWith("diff --git ")) chunks.push(chunk);
  return chunks;
}

/** Parse a single file's chunk of diff lines into a FileDiff. */
function parseFileDiff(lines: string[]): FileDiff {
  const file: FileDiff = { path: "", status: "M", binary: false, hunks: [] };

  // First line is always "diff --git a/... b/..."
  const m = lines[0].match(/^diff --git a\/(.*) b\/(.*)$/);
  file.path = m ? m[2] : lines[0].slice(11);
  file.oldPath = m ? m[1] : undefined;

  // Find where hunks start (first @@ line)
  let hunkStart = lines.findIndex((l) => l.startsWith("@@"));
  if (hunkStart === -1) hunkStart = lines.length;

  // Parse header metadata (everything between "diff --git" and first @@)
  for (let i = 1; i < hunkStart; i++) {
    const line = lines[i];
    if (line.startsWith("new file mode")) file.status = "A";
    else if (line.startsWith("deleted file mode")) file.status = "D";
    else if (line.startsWith("rename from ")) { file.status = "R"; file.oldPath = line.slice(12); }
    else if (line.startsWith("rename to ")) file.path = line.slice(10);
    else if (line.startsWith("Binary files")) file.binary = true;
    // index, ---, +++ lines are intentionally skipped
  }

  // Split remaining lines into per-hunk groups and parse each
  file.hunks = splitHunkChunks(lines.slice(hunkStart)).map(parseHunk);
  return file;
}

/** Split hunk-region lines at each @@ boundary. */
function splitHunkChunks(lines: string[]): string[][] {
  const chunks: string[][] = [];
  let chunk: string[] = [];
  for (const line of lines) {
    if (line.startsWith("@@") && chunk.length > 0) {
      chunks.push(chunk);
      chunk = [];
    }
    chunk.push(line);
  }
  if (chunk.length > 0) chunks.push(chunk);
  return chunks;
}

/** Parse a single hunk: @@ header followed by +/-/context lines. */
function parseHunk(lines: string[]): Hunk {
  const header = lines[0];
  const m = header.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
  let oldNum = m ? parseInt(m[1], 10) : 1;
  let newNum = m ? parseInt(m[2], 10) : 1;

  const parsed: DiffLine[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith("+")) {
      parsed.push({ type: "add", content: line.slice(1), newNum: newNum++ });
    } else if (line.startsWith("-")) {
      parsed.push({ type: "del", content: line.slice(1), oldNum: oldNum++ });
    } else {
      parsed.push({
        type: "context",
        content: line.startsWith(" ") ? line.slice(1) : line,
        oldNum: oldNum++,
        newNum: newNum++,
      });
    }
  }

  return { header, oldStart: m ? parseInt(m[1], 10) : 1, newStart: m ? parseInt(m[2], 10) : 1, lines: parsed };
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
