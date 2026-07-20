// Terminal engine: scrollback rendering, prompt/input lifecycle, history.

import { dispatch, complete } from "./shell.js";

const HOST = "gebrial.github.io";

export function createTerminal({ container, fsRoot }) {
  const output = document.createElement("div");
  output.className = "terminal-output";
  container.appendChild(output);

  // Hidden span for measuring text width (inherits the terminal font, so it
  // stays correct under the responsive clamp() font-size). Used to place the
  // block cursor at the caret.
  const measurer = document.createElement("span");
  measurer.className = "measure";
  container.appendChild(measurer);

  const state = {
    cwd: [],
    history: [],
    historyIndex: 0, // points one past the last entry when not browsing
    activeInput: null,
    updateCursor: null,
    closed: false,
  };

  // Position the block cursor over the caret cell of the given input.
  function updateCursor(input, cursorEl) {
    const value = input.value;
    const pos = input.selectionStart ?? value.length;
    measurer.textContent = value.slice(0, pos);
    const x = measurer.getBoundingClientRect().width - input.scrollLeft;
    const ch = value[pos] || "";
    cursorEl.textContent = ch;
    measurer.textContent = ch || " ";
    cursorEl.style.width = measurer.getBoundingClientRect().width + "px";
    cursorEl.style.left = x + "px";
    // Hide when the caret has scrolled out of a long line's visible area.
    cursorEl.style.visibility = x < 0 || x > input.clientWidth ? "hidden" : "visible";
  }

  function promptText() {
    const path = state.cwd.length === 0 ? "~" : "~/" + state.cwd.join("/");
    return `guest@${HOST}:${path}$ `;
  }

  function scrollToBottom() {
    container.scrollTop = container.scrollHeight;
  }

  function println(text) {
    for (const lineText of String(text).split("\n")) {
      const line = document.createElement("div");
      line.className = "line";
      line.textContent = lineText === "" ? " " : lineText;
      output.appendChild(line);
    }
    scrollToBottom();
  }

  // Build a colorized listing line from entries as [{text, cls}]
  function buildListingLine(entries) {
    const line = document.createElement("div");
    line.className = "line";
    entries.forEach((entry, i) => {
      const span = document.createElement("span");
      span.className = `ls-${entry.cls}`;
      span.textContent = entry.text;
      line.appendChild(span);
      if (i < entries.length - 1) line.appendChild(document.createTextNode("  "));
    });
    return line;
  }

  // Colorized `ls` listing: entries as [{text, cls}]
  function printListing(entries) {
    output.appendChild(buildListingLine(entries));
    scrollToBottom();
  }

  // Build one line from styled segments concatenated directly (no separators;
  // callers bake alignment padding into the segment text).
  function buildRow(segments) {
    const line = document.createElement("div");
    line.className = "line";
    for (const seg of segments) {
      const span = document.createElement("span");
      span.className = `ls-${seg.cls}`;
      span.textContent = seg.text;
      line.appendChild(span);
    }
    return line;
  }

  // Multi-row output (e.g. `ls -l`): rows is an array of segment arrays.
  function printRows(rows) {
    for (const row of rows) output.appendChild(buildRow(row));
    scrollToBottom();
  }

  function clearScreen() {
    output.innerHTML = "";
  }

  // End the (pretend SSH) session: stop the prompt loop and leave the terminal
  // inert. Only a manual browser reload reconnects.
  function endSession() {
    state.closed = true;
    state.activeInput = null;
    state.updateCursor = null;
    output.appendChild(buildRow([{ text: "[Process completed]", cls: "dim" }]));
    scrollToBottom();
  }

  const ctx = {
    println,
    printListing,
    printRows,
    clearScreen,
    endSession,
    fsRoot,
    get host() {
      return HOST;
    },
    get cwd() {
      return state.cwd;
    },
    setCwd(segments) {
      state.cwd = segments;
    },
    get history() {
      return state.history;
    },
  };

  function freezePromptLine(promptLine, value) {
    // Replace the live input (and its cursor overlay) with plain text.
    promptLine.querySelector(".input-wrap").remove();
    const echoed = document.createElement("span");
    echoed.className = "echoed";
    echoed.textContent = value;
    promptLine.appendChild(echoed);
  }

  function spawnPrompt() {
    const promptLine = document.createElement("div");
    promptLine.className = "line prompt-line";

    const label = document.createElement("span");
    label.className = "prompt";
    label.textContent = promptText();
    promptLine.appendChild(label);

    const wrap = document.createElement("div");
    wrap.className = "input-wrap";

    const input = document.createElement("input");
    input.type = "text";
    input.className = "prompt-input";
    input.autocapitalize = "off";
    input.autocomplete = "off";
    input.spellcheck = false;
    input.setAttribute("aria-label", "terminal command input");
    wrap.appendChild(input);

    const cursorEl = document.createElement("span");
    cursorEl.className = "cursor";
    wrap.appendChild(cursorEl);

    promptLine.appendChild(wrap);
    output.appendChild(promptLine);

    const update = () => updateCursor(input, cursorEl);
    state.activeInput = input;
    state.updateCursor = update;

    // Keep the block solid while actively typing; resume blinking when idle.
    let typingTimer = null;
    const markTyping = () => {
      cursorEl.classList.add("solid");
      clearTimeout(typingTimer);
      typingTimer = setTimeout(() => cursorEl.classList.remove("solid"), 500);
    };

    input.addEventListener("input", () => {
      markTyping();
      update();
    });
    input.addEventListener("keyup", update);
    input.addEventListener("click", update);
    input.addEventListener("scroll", update);
    input.addEventListener("focus", () => cursorEl.classList.remove("hollow"));
    input.addEventListener("blur", () => cursorEl.classList.add("hollow"));

    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        const value = input.value;
        clearTimeout(typingTimer);
        freezePromptLine(promptLine, value);
        state.activeInput = null;
        state.updateCursor = null;

        const trimmed = value.trim();
        if (trimmed) {
          state.history.push(trimmed);
        }
        state.historyIndex = state.history.length;

        dispatch(value, ctx);
        if (!state.closed) spawnPrompt();
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        if (state.historyIndex > 0) {
          state.historyIndex--;
          input.value = state.history[state.historyIndex];
          update();
          // put caret at end
          requestAnimationFrame(() => {
            input.setSelectionRange(input.value.length, input.value.length);
            update();
          });
        }
      } else if (e.key === "Tab") {
        e.preventDefault();
        const result = complete(input.value, ctx);
        if (result.newInput !== null) {
          input.value = result.newInput;
          update();
          requestAnimationFrame(() => {
            input.setSelectionRange(input.value.length, input.value.length);
            update();
          });
        }
        if (result.candidates.length > 1) {
          // Show the options above the live prompt, like bash does.
          output.insertBefore(buildListingLine(result.candidates), promptLine);
          scrollToBottom();
        }
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        if (state.historyIndex < state.history.length - 1) {
          state.historyIndex++;
          input.value = state.history[state.historyIndex];
        } else {
          state.historyIndex = state.history.length;
          input.value = "";
        }
        update();
      }
    });

    input.focus();
    update();
    scrollToBottom();
  }

  // Clicking anywhere in the terminal focuses the active input, unless the
  // user is selecting text.
  container.addEventListener("click", () => {
    const selection = window.getSelection();
    if (selection && selection.toString().length > 0) return;
    state.activeInput?.focus();
  });

  return {
    println,
    spawnPrompt,
    // Insert text into the active input (used by mobile quick-command bar).
    insertCommand(text, { submit = false } = {}) {
      const input = state.activeInput;
      if (!input) return;
      input.value = text;
      input.focus();
      state.updateCursor?.();
      if (submit) {
        input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      }
    },
  };
}
