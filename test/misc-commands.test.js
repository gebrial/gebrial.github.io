// help, navigation, history, write-family, session, and flavor commands.
import { test } from "node:test";
import assert from "node:assert/strict";
import { dispatch } from "../js/shell.js";
import { formatDate } from "../js/format.js";
import { makeCtx } from "./helpers.js";

const runIn = (input, opts) => {
  const ctx = makeCtx(opts);
  dispatch(input, ctx);
  return ctx;
};

// --- help ------------------------------------------------------------------

test("help lists visible commands and hides gag commands", () => {
  const ctx = runIn("help");
  const text = ctx.lines.join("\n");
  for (const visible of ["ls", "tree", "cat", "grep", "history", "exit"]) {
    assert.ok(ctx.lines.some((l) => l.trim().startsWith(visible + " ")), `missing ${visible}`);
  }
  for (const hidden of ["sudo", "uname", "whoami", "rm", "mkdir", "mv"]) {
    assert.ok(!ctx.lines.some((l) => l.trim().startsWith(hidden + " ")), `${hidden} should be hidden`);
  }
  assert.ok(text.includes("Tab to autocomplete"));
});

// --- pwd / cd / clear ------------------------------------------------------

test("pwd prints the absolute cwd", () => {
  assert.deepEqual(runIn("pwd").lines, ["/"]);
  assert.deepEqual(runIn("pwd", { cwd: ["projects", "gravity"] }).lines, ["/projects/gravity"]);
});

test("cd navigates and mutates cwd", () => {
  const ctx = makeCtx();
  dispatch("cd projects", ctx);
  assert.deepEqual(ctx.cwd, ["projects"]);
  dispatch("cd gravity", ctx);
  assert.deepEqual(ctx.cwd, ["projects", "gravity"]);
  dispatch("cd", ctx); // bare cd goes home
  assert.deepEqual(ctx.cwd, []);
  assert.deepEqual(ctx.lines, []);
});

test("cd error strings leave cwd unchanged", () => {
  const ctx = makeCtx();
  dispatch("cd nope", ctx);
  dispatch("cd about.txt", ctx);
  assert.deepEqual(ctx.lines, [
    "bash: cd: nope: No such file or directory",
    "bash: cd: about.txt: Not a directory",
  ]);
  assert.deepEqual(ctx.cwd, []);
});

test("clear wipes the screen", () => {
  const ctx = runIn("clear");
  assert.equal(ctx.cleared, true);
});

// --- history ---------------------------------------------------------------

test("history prints numbered entries, right-aligned past 9", () => {
  const entries = [...Array(11).keys()].map((i) => `cmd${i}`);
  const ctx = runIn("history", { history: entries });
  assert.equal(ctx.lines[0], " 1  cmd0");
  assert.equal(ctx.lines[10], "11  cmd10");
});

test("history with no entries prints nothing", () => {
  assert.deepEqual(runIn("history").lines, []);
});

// --- write family ----------------------------------------------------------

for (const [cmd, missing] of [
  ["rm", "missing operand"],
  ["rmdir", "missing operand"],
  ["mkdir", "missing operand"],
  ["touch", "missing file operand"],
  ["mv", "missing file operand"],
  ["cp", "missing file operand"],
]) {
  test(`${cmd} with no operand reports "${missing}"`, () => {
    assert.deepEqual(runIn(cmd).lines, [`${cmd}: ${missing}`]);
  });
}

test("flags are not operands (rm -rf regression)", () => {
  assert.deepEqual(runIn("rm -rf").lines, ["rm: missing operand"]);
  assert.deepEqual(runIn("rm -rf about.txt").lines, ["rm: Read-only file system"]);
});

test("mv/cp demand a destination", () => {
  assert.deepEqual(runIn("mv a").lines, ["mv: missing destination file operand after 'a'"]);
  assert.deepEqual(runIn("cp -r a").lines, ["cp: missing destination file operand after 'a'"]);
  assert.deepEqual(runIn("mv a b").lines, ["mv: Read-only file system"]);
});

// --- exit / logout ---------------------------------------------------------

test("exit closes the session", () => {
  const ctx = runIn("exit");
  assert.deepEqual(ctx.lines, ["Connection to gebrial.github.io closed."]);
  assert.equal(ctx.ended, true);
});

test("logout echoes logout first", () => {
  const ctx = runIn("logout");
  assert.deepEqual(ctx.lines, ["logout", "Connection to gebrial.github.io closed."]);
  assert.equal(ctx.ended, true);
});

// --- flavor ----------------------------------------------------------------

test("echo joins args with single spaces", () => {
  assert.deepEqual(runIn("echo a b   c").lines, ["a b c"]);
  assert.deepEqual(runIn("echo").lines, [""]);
});

test("formatDate produces the classic unix shape", () => {
  assert.equal(formatDate(new Date(2026, 6, 16, 14, 32, 5)), "Thu Jul 16 14:32:05 2026");
});

test("date output matches the formatDate shape", () => {
  const ctx = runIn("date");
  assert.match(ctx.lines[0], /^[A-Z][a-z]{2} [A-Z][a-z]{2} \d{2} \d{2}:\d{2}:\d{2} \d{4}$/);
});

test("whoami always answers and never repeats back-to-back", () => {
  const seen = [];
  for (let i = 0; i < 50; i++) {
    const ctx = runIn("whoami");
    assert.equal(ctx.lines.length, 1);
    assert.ok(ctx.lines[0].length > 0);
    seen.push(ctx.lines[0]);
  }
  for (let i = 1; i < seen.length; i++) {
    assert.notEqual(seen[i], seen[i - 1], "whoami repeated the same line twice in a row");
  }
});

test("man shows descriptions, unknown pages, and the no-arg prompt", () => {
  assert.deepEqual(runIn("man ls").lines, ["ls - List directory contents"]);
  assert.deepEqual(runIn("man sudo").lines, ["sudo - Execute a command as the superuser"]);
  assert.deepEqual(runIn("man nope").lines, ["No manual entry for nope"]);
  assert.deepEqual(runIn("man").lines, ["What manual page do you want?"]);
});

test("sudo and uname gags", () => {
  assert.deepEqual(runIn("sudo rm -rf /").lines, [
    "guest is not in the sudoers file. This incident will be reported.",
  ]);
  assert.deepEqual(runIn("uname").lines, ["GebrialOS"]);
  assert.deepEqual(runIn("uname -a").lines, [
    "GebrialOS 1.0.0 gebrial.github.io x86_64 (browser) JavaScript",
  ]);
});
