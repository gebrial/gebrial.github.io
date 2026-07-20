import { test } from "node:test";
import assert from "node:assert/strict";
import { dispatch } from "../js/commands.js";
import { makeCtx, stubWindow } from "./helpers.js";

test("routes to a command with its args", () => {
  const ctx = makeCtx();
  dispatch("echo hello world", ctx);
  assert.deepEqual(ctx.lines, ["hello world"]);
});

test("unknown command prints bash-style error", () => {
  const ctx = makeCtx();
  dispatch("foobar", ctx);
  assert.deepEqual(ctx.lines, ["bash: foobar: command not found"]);
});

test("empty and whitespace-only input do nothing", () => {
  const ctx = makeCtx();
  dispatch("", ctx);
  dispatch("   ", ctx);
  assert.deepEqual(ctx.lines, []);
});

test("./name aliases to run and executes the launcher", () => {
  const win = stubWindow();
  try {
    const ctx = makeCtx({ cwd: ["projects", "gravity"] });
    dispatch("./launch", ctx);
    assert.ok(ctx.lines.some((l) => l.includes("Launching gravity")));
    assert.equal(win.getHref(), "https://gebrial.github.io/gravity/");
  } finally {
    win.restore();
  }
});

test("run on a non-executable is denied; missing target errors", () => {
  const ctx = makeCtx();
  dispatch("./projects", ctx);
  dispatch("./nope", ctx);
  assert.deepEqual(ctx.lines, [
    "bash: ./projects: Permission denied",
    "bash: ./nope: No such file or directory",
  ]);
});

test("quoted args pass through as single tokens", () => {
  const ctx = makeCtx();
  dispatch('echo "a  b" c', ctx);
  assert.deepEqual(ctx.lines, ["a  b c"]);
});

// --- Glob expansion (shell level, before commands see args) ---------------

test("* expands to sorted root entries", () => {
  const ctx = makeCtx();
  dispatch("echo *", ctx);
  assert.deepEqual(ctx.lines, ["about.txt contact.txt projects"]);
});

test("*.txt and ? patterns match by segment", () => {
  const ctx = makeCtx();
  dispatch("echo *.txt", ctx);
  dispatch("echo ?????.txt", ctx);
  assert.deepEqual(ctx.lines, ["about.txt contact.txt", "about.txt"]);
});

test("no match keeps the literal token (nullglob off)", () => {
  const ctx = makeCtx();
  dispatch("echo *.xyz", ctx);
  assert.deepEqual(ctx.lines, ["*.xyz"]);
});

test("quotes suppress globbing", () => {
  const ctx = makeCtx();
  dispatch('echo "*"', ctx);
  dispatch("echo '*'", ctx);
  assert.deepEqual(ctx.lines, ["*", "*"]);
});

test("glob in the last segment keeps its literal directory prefix", () => {
  const ctx = makeCtx();
  dispatch("echo projects/gravity/*", ctx);
  assert.deepEqual(ctx.lines, ["projects/gravity/README.md projects/gravity/launch"]);
});

test("globs resolve relative to cwd", () => {
  const ctx = makeCtx({ cwd: ["projects", "gravity"] });
  dispatch("echo *", ctx);
  assert.deepEqual(ctx.lines, ["README.md launch"]);
});

test("the command word is never globbed", () => {
  const ctx = makeCtx();
  dispatch("*", ctx);
  assert.deepEqual(ctx.lines, ["bash: *: command not found"]);
});
