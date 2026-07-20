// Presentation helpers: dates, ls -l rows, counts, and grep highlighting.

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

export function nodeSize(node) {
  if (node.type === "dir") return 4096;
  if (node.type === "file") return node.content.length;
  return 512; // exec
}

// Build styled `ls -l` rows for [name, node] pairs. Columns are padded so the
// name and description line up across rows.
export function longRows(pairs) {
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

// Line/word/char/byte counts for `wc`. `lines` counts newline characters, like
// real wc (so a non-newline-terminated file reports one fewer than `cat` shows).
export function countText(content) {
  return {
    lines: (content.match(/\n/g) || []).length,
    words: (content.match(/\S+/g) || []).length,
    chars: content.length,
    bytes: new TextEncoder().encode(content).length,
  };
}

// Split `line` into styled segments for grep: matched runs get cls "match",
// the rest cls "file". `re` must be a global regex.
export function highlightSegments(line, re) {
  const segs = [];
  let last = 0;
  re.lastIndex = 0;
  let m;
  while ((m = re.exec(line)) !== null) {
    if (m[0].length === 0) {
      re.lastIndex++; // zero-width match (empty, ^, x*): skip, don't loop forever
      continue;
    }
    if (m.index > last) segs.push({ text: line.slice(last, m.index), cls: "file" });
    segs.push({ text: m[0], cls: "match" });
    last = m.index + m[0].length;
  }
  if (last < line.length) segs.push({ text: line.slice(last), cls: "file" });
  if (segs.length === 0) segs.push({ text: line, cls: "file" }); // empty line
  return segs;
}
