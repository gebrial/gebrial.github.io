# gebrial.github.io

A terminal-style portfolio site. Visitors navigate a virtual filesystem with
shell commands — each folder under `projects/` is a project, and running
`./launch` inside one redirects to that project's live site.

Vanilla JS/HTML/CSS, no dependencies, no build step. GitHub Pages serves the
files directly.

## Features

- Commands: `help`, `ls`, `cd`, `cat`, `pwd`, `clear`, and `./launch` /
  `run <name>` to open a project
- Tab-completion for command names and paths (bash-style: completes unique
  matches, lists candidates when ambiguous)
- Up/Down arrow command history
- Shell-authentic error messages (`bash: cd: nope: No such file or directory`)
- Tappable quick-command bar on mobile, where typing is awkward
- Theming via CSS variables (`--fg`, `--bg`, `--accent` in
  [css/terminal.css](css/terminal.css))

## Code layout

| File | Purpose |
|---|---|
| [js/filesystem.js](js/filesystem.js) | Virtual filesystem config — the only file touched to add a project |
| [js/commands.js](js/commands.js) | Command implementations, path resolution, tab-completion, dispatch |
| [js/terminal.js](js/terminal.js) | Rendering engine: prompt lifecycle, scrollback, history, key handling |
| [js/main.js](js/main.js) | Bootstrap: welcome banner, quick-command bar wiring |
| [css/terminal.css](css/terminal.css) | Styling and mobile layout |

## Adding a project

Append one entry to the `PROJECTS` array in [js/filesystem.js](js/filesystem.js):

```js
{
  slug: "my-new-project",          // should match the project's repo name
  description: "One-line summary.",
  builtWith: "whatever it's built with",
  // url: "https://..."            // optional; defaults to https://gebrial.github.io/<slug>/
}
```

That's it — the folder, README, and `launch` executable are generated from
this entry. Nothing else needs to change.

Each project lives in its own repo with GitHub Pages enabled
(Settings → Pages → Deploy from branch `main`, root), which serves it at
`https://gebrial.github.io/<repo-name>/`.

## Local development

ES modules need to be served over http, so open the site through any static
server rather than `file://`, e.g.:

```
npx http-server -p 8000
```

then visit http://localhost:8000.
