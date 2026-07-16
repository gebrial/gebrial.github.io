import { FS_ROOT } from "./filesystem.js";
import { createTerminal } from "./terminal.js";

const container = document.getElementById("terminal");
const terminal = createTerminal({ container, fsRoot: FS_ROOT });

const BANNER = [
  "Welcome to gebrial.github.io",
  "",
  "This site is a terminal. Type `help` to see what you can do,",
  "or start with `ls` to look around.",
  "",
];

for (const line of BANNER) {
  terminal.println(line);
}

terminal.spawnPrompt();

// Mobile quick-command bar: tap a button to run that command.
document.querySelectorAll("#quick-commands button").forEach((button) => {
  button.addEventListener("click", (e) => {
    e.stopPropagation();
    terminal.insertCommand(button.dataset.cmd, { submit: true });
  });
});
