// ls / ls -l / tree — structure, decorations, and counts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { dispatch } from "../js/shell.js";
import { makeCtx } from "./helpers.js";

const runIn = (input, opts) => {
  const ctx = makeCtx(opts);
  dispatch(input, ctx);
  return ctx;
};

// --- ls --------------------------------------------------------------------

test("ls lists sorted entries with type decorations", () => {
  const ctx = runIn("ls");
  assert.deepEqual(ctx.rows[0], [
    { text: "about.txt", cls: "file" },
    { text: "contact.txt", cls: "file" },
    { text: "projects/", cls: "dir" },
  ]);
});

test("ls decorates executables with *", () => {
  const ctx = runIn("ls", { cwd: ["projects", "gravity"] });
  assert.deepEqual(
    ctx.rows[0].map((e) => e.text),
    ["README.md", "launch*"]
  );
});

test("ls on a file prints the path itself; missing target errors", () => {
  assert.deepEqual(runIn("ls about.txt").lines, ["about.txt"]);
  assert.deepEqual(runIn("ls nope").lines, ["ls: cannot access 'nope': No such file or directory"]);
});

test("ls -l prints total, metadata columns, and descriptions", () => {
  const ctx = runIn("ls -l");
  assert.equal(ctx.lines[0], "total 6");
  const about = ctx.lines[1];
  assert.ok(about.startsWith("-rw-r--r-- 1 gebrial staff  180 "), about);
  assert.ok(about.includes("about.txt"));
  assert.ok(about.endsWith("About me"));
  const projects = ctx.lines[3];
  assert.ok(projects.startsWith("drwxr-xr-x 2 gebrial staff 4096 "), projects);
  assert.ok(projects.endsWith("Things I've built"));
});

test("ls -l metadata and description segments are dim; names keep type cls", () => {
  const ctx = runIn("ls -l");
  const projectsRow = ctx.rows.find((r) => r.some((s) => s.text.startsWith("projects/")));
  assert.equal(projectsRow[0].cls, "dim");
  assert.equal(projectsRow[1].cls, "dir");
  assert.equal(projectsRow[2].cls, "dim");
});

test("ls -l on a single file row has no total header", () => {
  const ctx = runIn("ls -l about.txt");
  assert.equal(ctx.lines.length, 1);
  assert.ok(ctx.lines[0].startsWith("-rw-r--r-- 1 gebrial staff 180 "));
});

test("ls -la behaves like ls -l (unknown letters ignored)", () => {
  assert.equal(runIn("ls -la").lines[0], "total 6");
});

// --- tree ------------------------------------------------------------------

test("tree renders the full hierarchy with box-drawing connectors", () => {
  const ctx = runIn("tree");
  assert.deepEqual(ctx.lines, [
    ".",
    "├── about.txt",
    "├── contact.txt",
    "└── projects",
    "    └── gravity",
    "        ├── README.md",
    "        └── launch",
    "",
    "2 directories, 4 files",
  ]);
});

test("tree connectors are dim, names keep their type cls", () => {
  const ctx = runIn("tree");
  const gravityRow = ctx.rows.find((r) => r.some((s) => s.text === "gravity"));
  assert.equal(gravityRow[0].cls, "dim");
  assert.equal(gravityRow[1].cls, "dir");
});

test("tree scopes to a subtree with singular/plural counts", () => {
  const ctx = runIn("tree projects");
  assert.deepEqual(ctx.lines, [
    "projects",
    "└── gravity",
    "    ├── README.md",
    "    └── launch",
    "",
    "1 directory, 2 files",
  ]);
});

test("tree on a file counts one file", () => {
  assert.deepEqual(runIn("tree about.txt").lines, ["about.txt", "", "0 directories, 1 file"]);
});

test("tree on a missing target uses the authentic error", () => {
  assert.deepEqual(runIn("tree nope").lines, [
    "nope  [error opening dir]",
    "",
    "0 directories, 0 files",
  ]);
});
