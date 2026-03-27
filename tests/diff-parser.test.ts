import { describe, it, expect } from "bun:test";
import { parseDiff, fileStat } from "@core";

describe("parseDiff", () => {
  it("parses empty input", () => {
    const result = parseDiff("");
    expect(result.files).toEqual([]);
  });

  it("parses a simple modified file diff", () => {
    const raw = `diff --git a/src/app.ts b/src/app.ts
index abc1234..def5678 100644
--- a/src/app.ts
+++ b/src/app.ts
@@ -1,3 +1,4 @@
 import { foo } from "bar";
+import { baz } from "qux";

 export function main() {`;

    const result = parseDiff(raw);
    expect(result.files).toHaveLength(1);

    const file = result.files[0];
    expect(file.path).toBe("src/app.ts");
    expect(file.status).toBe("M");
    expect(file.binary).toBe(false);
    expect(file.hunks).toHaveLength(1);

    const hunk = file.hunks[0];
    expect(hunk.oldStart).toBe(1);
    expect(hunk.newStart).toBe(1);
    expect(hunk.lines).toHaveLength(4);

    // Context line
    expect(hunk.lines[0].type).toBe("context");
    expect(hunk.lines[0].content).toBe('import { foo } from "bar";');
    expect(hunk.lines[0].oldNum).toBe(1);
    expect(hunk.lines[0].newNum).toBe(1);

    // Added line
    expect(hunk.lines[1].type).toBe("add");
    expect(hunk.lines[1].content).toBe('import { baz } from "qux";');
    expect(hunk.lines[1].newNum).toBe(2);
  });

  it("parses a new file", () => {
    const raw = `diff --git a/new-file.ts b/new-file.ts
new file mode 100644
index 0000000..abc1234
--- /dev/null
+++ b/new-file.ts
@@ -0,0 +1,2 @@
+export const x = 1;
+export const y = 2;`;

    const result = parseDiff(raw);
    expect(result.files).toHaveLength(1);
    expect(result.files[0].status).toBe("A");
    expect(result.files[0].hunks[0].lines).toHaveLength(2);
    expect(result.files[0].hunks[0].lines[0].type).toBe("add");
  });

  it("parses a deleted file", () => {
    const raw = `diff --git a/old-file.ts b/old-file.ts
deleted file mode 100644
index abc1234..0000000
--- a/old-file.ts
+++ /dev/null
@@ -1,2 +0,0 @@
-export const x = 1;
-export const y = 2;`;

    const result = parseDiff(raw);
    expect(result.files).toHaveLength(1);
    expect(result.files[0].status).toBe("D");
    expect(result.files[0].hunks[0].lines).toHaveLength(2);
    expect(result.files[0].hunks[0].lines[0].type).toBe("del");
  });

  it("parses a renamed file", () => {
    const raw = `diff --git a/old-name.ts b/new-name.ts
rename from old-name.ts
rename to new-name.ts`;

    const result = parseDiff(raw);
    expect(result.files).toHaveLength(1);
    expect(result.files[0].status).toBe("R");
    expect(result.files[0].oldPath).toBe("old-name.ts");
    expect(result.files[0].path).toBe("new-name.ts");
  });

  it("parses binary files", () => {
    const raw = `diff --git a/image.png b/image.png
Binary files a/image.png and b/image.png differ`;

    const result = parseDiff(raw);
    expect(result.files).toHaveLength(1);
    expect(result.files[0].binary).toBe(true);
  });

  it("parses multiple files", () => {
    const raw = `diff --git a/a.ts b/a.ts
index abc..def 100644
--- a/a.ts
+++ b/a.ts
@@ -1,2 +1,3 @@
 line1
+line2
 line3
diff --git a/b.ts b/b.ts
new file mode 100644
index 000..abc
--- /dev/null
+++ b/b.ts
@@ -0,0 +1 @@
+hello`;

    const result = parseDiff(raw);
    expect(result.files).toHaveLength(2);
    expect(result.files[0].path).toBe("a.ts");
    expect(result.files[0].status).toBe("M");
    expect(result.files[1].path).toBe("b.ts");
    expect(result.files[1].status).toBe("A");
  });

  it("parses multiple hunks in one file", () => {
    const raw = `diff --git a/big.ts b/big.ts
index abc..def 100644
--- a/big.ts
+++ b/big.ts
@@ -1,3 +1,4 @@
 line1
+inserted
 line3
 line4
@@ -10,3 +11,4 @@
 line10
+another insert
 line12
 line13`;

    const result = parseDiff(raw);
    expect(result.files).toHaveLength(1);
    expect(result.files[0].hunks).toHaveLength(2);
    expect(result.files[0].hunks[0].oldStart).toBe(1);
    expect(result.files[0].hunks[1].oldStart).toBe(10);
  });

  it("correctly tracks line numbers for mixed add/del", () => {
    const raw = `diff --git a/mix.ts b/mix.ts
index abc..def 100644
--- a/mix.ts
+++ b/mix.ts
@@ -1,4 +1,4 @@
 context
-old line
+new line
 context2
 context3`;

    const result = parseDiff(raw);
    const lines = result.files[0].hunks[0].lines;

    expect(lines[0].type).toBe("context");
    expect(lines[0].oldNum).toBe(1);
    expect(lines[0].newNum).toBe(1);

    expect(lines[1].type).toBe("del");
    expect(lines[1].oldNum).toBe(2);

    expect(lines[2].type).toBe("add");
    expect(lines[2].newNum).toBe(2);

    expect(lines[3].type).toBe("context");
    expect(lines[3].oldNum).toBe(3);
    expect(lines[3].newNum).toBe(3);
  });
});

describe("fileStat", () => {
  it("counts added and deleted lines", () => {
    const raw = `diff --git a/mix.ts b/mix.ts
index abc..def 100644
--- a/mix.ts
+++ b/mix.ts
@@ -1,4 +1,5 @@
 context
-old line
+new line
+another new
 context2
 context3`;

    const result = parseDiff(raw);
    const stat = fileStat(result.files[0]);
    expect(stat.added).toBe(2);
    expect(stat.deleted).toBe(1);
  });

  it("returns zeros for context-only diff", () => {
    const raw = `diff --git a/same.ts b/same.ts
index abc..def 100644
--- a/same.ts
+++ b/same.ts
@@ -1,2 +1,2 @@
 line1
 line2`;

    const result = parseDiff(raw);
    const stat = fileStat(result.files[0]);
    expect(stat.added).toBe(0);
    expect(stat.deleted).toBe(0);
  });
});
