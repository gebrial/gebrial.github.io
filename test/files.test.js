// cat / head / tail / wc / grep — output shapes and error strings.
import { test } from "node:test";
import assert from "node:assert/strict";
import { dispatch } from "../js/commands.js";
import { makeCtx, ABOUT_LINES, CONTACT_LINES } from "./helpers.js";

const runIn = (input, opts) => {
  const ctx = makeCtx(opts);
  dispatch(input, ctx);
  return ctx;
};

// --- cat -------------------------------------------------------------------

test("cat prints file content", () => {
  assert.deepEqual(runIn("cat about.txt").lines, ABOUT_LINES);
});

test("cat concatenates multiple files", () => {
  assert.deepEqual(runIn("cat about.txt contact.txt").lines, [...ABOUT_LINES, ...CONTACT_LINES]);
});

test("cat error strings", () => {
  assert.deepEqual(runIn("cat nope").lines, ["cat: nope: No such file or directory"]);
  assert.deepEqual(runIn("cat projects").lines, ["cat: projects: Is a directory"]);
  assert.deepEqual(runIn("cat projects/gravity/launch").lines, [
    "cat: projects/gravity/launch: Permission denied (it's an executable — try ./projects/gravity/launch)",
  ]);
  assert.deepEqual(runIn("cat").lines, ["usage: cat <file>"]);
});

// --- head / tail -----------------------------------------------------------

test("head defaults to 10 lines (whole short file)", () => {
  assert.deepEqual(runIn("head about.txt").lines, ABOUT_LINES);
});

test("head/tail -n N and shorthand forms", () => {
  assert.deepEqual(runIn("head -n 3 about.txt").lines, ABOUT_LINES.slice(0, 3));
  assert.deepEqual(runIn("head -2 about.txt").lines, ABOUT_LINES.slice(0, 2));
  assert.deepEqual(runIn("head -n2 about.txt").lines, ABOUT_LINES.slice(0, 2));
  assert.deepEqual(runIn("tail -n 2 about.txt").lines, ABOUT_LINES.slice(-2));
});

test("count of zero prints nothing", () => {
  assert.deepEqual(runIn("head -n 0 about.txt").lines, []);
  assert.deepEqual(runIn("tail -0 about.txt").lines, []);
});

test("multi-file head uses ==> headers with blank separators", () => {
  assert.deepEqual(runIn("head -n 1 about.txt contact.txt").lines, [
    "==> about.txt <==",
    ABOUT_LINES[0],
    "",
    "==> contact.txt <==",
    CONTACT_LINES[0],
  ]);
});

test("head/tail errors mirror cat's wording", () => {
  assert.deepEqual(runIn("head nope").lines, ["head: nope: No such file or directory"]);
  assert.deepEqual(runIn("tail projects").lines, ["tail: projects: Is a directory"]);
  assert.deepEqual(runIn("head").lines, ["usage: head [-n N] <file>"]);
  assert.deepEqual(runIn("tail").lines, ["usage: tail [-n N] <file>"]);
});

// --- wc --------------------------------------------------------------------

test("wc default columns: lines words bytes, right-aligned", () => {
  assert.deepEqual(runIn("wc about.txt").lines, ["  6  32 180 about.txt"]);
});

test("wc flag subsets print in canonical order regardless of flag order", () => {
  assert.deepEqual(runIn("wc -l about.txt").lines, ["6 about.txt"]);
  assert.deepEqual(runIn("wc -w about.txt").lines, ["32 about.txt"]);
  assert.deepEqual(runIn("wc -c about.txt").lines, ["180 about.txt"]);
  assert.deepEqual(runIn("wc -m about.txt").lines, ["180 about.txt"]);
  assert.deepEqual(runIn("wc -lw about.txt").lines, [" 6 32 about.txt"]);
  assert.deepEqual(runIn("wc -wl about.txt").lines, [" 6 32 about.txt"]);
});

test("wc multi-file adds an aligned total row", () => {
  assert.deepEqual(runIn("wc about.txt contact.txt").lines, [
    "  6  32 180 about.txt",
    "  2   6 105 contact.txt",
    "  8  38 285 total",
  ]);
});

test("wc errors and usage", () => {
  assert.deepEqual(runIn("wc nope").lines, ["wc: nope: No such file or directory"]);
  assert.deepEqual(runIn("wc projects").lines, ["wc: projects: Is a directory"]);
  assert.deepEqual(runIn("wc").lines, ["usage: wc [-lwcm] <file>"]);
});

// --- grep ------------------------------------------------------------------

test("grep prints matching lines with the match highlighted", () => {
  const ctx = runIn("grep Gebrial about.txt");
  assert.deepEqual(ctx.lines, ["Hi, I'm Gebrial."]);
  assert.deepEqual(ctx.rows[0], [
    { text: "Hi, I'm ", cls: "file" },
    { text: "Gebrial", cls: "match" },
    { text: ".", cls: "file" },
  ]);
});

test("grep -i matches case-insensitively", () => {
  assert.deepEqual(runIn("grep -i GEBRIAL about.txt").lines, ["Hi, I'm Gebrial."]);
});

test("grep -n prefixes dim line numbers", () => {
  const ctx = runIn("grep -n gebrial contact.txt");
  assert.equal(ctx.lines.length, 3);
  assert.deepEqual(ctx.rows[0][0], { text: "1:", cls: "dim" });
});

test("grep -v prints non-matching lines plain", () => {
  const ctx = runIn("grep -v Gebrial about.txt");
  assert.deepEqual(ctx.lines, ABOUT_LINES.slice(1));
  assert.ok(ctx.rows.every((row) => row.every((seg) => seg.cls !== "match")));
});

test("grep -c prints only the count", () => {
  assert.deepEqual(runIn("grep -c gebrial contact.txt").lines, ["3"]);
});

test("grep across multiple files prefixes filenames, keeps arg order", () => {
  const ctx = runIn("grep -n projects about.txt contact.txt");
  assert.deepEqual(ctx.lines, ["about.txt:4:Each folder under projects/ is one of my projects."]);
});

test("grep zero-width patterns print whole lines plain (regression)", () => {
  assert.deepEqual(runIn('grep "" about.txt').lines, ABOUT_LINES);
  assert.deepEqual(runIn("grep ^ contact.txt").lines, CONTACT_LINES);
});

test("grep quoted pattern is regex, not glob", () => {
  // "a*" as a regex matches every line (zero-or-more a's); unquoted a* would glob to about.txt
  assert.equal(runIn('grep "a*" about.txt').lines.length, ABOUT_LINES.length);
});

test("grep errors and usage", () => {
  assert.deepEqual(runIn("grep [ about.txt").lines, ["grep: invalid pattern: ["]);
  assert.deepEqual(runIn("grep foo nope").lines, ["grep: nope: No such file or directory"]);
  assert.deepEqual(runIn("grep foo projects").lines, ["grep: projects: Is a directory"]);
  assert.deepEqual(runIn("grep").lines, ["usage: grep [-invc] <pattern> <file>"]);
  assert.deepEqual(runIn("grep foo").lines, ["usage: grep [-invc] <pattern> <file>"]);
});
