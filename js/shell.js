// The shell layer: tokenizing input (quotes), glob expansion, dispatch, and
// tab-completion.

import { COMMANDS } from "./commands.js";
import { resolveSegments, nodeAt } from "./paths.js";

// Split a command line into tokens, honoring '...' and "..." quoting. Both
// quote styles are literal (no expansion); quotes are stripped. An unterminated
// quote runs to end of line. Whitespace outside quotes separates. Each token
// carries `quoted` (true if any part was quoted) so globbing can skip it.
export function tokenize(input) {
  const tokens = [];
  let cur = "";
  let inToken = false;
  let quoted = false;
  let quote = null;
  for (const ch of input) {
    if (quote) {
      if (ch === quote) quote = null;
      else cur += ch;
      inToken = true;
    } else if (ch === "'" || ch === '"') {
      quote = ch;
      inToken = true;
      quoted = true;
    } else if (/\s/.test(ch)) {
      if (inToken) {
        tokens.push({ value: cur, quoted });
        cur = "";
        inToken = false;
        quoted = false;
      }
    } else {
      cur += ch;
      inToken = true;
    }
  }
  if (inToken) tokens.push({ value: cur, quoted });
  return tokens;
}

// Translate a single path-segment glob (* ?) to an anchored regex.
function globToRegExp(seg) {
  let re = "^";
  for (const ch of seg) {
    if (ch === "*") re += ".*";
    else if (ch === "?") re += ".";
    else re += ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(re + "$");
}

// Expand a glob pattern to sorted matching path strings, or null if it has no
// glob in its final segment or matches nothing (bash nullglob-off: keep literal).
// v1 globs only the final path segment; the directory prefix is literal.
function expandGlob(fsRoot, cwd, pattern) {
  const slash = pattern.lastIndexOf("/");
  const lastSeg = slash >= 0 ? pattern.slice(slash + 1) : pattern;
  if (!/[*?]/.test(lastSeg)) return null;
  const dirPart = slash >= 0 ? pattern.slice(0, slash + 1) : "";
  const dirNode = nodeAt(fsRoot, resolveSegments(cwd, dirPart || "."));
  if (!dirNode || dirNode.type !== "dir") return null;
  const re = globToRegExp(lastSeg);
  const matches = Object.keys(dirNode.children)
    .filter((name) => re.test(name))
    .sort()
    .map((name) => dirPart + name); // keep literal prefix → relative/absolute style preserved
  return matches.length ? matches : null;
}

export function dispatch(rawInput, ctx) {
  const parts = tokenize(rawInput);
  if (parts.length === 0) return;
  let cmd = parts[0].value;
  const argv = [];
  for (const part of parts.slice(1)) {
    if (part.quoted) {
      argv.push(part.value); // quotes suppress globbing
      continue;
    }
    const matches = expandGlob(ctx.fsRoot, ctx.cwd, part.value);
    if (matches) argv.push(...matches);
    else argv.push(part.value); // no glob / no match → literal
  }
  let args = argv;
  if (cmd.startsWith("./")) {
    args = [cmd.slice(2), ...argv];
    cmd = "run";
  }
  const handler = COMMANDS[cmd];
  if (!handler) {
    ctx.println(`bash: ${cmd}: command not found`);
    return;
  }
  handler.run(args, ctx);
}

// Candidate commands whose name starts with `prefix`.
function completeCommandName(prefix) {
  return Object.keys(COMMANDS)
    .filter((name) => name.startsWith(prefix))
    .sort()
    .map((name) => ({ display: name, cls: "file", token: name, suffix: " " }));
}

// Candidate filesystem entries for the partial path `current`. Splits the token
// into a directory part (kept verbatim) and the basename being completed.
// Returns null when `current` doesn't point at a real directory.
function completePath(current, ctx) {
  let path = current;
  let dotSlash = "";
  if (path.startsWith("./")) {
    dotSlash = "./";
    path = path.slice(2);
  }
  const slash = path.lastIndexOf("/");
  const dirPart = slash >= 0 ? path.slice(0, slash + 1) : "";
  const base = slash >= 0 ? path.slice(slash + 1) : path;
  const dirNode = nodeAt(ctx.fsRoot, resolveSegments(ctx.cwd, dirPart === "" ? "." : dirPart));
  if (!dirNode || dirNode.type !== "dir") return null;
  return Object.keys(dirNode.children)
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

// Turn candidate matches into a completion result: fill in a unique match,
// extend to the longest common prefix when ambiguous, else list options.
function resolveMatches(matches, current, head) {
  if (matches.length === 0) return { newInput: null, candidates: [] };
  if (matches.length === 1) {
    return { newInput: head + matches[0].token + matches[0].suffix, candidates: [] };
  }
  let lcp = matches[0].token;
  for (const m of matches) {
    while (!m.token.startsWith(lcp)) lcp = lcp.slice(0, -1);
  }
  return {
    newInput: lcp.length > current.length ? head + lcp : null,
    candidates: matches.map((m) => ({ text: m.display, cls: m.cls })),
  };
}

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
    matches = completeCommandName(current);
  } else {
    matches = completePath(current, ctx);
    if (matches === null) return { newInput: null, candidates: [] };
  }
  return resolveMatches(matches, current, head);
}
