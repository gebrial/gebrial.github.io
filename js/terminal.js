// Terminal engine: scrollback rendering, prompt/input lifecycle, history.

import { dispatch, complete } from "./commands.js";

const HOST = "gebrial.github.io";

export function createTerminal({ container, fsRoot }) {
  const output = document.createElement("div");
  output.className = "terminal-output";
  container.appendChild(output);

  const state = {
    cwd: [],
    history: [],
    historyIndex: 0, // points one past the last entry when not browsing
    activeInput: null,
  };

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

  function clearScreen() {
    output.innerHTML = "";
  }

  const ctx = {
    println,
    printListing,
    clearScreen,
    fsRoot,
    get cwd() {
      return state.cwd;
    },
    setCwd(segments) {
      state.cwd = segments;
    },
  };

  function freezePromptLine(promptLine, value) {
    // Replace the live input with plain text in scrollback.
    promptLine.querySelector("input").remove();
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

    const input = document.createElement("input");
    input.type = "text";
    input.className = "prompt-input";
    input.autocapitalize = "off";
    input.autocomplete = "off";
    input.spellcheck = false;
    input.setAttribute("aria-label", "terminal command input");
    promptLine.appendChild(input);

    output.appendChild(promptLine);
    state.activeInput = input;

    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        const value = input.value;
        freezePromptLine(promptLine, value);
        state.activeInput = null;

        const trimmed = value.trim();
        if (trimmed) {
          state.history.push(trimmed);
        }
        state.historyIndex = state.history.length;

        dispatch(value, ctx);
        spawnPrompt();
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        if (state.historyIndex > 0) {
          state.historyIndex--;
          input.value = state.history[state.historyIndex];
          // put caret at end
          requestAnimationFrame(() => input.setSelectionRange(input.value.length, input.value.length));
        }
      } else if (e.key === "Tab") {
        e.preventDefault();
        const result = complete(input.value, ctx);
        if (result.newInput !== null) {
          input.value = result.newInput;
          requestAnimationFrame(() => input.setSelectionRange(input.value.length, input.value.length));
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
      }
    });

    input.focus();
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
      if (submit) {
        input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      }
    },
  };
}
