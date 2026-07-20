// The command table and command-specific helpers.
//
// Every handler receives (args, ctx) where ctx provides:
//   ctx.println(text)   — append a line (or multi-line string) to scrollback
//   ctx.cwd             — current directory as an array of segments
//   ctx.setCwd(array)   — change directory
//   ctx.clearScreen()   — wipe scrollback
//   ctx.fsRoot          — the virtual filesystem root node

import { resolveSegments, nodeAt, pathString } from "./paths.js";
import { formatDate, nodeSize, longRows, countText, highlightSegments } from "./format.js";

// Partition tokenized args into flag letters and operands. A bundle like `-rf`
// contributes letters r,f; everything else is an operand. Each command decides
// what its letters mean. (head/tail's numeric `-n` parsing is a different
// grammar and stays in parseLineArgs.)
function splitFlags(args) {
  const flags = new Set();
  const operands = [];
  for (const a of args) {
    if (a.startsWith("-") && a.length > 1) {
      for (const ch of a.slice(1)) flags.add(ch);
    } else {
      operands.push(a);
    }
  }
  return { flags, operands };
}

// Write-family commands. The virtual filesystem is read-only, so each refuses
// in-character. With no operand they mirror the real coreutils "missing
// operand" errors; two-operand commands (mv/cp) also flag a missing destination.
function makeWriteCommand(name, { desc, missing, dest = false }) {
  return {
    desc,
    hidden: true,
    run(args, ctx) {
      // Flags (e.g. -rf) aren't operands; count only the file/dir arguments.
      const { operands } = splitFlags(args);
      if (operands.length === 0) {
        ctx.println(`${name}: ${missing}`);
        return;
      }
      if (dest && operands.length < 2) {
        ctx.println(`${name}: missing destination file operand after '${operands[0]}'`);
        return;
      }
      ctx.println(`${name}: Read-only file system`);
    },
  };
}

const WRITE_COMMANDS = {
  rm: makeWriteCommand("rm", { desc: "Remove each specified file", missing: "missing operand" }),
  rmdir: makeWriteCommand("rmdir", { desc: "Remove empty directories", missing: "missing operand" }),
  mkdir: makeWriteCommand("mkdir", { desc: "Create directories", missing: "missing operand" }),
  touch: makeWriteCommand("touch", { desc: "Change file timestamps", missing: "missing file operand" }),
  mv: makeWriteCommand("mv", { desc: "Move (rename) files", missing: "missing file operand", dest: true }),
  cp: makeWriteCommand("cp", { desc: "Copy files", missing: "missing file operand", dest: true }),
};

// exit / logout — end the (pretend SSH) session and leave the terminal inert.
function closeSession(ctx, echo) {
  if (echo) ctx.println(echo); // logout echoes "logout"; exit doesn't
  ctx.println(`Connection to ${ctx.host} closed.`);
  ctx.endSession();
}

// Resolve a path to a readable file's content, or print a cat-style error and
// return null. Shared by cat/head/tail/wc/grep.
function readFile(ctx, cmd, target) {
  const node = nodeAt(ctx.fsRoot, resolveSegments(ctx.cwd, target));
  if (!node) {
    ctx.println(`${cmd}: ${target}: No such file or directory`);
    return null;
  }
  if (node.type === "dir") {
    ctx.println(`${cmd}: ${target}: Is a directory`);
    return null;
  }
  if (node.type === "exec") {
    ctx.println(
      `${cmd}: ${target}: Permission denied (it's an executable — try ./${target.replace(/^\.\//, "")})`
    );
    return null;
  }
  return node.content;
}

// head / tail share parsing, resolution, and output shape — only line
// selection differs, so they're built from one factory.
// Parse `-n N`, `-nN`, and `-N` count forms; everything else is a file operand.
function parseLineArgs(args) {
  let count = 10;
  const files = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "-n") {
      const v = parseInt(args[++i], 10);
      if (!Number.isNaN(v)) count = v;
    } else if (/^-n\d+$/.test(a)) {
      count = parseInt(a.slice(2), 10);
    } else if (/^-\d+$/.test(a)) {
      count = parseInt(a.slice(1), 10);
    } else if (a.startsWith("-") && a.length > 1) {
      // unknown flag: ignore (we only support -n / -N)
    } else {
      files.push(a);
    }
  }
  return { count: Math.max(0, count), files };
}

