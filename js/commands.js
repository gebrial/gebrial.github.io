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

// Unix-style date string, e.g. "Tue Jul 16 14:32:05 2026".
// Exported so phase 3's `Last login:` banner can reuse it.
export function formatDate(d = new Date()) {
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const pad = (n) => String(n).padStart(2, "0");
  return (
    `${days[d.getDay()]} ${months[d.getMonth()]} ${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())} ${d.getFullYear()}`
  );
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
      const target = args[0] ?? ".";
      const segments = resolveSegments(ctx.cwd, target);
      const node = nodeAt(ctx.fsRoot, segments);
      if (!node) {
        ctx.println(`ls: cannot access '${target}': No such file or directory`);
        return;
      }
      if (node.type !== "dir") {
        // Real ls prints the file path itself.
        ctx.println(target);
        return;
      }
      const names = Object.keys(node.children).sort();
      if (names.length === 0) return;
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
        const node = nodeAt(ctx.fsRoot, resolveSegments(ctx.cwd, target));
        if (!node) {
          ctx.println(`cat: ${target}: No such file or directory`);
        } else if (node.type === "dir") {
          ctx.println(`cat: ${target}: Is a directory`);
        } else if (node.type === "exec") {
          ctx.println(
            `cat: ${target}: Permission denied (it's an executable — try ./${target.replace(/^\.\//, "")})`
          );
        } else {
          ctx.println(node.content);
        }
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
