import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");
const packageJson = JSON.parse(read("package.json"));
const version = packageJson.version;
const escapedVersion = version.replaceAll(".", "\\.");

test("active documentation binds the current package and released version", () => {
  const readme = read("README.md");
  const docsIndex = read("docs/README.md");
  const releaseIndex = read("docs/releases/README.md");
  const releaseNote = read(`docs/releases/${version}.md`);
  const roadmap = JSON.parse(read("governance/roadmap.yaml"));
  // The Roadmap baseline is frozen by approved Target digests. Completed
  // publication has its own append-only evidence; it can advance before the
  // next Roadmap revision without turning the released package into a candidate.
  const publication = JSON.parse(read("governance/releases/semantic-convergence-20261002-publication.json"));
  assert.equal(publication.status, "PUBLIC_DESTINATIONS_VERIFIED");
  const published = publication.products.find((product) => product.product === "harness");
  assert.equal(published?.status, "PUBLISHED_AND_VERIFIED");
  assert.equal(published.tag, `v${published.version}`);
  assert.match(published.sourceCommit, /^[a-f0-9]{40}$/);
  assert.equal(published.releaseUrl, `https://github.com/yeliang-wang/evopilot-harness/releases/tag/${published.tag}`);
  const publishedVersion = published.version;
  assert.ok(roadmap.versionPolicy.publishedBaseline);
  const releaseManagement = read("docs/operations/release-management.md");
  const npmDistribution = read("docs/operations/npm-distribution.md");
  const troubleshooting = read("docs/operations/troubleshooting.md");
  const llms = read("llms.txt");

  // Package guidance remains true before and after promotion. Publication facts
  // come from immutable evidence and the maintained ledger, not a candidate label.
  assert.match(readme, new RegExp(`@evopilot/harness@${escapedVersion}`));
  assert.match(readme, new RegExp(`This package is \\*\\*${escapedVersion}\\*\\*`));
  assert.match(readme, /docs\/releases\/current-release\.md/);
  assert.match(docsIndex, new RegExp(`Engine ${escapedVersion}`));
  assert.match(releaseIndex, new RegExp(`\\[${escapedVersion} package notes\\]`));
  assert.match(releaseNote, new RegExp(`^# EvoPilot Harness ${escapedVersion}`));
  assert.match(releaseNote, /publication ledger/);
  assert.doesNotMatch(readme, /This package.*(?:unpublished|candidate)/i);
  assert.doesNotMatch(releaseNote, /> Status: (?:candidate|released)/);
  assert.match(releaseManagement, /publication ledger/);
  assert.match(releaseManagement, /does not rebuild or repack/);
  assert.match(npmDistribution, new RegExp(`npm view @evopilot/harness@${escapedVersion} version`));
  assert.match(troubleshooting, new RegExp(`npm view @evopilot/harness@${escapedVersion}`));
  assert.match(llms, /Current publication and acceptance limits.*docs\/releases\/current-release\.md/);
});

test("the legacy Guided Operator alias resolves to the packaged Digital Expert", () => {
  const aliasPath = path.join(root, ".agents/skills/evopilot-harness-guided-operator/SKILL.md");
  const alias = fs.readFileSync(aliasPath, "utf8");
  const match = alias.match(/\[the generated v4 Digital Expert Skill]\(([^)]+)\)/);
  assert.ok(match, "compatibility alias must link to the generated Digital Expert Skill");
  assert.equal(fs.existsSync(path.resolve(path.dirname(aliasPath), match[1])), true);
});

test("the repository documentation link gate covers public and Agent-facing entrypoints", () => {
  const checker = read("scripts/check-doc-links.mjs");
  for (const requiredRoot of ["README.md", "AGENTS.md", "llms.txt", ".agents/skills", "docs", "harnesses", "published"]) {
    assert.match(checker, new RegExp(`\\"${requiredRoot.replaceAll(".", "\\.")}\\"`));
  }
  const completed = spawnSync(process.execPath, ["scripts/check-doc-links.mjs"], { cwd: root, encoding: "utf8" });
  assert.equal(completed.status, 0, completed.stderr || completed.stdout);
  assert.match(completed.stdout, /Markdown link check passed/);
});

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}
