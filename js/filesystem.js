// Virtual filesystem for the terminal portfolio.
//
// To add a new project: append one entry to PROJECTS below. Nothing else
// needs to change — the folder, README, and launch executable are generated.
//
// Node types:
//   dir  — { type: "dir",  children: { name: node, ... } }
//   file — { type: "file", content: "..." }        shown by `cat`
//   exec — { type: "exec", run(ctx) }               run via `./name` or `run name`

const SITE_BASE = "https://gebrial.github.io";

export const PROJECTS = [
  {
    slug: "gravity",
    description: "An n-body gravitational simulation.",
    builtWith: "Typescript for simulation and p5.js for visualization.",
    // url: override here if the project lives somewhere non-standard;
    // defaults to `${SITE_BASE}/${slug}/`
  },
];

function projectUrl(p) {
  return p.url || `${SITE_BASE}/${p.slug}/`;
}

function projectReadme(p) {
  return [
    p.slug,
    "=".repeat(p.slug.length),
    "",
    p.description,
    p.builtWith ? `Built with: ${p.builtWith}` : null,
    "",
    "Run `./launch` to view the live project.",
  ]
    .filter((line) => line !== null)
    .join("\n");
}

// The one place that knows how a PROJECTS entry maps to filesystem nodes.
function projectNode(p) {
  return {
    type: "dir",
    description: p.description,
    children: {
      "README.md": {
        type: "file",
        description: "Project readme",
        content: p.readme || projectReadme(p),
      },
      launch: {
        type: "exec",
        description: "Launch the live site",
        run(ctx) {
          ctx.println(`Launching ${p.slug} ...`);
          window.location.href = projectUrl(p);
        },
      },
    },
  };
}

export const FS_ROOT = {
  type: "dir",
  children: {
    "about.txt": {
      type: "file",
      description: "About me",
      content: [
        "Hi, I'm Gebrial.",
        "Welcome to my terminal portfolio.",
        "",
        "Each folder under projects/ is one of my projects.",
        "cd into one and run `./launch` to visit it.",
        "",
        "Type `help` to see all commands.",
      ].join("\n"),
    },
    projects: {
      type: "dir",
      description: "Things I've built",
      children: Object.fromEntries(PROJECTS.map((p) => [p.slug, projectNode(p)])),
    },
    "contact.txt": {
      type: "file",
      description: "How to reach me",
      content: [
        "Email:  gebrial@live.ca",
        "GitHub: https://github.com/gebrial",
        "LinkedIn: https://www.linkedin.com/in/gebrial/",
      ].join("\n"),
    },
  },
};
