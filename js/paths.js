// Path resolution and virtual-filesystem walking utilities.

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

export function pathString(segments) {
  return "/" + segments.join("/");
}
