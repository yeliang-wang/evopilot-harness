#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

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
for (const expectedPath of ["src/index.mjs", "src/v3/reasoning.mjs", "assets/v3/components/engineering-validation/asset.yaml", "schemas/harness-asset-v3.schema.json", "ontology/builtin/software-engineering.yaml", "policies/matcher/default.yaml", "ui/harness-hub/index.html", "published/CATALOG.md", "Dockerfile", "compose.yaml"]) {
  assert.ok(sourceList.some((item) => item.endsWith(expectedPath)), `${expectedPath} should be in source archive`);
}

console.log("evopilot-harness release artifact verification passed.");

function execTarList(archive) {
  return execFileSync("tar", ["-tzf", archive], { encoding: "utf8" }).trim().split(/\r?\n/);
}
