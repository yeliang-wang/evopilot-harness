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
  const publishedVersion = roadmap.versionPolicy.publishedBaseline;
  const escapedPublishedVersion = publishedVersion.replaceAll(".", "\\.");
  const releaseManagement = read("docs/operations/release-management.md");
  const npmDistribution = read("docs/operations/npm-distribution.md");
  const troubleshooting = read("docs/operations/troubleshooting.md");
  const llms = read("llms.txt");

  if (version === publishedVersion) {
    assert.match(readme, new RegExp(`@evopilot/harness@${escapedVersion}`));
    assert.match(readme, new RegExp(`/releases/tag/v${escapedVersion}`));
    assert.match(docsIndex, new RegExp(`Current release:.*v${escapedVersion}`));
    assert.match(releaseIndex, new RegExp(`\\[${escapedVersion} current release\\]`));
    assert.match(releaseNote, /> Status: released/);
  } else {
    assert.match(releaseIndex, new RegExp(`\\[${escapedVersion} candidate\\]`));
    assert.match(releaseNote, /> Status: candidate/);
    assert.doesNotMatch(releaseNote, new RegExp(`/releases/tag/v${escapedVersion}|npmjs\\.com/package/@evopilot/harness/v/${escapedVersion}`));
  }
  assert.match(releaseManagement, new RegExp(`Current published Engine release:.*v${escapedPublishedVersion}`));
  assert.match(npmDistribution, new RegExp(`npm view @evopilot/harness@${escapedPublishedVersion} version`));
  assert.match(troubleshooting, new RegExp(`npm view @evopilot/harness@${escapedPublishedVersion}`));
  assert.match(llms, new RegExp(`Current v${escapedPublishedVersion} release notes`));
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
