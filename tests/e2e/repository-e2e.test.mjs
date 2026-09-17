import assert from "node:assert/strict";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..", "..");
const validator = path.join(root, "scripts", "validate-repository-e2e.mjs");
const versions = ["4.6.0", "4.7.0", "4.8.0"];
const targetFiles = versions.map((version) => JSON.parse(fs.readFileSync(manifestFile(version))).target.path).map((target) => path.join(root, target));

test("repository E2E index validates exact v4.6.0-v4.8.0 Target projections", () => {
  const before = targetFiles.map(digestFile);
  const result = run();
  assert.equal(result.status, 0, result.stdout);
  const report = JSON.parse(result.stdout);
  assert.equal(report.status, "PASSED");
  assert.deepEqual(report.versions.map((item) => item.version), versions);
  assert.ok(report.versions.every((item) => item.caseIds.join(",") === "RC01,RC02,RC03,RC04,RC05"));
  assert.ok(report.versions.every((item) => item.acceptanceIdCount === 22));
  assert.equal(report.authority.acceptanceAuthority, false);
  assert.equal(report.authority.releaseAuthority, false);
  assert.deepEqual(targetFiles.map(digestFile), before);
});

for (const version of versions) {
  test(`${version} manifest is independently discoverable and valid`, () => {
    const result = run("--manifest", path.relative(root, manifestFile(version)));
    assert.equal(result.status, 0, result.stdout);
    const report = JSON.parse(result.stdout);
    assert.equal(report.status, "PASSED");
    assert.equal(report.versions.length, 1);
    assert.equal(report.versions[0].version, version);
  });
}

test("repository E2E validation fails closed for stale Target digests", () => {
  expectBlocked((manifest) => { manifest.target.sha256 = `sha256:${"0".repeat(64)}`; }, "TARGET_DIGEST_MISMATCH");
});

test("repository E2E validation rejects unsupported versions", () => {
  expectBlocked((manifest) => { manifest.version = "9.9.9"; }, "VERSION_NOT_INDEXED");
});

test("repository E2E validation rejects missing or reordered cases", () => {
  expectBlocked((manifest) => { manifest.cases.reverse(); }, "CASE_ORDER_MISMATCH");
  expectBlocked((manifest) => { manifest.cases.pop(); }, "CASE_COUNT_MISMATCH");
});

test("repository E2E validation rejects unsafe Target paths", () => {
  expectBlocked((manifest) => { manifest.target.path = "../../outside.json"; }, "TARGET_PATH_UNSAFE");
});

test("repository E2E validation rejects evidence-pointer drift", () => {
  expectBlocked((manifest) => { manifest.cases[0].evidencePointer = "/realCaseCoverage/1/evidenceRefs"; }, "EVIDENCE_POINTER_MISMATCH");
});

test("repository E2E validation rejects embedded approval or status authority", () => {
  expectBlocked((manifest) => { manifest.approval = "APPROVED"; }, "MANIFEST_AUTHORITY_FIELD_FORBIDDEN");
  expectBlocked((manifest) => { manifest.cases[0].status = "PASSED"; }, "MANIFEST_AUTHORITY_FIELD_FORBIDDEN");
});

function expectBlocked(change, code) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "evopilot-harness-e2e-"));
  const manifest = JSON.parse(fs.readFileSync(manifestFile("4.8.0")));
  change(manifest);
  const fixture = path.join(home, "manifest.json");
  fs.writeFileSync(fixture, `${JSON.stringify(manifest, null, 2)}\n`);
  const result = run("--manifest", fixture);
  assert.equal(result.status, 2, result.stdout);
  const report = JSON.parse(result.stdout);
  assert.equal(report.status, "BLOCKED");
  assert.equal(report.blocker.code, code);
}

function run(...args) {
  return spawnSync(process.execPath, [validator, ...args], { cwd: root, encoding: "utf8" });
}

function manifestFile(version) {
  return path.join(root, "tests", "e2e", "versions", version, "manifest.json");
}

function digestFile(file) {
  return `sha256:${crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex")}`;
}
