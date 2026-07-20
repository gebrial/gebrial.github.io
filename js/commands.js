// Command implementations and dispatch for the terminal.
//
// Every handler receives (args, ctx) where ctx provides:
//   ctx.println(text)   — append a line (or multi-line string) to scrollback
//   ctx.cwd             — current directory as an array of segments
//   ctx.setCwd(array)   — change directory
//   ctx.clearScreen()   — wipe scrollback
//   ctx.fsRoot          — the virtual filesystem root node

// --- Path resolution -------------------------------------------------------

// Resolve a path string against cwd segments. Returns segments array or null
// if the path steps above root in a malformed way (".." at root clamps, like
// real shells).
export function resolveSegments(cwd, input) {
  const absolute = input.startsWith("/") || input.startsWith("~");
  const stripped = input.replace(/^~\/?/, "").replace(/^\/+/, "");
  const parts = stripped.split("/").filter((s) => s.length > 0);
  const segments = absolute ? [] : [...cwd];
  for (const part of parts) {
    if (part === ".") continue;
    if (part === "..") {
      segments.pop(); // popping at root is a no-op, like `cd ..` in /
    } else {
      segments.push(part);
    }
  }
  return segments;
}

// Walk the tree; returns the node at segments, or null if any hop is missing
// or a non-dir is used as an intermediate directory.
export function nodeAt(fsRoot, segments) {
  let node = fsRoot;
  for (const seg of segments) {
    if (!node || node.type !== "dir" || !(seg in node.children)) return null;
    node = node.children[seg];
  }
  return node;
}

function pathString(segments) {
  return "/" + segments.join("/");
}

// --- Shared helpers --------------------------------------------------------

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Unix-style date string, e.g. "Tue Jul 16 14:32:05 2026".
// Exported so phase 3's `Last login:` banner can reuse it.
export function formatDate(d = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  return (
    `${DAYS[d.getDay()]} ${MONTHS[d.getMonth()]} ${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())} ${d.getFullYear()}`
  );
}

// `ls -l`-style timestamp, e.g. "Jul 16 14:32".
function lsDate(d) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${MONTHS[d.getMonth()]} ${String(d.getDate()).padStart(2, " ")} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// Per-node presentation used by `ls`/`ls -l`.
const NODE_MODE = { dir: "drwxr-xr-x", exec: "-rwxr-xr-x", file: "-rw-r--r--" };
const NODE_SUFFIX = { dir: "/", exec: "*", file: "" };

function nodeSize(node) {
  if (node.type === "dir") return 4096;
  if (node.type === "file") return node.content.length;
  return 512; // exec
}

