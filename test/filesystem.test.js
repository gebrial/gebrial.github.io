import { test } from "node:test";
import assert from "node:assert/strict";
import { FS_ROOT, PROJECTS } from "../js/filesystem.js";
import { makeCtx, stubWindow } from "./helpers.js";

test("root contains the expected entries", () => {
  assert.deepEqual(Object.keys(FS_ROOT.children).sort(), ["about.txt", "contact.txt", "projects", "resume"]);
  assert.equal(FS_ROOT.children["about.txt"].type, "file");
  assert.equal(FS_ROOT.children.projects.type, "dir");
});

test("top-level nodes carry ls -l descriptions", () => {
  assert.equal(FS_ROOT.children["about.txt"].description, "About me");
  assert.equal(FS_ROOT.children["contact.txt"].description, "How to reach me");
  assert.equal(FS_ROOT.children.projects.description, "Things I've built");
  assert.equal(FS_ROOT.children.resume.description, "Open my resume (PDF)");
});

test("resume opens the PDF in a new tab", () => {
  const win = stubWindow();
  try {
    const ctx = makeCtx();
    FS_ROOT.children.resume.run(ctx);
    assert.deepEqual(win.getOpened(), ["Sanjaya_Gebrial_Resume.pdf"]);
    assert.equal(win.getHref(), "");
    assert.deepEqual(ctx.lines, ["Opening resume ..."]);
  } finally {
    win.restore();
  }
});

test("resume falls back to same-tab navigation when popups are blocked", () => {
  const win = stubWindow({ popupBlocked: true });
  try {
    FS_ROOT.children.resume.run(makeCtx());
    assert.equal(win.getHref(), "Sanjaya_Gebrial_Resume.pdf");
  } finally {
    win.restore();
  }
});

test("every PROJECTS entry generates a project folder", () => {
  const slugs = Object.keys(FS_ROOT.children.projects.children).sort();
  assert.deepEqual(slugs, PROJECTS.map((p) => p.slug).sort());
});

for (const p of PROJECTS) {
  test(`project ${p.slug}: README + launch generated from config`, () => {
    const node = FS_ROOT.children.projects.children[p.slug];
    assert.equal(node.type, "dir");
    assert.equal(node.description, p.description);

    const readme = node.children["README.md"];
    assert.equal(readme.type, "file");
    assert.equal(readme.description, "Project readme");
    assert.ok(readme.content.includes(p.slug));
    assert.ok(readme.content.includes(p.description));

    const launch = node.children.launch;
    assert.equal(launch.type, "exec");
    assert.equal(launch.description, "Launch the live site");
  });

  test(`project ${p.slug}: launch redirects to its URL`, () => {
    const win = stubWindow();
    try {
      const ctx = makeCtx();
      const launch = FS_ROOT.children.projects.children[p.slug].children.launch;
      launch.run(ctx);
      assert.equal(win.getHref(), p.url || `https://gebrial.github.io/${p.slug}/`);
      assert.ok(ctx.lines.some((l) => l.includes(`Launching ${p.slug}`)));
    } finally {
      win.restore();
    }
  });
}
