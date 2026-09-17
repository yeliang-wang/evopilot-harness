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
assert.match(manifest.version, /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/);
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
  "models.example.json",
  "src/index.mjs",
  "src/v4/bootstrap.mjs",
  "src/v4/operation-server/server.mjs",
  "src/v3/comparison.mjs",
  "src/v3/calibration.mjs",
  "src/v3/learning.mjs",
  "policies/comparison/default.yaml",
  "schemas/comparison-policy-pack-v1.schema.json",
  "schemas/harness-comparison-evidence-package-v1.schema.json",
  "schemas/harness-comparison-report-v1.schema.json",
  "schemas/harness-comparison-rescore-record-v1.schema.json",
  "schemas/harness-calibration-case-set-v1.schema.json",
  "schemas/harness-calibration-report-v1.schema.json",
  "schemas/research-adapter-manifest-v1.schema.json",
  "schemas/research-evidence-package-v1.schema.json",
  "schemas/evidence-run-manifest-v1.schema.json",
  "schemas/asset-curriculum-entry-v1.schema.json",
  "schemas/asset-curriculum-snapshot-v1.schema.json",
  "schemas/professional-completeness-policy-pack-v1.schema.json",
  "schemas/professional-completeness-report-v1.schema.json",
  "schemas/professional-completeness-rescore-record-v1.schema.json",
  "schemas/contribution-evidence-package-v1.schema.json",
  "schemas/domain-role-proposal-v1.schema.json",
  "schemas/professional-pack-v1.schema.json",
  "schemas/professional-pack-inspection-v1.schema.json",
  "schemas/pack-benchmark-v1.schema.json",
  "schemas/pack-gold-case-v1.schema.json",
  "schemas/pack-certification-v1.schema.json",
  "schemas/external-semantic-evidence-adapter-v1.schema.json",
  "schemas/project-ontology-proposal-v1.schema.json",
  "schemas/resolved-project-ontology-snapshot-v1.schema.json",
  "schemas/project-ontology-artifact-set-v1.schema.json",
  "schemas/project-ontology-skill-v1.schema.json",
  "schemas/ontology-reasoning-profile-v1.schema.json",
  "schemas/semantic-index-v1.schema.json",
  "schemas/affected-subgraph-v1.schema.json",
  "schemas/semantic-computation-v1.schema.json",
  "schemas/federated-pack-discovery-v1.schema.json",
  "schemas/semantic-interoperability-projection-set-v1.schema.json",
  "schemas/semantic-round-trip-report-v1.schema.json",
  "schemas/terminal-semantic-closure-v1.schema.json",
  "schemas/terminal-semantic-slice-v1.schema.json",
  "src/v4/semantics/professional-packs.mjs",
  "src/v4/semantics/project-ontology.mjs",
  "src/v4/semantics/semantic-interoperability.mjs",
  "ontology/examples/example-finance-domain.yaml",
  "ontology/examples/example-crm-product.yaml",
  "policies/completeness/default.yaml",
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

assert.ok(files.length <= 320, `npm package contains too many files: ${files.length}`);
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
