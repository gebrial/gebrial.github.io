// Shared test helpers: a fake ctx mirroring the one js/terminal.js builds,
// capturing output instead of touching the DOM.

import { FS_ROOT } from "../js/filesystem.js";

export function makeCtx({ cwd = [], history = [] } = {}) {
  const ctx = {
    lines: [], // every println line, split on \n
    rows: [], // printRows/printListing calls, as segment arrays
    cleared: false,
    ended: false,
    fsRoot: FS_ROOT,
    host: "gebrial.github.io",
    cwd,
    history,
    println(text) {
      for (const l of String(text).split("\n")) ctx.lines.push(l);
    },
    printListing(entries) {
      ctx.rows.push(entries);
      ctx.lines.push(entries.map((e) => e.text).join("  "));
    },
    printRows(rows) {
      for (const r of rows) {
        ctx.rows.push(r);
        ctx.lines.push(r.map((s) => s.text).join(""));
      }
    },
    clearScreen() {
      ctx.cleared = true;
      ctx.lines = [];
    },
    endSession() {
      ctx.ended = true;
    },
    setCwd(segments) {
      ctx.cwd = segments;
    },
  };
  return ctx;
}

// Stub the browser global that project `launch` exec nodes assign to.
// Returns a restore function; read the navigated URL via getHref().
export function stubWindow() {
  const prev = globalThis.window;
  globalThis.window = { location: { href: "" } };
  return {
    getHref: () => globalThis.window.location.href,
    restore: () => {
      if (prev === undefined) delete globalThis.window;
      else globalThis.window = prev;
    },
  };
}

// Ground truth for the seeded filesystem, mirrored from js/filesystem.js.
export const ABOUT_LINES = [
  "Hi, I'm Gebrial.",
  "Welcome to my terminal portfolio.",
  "",
  "Each folder under projects/ is one of my projects.",
  "cd into one and run `./launch` to visit it.",
  "",
  "Type `help` to see all commands.",
];

export const CONTACT_LINES = [
  "Email:  gebrial@live.ca",
  "GitHub: https://github.com/gebrial",
  "LinkedIn: https://www.linkedin.com/in/gebrial/",
];
