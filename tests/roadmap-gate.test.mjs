import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");

test("Roadmap Gate validates the contract and declared package version", () => {
  const result = run([]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.body.classification, "ALIGNED");
  assert.equal(result.body.intent, "static-roadmap-contract-validation");
});

test("Roadmap Gate allows approved execution feedback foundation work", () => {
  const result = run(["--intent", "Read an approved HarnessExecutionFeedbackPackage and aggregate asset effectiveness"]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.body.classification, "ALIGNED");
  assert.ok(result.body.matchedMilestones.includes("evopilot-harness-3.3-feedback-evidence-foundation"));
});

test("Roadmap Gate allows repository evolution governance without changing Harness behavior", () => {
  const result = run(["--intent", "Add conversational orchestrator and Roadmap binding for evolution governance"]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.body.classification, "ALIGNED");
  assert.ok(result.body.matchedStandingWork.includes("evopilot-harness-evolution-governance"));
});

test("Roadmap Gate allows v3.4 evidence-driven Asset Delta and Evaluation closure", () => {
  const result = run(["--intent", "Implement evidence-driven Asset Delta Proposal and EvaluationPack v3 portable evaluation cases"]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.body.classification, "ALIGNED");
  assert.ok(result.body.matchedMilestones.includes("evopilot-harness-3.4-evidence-driven-asset-delta"));
});

test("Roadmap Gate allows v4.0 Agent-native Harness operations", () => {
  const result = run(["--intent", "Implement a question-driven Digital Expert and local stdio MCP Harness Operation Server"]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.body.classification, "ALIGNED");
  assert.ok(result.body.matchedMilestones.includes("evopilot-harness-4.0-agent-native-operations"));
});

test("Roadmap Gate keeps controlled comparative evidence in v4.1", () => {
  const result = run(["--intent", "Implement controlled comparative evidence for Baseline Candidate calibration"]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.body.classification, "ALIGNED");
  assert.ok(result.body.matchedMilestones.includes("evopilot-harness-4.1-controlled-comparative-evidence"));
});

test("Roadmap Gate keeps professional Asset learning in v4.2", () => {
  const result = run(["--intent", "Implement professional Asset learning with a governed Asset curriculum"]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.body.classification, "ALIGNED");
  assert.ok(result.body.matchedMilestones.includes("evopilot-harness-4.2-professional-asset-learning"));
});

test("Roadmap Gate stops unplanned product capability work", () => {
  const result = run(["--intent", "Add customer invoicing and a public plugin marketplace"]);
  assert.equal(result.status, 2);
  assert.equal(result.body.classification, "UNPLANNED");
  assert.equal(result.body.approvalRequired, true);
});

test("Roadmap Gate blocks Goal Loop execution inside evopilot-harness", () => {
  const result = run(["--intent", "Run Goal Loop in evopilot-harness"]);
  assert.equal(result.status, 2);
  assert.equal(result.body.classification, "BOUNDARY_CHANGE");
  assert.equal(result.body.boundaryImpact, "REPLACEMENT_ADR_REQUIRED");
});

test("Roadmap Gate stops explicit milestone-order deviations", () => {
  const result = run(["--intent", "Skip milestone and replace Roadmap direction"]);
  assert.equal(result.status, 2);
  assert.equal(result.body.classification, "DEVIATION");
  assert.equal(result.body.boundaryImpact, "ROADMAP_REVISION_REQUIRED");
});

test("Roadmap Gate stops a future unreviewed milestone scope move even when maintenance words are present", () => {
  const result = run(["--intent", "Revise Roadmap and move Roadmap capability for compatibility and regression work"]);
  assert.equal(result.status, 2);
  assert.equal(result.body.classification, "DEVIATION");
  assert.equal(result.body.boundaryImpact, "ROADMAP_REVISION_REQUIRED");
});

test("Roadmap Gate stops an empty intent as unknown", () => {
  const result = run(["--intent", ""]);
  assert.equal(result.status, 2);
  assert.equal(result.body.classification, "UNKNOWN");
  assert.equal(result.body.approvalRequired, true);
});

test("Roadmap Gate permits declared releases and rejects undeclared release lines", () => {
  const declared = run(["--release-version", "3.4.2"]);
  assert.equal(declared.status, 0, declared.stderr);
  assert.equal(declared.body.classification, "ALIGNED");

  const agentNative = run(["--release-version", "4.0.0"]);
  assert.equal(agentNative.status, 0, agentNative.stderr);
  assert.equal(agentNative.body.classification, "ALIGNED");

  const undeclared = run(["--release-version", "5.0.0"]);
  assert.equal(undeclared.status, 2);
  assert.equal(undeclared.body.classification, "UNPLANNED");
});

function run(args) {
  const result = spawnSync(process.execPath, ["scripts/roadmap-gate.mjs", ...args, "--json"], { cwd: root, encoding: "utf8" });
  return { ...result, body: JSON.parse(result.stdout) };
}
