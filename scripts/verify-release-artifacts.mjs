#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { releaseSourceManifest } from "./release-source-manifest.mjs";

const projectName = "evopilot-harness";
const root = process.cwd();
const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const version = packageJson.version;
const outDir = path.join(root, "dist", "release");
const required = [
  `${projectName}-${version}-source.tar.gz`,
  `${projectName}-${version}-sbom.spdx.json`,
  `${projectName}-${version}-provenance.json`,
  "SHA256SUMS"
];

for (const name of required) {
  const file = path.join(outDir, name);
  assert.ok(fs.existsSync(file), `${name} should exist`);
  assert.ok(fs.statSync(file).size > 0, `${name} should not be empty`);
}

const sbom = JSON.parse(fs.readFileSync(path.join(outDir, `${projectName}-${version}-sbom.spdx.json`), "utf8"));
assert.equal(sbom.spdxVersion, "SPDX-2.3");
assert.equal(sbom.packages[0].name, projectName);
assert.equal(sbom.packages[0].versionInfo, version);

const provenance = JSON.parse(fs.readFileSync(path.join(outDir, `${projectName}-${version}-provenance.json`), "utf8"));
assert.equal(provenance.project, projectName);
assert.equal(provenance.version, version);
assert.equal(provenance.tag, `v${version}`);
assert.equal(provenance.source.commit, provenance.commit);
assert.equal(typeof provenance.source.dirty, "boolean");
if (provenance.source.dirty) assert.match(provenance.source.statusDigest, /^sha256:[a-f0-9]{64}$/);
else assert.equal(provenance.source.statusDigest, null);
if (process.env.CI === "true") assert.equal(provenance.source.dirty, false, "release provenance must come from a clean CI checkout");
assert.match(provenance.source.manifest.treeDigest, /^sha256:[a-f0-9]{64}$/);
assert.ok(provenance.source.manifest.fileCount > 0);
assert.deepEqual(releaseSourceManifest(root), provenance.source.manifest, "release provenance should bind the current source tree bytes");
assert.ok(Array.isArray(provenance.artifacts));

const checksums = fs.readFileSync(path.join(outDir, "SHA256SUMS"), "utf8").trim().split(/\r?\n/);
for (const line of checksums) {
  const [expected, name] = line.split(/\s+/);
  const file = path.join(outDir, name);
  assert.ok(fs.existsSync(file), `${name} listed in SHA256SUMS should exist`);
  const actual = crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
  assert.equal(actual, expected, `${name} checksum should match`);
}

const sourceList = execTarList(path.join(outDir, `${projectName}-${version}-source.tar.gz`));
assert.equal(sourceList.filter((item) => path.basename(item).startsWith("._")).length, 0, "source archive must not contain macOS AppleDouble entries");
for (const expectedPath of ["src/index.mjs", "src/v3/reasoning.mjs", "src/v3/review.mjs", "src/v3/feedback.mjs", "src/v4/operation-server/server.mjs", "src/v4/session/store.mjs", "assets/v3/components/engineering-validation/asset.yaml", "schemas/harness-asset-v3.schema.json", "schemas/harness-execution-feedback-package-v1.schema.json", "schemas/harness-effectiveness-report-v1.schema.json", "schemas/evaluation-pack-v2.schema.json", "schemas/proposal-review-v1.schema.json", "schemas/proposal-semantic-review-v1.schema.json", "schemas/agent-operation-session-v1.schema.json", "ontology/builtin/software-engineering.yaml", "policies/matcher/default.yaml", "policies/advisor/default.yaml", "governance/roadmap.yaml", "docs/roadmap/ROADMAP.md", "digital-expert/expert-manifest.yaml", "digital-expert/manifest.lock.json", "digital-expert/adapters/codex/SKILL.md", "digital-expert/conformance/generic-host.mjs", ".agents/skills/evopilot-harness-digital-expert/SKILL.md", ".agents/skills/evopilot-harness-guided-operator/SKILL.md", "ui/harness-hub/index.html", "published/CATALOG.md", "docs/guides/feedback-evidence.md", "docs/assets/harness-hub.png", "AGENTS.md", "CONTRIBUTING.md", "SECURITY.md", "LICENSE", "llms.txt", "Dockerfile", "compose.yaml"]) {
  assert.ok(sourceList.some((item) => item.endsWith(expectedPath)), `${expectedPath} should be in source archive`);
}

const extracted = fs.mkdtempSync(path.join(os.tmpdir(), "evopilot-harness-release-verify-"));
try {
  execFileSync("tar", ["-xzf", path.join(outDir, `${projectName}-${version}-source.tar.gz`), "-C", extracted]);
  assert.deepEqual(releaseSourceManifest(extracted), provenance.source.manifest, "source archive bytes should match the provenance-bound source tree");
} finally {
  fs.rmSync(extracted, { recursive: true, force: true });
}

console.log("evopilot-harness release artifact verification passed.");

function execTarList(archive) {
  return execFileSync("tar", ["-tzf", archive], { encoding: "utf8" }).trim().split(/\r?\n/);
}
