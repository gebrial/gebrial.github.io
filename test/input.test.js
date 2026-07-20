import { test } from "node:test";
import assert from "node:assert/strict";
import { historyStep, cursorPlacement } from "../js/input.js";

// --- historyStep -----------------------------------------------------------

const HIST = ["ls", "cd projects", "pwd"]; // index 3 == "not browsing"

test("up walks backward from the not-browsing index", () => {
  assert.deepEqual(historyStep(HIST, 3, -1), { index: 2, value: "pwd" });
  assert.deepEqual(historyStep(HIST, 2, -1), { index: 1, value: "cd projects" });
  assert.deepEqual(historyStep(HIST, 1, -1), { index: 0, value: "ls" });
});

test("up at the oldest entry returns null (nothing to do)", () => {
  assert.equal(historyStep(HIST, 0, -1), null);
});

test("down walks forward, then clears past the newest entry", () => {
  assert.deepEqual(historyStep(HIST, 0, 1), { index: 1, value: "cd projects" });
  assert.deepEqual(historyStep(HIST, 1, 1), { index: 2, value: "pwd" });
  // at the newest -> blank input, index parks one past the end
  assert.deepEqual(historyStep(HIST, 2, 1), { index: 3, value: "" });
  assert.deepEqual(historyStep(HIST, 3, 1), { index: 3, value: "" });
});

test("empty history: up does nothing, down clears", () => {
  assert.equal(historyStep([], 0, -1), null);
  assert.deepEqual(historyStep([], 0, 1), { index: 0, value: "" });
});

// --- cursorPlacement -------------------------------------------------------

const mono = (s) => s.length * 8; // 8px-per-char monospace stub

test("cursor sits after the typed text with a space-width block at line end", () => {
  const p = cursorPlacement({ value: "hello", pos: 5, textWidth: mono, scrollLeft: 0, clientWidth: 200 });
  assert.deepEqual(p, { left: 40, width: 8, ch: "", visible: true });
});

test("cursor covers the character at the caret mid-line", () => {
  const p = cursorPlacement({ value: "hello", pos: 1, textWidth: mono, scrollLeft: 0, clientWidth: 200 });
  assert.deepEqual(p, { left: 8, width: 8, ch: "e", visible: true });
});

test("scrollLeft shifts the block and can push it out of view", () => {
  const p = cursorPlacement({ value: "hello", pos: 2, textWidth: mono, scrollLeft: 20, clientWidth: 200 });
  assert.equal(p.left, -4);
  assert.equal(p.visible, false); // left < 0
});

test("caret past the visible width is hidden", () => {
  const p = cursorPlacement({ value: "hello", pos: 5, textWidth: mono, scrollLeft: 0, clientWidth: 30 });
  assert.equal(p.left, 40);
  assert.equal(p.visible, false); // left > clientWidth
});
