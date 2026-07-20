import { test } from "node:test";
import assert from "node:assert/strict";
import { tokenize } from "../js/shell.js";

const values = (input) => tokenize(input).map((t) => t.value);

test("splits on whitespace, collapsing runs", () => {
  assert.deepEqual(values("ls -l  projects"), ["ls", "-l", "projects"]);
  assert.deepEqual(values("  cat   about.txt  "), ["cat", "about.txt"]);
});

test("empty and whitespace-only input yield no tokens", () => {
  assert.deepEqual(tokenize(""), []);
  assert.deepEqual(tokenize("   \t "), []);
});

test("double quotes group spaces into one token and are stripped", () => {
  assert.deepEqual(values('grep "hello world" f'), ["grep", "hello world", "f"]);
});

test("single quotes group and preserve inner spacing", () => {
  assert.deepEqual(values("echo 'a  b'"), ["echo", "a  b"]);
});

test("quote styles nest literally inside each other", () => {
  assert.deepEqual(values(`echo 'say "hi"'`), ["echo", 'say "hi"']);
  assert.deepEqual(values(`echo "I'm"`), ["echo", "I'm"]);
});

test("mid-token quotes concatenate like bash", () => {
  assert.deepEqual(values('a"b c"d'), ["ab cd"]);
});

test("empty quotes produce an empty-string token", () => {
  assert.deepEqual(values('grep "" file'), ["grep", "", "file"]);
});

test("unterminated quote runs to end of line", () => {
  assert.deepEqual(values('echo "foo'), ["echo", "foo"]);
});

test("tokens carry a quoted flag when any part was quoted", () => {
  assert.deepEqual(tokenize('echo "x" y'), [
    { value: "echo", quoted: false },
    { value: "x", quoted: true },
    { value: "y", quoted: false },
  ]);
  assert.equal(tokenize('a"b"c')[0].quoted, true);
});
