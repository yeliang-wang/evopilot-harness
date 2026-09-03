#!/usr/bin/env node

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "evopilot-runbook-test-"));
try {
  const target = {
    id: "test-target",
    revision: 99,
    status: "APPROVED",
    approvals: { target: { authorizationDigest: `sha256:${"a".repeat(64)}` } },
    realCaseCoverage: [
      { id: "RC01", hosts: ["WorkBuddy"], startingState: "READY", scenario: "classify", terminalState: "CLOSED", prohibitedEffects: ["NO_PUBLISH"] },
      { id: "RC02", hosts: ["WorkBuddy"], startingState: "READY", scenario: "evolve", terminalState: "CLOSED", prohibitedEffects: ["NO_PUBLISH"] }
    ]
  };
  const portfolio = {
    sourceMutation: false,
    projectMutation: false,
    sources: [
      { id: "S1", type: "FILE", readOnly: true, locator: "source-one" },
      { id: "S2", type: "FILE", readOnly: true, locator: "source-two" }
    ],
    caseBindings: [
      { caseId: "RC01", sourceIds: ["S1"] },
      { caseId: "RC02", sourceIds: ["S2"] }
    ],
    acceptanceOracles: []
  };
  const binding = {
    schema: "evopilot-candidate-acceptance-binding/v1",
    id: "evopilot-harness-v4.5.0-candidate-27-acceptance-binding-1",
    target: { id: "test-target", revision: 99 },
    candidate: {
      id: "evopilot-harness-v4.5.0-candidate-27",
      packageDigest: `sha256:${"b".repeat(64)}`,
      manifestDigest: `sha256:${"c".repeat(64)}`,
      sourceCheckoutUsed: false
    }
  };
  const sourceBindings = {
    schema: "evopilot-workbuddy-source-bindings/v1",
    target: { id: target.id, revision: target.revision, authorizationDigest: target.approvals.target.authorizationDigest },
    sourcePortfolioDigest: shaFileDocument(portfolio),
    sourceMutation: false,
    projectMutation: false,
    candidateOutputUsed: false,
    bindings: [{ caseId: "RC02", sourceIds: ["S1"] }]
  };
  const files = { target, portfolio, binding, sourceBindings };
  for (const [name, value] of Object.entries(files)) fs.writeFileSync(path.join(root, `${name}.json`), `${JSON.stringify(value, null, 2)}\n`);
  const result = spawnSync(process.execPath, [
    path.join(import.meta.dirname, "generate_workbuddy_runbooks.mjs"),
    "--target", path.join(root, "target.json"),
    "--portfolio", path.join(root, "portfolio.json"),
    "--candidate-binding", path.join(root, "binding.json"),
    "--source-bindings", path.join(root, "sourceBindings.json"),
    "--workspace-root", path.join(root, "workspaces"),
    "--model-route", "configured-model",
    "--out", path.join(root, "runbooks")
  ], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.status, "PASS");
  assert.equal(parsed.manifest.targetRevision, 99);
  assert.equal(parsed.manifest.finalDeclaration, "RC01～RC02 已完成");
  assert.equal(parsed.manifest.runbookCount, 2);
  assert.equal(parsed.manifest.candidateBindingType, "CANDIDATE_ACCEPTANCE_BINDING");
  assert.equal(parsed.manifest.candidateBindingId, binding.id);
  assert.equal(parsed.manifest.candidate.id, binding.candidate.id);
  assert.equal(parsed.manifest.sourceBindingsDigest, shaFile(path.join(root, "sourceBindings.json")));
  const runbook = JSON.parse(fs.readFileSync(path.join(root, "runbooks", "RC01.json"), "utf8"));
  assert.equal(runbook.candidate.id, "evopilot-harness-v4.5.0-candidate-27");
  assert.ok(runbook.workspace.endsWith("RC01-workspace-evopilot-harness-v4.5.0-candidate-27"));
  assert.ok(!JSON.stringify(runbook).includes("candidate-10"));
  const overridden = JSON.parse(fs.readFileSync(path.join(root, "runbooks", "RC02.json"), "utf8"));
  assert.deepEqual(overridden.sources.map((source) => source.id), ["S1"]);
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

process.stdout.write("dynamic WorkBuddy runbook generation tests: PASS\n");

function shaFileDocument(value) {
  const bytes = `${JSON.stringify(value, null, 2)}\n`;
  return `sha256:${hash(bytes)}`;
}
function shaFile(file) { return `sha256:${hash(fs.readFileSync(file))}`; }
function hash(value) { return crypto.createHash("sha256").update(value).digest("hex"); }
