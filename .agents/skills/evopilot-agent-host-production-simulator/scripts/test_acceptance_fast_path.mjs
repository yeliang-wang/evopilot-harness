#!/usr/bin/env node

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "evopilot-fast-path-test-"));
const script = path.join(import.meta.dirname, "acceptance_fast_path.mjs");

try {
  const write = (name, value) => {
    const file = path.join(root, name);
    fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
    return file;
  };
  const digest = (file) => `sha256:${crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex")}`;
  const targetManifest = write("target-manifest.json", {
    schema: "evopilot-real-host-acceptance-manifest/v2",
    id: "target-manifest",
    candidate: {
      bindingMode: "EXTERNAL_CANDIDATE_BINDING",
      requiredSchema: "evopilot-candidate-acceptance-binding/v1"
    }
  });
  const binding = write("binding.json", {
    schema: "evopilot-candidate-acceptance-binding/v1",
    candidate: { id: "evopilot-harness-v4.5.0-candidate-14" },
    targetManifest: { id: "target-manifest" }
  });
  const plan = write("plan.json", { schema: "test-plan/v1" });
  const stagePlan = write("stages.json", [
    { id: "IMPACT_CLOSURE", kind: "MACHINE" },
    { id: "CLASSIFICATION_CLOSE", kind: "HUMAN_GATE" },
    { id: "FIXED_WAVE", kind: "MACHINE" }
  ]);
  const state = path.join(root, "state.json");
  const init = run("init", "--state", state, "--candidate-binding", binding, "--target-manifest", targetManifest, "--acceptance-plan", plan, "--stage-plan", stagePlan);
  assert.equal(init.status, 0, init.stderr);
  assert.equal(JSON.parse(init.stdout).status, "CONTINUE_AUTOMATICALLY");

  const impactEvidence = write("impact.json", { status: "PASS" });
  const impact = run("record", "--state", state, "--stage", "IMPACT_CLOSURE", "--result", "PASSED", "--evidence", impactEvidence);
  assert.equal(impact.status, 0, impact.stderr);
  assert.equal(JSON.parse(impact.stdout).status, "NEEDS_HUMAN_DECISION");

  const oracle = {
    stageId: "CLASSIFICATION_CLOSE",
    ordinal: 1,
    templateVersion: "classification-result/v1",
    locale: "zh-CN",
    businessSemantics: { aggregate: "TAXONOMY_MATCHED", nextAction: "CLOSE" },
    riskLevel: "NON_DESTRUCTIVE",
    affectedAssets: [],
    question: "是否关闭分类会话？",
    choices: ["CLOSE", "CONTINUE_TO_PROPOSAL_DECISION"],
    priorStageOutcome: "TAXONOMY_MATCHED",
    expectedTerminalState: "CLOSED",
    blockers: [],
    warningsRequiringDecision: [],
    hostAuthoredGovernedProse: false
  };
  const replayManifest = write("replay-manifest.json", {
    schema: "evopilot-acceptance-decision-replay/v1",
    status: "AUTHORIZED",
    candidateBindingDigest: digest(binding),
    targetManifestDigest: digest(targetManifest),
    decision: "CLOSE",
    repetitionIds: ["RC01"],
    expiresAt: "2999-01-01T00:00:00.000Z",
    baseline: { runId: "baseline-1", semanticOracle: oracle },
    authority: { authorizesCleanup: false, authorizesRelease: false, authorizesUnrelatedMutation: false }
  });
  const frame = write("frame.json", {
    schema: "evopilot-acceptance-current-gate/v1",
    repetitionId: "RC01",
    semanticOracle: oracle,
    currentBindings: { sessionId: "fresh-session", frameDigest: "fresh-frame", decisionHandle: "fresh-handle" }
  });
  const replay = run("evaluate-replay", "--state", state, "--replay-manifest", replayManifest, "--current-frame", frame);
  assert.equal(replay.status, 0, replay.stderr);
  const replayRecord = write("replay-record.json", JSON.parse(replay.stdout));
  const closeEvidence = write("close.json", { status: "CLOSED" });
  const close = run("record", "--state", state, "--stage", "CLASSIFICATION_CLOSE", "--result", "PASSED", "--evidence", closeEvidence, "--replay-record", replayRecord);
  assert.equal(close.status, 0, close.stderr);
  assert.equal(JSON.parse(close.stdout).status, "CONTINUE_AUTOMATICALLY");

  const failureEvidence = write("runner-failure.json", { status: "FAIL" });
  const failed = run("record", "--state", state, "--stage", "FIXED_WAVE", "--result", "FAILED", "--failure-class", "RUNNER_PROJECTION", "--evidence", failureEvidence);
  assert.equal(failed.status, 0, failed.stderr);
  const failedStatus = JSON.parse(failed.stdout);
  assert.equal(failedStatus.status, "STOP_FAILED");
  assert.equal(failedStatus.failure.rerunScope, "AFFECTED_STAGE_ONLY");
  assert.equal(failedStatus.failure.requiresNewCandidate, false);

  const correctedEvidence = write("runner-corrected.json", { status: "PASS" });
  const corrected = run("record", "--state", state, "--stage", "FIXED_WAVE", "--result", "PASSED", "--retry", "true", "--evidence", correctedEvidence);
  assert.equal(corrected.status, 0, corrected.stderr);
  assert.equal(JSON.parse(corrected.stdout).status, "COMPLETE");

  const changedFrame = JSON.parse(fs.readFileSync(frame, "utf8"));
  changedFrame.semanticOracle.riskLevel = "DESTRUCTIVE";
  const changedFrameFile = write("changed-frame.json", changedFrame);
  const rejected = run("evaluate-replay", "--state", state, "--replay-manifest", replayManifest, "--current-frame", changedFrameFile);
  assert.equal(rejected.status, 4);
  assert.equal(JSON.parse(rejected.stdout).status, "FAIL");
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

process.stdout.write("acceptance fast-path tests: PASS\n");

function run(...args) {
  return spawnSync(process.execPath, [script, ...args], { encoding: "utf8" });
}
