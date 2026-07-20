import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveSegments, nodeAt } from "../js/paths.js";
import { FS_ROOT } from "../js/filesystem.js";

test("relative paths resolve against cwd", () => {
  assert.deepEqual(resolveSegments([], "projects"), ["projects"]);
  assert.deepEqual(resolveSegments(["projects"], "gravity"), ["projects", "gravity"]);
});

test(". stays put and .. goes up", () => {
  assert.deepEqual(resolveSegments(["projects"], "."), ["projects"]);
  assert.deepEqual(resolveSegments(["projects", "gravity"], ".."), ["projects"]);
  assert.deepEqual(resolveSegments(["projects", "gravity"], "../.."), []);
});

test(".. clamps at root instead of erroring", () => {
  assert.deepEqual(resolveSegments([], ".."), []);
  assert.deepEqual(resolveSegments(["projects"], "../../../.."), []);
});

test("absolute and ~ paths ignore cwd", () => {
  assert.deepEqual(resolveSegments(["projects"], "/"), []);
  assert.deepEqual(resolveSegments(["projects"], "~"), []);
  assert.deepEqual(resolveSegments(["projects"], "/projects/gravity"), ["projects", "gravity"]);
  assert.deepEqual(resolveSegments(["projects"], "~/about.txt"), ["about.txt"]);
});

test("duplicate and trailing slashes are tolerated", () => {
  assert.deepEqual(resolveSegments([], "projects//gravity/"), ["projects", "gravity"]);
});

test("nodeAt walks to nested nodes", () => {
  assert.equal(nodeAt(FS_ROOT, []), FS_ROOT);
  assert.equal(nodeAt(FS_ROOT, ["projects", "gravity", "README.md"]).type, "file");
  assert.equal(nodeAt(FS_ROOT, ["projects", "gravity", "launch"]).type, "exec");
});

test("nodeAt returns null for missing paths", () => {
  assert.equal(nodeAt(FS_ROOT, ["nope"]), null);
  assert.equal(nodeAt(FS_ROOT, ["projects", "nope"]), null);
});

test("nodeAt returns null when traversing through a non-directory", () => {
  assert.equal(nodeAt(FS_ROOT, ["about.txt", "child"]), null);
});
