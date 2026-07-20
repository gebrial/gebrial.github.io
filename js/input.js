// Pure logic behind the command prompt input: history navigation and block-
// cursor geometry. DOM-free so it can be unit-tested.

// Compute the next command-history state for an arrow keypress. `index` points
// one past the newest entry when not browsing. `direction` is -1 (up/older) or
// +1 (down/newer). Returns { index, value }, or null when Up has nowhere to go.
export function historyStep(history, index, direction) {
  if (direction < 0) {
    if (index <= 0) return null;
    return { index: index - 1, value: history[index - 1] };
  }
  if (index >= history.length - 1) return { index: history.length, value: "" };
  return { index: index + 1, value: history[index + 1] };
}

// Geometry for the block cursor overlay. `textWidth(str)` returns a string's
// rendered pixel width (injected so this stays DOM-free). Returns where to draw
// the block, its width, and which character it covers.
export function cursorPlacement({ value, pos, textWidth, scrollLeft, clientWidth }) {
  const left = textWidth(value.slice(0, pos)) - scrollLeft;
  const ch = value[pos] || "";
  const width = textWidth(ch || " ");
  const visible = !(left < 0 || left > clientWidth);
  return { left, width, ch, visible };
}