function makeLineCommand(name, desc, take) {
  return {
    desc,
    run(args, ctx) {
      const { count, files } = parseLineArgs(args);
      if (files.length === 0) {
        ctx.println(`usage: ${name} [-n N] <file>`);
        return;
      }
      files.forEach((target, i) => {
        const content = readFile(ctx, name, target);
        if (content === null) return;
        if (files.length > 1) {
          // multi-file: `==> name <==` headers, blank line between
          if (i > 0) ctx.println("");
          ctx.println(`==> ${target} <==`);
        }
        const selected = take(content.split("\n"), count);
        if (selected.length) ctx.println(selected.join("\n"));
      });
    },
  };
}

// `whoami` cycles through these — fragments from Shelley's "Ozymandias"
// (public domain, 1818). Each reads as a first-person identity statement.
// Add or trim freely.
const WHOAMI_LINES = [
  "a traveller from an antique land",
  "My name is Ozymandias",
  "King of Kings",
  "My name is Ozymandias, King of Kings; look on my Works, ye Mighty, and despair!",
];
let lastWhoami = -1;

// --- ls helpers ------------------------------------------------------------

function parseLsArgs(args) {
  const { flags, operands } = splitFlags(args);
  return { longFmt: flags.has("l"), target: operands[0] ?? "." };
}

// `ls -l` output. The `total` header is printed only for directory listings.
function renderLong(pairs, ctx, withTotal) {
  if (withTotal) {
    const total = pairs.reduce((sum, [, n]) => sum + Math.max(1, Math.ceil(nodeSize(n) / 1024)), 0);
    ctx.println(`total ${total}`);
  }
  ctx.printRows(longRows(pairs));
}

// Plain `ls` output: names decorated by type, on one line.
function renderShort(names, node, ctx) {
  const decorated = names.map((name) => {
    const child = node.children[name];
    if (child.type === "dir") return { text: name + "/", cls: "dir" };
    if (child.type === "exec") return { text: name + "*", cls: "exec" };
    return { text: name, cls: "file" };
  });
  ctx.printListing
    ? ctx.printListing(decorated)
    : ctx.println(decorated.map((d) => d.text).join("  "));
}

// --- grep helper -----------------------------------------------------------

// Print the matching lines of one file (or, with -c, the match count).
function grepFile(ctx, content, target, { opts, matchRe, globalRe, multi }) {
  let count = 0;
  const rows = [];
  content.split("\n").forEach((line, idx) => {
    if (matchRe.test(line) === opts.v) return; // skip non-matches (or matches if -v)
    count++;
    if (opts.c) return;
    const prefix = [];
    if (multi) prefix.push({ text: `${target}:`, cls: "dim" });
    if (opts.n) prefix.push({ text: `${idx + 1}:`, cls: "dim" });
    const body = opts.v ? [{ text: line, cls: "file" }] : highlightSegments(line, globalRe);
    rows.push([...prefix, ...body]);
  });
  if (opts.c) ctx.println(multi ? `${target}:${count}` : `${count}`);
  else if (rows.length) ctx.printRows(rows);
}

// --- Commands --------------------------------------------------------------

