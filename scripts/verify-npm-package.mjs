#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const packed = JSON.parse(execFileSync("npm", ["pack", "--dry-run", "--json"], { cwd: root, encoding: "utf8" }))[0];
const files = packed.files.map((entry) => entry.path).sort();

assert.equal(manifest.name, "@evopilot/harness");
assert.equal(manifest.version, "4.1.0");
assert.equal(manifest.private, false);
assert.equal(manifest.publishConfig?.access, "public");
assert.equal(manifest.publishConfig?.provenance, true);
assert.equal(manifest.bin?.["evopilot-harness"], "src/index.mjs");
assert.ok(Array.isArray(manifest.files) && manifest.files.length > 0, "files allowlist is required");

const required = [
  "package.json",
  "README.md",
  "LICENSE",
  "NOTICE",
  "src/index.mjs",
  "src/v4/bootstrap.mjs",
  "src/v4/operation-server/server.mjs",
  "src/v3/comparison.mjs",
  "src/v3/calibration.mjs",
  "policies/comparison/default.yaml",
  "schemas/comparison-policy-pack-v1.schema.json",
  "schemas/harness-comparison-evidence-package-v1.schema.json",
  "schemas/harness-comparison-report-v1.schema.json",
  "schemas/harness-comparison-rescore-record-v1.schema.json",
  "schemas/harness-calibration-case-set-v1.schema.json",
  "schemas/harness-calibration-report-v1.schema.json",
  "digital-expert/expert-manifest.yaml",
  "digital-expert/manifest.lock.json",
  "digital-expert/adapters/workbuddy/WORKBUDDY.md",
  "digital-expert/conformance/generic-host.mjs",
  ".agents/skills/evopilot-harness-digital-expert/SKILL.md",
  "assets/v3/components/engineering-validation/asset.yaml",
  "ontology/builtin/software-engineering.yaml",
  "policies/matcher/default.yaml",
  "policies/advisor/default.yaml",
  "schemas/agent-operation-session-v1.schema.json",
  "harnesses/database-product-harness/template.yaml",
  "ui/harness-hub/index.html"
];
for (const expected of required) assert.ok(files.includes(expected), `${expected} must be packaged`);

const forbiddenPrefixes = [
  ".codex-evidence/", ".git/", ".github/", "dist/", "docs/", "governance/",
  "node_modules/", "published/", "scripts/", "tests/"
];
const forbiddenExact = new Set(["models.json", "harness-registry.yaml", "ui/harness-hub/catalog-snapshot.json"]);
for (const file of files) {
  assert.ok(!forbiddenPrefixes.some((prefix) => file.startsWith(prefix)), `${file} is outside the npm runtime contract`);
  assert.ok(!forbiddenExact.has(file), `${file} must not be packaged`);
}

assert.ok(files.length <= 260, `npm package contains too many files: ${files.length}`);
assert.ok(packed.unpackedSize <= 2_500_000, `npm package is too large when unpacked: ${packed.unpackedSize}`);

const secretPatterns = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /(?:api[_-]?key|token|password)\s*[=:]\s*["'][A-Za-z0-9_\-]{20,}["']/i,
  /\/(?:Users|home)\/[A-Za-z0-9._-]+\//
];
for (const file of files) {
  const full = path.join(root, file);
  if (!fs.existsSync(full) || fs.statSync(full).size > 1_000_000 || !isText(file)) continue;
  const content = fs.readFileSync(full, "utf8");
  for (const pattern of secretPatterns) assert.doesNotMatch(content, pattern, `${file} contains forbidden sensitive or machine-specific material`);
}

console.log(JSON.stringify({
  schema: "evopilot-harness-npm-package-verification/v1",
  status: "PASSED",
  package: `${manifest.name}@${manifest.version}`,
  entryCount: files.length,
  packedBytes: packed.size,
  unpackedBytes: packed.unpackedSize,
  expectedBin: "evopilot-harness",
  forbiddenPathCount: 0
}, null, 2));

function isText(file) {
  return /(?:^|\/)(?:[^/]+\.(?:js|mjs|json|md|txt|yaml|yml|html|css)|NOTICE|LICENSE|README)$/.test(file);
}