// Build styled `ls -l` rows for [name, node] pairs. Columns are padded so the
// name and description line up across rows.
function longRows(pairs) {
  const stamp = lsDate(new Date());
  const sizeW = Math.max(...pairs.map(([, n]) => String(nodeSize(n)).length));
  const nameW = Math.max(...pairs.map(([name, n]) => (name + NODE_SUFFIX[n.type]).length));
  return pairs.map(([name, node]) => {
    const links = node.type === "dir" ? 2 : 1;
    const meta =
      `${NODE_MODE[node.type]} ${links} gebrial staff ` +
      `${String(nodeSize(node)).padStart(sizeW)} ${stamp} `;
    const row = [
      { text: meta, cls: "dim" },
      { text: (name + NODE_SUFFIX[node.type]).padEnd(nameW + 2), cls: node.type },
    ];
    if (node.description) row.push({ text: node.description, cls: "dim" });
    return row;
  });
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
      const operands = args.filter((a) => !(a.startsWith("-") && a.length > 1));
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
// return null. Shared by cat/head/tail.
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

// Line/word/char/byte counts for `wc`. `lines` counts newline characters, like
// real wc (so a non-newline-terminated file reports one fewer than `cat` shows).
function countText(content) {
  return {
    lines: (content.match(/\n/g) || []).length,
    words: (content.match(/\S+/g) || []).length,
    chars: content.length,
    bytes: new TextEncoder().encode(content).length,
  };
}

// Split `line` into styled segments for grep: matched runs get cls "match",
// the rest cls "file". `re` must be a global regex.
function highlightSegments(line, re) {
  const segs = [];
  let last = 0;
  re.lastIndex = 0;
  let m;
  while ((m = re.exec(line)) !== null) {
    if (m.index > last) segs.push({ text: line.slice(last, m.index), cls: "file" });
    if (m[0].length > 0) {
      segs.push({ text: m[0], cls: "match" });
      last = m.index + m[0].length;
    } else {
      re.lastIndex++; // zero-width match (e.g. ^, x*): don't loop forever
    }
  }
  if (last < line.length) segs.push({ text: line.slice(last), cls: "file" });
  if (segs.length === 0) segs.push({ text: line, cls: "file" }); // empty line
  return segs;
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
      // Separate flag bundles (e.g. -l, -la) from the path. We have no hidden
      // files, so any flag other than `l` is accepted and ignored.
      let longFmt = false;
      let target = null;
      for (const a of args) {
        if (a.startsWith("-") && a.length > 1) {
          if (a.includes("l")) longFmt = true;
        } else if (target === null) {
          target = a;
        }
      }
      target = target ?? ".";

      const segments = resolveSegments(ctx.cwd, target);
      const node = nodeAt(ctx.fsRoot, segments);
      if (!node) {
        ctx.println(`ls: cannot access '${target}': No such file or directory`);
        return;
      }
      if (node.type !== "dir") {
        if (longFmt) {
          const name = segments.length ? segments[segments.length - 1] : target;
          ctx.printRows(longRows([[name, node]]));
        } else {
          // Real ls prints the file path itself.
          ctx.println(target);
        }
        return;
      }

      const names = Object.keys(node.children).sort();
      if (names.length === 0) return;

      if (longFmt) {
        const pairs = names.map((name) => [name, node.children[name]]);
        const total = pairs.reduce(
          (sum, [, n]) => sum + Math.max(1, Math.ceil(nodeSize(n) / 1024)),
          0
        );
        ctx.println(`total ${total}`);
        ctx.printRows(longRows(pairs));
        return;
      }

      const decorated = names.map((name) => {
        const child = node.children[name];
        if (child.type === "dir") return { text: name + "/", cls: "dir" };
        if (child.type === "exec") return { text: name + "*", cls: "exec" };
        return { text: name, cls: "file" };
      });
      ctx.printListing
        ? ctx.printListing(decorated)
        : ctx.println(decorated.map((d) => d.text).join("  "));
    },
  },

  tree: {
    desc: "List directory contents recursively",
    run(args, ctx) {
      // Same flag handling as ls: skip flag bundles, first non-flag is the path.
      let target = null;
      for (const a of args) {
        if (a.startsWith("-") && a.length > 1) continue;
        if (target === null) target = a;
      }
      target = target ?? ".";

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
      const selected = new Set();
      const files = [];
      for (const a of args) {
        if (a.length > 1 && a.startsWith("-")) {
          for (const ch of a.slice(1)) if (flagMap[ch]) selected.add(flagMap[ch]);
        } else {
          files.push(a);
        }
      }
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
      const rest = [];
      for (const a of args) {
        if (a.startsWith("-") && a.length > 1) {
          for (const ch of a.slice(1)) if (ch in opts) opts[ch] = true;
        } else {
          rest.push(a);
        }
      }
      const pattern = rest.shift();
      const files = rest;
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

      const multi = files.length > 1;
      for (const target of files) {
        const content = readFile(ctx, "grep", target); // null => error printed, skip
        if (content === null) continue;
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

// --- Tab completion --------------------------------------------------------

// Compute a completion for rawInput. Returns:
//   newInput   — replacement for the whole input line, or null if nothing to do
//   candidates — [{text, cls}] to display when the match is ambiguous
export function complete(rawInput, ctx) {
  const endsWithSpace = rawInput === "" || /\s$/.test(rawInput);
  const tokens = rawInput.split(/\s+/).filter(Boolean);
  const current = endsWithSpace ? "" : tokens[tokens.length - 1];
  const head = rawInput.slice(0, rawInput.length - current.length);
  const isCommandPosition = tokens.length === 0 || (tokens.length === 1 && !endsWithSpace);

  let matches;
  if (isCommandPosition && !current.includes("/") && !current.startsWith(".")) {
    matches = Object.keys(COMMANDS)
      .filter((name) => name.startsWith(current))
      .sort()
      .map((name) => ({ display: name, cls: "file", token: name, suffix: " " }));
  } else {
    // Path completion: split the token into the directory part (kept as-is)
    // and the basename being completed.
    let rest = current;
    let dotSlash = "";
    if (rest.startsWith("./")) {
      dotSlash = "./";
      rest = rest.slice(2);
    }
    const slash = rest.lastIndexOf("/");
    const dirPart = slash >= 0 ? rest.slice(0, slash + 1) : "";
    const base = slash >= 0 ? rest.slice(slash + 1) : rest;
    const dirNode = nodeAt(ctx.fsRoot, resolveSegments(ctx.cwd, dirPart === "" ? "." : dirPart));
    if (!dirNode || dirNode.type !== "dir") return { newInput: null, candidates: [] };
    matches = Object.keys(dirNode.children)
      .filter((name) => name.startsWith(base))
      .sort()
      .map((name) => {
        const child = dirNode.children[name];
        const isDir = child.type === "dir";
        const isExec = child.type === "exec";
        return {
          display: name + (isDir ? "/" : isExec ? "*" : ""),
          cls: isDir ? "dir" : isExec ? "exec" : "file",
          token: dotSlash + dirPart + name,
          suffix: isDir ? "/" : " ",
        };
      });
  }

  if (matches.length === 0) return { newInput: null, candidates: [] };
  if (matches.length === 1) {
    return { newInput: head + matches[0].token + matches[0].suffix, candidates: [] };
  }

  // Ambiguous: extend to the longest common prefix, and list the options.
  let lcp = matches[0].token;
  for (const m of matches) {
    while (!m.token.startsWith(lcp)) lcp = lcp.slice(0, -1);
  }
  return {
    newInput: lcp.length > current.length ? head + lcp : null,
    candidates: matches.map((m) => ({ text: m.display, cls: m.cls })),
  };
}

// --- Dispatch --------------------------------------------------------------

export function dispatch(rawInput, ctx) {
  const trimmed = rawInput.trim();
  if (!trimmed) return;
  let [cmd, ...args] = trimmed.split(/\s+/);
  if (cmd.startsWith("./")) {
    args = [cmd.slice(2), ...args];
    cmd = "run";
  }
  const handler = COMMANDS[cmd];
  if (!handler) {
    ctx.println(`bash: ${cmd}: command not found`);
    return;
  }
  handler.run(args, ctx);
}
