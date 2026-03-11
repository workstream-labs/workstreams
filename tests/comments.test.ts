import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import {
  loadComments,
  saveComments,
  clearComments,
  deleteComment,
  formatCommentsAsPrompt,
  type WorkstreamComments,
  type ReviewComment,
} from "../src/core/comments";
import { mkdir, rm } from "fs/promises";

const TEST_DIR = "/tmp/test-ws-comments";

describe("comments", () => {
  beforeEach(async () => {
    await rm(TEST_DIR, { recursive: true, force: true });
    await mkdir(`${TEST_DIR}/.workstreams/comments`, { recursive: true });
    process.chdir(TEST_DIR);
  });

  afterEach(async () => {
    process.chdir("/tmp");
    await rm(TEST_DIR, { recursive: true, force: true });
  });

  it("loadComments returns empty default when file missing", async () => {
    const data = await loadComments("nonexistent");
    expect(data.workstream).toBe("nonexistent");
    expect(data.comments).toEqual([]);
  });

  it("saveComments and loadComments roundtrip", async () => {
    const comment: ReviewComment = {
      filePath: "src/index.ts",
      line: 10,
      text: "Fix this bug",
      createdAt: new Date().toISOString(),
    };

    const data: WorkstreamComments = {
      workstream: "feature-x",
      comments: [comment],
      updatedAt: new Date().toISOString(),
    };

    await saveComments(data);
    const loaded = await loadComments("feature-x");

    expect(loaded.workstream).toBe("feature-x");
    expect(loaded.comments).toHaveLength(1);
    expect(loaded.comments[0].filePath).toBe("src/index.ts");
    expect(loaded.comments[0].line).toBe(10);
    expect(loaded.comments[0].text).toBe("Fix this bug");
  });

  it("clearComments removes the file", async () => {
    const data: WorkstreamComments = {
      workstream: "feature-x",
      comments: [{ filePath: "a.ts", text: "hi", createdAt: new Date().toISOString() }],
      updatedAt: new Date().toISOString(),
    };
    await saveComments(data);

    await clearComments("feature-x");
    const loaded = await loadComments("feature-x");
    expect(loaded.comments).toEqual([]);
  });

  it("clearComments is a no-op when file does not exist", async () => {
    // should not throw
    await clearComments("nonexistent");
  });

  it("deleteComment removes a comment by index", async () => {
    const data: WorkstreamComments = {
      workstream: "ws1",
      comments: [
        { filePath: "a.ts", text: "first", createdAt: new Date().toISOString() },
        { filePath: "b.ts", text: "second", createdAt: new Date().toISOString() },
        { filePath: "c.ts", text: "third", createdAt: new Date().toISOString() },
      ],
      updatedAt: new Date().toISOString(),
    };
    await saveComments(data);

    const updated = await deleteComment("ws1", 1);
    expect(updated.comments).toHaveLength(2);
    expect(updated.comments[0].text).toBe("first");
    expect(updated.comments[1].text).toBe("third");
  });
});

describe("formatCommentsAsPrompt", () => {
  it("returns empty string for no comments", () => {
    const result = formatCommentsAsPrompt({
      workstream: "test",
      comments: [],
      updatedAt: new Date().toISOString(),
    });
    expect(result).toBe("");
  });

  it("formats a comment with file and line", () => {
    const result = formatCommentsAsPrompt({
      workstream: "test",
      comments: [
        {
          filePath: "src/app.ts",
          line: 42,
          lineType: "add",
          side: "new",
          text: "Missing null check",
          createdAt: new Date().toISOString(),
        },
      ],
      updatedAt: new Date().toISOString(),
    });

    expect(result).toContain("Comment 1: src/app.ts:42");
    expect(result).toContain("added line");
    expect(result).toContain("new side");
    expect(result).toContain("Missing null check");
  });

  it("formats a comment with diff context", () => {
    const result = formatCommentsAsPrompt({
      workstream: "test",
      comments: [
        {
          filePath: "src/app.ts",
          text: "Looks wrong",
          diffContext: "+const x = 1;\n-const x = 2;",
          createdAt: new Date().toISOString(),
        },
      ],
      updatedAt: new Date().toISOString(),
    });

    expect(result).toContain("```diff");
    expect(result).toContain("+const x = 1;");
  });

  it("formats a comment with line content when no diff context", () => {
    const result = formatCommentsAsPrompt({
      workstream: "test",
      comments: [
        {
          filePath: "src/app.ts",
          text: "Rename this",
          lineContent: "const foo = bar();",
          createdAt: new Date().toISOString(),
        },
      ],
      updatedAt: new Date().toISOString(),
    });

    expect(result).toContain("Line: `const foo = bar();`");
  });

  it("formats comment with file path only (no line)", () => {
    const result = formatCommentsAsPrompt({
      workstream: "test",
      comments: [
        {
          filePath: "src/app.ts",
          text: "General comment",
          createdAt: new Date().toISOString(),
        },
      ],
      updatedAt: new Date().toISOString(),
    });

    expect(result).toContain("Comment 1: src/app.ts");
    // No line number in the location — just file path
    expect(result).not.toContain("src/app.ts:");
  });

  it("handles removed line type", () => {
    const result = formatCommentsAsPrompt({
      workstream: "test",
      comments: [
        {
          filePath: "src/app.ts",
          line: 5,
          lineType: "remove",
          text: "Why removed?",
          createdAt: new Date().toISOString(),
        },
      ],
      updatedAt: new Date().toISOString(),
    });

    expect(result).toContain("removed line");
  });

  it("handles context line type", () => {
    const result = formatCommentsAsPrompt({
      workstream: "test",
      comments: [
        {
          filePath: "src/app.ts",
          line: 5,
          lineType: "context",
          text: "Context note",
          createdAt: new Date().toISOString(),
        },
      ],
      updatedAt: new Date().toISOString(),
    });

    expect(result).toContain("unchanged line");
  });
});