export const COMMANDS = {
  help: {
    desc: "List available commands",
    run(args, ctx) {
      const lines = ["Available commands:", ""];
      const visible = Object.entries(COMMANDS).filter(([, cmd]) => !cmd.hidden);
      const width = Math.max(...visible.map(([name]) => name.length));
      for (const [name, cmd] of visible) {
        lines.push(`  ${name.padEnd(width + 2)}${cmd.desc}`);
      }
      lines.push("");
      lines.push("Navigate into a project folder and type `./launch` to visit it.");
      lines.push("Use Up/Down arrows to recall previous commands, Tab to autocomplete.");
      ctx.println(lines.join("\n"));
    },
  },

  ls: {
    desc: "List directory contents",
    run(args, ctx) {
      // We have no hidden files, so any flag other than `l` is accepted and ignored.
      const { longFmt, target } = parseLsArgs(args);
      const segments = resolveSegments(ctx.cwd, target);
      const node = nodeAt(ctx.fsRoot, segments);
      if (!node) {
        ctx.println(`ls: cannot access '${target}': No such file or directory`);
        return;
      }
      if (node.type !== "dir") {
        if (longFmt) {
          const name = segments.length ? segments[segments.length - 1] : target;
          renderLong([[name, node]], ctx, false);
        } else {
          // Real ls prints the file path itself.
          ctx.println(target);
        }
        return;
      }

      const names = Object.keys(node.children).sort();
      if (names.length === 0) return;

      if (longFmt) {
        renderLong(names.map((name) => [name, node.children[name]]), ctx, true);
      } else {
        renderShort(names, node, ctx);
      }
    },
  },

  tree: {
    desc: "List directory contents recursively",
    run(args, ctx) {
      // No flags are supported yet; the first non-flag operand is the path.
      const target = splitFlags(args).operands[0] ?? ".";

      const node = nodeAt(ctx.fsRoot, resolveSegments(ctx.cwd, target));
      if (!node) {
        ctx.println(`${target}  [error opening dir]`);
        ctx.println("");
        ctx.println("0 directories, 0 files");
        return;
      }

      const counts = { dirs: 0, files: 0 };
      const rows = [[{ text: target, cls: node.type === "dir" ? "dir" : node.type }]];

      function walk(dir, prefix) {
        const names = Object.keys(dir.children).sort();
        names.forEach((name, i) => {
          const child = dir.children[name];
          const last = i === names.length - 1;
          rows.push([
            { text: prefix + (last ? "└── " : "├── "), cls: "dim" },
            { text: name, cls: child.type },
          ]);
          if (child.type === "dir") {
            counts.dirs++;
            walk(child, prefix + (last ? "    " : "│   "));
          } else {
            counts.files++;
          }
        });
      }

      if (node.type === "dir") {
        walk(node, "");
      } else {
        counts.files++;
        rows.length = 0;
        rows.push([{ text: target, cls: node.type }]);
      }

      ctx.printRows(rows);
      ctx.println("");
      ctx.println(
        `${counts.dirs} ${counts.dirs === 1 ? "directory" : "directories"}, ` +
          `${counts.files} ${counts.files === 1 ? "file" : "files"}`
      );
    },
  },

  cd: {
    desc: "Change directory",
    run(args, ctx) {
      const target = args[0] ?? "~";
      const segments = resolveSegments(ctx.cwd, target);
      const node = nodeAt(ctx.fsRoot, segments);
      if (!node) {
        ctx.println(`bash: cd: ${target}: No such file or directory`);
        return;
      }
      if (node.type !== "dir") {
        ctx.println(`bash: cd: ${target}: Not a directory`);
        return;
      }
      ctx.setCwd(segments);
    },
  },

  cat: {
    desc: "Print file contents",
    run(args, ctx) {
      if (args.length === 0) {
        ctx.println("usage: cat <file>");
        return;
      }
      for (const target of args) {
        const content = readFile(ctx, "cat", target);
        if (content !== null) ctx.println(content);
      }
    },
  },

  head: makeLineCommand("head", "Output the first part of a file", (lines, n) => lines.slice(0, n)),

  tail: makeLineCommand("tail", "Output the last part of a file", (lines, n) =>
    lines.slice(Math.max(0, lines.length - n))
  ),

  wc: {
    desc: "Count lines, words, and bytes in a file",
    run(args, ctx) {
      const flagMap = { l: "lines", w: "words", m: "chars", c: "bytes" };
      const order = ["lines", "words", "chars", "bytes"]; // canonical print order
      const { flags, operands: files } = splitFlags(args);
      const selected = new Set();
      for (const ch of flags) if (flagMap[ch]) selected.add(flagMap[ch]);
      if (files.length === 0) {
        ctx.println("usage: wc [-lwcm] <file>");
        return;
      }
      const cols = selected.size ? order.filter((k) => selected.has(k)) : ["lines", "words", "bytes"];

      const rows = [];
      const totals = { lines: 0, words: 0, chars: 0, bytes: 0 };
      for (const target of files) {
        const content = readFile(ctx, "wc", target); // null => error printed, skip
        if (content === null) continue;
        const counts = countText(content);
        rows.push({ counts, name: target });
        for (const k of order) totals[k] += counts[k];
      }
      if (rows.length === 0) return;
      if (rows.length > 1) rows.push({ counts: totals, name: "total" });

      // Right-align every count to the widest so columns line up (like real wc).
      let width = 1;
      for (const r of rows) for (const k of cols) width = Math.max(width, String(r.counts[k]).length);
      for (const r of rows) {
        const nums = cols.map((k) => String(r.counts[k]).padStart(width)).join(" ");
        ctx.println(`${nums} ${r.name}`);
      }
    },
  },

  grep: {
    desc: "Search for a pattern in a file",
    run(args, ctx) {
      const opts = { i: false, n: false, v: false, c: false };
      const { flags, operands } = splitFlags(args);
      for (const ch of flags) if (ch in opts) opts[ch] = true;
      const [pattern, ...files] = operands;
      if (pattern === undefined || files.length === 0) {
        ctx.println("usage: grep [-invc] <pattern> <file>");
        return;
      }

      let matchRe, globalRe;
      try {
        matchRe = new RegExp(pattern, opts.i ? "i" : "");
        globalRe = new RegExp(pattern, opts.i ? "gi" : "g");
      } catch {
        ctx.println(`grep: invalid pattern: ${pattern}`);
        return;
      }

      const search = { opts, matchRe, globalRe, multi: files.length > 1 };
      for (const target of files) {
        const content = readFile(ctx, "grep", target); // null => error printed, skip
        if (content !== null) grepFile(ctx, content, target, search);
      }
    },
  },

  pwd: {
    desc: "Print working directory",
    run(args, ctx) {
      ctx.println(pathString(ctx.cwd));
    },
  },

  clear: {
    desc: "Clear the terminal",
    run(args, ctx) {
      ctx.clearScreen();
    },
  },

  exit: {
    desc: "Close the session",
    run(args, ctx) {
      closeSession(ctx);
    },
  },

  logout: {
    desc: "Log out and close the session",
    run(args, ctx) {
      closeSession(ctx, "logout");
    },
  },

  history: {
    desc: "Show previously entered commands",
    run(args, ctx) {
      const entries = ctx.history;
      if (entries.length === 0) return;
      const width = String(entries.length).length;
      const lines = entries.map(
        (cmd, i) => `${String(i + 1).padStart(width)}  ${cmd}`
      );
      ctx.println(lines.join("\n"));
    },
  },

  whoami: {
    desc: "Print who you are",
    hidden: true,
    run(args, ctx) {
      let i;
      do {
        i = Math.floor(Math.random() * WHOAMI_LINES.length);
      } while (i === lastWhoami && WHOAMI_LINES.length > 1);
      lastWhoami = i;
      ctx.println(WHOAMI_LINES[i]);
    },
  },

  echo: {
    desc: "Write arguments to the output",
    run(args, ctx) {
      ctx.println(args.join(" "));
    },
  },

  date: {
    desc: "Print the current date and time",
    run(args, ctx) {
      ctx.println(formatDate());
    },
  },

  man: {
    desc: "Show a command's manual entry",
    run(args, ctx) {
      if (args.length === 0) {
        ctx.println("What manual page do you want?");
        return;
      }
      const name = args[0];
      const cmd = COMMANDS[name];
      if (cmd) {
        ctx.println(`${name} - ${cmd.desc}`);
      } else {
        ctx.println(`No manual entry for ${name}`);
      }
    },
  },

  sudo: {
    desc: "Execute a command as the superuser",
    hidden: true,
    run(args, ctx) {
      ctx.println("guest is not in the sudoers file. This incident will be reported.");
    },
  },

  ...WRITE_COMMANDS,

  uname: {
    desc: "Print system information",
    hidden: true,
    run(args, ctx) {
      if (args.includes("-a")) {
        ctx.println("GebrialOS 1.0.0 gebrial.github.io x86_64 (browser) JavaScript");
      } else {
        ctx.println("GebrialOS");
      }
    },
  },

  run: {
    desc: "Execute a launcher (alias: ./name)",
    run(args, ctx) {
      if (args.length === 0) {
        ctx.println("usage: run <name>   (or ./name)");
        return;
      }
      const target = args[0];
      const node = nodeAt(ctx.fsRoot, resolveSegments(ctx.cwd, target));
      if (!node) {
        ctx.println(`bash: ./${target}: No such file or directory`);
        return;
      }
      if (node.type !== "exec") {
        ctx.println(`bash: ./${target}: Permission denied`);
        return;
      }
      node.run(ctx);
    },
  },
};
