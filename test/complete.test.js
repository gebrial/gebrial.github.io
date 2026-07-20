import { test } from "node:test";
import assert from "node:assert/strict";
import { complete } from "../js/shell.js";
import { COMMANDS } from "../js/commands.js";
import { makeCtx } from "./helpers.js";

test("unique command completes with a trailing space", () => {
  const ctx = makeCtx();
  assert.equal(complete("hel", ctx).newInput, "help ");
  assert.equal(complete("gr", ctx).newInput, "grep ");
});

test("ambiguous command lists candidates without changing input", () => {
  const ctx = makeCtx();
  const result = complete("rm", ctx);
  assert.equal(result.newInput, null); // lcp "rm" is no longer than what's typed
  assert.deepEqual(result.candidates.map((c) => c.text).sort(), ["rm", "rmdir"]);
});

test("empty input offers every command (hidden included)", () => {
  const ctx = makeCtx();
  const result = complete("", ctx);
  assert.equal(result.newInput, null);
  assert.equal(result.candidates.length, Object.keys(COMMANDS).length);
});

test("hidden commands are completable", () => {
  const ctx = makeCtx();
  assert.equal(complete("su", ctx).newInput, "sudo ");
  assert.equal(complete("wh", ctx).newInput, "whoami ");
});

test("argument position completes filesystem paths", () => {
  const ctx = makeCtx();
  assert.equal(complete("ls ab", ctx).newInput, "ls about.txt ");
  assert.equal(complete("cd pro", ctx).newInput, "cd projects/"); // dirs get / not space
});

test("nested path completion keeps the directory prefix", () => {
  const ctx = makeCtx();
  assert.equal(complete("cat projects/grav", ctx).newInput, "cat projects/gravity/");
});

test("./ prefix completes executables in cwd", () => {
  const ctx = makeCtx({ cwd: ["projects", "gravity"] });
  assert.equal(complete("./la", ctx).newInput, "./launch ");
});

test("no matches leaves input untouched", () => {
  const ctx = makeCtx();
  const result = complete("ls zz", ctx);
  assert.equal(result.newInput, null);
  assert.deepEqual(result.candidates, []);
});

test("directory-argument listing shows decorated candidates", () => {
  const ctx = makeCtx();
  const result = complete("ls projects/", ctx);
  // single child -> unique completion into the dir
  assert.equal(result.newInput, "ls projects/gravity/");
});

test("earlier arguments (head) are preserved verbatim", () => {
  const ctx = makeCtx();
  assert.equal(complete('grep "a b" ab', ctx).newInput, 'grep "a b" about.txt ');
});
