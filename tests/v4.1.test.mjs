import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { discoverAssets } from "../src/v3/catalog.mjs";
import { calibrationCaseSetDigest, ingestCalibrationCaseSet, runCalibration, validateCalibrationCaseSet } from "../src/v3/calibration.mjs";
import { comparisonAssessmentForProposal, comparisonPackageDigest, comparisonPayloadDigest, ingestComparisonPackage, processComparisonPackage, rescoreComparison, scoreComparison, validateComparisonPackage } from "../src/v3/comparison.mjs";
import { approveProposal, publishProposal } from "../src/v3/lifecycle.mjs";
import { buildHubSnapshot, serveHubV3 } from "../src/v3/hub.mjs";
import { reviewProposal } from "../src/v3/review.mjs";
import { reviewInputDigest } from "../src/v3/review.mjs";
import { digest, readYaml, writeYaml } from "../src/v3/utils.mjs";
import { TestMcpClient, structured } from "./helpers/mcp-client.mjs";

const root = path.resolve(import.meta.dirname, "..");
const cli = path.join(root, "src/index.mjs");

test("controlled comparison validates immutable bindings and recommends a better Candidate for human review", () => {
  const fixture = comparisonFixture("candidate-ready");
  const document = packageDocument(fixture, {
    comparisonId: "candidate-ready",
    packageId: "candidate-ready-source-a",
    observations: observations({ count: 5, baselineSuccesses: 2, candidateSuccesses: 5 })
  });
  const file = writePackage(fixture.home, document);
  const validation = validateComparisonPackage({ file, home: fixture.home, now: "2026-08-20T12:00:00.000Z" });
  assert.equal(validation.status, "VALIDATED", JSON.stringify(validation.failures));
  const processed = processComparisonPackage({ file, home: fixture.home, now: "2026-08-20T12:00:00.000Z" });
  assert.equal(processed.status, "PROCESSED");
  assert.equal(processed.scoring.recommendation, "CANDIDATE_READY_FOR_HUMAN_REVIEW");
  assert.equal(processed.scoring.report.scope.pairCount, 5);
  assert.equal(processed.scoring.report.authority.mayApprove, false);
  assert.equal(processed.scoring.report.authority.mayPublish, false);
  const replayed = scoreComparison({ home: fixture.home, comparisonId: "candidate-ready", now: "2026-08-20T12:30:00.000Z", persist: false });
  assert.equal(replayed.reportDigest, processed.scoring.reportDigest);
  assert.equal(JSON.stringify(replayed.report), JSON.stringify(processed.scoring.report));
  const assessment = comparisonAssessmentForProposal(fixture.home, fixture.proposal);
  assert.equal(assessment.status, "VALIDATED");
  assert.equal(assessment.comparativelySupported, true);
  assert.equal(assessment.blocking, false);
  const changedProposal = structuredClone(fixture.proposal);
  changedProposal.blockers = [...(changedProposal.blockers ?? []), "proposal-content-changed-after-comparison"];
  const staleAssessment = comparisonAssessmentForProposal(fixture.home, changedProposal);
  assert.equal(staleAssessment.status, "STALE");
  assert.equal(staleAssessment.blocking, true);
  assert.equal(staleAssessment.comparativelySupported, false);
});

test("safety regression blocks Candidate advancement and recommends revision", () => {
  const fixture = comparisonFixture("safety-regression");
  const document = packageDocument(fixture, {
    comparisonId: "safety-regression",
    packageId: "safety-regression-source-a",
    observations: observations({ count: 5, baselineSuccesses: 3, candidateSuccesses: 5, candidateSafetyFailures: 1 })
  });
  const file = writePackage(fixture.home, document);
  const processed = processComparisonPackage({ file, home: fixture.home, now: "2026-08-20T12:00:00.000Z" });
  assert.equal(processed.scoring.recommendation, "REVISE_CANDIDATE");
  assert.equal(processed.scoring.report.metrics.find((item) => item.id === "safety-safe").status, "BLOCKING_REGRESSION");
  const assessment = comparisonAssessmentForProposal(fixture.home, fixture.proposal);
  assert.equal(assessment.blocking, true);
  assert.equal(assessment.comparativelySupported, false);
});

test("mixed context packages fail closed as NON_COMPARABLE", () => {
  const fixture = comparisonFixture("non-comparable");
  const first = packageDocument(fixture, { comparisonId: "non-comparable", packageId: "non-comparable-a", observations: observations({ count: 3, pairPrefix: "a" }) });
  const second = packageDocument(fixture, { comparisonId: "non-comparable", packageId: "non-comparable-b", observations: observations({ count: 3, pairPrefix: "b" }), environmentDigest: digest("different-environment") });
  ingestComparisonPackage({ file: writePackage(fixture.home, first), home: fixture.home, now: "2026-08-20T12:00:00.000Z" });
  ingestComparisonPackage({ file: writePackage(fixture.home, second), home: fixture.home, now: "2026-08-20T12:00:00.000Z" });
  const scoring = scoreComparison({ home: fixture.home, comparisonId: "non-comparable", now: "2026-08-20T12:00:00.000Z" });
  assert.equal(scoring.status, "NON_COMPARABLE");
  assert.equal(scoring.recommendation, "NON_COMPARABLE");
  assert.equal(scoring.report.comparability.checks.find((item) => item.id === "environmentdigest").status, "FAIL");
});

test("insufficient pairs remain evidence-limited and never claim Candidate superiority", () => {
  const fixture = comparisonFixture("insufficient");
  const document = packageDocument(fixture, { comparisonId: "insufficient", packageId: "insufficient-a", observations: observations({ count: 2 }) });
  const processed = processComparisonPackage({ file: writePackage(fixture.home, document), home: fixture.home, now: "2026-08-20T12:00:00.000Z" });
  assert.equal(processed.scoring.recommendation, "NEED_MORE_EVIDENCE");
  assert.ok(processed.scoring.report.uncertainty.reasons.includes("paired-observations-below-5"));
});

test("missing and conflicting observations remain explicit instead of becoming a quality claim", () => {
  const missingFixture = comparisonFixture("missing-observation");
  const missingRows = observations({ count: 5 });
  missingRows[0].candidate.metrics[0].status = "MISSING";
  delete missingRows[0].candidate.metrics[0].value;
  const missing = processComparisonPackage({
    file: writePackage(missingFixture.home, packageDocument(missingFixture, { comparisonId: "missing-observation", packageId: "missing-observation-a", observations: missingRows })),
    home: missingFixture.home,
    now: "2026-08-20T12:00:00.000Z"
  });
  const missingMetric = missing.scoring.report.metrics.find((item) => item.id === "outcome-success");
  assert.equal(missingMetric.missingPairCount, 1);
  assert.ok(missing.scoring.report.uncertainty.missingRatio > 0);

  const conflictFixture = comparisonFixture("conflicting-observation");
  const conflictRows = observations({ count: 5 });
  conflictRows[0].candidate.metrics[0].value = false;
  const conflict = processComparisonPackage({
    file: writePackage(conflictFixture.home, packageDocument(conflictFixture, { comparisonId: "conflicting-observation", packageId: "conflicting-observation-a", observations: conflictRows })),
    home: conflictFixture.home,
    now: "2026-08-20T12:00:00.000Z"
  });
  assert.equal(conflict.scoring.recommendation, "CONFLICT");
  assert.ok(conflict.scoring.report.uncertainty.conflicts.includes("metric-conflict:outcome-success"));
  assert.equal(conflict.scoring.report.metrics.find((item) => item.id === "outcome-success").status, "INCONCLUSIVE");
});

test("comparison package ingestion is idempotent and rejects immutable package id conflicts", () => {
  const fixture = comparisonFixture("package-integrity");
  const original = packageDocument(fixture, { comparisonId: "package-integrity", packageId: "package-integrity-a", observations: observations({ count: 5 }) });
  const originalFile = writePackage(fixture.home, original);
  assert.equal(ingestComparisonPackage({ file: originalFile, home: fixture.home, now: "2026-08-20T12:00:00.000Z" }).status, "ACCEPTED");
  assert.equal(ingestComparisonPackage({ file: originalFile, home: fixture.home, now: "2026-08-20T12:00:00.000Z" }).status, "DUPLICATE");
  const conflicting = packageDocument(fixture, { comparisonId: "package-integrity", packageId: "package-integrity-a", observations: observations({ count: 5, candidateSuccesses: 4 }) });
  assert.equal(ingestComparisonPackage({ file: writePackage(fixture.home, conflicting, "conflict.yaml"), home: fixture.home, now: "2026-08-20T12:00:00.000Z" }).status, "REJECTED");
});

test("rescoring is append-only and preserves raw packages and prior reports", () => {
  const fixture = comparisonFixture("rescore");
  const document = packageDocument(fixture, { comparisonId: "rescore", packageId: "rescore-a", observations: observations({ count: 5 }) });
  const processed = processComparisonPackage({ file: writePackage(fixture.home, document), home: fixture.home, now: "2026-08-20T12:00:00.000Z" });
  const packageBefore = fs.readFileSync(processed.ingestion.destination, "utf8");
  const reportBefore = fs.readFileSync(processed.scoring.reportPath, "utf8");
  const policy = readYaml(path.join(root, "policies/comparison/default.yaml"));
  policy.metadata.id = "strict-controlled-comparison";
  policy.metadata.version = "1.1.0";
  policy.metadata.lifecycle = "approved";
  policy.spec.minPairedObservations = 10;
  const policyFile = path.join(fixture.home, "strict-comparison-policy.yaml");
  writeYaml(policyFile, policy);
  const rescored = rescoreComparison({ home: fixture.home, reportId: processed.scoring.reportId, policyFile, reason: "Apply the reviewed stricter minimum sample policy.", now: "2026-08-20T13:00:00.000Z" });
  assert.equal(rescored.status, "RESCORED");
  assert.equal(rescored.scoring.recommendation, "NEED_MORE_EVIDENCE");
  assert.equal(fs.readFileSync(processed.ingestion.destination, "utf8"), packageBefore);
  assert.equal(fs.readFileSync(processed.scoring.reportPath, "utf8"), reportBefore);
  assert.equal(rescored.record.authority.rawObservationsMutated, false);
  assert.equal(rescored.record.authority.priorReportsMutated, false);
  const assessment = comparisonAssessmentForProposal(fixture.home, fixture.proposal);
  assert.equal(assessment.status, "VALIDATED");
  assert.equal(assessment.recommendation, "NEED_MORE_EVIDENCE");
  assert.equal(assessment.blocking, true);
});

test("comparison validation rejects tamper, expiry, redaction, approval, and Proposal binding drift", () => {
  const fixture = comparisonFixture("negative-validation");
  const original = packageDocument(fixture, { comparisonId: "negative-validation", packageId: "negative-validation-a", observations: observations({ count: 5 }) });
  const cases = [
    ["tamper", (document) => { document.observations[0].candidate.metrics[0].value = false; }, "package-digest", "2026-08-20T12:00:00.000Z", false],
    ["expired", () => {}, "not-expired", "2026-10-20T12:00:00.000Z", false],
    ["redaction", (document) => { document.redaction.status = "RAW"; finalizePackage(document); }, "redaction", "2026-08-20T12:00:00.000Z", false],
    ["approval", (document) => { document.approval.status = "PENDING"; finalizePackage(document); }, "approval", "2026-08-20T12:00:00.000Z", false],
    ["binding", (document) => { document.candidate.proposalRef.proposalDigest = digest("stale-proposal"); finalizePackage(document); }, "candidate-proposal-digest", "2026-08-20T12:00:00.000Z", false]
  ];
  for (const [name, mutate, expectedFailure, now] of cases) {
    const document = structuredClone(original);
    mutate(document);
    const validation = validateComparisonPackage({ file: writePackage(fixture.home, document, `${name}.yaml`), home: fixture.home, now });
    assert.equal(validation.status, "REJECTED", name);
    assert.ok(validation.failures.some((item) => item.id === expectedFailure), `${name}: ${JSON.stringify(validation.failures)}`);
  }
});

test("every governed context mismatch is stratified and never emitted as a mixed metric aggregate", () => {
  const fixture = comparisonFixture("comparability-matrix");
  const mismatches = [
    ["taskdigest", (document) => { document.comparisonContext.task.digest = digest("other-task"); }],
    ["sourcesnapshotdigest", (document) => { document.comparisonContext.sourceSnapshotDigest = digest("other-source"); }],
    ["environmentdigest", (document) => { document.comparisonContext.environmentDigest = digest("other-environment"); }],
    ["modelconfigurationdigest", (document) => { document.comparisonContext.modelConfigurationDigest = digest("other-model"); }],
    ["toolchaindigest", (document) => { document.comparisonContext.toolchainDigest = digest("other-toolchain"); }],
    ["evaluationpackdigest", (document) => { document.comparisonContext.evaluationPackRef.digest = digest("other-evaluation"); }],
    ["scorersetdigest", (document) => { document.comparisonContext.scorerSet[0].digest = digest("other-scorer"); }]
  ];
  for (const [expectedCheck, mutate] of mismatches) {
    const comparisonId = `matrix-${expectedCheck}`;
    const first = catalogPackageDocument(fixture, { comparisonId, packageId: `${comparisonId}-a`, observations: observations({ count: 5, pairPrefix: `${expectedCheck}-a` }) });
    const second = catalogPackageDocument(fixture, { comparisonId, packageId: `${comparisonId}-b`, observations: observations({ count: 5, pairPrefix: `${expectedCheck}-b` }) });
    mutate(second);
    finalizePackage(second);
    assert.equal(ingestComparisonPackage({ file: writePackage(fixture.home, first), home: fixture.home, now: "2026-08-20T12:00:00.000Z" }).status, "ACCEPTED");
    assert.equal(ingestComparisonPackage({ file: writePackage(fixture.home, second), home: fixture.home, now: "2026-08-20T12:00:00.000Z" }).status, "ACCEPTED");
    const scored = scoreComparison({ home: fixture.home, comparisonId, now: "2026-08-20T12:00:00.000Z" });
    assert.equal(scored.recommendation, "NON_COMPARABLE");
    assert.equal(scored.report.metrics.length, 0);
    assert.equal(scored.report.comparability.strata.length, 2);
    assert.equal(scored.report.comparability.checks.find((item) => item.id === expectedCheck).status, "FAIL");
  }
});

test("a safety regression in a published Catalog Candidate produces a non-executing rollback recommendation", () => {
  const fixture = comparisonFixture("published-rollback");
  const document = catalogPackageDocument(fixture, {
    comparisonId: "published-rollback",
    packageId: "published-rollback-a",
    observations: observations({ count: 5, baselineSuccesses: 3, candidateSuccesses: 5, candidateSafetyFailures: 1 })
  });
  const processed = processComparisonPackage({ file: writePackage(fixture.home, document), home: fixture.home, now: "2026-08-20T12:00:00.000Z" });
  assert.equal(processed.scoring.recommendation, "ROLLBACK_RECOMMENDED");
  assert.equal(processed.scoring.report.authority.mayRollback, false);
  assert.equal(processed.scoring.report.authority.mayExecute, false);
  assert.equal(processed.assetMutation, false);
});

test("Proposal Review, approval, and publication fail closed on comparison contradiction or digest drift", async () => {
  const fixture = comparisonFixture("proposal-gates");
  const ready = packageDocument(fixture, { comparisonId: "proposal-gates", packageId: "proposal-gates-a", observations: observations({ count: 5, pairPrefix: "ready" }) });
  const processed = processComparisonPackage({ file: writePackage(fixture.home, ready), home: fixture.home, now: "2026-08-20T12:00:00.000Z" });
  assert.equal(processed.scoring.recommendation, "CANDIDATE_READY_FOR_HUMAN_REVIEW");
  const reviewer = await startReviewServer();
  try {
    const modelsFile = writeModelsFile(fixture.home, reviewer.url);
    const firstReview = await reviewProposal(fixture.home, fixture.proposal.proposalId, { options: { "models-file": modelsFile, model: "v41-reviewer" } });
    assert.equal(firstReview.verdict, "READY_FOR_HUMAN_APPROVAL");
    assert.equal(firstReview.comparisonAssessment.comparativelySupported, true);

    const additional = packageDocument(fixture, { comparisonId: "proposal-gates", packageId: "proposal-gates-b", observations: observations({ count: 5, pairPrefix: "additional" }) });
    assert.equal(ingestComparisonPackage({ file: writePackage(fixture.home, additional), home: fixture.home, now: "2026-08-20T12:30:00.000Z" }).status, "ACCEPTED");
    const approval = approveProposal(fixture.home, fixture.proposal.proposalId, { confirmedBy: "fixture-reviewer", confirmation: "approve reviewed proposal", evaluationReviewed: true });
    assert.equal(approval.status, "BLOCKED");
    assert.ok(approval.blockers.includes("proposal-comparison-assessment-drift"), JSON.stringify(approval));

    const staleReview = await reviewProposal(fixture.home, fixture.proposal.proposalId, { options: { "models-file": modelsFile, model: "v41-reviewer" } });
    assert.equal(staleReview.comparisonAssessment.status, "STALE");
    assert.equal(staleReview.verdict, "REVISE");
    assert.equal(staleReview.deterministicGates.find((item) => item.id === "controlled-comparison").status, "FAIL");

    const rescored = scoreComparison({ home: fixture.home, comparisonId: "proposal-gates", now: "2026-08-20T13:00:00.000Z" });
    assert.equal(rescored.recommendation, "CANDIDATE_READY_FOR_HUMAN_REVIEW");
    const currentReview = await reviewProposal(fixture.home, fixture.proposal.proposalId, { options: { "models-file": modelsFile, model: "v41-reviewer" } });
    assert.equal(currentReview.verdict, "READY_FOR_HUMAN_APPROVAL");
    const approved = approveProposal(fixture.home, fixture.proposal.proposalId, { confirmedBy: "fixture-reviewer", confirmation: "approve reviewed proposal", evaluationReviewed: true });
    assert.equal(approved.status, "APPROVED", JSON.stringify(approved));

    const reportFile = rescored.reportPath;
    const tampered = JSON.parse(fs.readFileSync(reportFile, "utf8"));
    tampered.reasons.push("tampered-after-approval");
    fs.writeFileSync(reportFile, `${JSON.stringify(tampered, null, 2)}\n`, "utf8");
    const publication = publishProposal(fixture.home, fixture.proposal.proposalId);
    assert.equal(publication.status, "BLOCKED");
    assert.ok(publication.blockers.some((item) => item.startsWith("proposal-comparison-")), JSON.stringify(publication));
  } finally {
    await reviewer.close();
  }
});

test("a semantic reviewer cannot override a deterministic safety regression", async () => {
  const fixture = comparisonFixture("advisor-contradiction");
  const packageFile = writePackage(fixture.home, packageDocument(fixture, {
    comparisonId: "advisor-contradiction",
    packageId: "advisor-contradiction-a",
    observations: observations({ count: 5, candidateSafetyFailures: 1 })
  }));
  processComparisonPackage({ file: packageFile, home: fixture.home, now: "2026-08-20T12:00:00.000Z" });
  const reviewer = await startReviewServer();
  try {
    const review = await reviewProposal(fixture.home, fixture.proposal.proposalId, { options: { "models-file": writeModelsFile(fixture.home, reviewer.url), model: "v41-reviewer" } });
    assert.equal(review.reviewer.status, "SUCCEEDED");
    assert.equal(review.algorithm.semanticVerdict, "READY_FOR_HUMAN_APPROVAL");
    assert.equal(review.comparisonAssessment.recommendation, "REVISE_CANDIDATE");
    assert.equal(review.verdict, "REVISE");
  } finally {
    await reviewer.close();
  }
});

test("calibration replays matching and Proposal policies without mutating the active policy", () => {
  const fixture = comparisonFixture("calibration");
  const processed = processComparisonPackage({
    file: writePackage(fixture.home, packageDocument(fixture, { comparisonId: "calibration", packageId: "calibration-a", observations: observations({ count: 5 }) })),
    home: fixture.home,
    now: "2026-08-20T12:00:00.000Z"
  });
  const policies = calibrationPolicies(fixture.home);
  const caseSetFile = writeCalibrationCaseSet(fixture, processed.scoring.report, "calibration-cases");
  const activeBefore = fs.readFileSync(policies.baselineComparison, "utf8");
  const validation = validateCalibrationCaseSet({ file: caseSetFile, home: fixture.home });
  assert.equal(validation.status, "VALIDATED", JSON.stringify(validation.failures));
  assert.equal(ingestCalibrationCaseSet({ file: caseSetFile, home: fixture.home }).status, "ACCEPTED");
  const calibrated = runCalibration({
    home: fixture.home,
    caseSetId: "calibration-cases",
    baselineMatchPolicyFile: policies.baselineMatch,
    candidateMatchPolicyFile: policies.candidateMatch,
    baselineComparisonPolicyFile: policies.baselineComparison,
    candidateComparisonPolicyFile: policies.candidateComparison,
    now: "2026-08-20T14:00:00.000Z"
  });
  assert.equal(calibrated.status, "CALIBRATED");
  assert.equal(calibrated.recommendation, "REVISE_CANDIDATE_POLICY");
  assert.ok(calibrated.report.summary.regressions.length >= 1);
  assert.ok(calibrated.report.conflicts.length >= 1);
  assert.equal(calibrated.report.ranking[0].policySide, "BASELINE");
  assert.equal(calibrated.report.summary.candidate.falseUpgradeRate, 0);
  assert.equal(calibrated.report.authority.activePolicyMutated, false);
  assert.equal(calibrated.idempotentReplay, false);
  const reportBefore = fs.readFileSync(calibrated.reportPath, "utf8");

  const laterEvidence = packageDocument(fixture, {
    comparisonId: "calibration",
    packageId: "calibration-later-evidence",
    observations: observations({ count: 5, pairPrefix: "later", candidateSafetyFailures: 1 })
  });
  assert.equal(ingestComparisonPackage({ file: writePackage(fixture.home, laterEvidence, "calibration-later.yaml"), home: fixture.home, now: "2026-08-20T15:00:00.000Z" }).status, "ACCEPTED");
  const replayed = runCalibration({
    home: fixture.home,
    caseSetId: "calibration-cases",
    baselineMatchPolicyFile: policies.baselineMatch,
    candidateMatchPolicyFile: policies.candidateMatch,
    baselineComparisonPolicyFile: policies.baselineComparison,
    candidateComparisonPolicyFile: policies.candidateComparison,
    now: "2026-08-21T14:00:00.000Z"
  });
  assert.equal(replayed.idempotentReplay, true);
  assert.equal(replayed.reportId, calibrated.reportId);
  assert.equal(replayed.reportDigest, calibrated.reportDigest);
  assert.equal(JSON.stringify(replayed.report), JSON.stringify(calibrated.report));
  assert.equal(fs.readFileSync(calibrated.reportPath, "utf8"), reportBefore);
  assert.equal(fs.readFileSync(policies.baselineComparison, "utf8"), activeBefore);
});

test("Harness Hub exposes comparison and calibration summaries through a read-only API", async (t) => {
  const fixture = comparisonFixture("hub-comparison-calibration");
  const processed = processComparisonPackage({
    file: writePackage(fixture.home, packageDocument(fixture, { comparisonId: "hub-comparison-calibration", packageId: "hub-comparison-calibration-a", observations: observations({ count: 5 }) })),
    home: fixture.home,
    now: "2026-08-20T12:00:00.000Z"
  });
  const policies = calibrationPolicies(fixture.home);
  const caseSetFile = writeCalibrationCaseSet(fixture, processed.scoring.report, "hub-calibration-cases");
  ingestCalibrationCaseSet({ file: caseSetFile, home: fixture.home });
  runCalibration({
    home: fixture.home,
    caseSetId: "hub-calibration-cases",
    baselineMatchPolicyFile: policies.baselineMatch,
    candidateMatchPolicyFile: policies.candidateMatch,
    baselineComparisonPolicyFile: policies.baselineComparison,
    candidateComparisonPolicyFile: policies.candidateComparison,
    now: "2026-08-20T14:00:00.000Z"
  });

  const snapshot = buildHubSnapshot(fixture.home);
  assert.equal(snapshot.comparisons.packageCount, 1);
  assert.equal(snapshot.comparisons.reportCount, 1);
  assert.equal(snapshot.comparisons.latestReport.recommendation, "CANDIDATE_READY_FOR_HUMAN_REVIEW");
  assert.deepEqual(snapshot.comparisons.latestReport.blockers, []);
  assert.equal(snapshot.comparisons.latestReport.uncertainty.level, "LOW");
  assert.equal(snapshot.comparisons.latestReport.provenance.algorithmVersion, "paired-comparison/v1");
  assert.ok(snapshot.comparisons.latestReport.limitations.length >= 1);
  assert.equal(snapshot.comparisons.latestReport.nextAction, "proposal-review");
  assert.equal(snapshot.calibration.caseSetCount, 1);
  assert.equal(snapshot.calibration.reportCount, 1);
  assert.equal(snapshot.calibration.latestReport.recommendation, "REVISE_CANDIDATE_POLICY");
  assert.ok(snapshot.calibration.latestReport.blockers.length >= 1);
  assert.equal(snapshot.calibration.latestReport.uncertainty.level, "MEDIUM");
  assert.equal(snapshot.calibration.latestReport.provenance.algorithmVersion, "cross-version-policy-replay/v1");
  assert.ok(snapshot.calibration.latestReport.limitations.length >= 1);
  assert.equal(snapshot.calibration.latestReport.nextAction, "revise-candidate-policy");
  const serialized = JSON.stringify(snapshot);
  assert.doesNotMatch(serialized, /\"observations\"|\"apiKey\"|\"authorization\"/i);
  assert.equal(serialized.includes(fixture.home), false);
  assert.equal(serialized.includes(root), false);
  assert.match(serialized, /workspace:\/\/\//);
  assert.match(serialized, /package:\/\/\//);

  const server = serveHubV3(fixture.home, { host: "127.0.0.1", port: 0 });
  t.after(() => server.close());
  if (!server.listening) await new Promise((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const read = await fetch(`${base}/api/v3/snapshot`);
  assert.equal(read.status, 200);
  assert.equal((await read.json()).comparisons.latestReport.recommendation, "CANDIDATE_READY_FOR_HUMAN_REVIEW");
  const mutation = await fetch(`${base}/api/v3/snapshot`, { method: "POST" });
  assert.equal(mutation.status, 405);
  assert.deepEqual(await mutation.json(), { status: "method-not-allowed", allowed: ["GET"] });
});

test("real stdio MCP completes comparison and calibration review sessions without human CLI commands", async () => {
  const fixture = comparisonFixture("mcp-comparison-calibration");
  const packageFile = writePackage(fixture.home, packageDocument(fixture, {
    comparisonId: "mcp-comparison-calibration",
    packageId: "mcp-comparison-calibration-a",
    observations: observations({ count: 5 })
  }));
  let first = new TestMcpClient({ command: process.execPath, args: ["src/index.mjs", "mcp", "serve", "--workspace", fixture.home], cwd: root });
  let resumedState;
  try {
    await first.initialize();
    const inspected = structured(await first.tool("run_engine_diagnostic", { operation: "comparison.inspect", input: { file: packageFile } }));
    assert.equal(inspected.operation, "comparison.inspect");
    const validated = structured(await first.tool("run_engine_diagnostic", { operation: "comparison.validate", input: { file: packageFile, now: "2026-08-20T12:00:00.000Z" } }));
    assert.equal(validated.status, "VALIDATED");
    let session = structured(await first.tool("start_operation_session", { intent: "Compare the governed Baseline and Candidate evidence", adapterId: "codex-v41" }));
    const planResult = await first.tool("plan_operation_session", { sessionId: session.sessionId, expectedSessionDigest: session.sessionDigest, scenario: "comparison", goal: session.intent.text, sources: { comparisonFile: packageFile, now: "2026-08-20T12:00:00.000Z" } });
    assert.equal(planResult.isError, undefined, JSON.stringify(planResult.structuredContent));
    session = structured(planResult);
    session = structured(await first.tool("confirm_operation_plan", { sessionId: session.sessionId, expectedSessionDigest: session.sessionDigest, expectedPlanDigest: session.planDigest, confirmedBy: "fixture-reviewer", confirmation: `CONFIRM_OPERATION_PLAN:${session.planDigest}` }));
    resumedState = { sessionId: session.sessionId, sessionDigest: session.sessionDigest, planDigest: session.planDigest };
  } finally {
    await first.close();
  }

  const second = new TestMcpClient({ command: process.execPath, args: ["src/index.mjs", "mcp", "serve", "--workspace", fixture.home], cwd: root });
  try {
    await second.initialize();
    let session = structured(await second.tool("resume_operation_session", { sessionId: resumedState.sessionId, expectedSessionDigest: resumedState.sessionDigest, adapterId: "workbuddy-v41" }));
    assert.deepEqual(session.adapter.history, ["codex-v41", "workbuddy-v41"]);
    session = structured(await second.tool("execute_operation_plan", { sessionId: session.sessionId, expectedSessionDigest: session.sessionDigest, expectedPlanDigest: resumedState.planDigest }));
    assert.equal(session.status, "EVIDENCE_REVIEW_REQUIRED");
    assert.equal(session.operations.at(-1).operation, "comparison.process");
    assert.equal(session.evidenceReports.length, 1);
    const comparison = session.evidenceReports[0];
    assert.equal(comparison.type, "COMPARISON");
    assert.equal(comparison.recommendation, "CANDIDATE_READY_FOR_HUMAN_REVIEW");
    assert.ok(comparison.metrics.length >= 1);
    session = structured(await second.tool("acknowledge_evidence_report_review", {
      sessionId: session.sessionId,
      expectedSessionDigest: session.sessionDigest,
      reportType: "COMPARISON",
      reportId: comparison.reportId,
      expectedReportDigest: comparison.reportDigest,
      confirmedBy: "fixture-reviewer",
      confirmation: `ACKNOWLEDGE_COMPARISON_REVIEW:${comparison.reportId}:${comparison.reportDigest}`
    }));
    assert.equal(session.status, "COMPLETED");
    const reported = structured(await second.tool("run_engine_diagnostic", { operation: "comparison.report", input: { reportId: comparison.reportId } }));
    assert.equal(reported.status, "FOUND");

    const policies = calibrationPolicies(fixture.home);
    let maintenance = structured(await second.tool("start_operation_session", { intent: "Exercise append-only comparison ingestion, scoring, and rescoring", adapterId: "workbuddy-v41" }));
    maintenance = structured(await second.tool("plan_operation_session", {
      sessionId: maintenance.sessionId,
      expectedSessionDigest: maintenance.sessionDigest,
      scenario: "maintenance",
      goal: maintenance.intent.text,
      operations: [
        { operation: "comparison.ingest", input: { file: packageFile, now: "2026-08-20T12:00:00.000Z" } },
        { operation: "comparison.score", input: { comparisonId: "mcp-comparison-calibration", now: "2026-08-20T12:30:00.000Z" } },
        { operation: "comparison.rescore", input: { reportId: comparison.reportId, policyFile: policies.candidateComparison, reason: "Apply the reviewed stricter comparison policy.", now: "2026-08-20T13:00:00.000Z" } }
      ]
    }));
    maintenance = structured(await second.tool("confirm_operation_plan", { sessionId: maintenance.sessionId, expectedSessionDigest: maintenance.sessionDigest, expectedPlanDigest: maintenance.planDigest, confirmedBy: "fixture-reviewer", confirmation: `CONFIRM_OPERATION_PLAN:${maintenance.planDigest}` }));
    maintenance = structured(await second.tool("execute_operation_plan", { sessionId: maintenance.sessionId, expectedSessionDigest: maintenance.sessionDigest, expectedPlanDigest: maintenance.planDigest }));
    assert.equal(maintenance.status, "EVIDENCE_REVIEW_REQUIRED");
    assert.deepEqual(maintenance.operations.filter((item) => item.phase === "plan").map((item) => item.operation), ["comparison.ingest", "comparison.score", "comparison.rescore"]);
    for (const report of maintenance.evidenceReports) {
      maintenance = structured(await second.tool("acknowledge_evidence_report_review", {
        sessionId: maintenance.sessionId,
        expectedSessionDigest: maintenance.sessionDigest,
        reportType: "COMPARISON",
        reportId: report.reportId,
        expectedReportDigest: report.reportDigest,
        confirmedBy: "fixture-reviewer",
        confirmation: `ACKNOWLEDGE_COMPARISON_REVIEW:${report.reportId}:${report.reportDigest}`
      }));
    }
    assert.equal(maintenance.status, "COMPLETED");

    const caseSetFile = writeCalibrationCaseSet(fixture, reported.result.report, "mcp-calibration-cases");
    const calibrationValidation = structured(await second.tool("run_engine_diagnostic", { operation: "calibration.validate", input: { file: caseSetFile } }));
    assert.equal(calibrationValidation.status, "VALIDATED");
    let calibrationIngest = structured(await second.tool("start_operation_session", { intent: "Ingest the reviewed immutable calibration case set", adapterId: "workbuddy-v41" }));
    calibrationIngest = structured(await second.tool("plan_operation_session", { sessionId: calibrationIngest.sessionId, expectedSessionDigest: calibrationIngest.sessionDigest, scenario: "maintenance", goal: calibrationIngest.intent.text, operations: [{ operation: "calibration.ingest", input: { file: caseSetFile } }] }));
    calibrationIngest = structured(await second.tool("confirm_operation_plan", { sessionId: calibrationIngest.sessionId, expectedSessionDigest: calibrationIngest.sessionDigest, expectedPlanDigest: calibrationIngest.planDigest, confirmedBy: "fixture-reviewer", confirmation: `CONFIRM_OPERATION_PLAN:${calibrationIngest.planDigest}` }));
    calibrationIngest = structured(await second.tool("execute_operation_plan", { sessionId: calibrationIngest.sessionId, expectedSessionDigest: calibrationIngest.sessionDigest, expectedPlanDigest: calibrationIngest.planDigest }));
    assert.equal(calibrationIngest.status, "COMPLETED");
    assert.equal(calibrationIngest.operations.at(-1).operation, "calibration.ingest");
    let calibration = structured(await second.tool("start_operation_session", { intent: "Calibrate matching and Proposal policies from reviewed evidence cases", adapterId: "workbuddy-v41" }));
    const calibrationPlanResult = await second.tool("plan_operation_session", {
      sessionId: calibration.sessionId,
      expectedSessionDigest: calibration.sessionDigest,
      scenario: "calibration",
      goal: calibration.intent.text,
      sources: {
        calibrationCaseSet: caseSetFile,
        baselineMatchPolicy: policies.baselineMatch,
        candidateMatchPolicy: policies.candidateMatch,
        baselineComparisonPolicy: policies.baselineComparison,
        candidateComparisonPolicy: policies.candidateComparison,
        now: "2026-08-20T14:00:00.000Z"
      }
    });
    assert.equal(calibrationPlanResult.isError, undefined, JSON.stringify(calibrationPlanResult.structuredContent));
    calibration = structured(calibrationPlanResult);
    calibration = structured(await second.tool("confirm_operation_plan", { sessionId: calibration.sessionId, expectedSessionDigest: calibration.sessionDigest, expectedPlanDigest: calibration.planDigest, confirmedBy: "fixture-reviewer", confirmation: `CONFIRM_OPERATION_PLAN:${calibration.planDigest}` }));
    calibration = structured(await second.tool("execute_operation_plan", { sessionId: calibration.sessionId, expectedSessionDigest: calibration.sessionDigest, expectedPlanDigest: calibration.planDigest }));
    assert.equal(calibration.status, "EVIDENCE_REVIEW_REQUIRED");
    assert.equal(calibration.operations.at(-1).operation, "calibration.run");
    const calibrationReport = calibration.evidenceReports[0];
    assert.equal(calibrationReport.type, "CALIBRATION");
    assert.equal(calibrationReport.recommendation, "REVISE_CANDIDATE_POLICY");
    calibration = structured(await second.tool("acknowledge_evidence_report_review", {
      sessionId: calibration.sessionId,
      expectedSessionDigest: calibration.sessionDigest,
      reportType: "CALIBRATION",
      reportId: calibrationReport.reportId,
      expectedReportDigest: calibrationReport.reportDigest,
      confirmedBy: "fixture-reviewer",
      confirmation: `ACKNOWLEDGE_CALIBRATION_REVIEW:${calibrationReport.reportId}:${calibrationReport.reportDigest}`
    }));
    assert.equal(calibration.status, "COMPLETED");
    const calibrationRead = structured(await second.tool("run_engine_diagnostic", { operation: "calibration.report", input: { reportId: calibrationReport.reportId } }));
    assert.equal(calibrationRead.status, "FOUND");
  } finally {
    await second.close();
  }
});

test("atomic JSON CLI covers comparison and calibration lifecycle with structured next actions", () => {
  const fixture = comparisonFixture("cli-contract");
  const packageFile = writePackage(fixture.home, packageDocument(fixture, { comparisonId: "cli-contract", packageId: "cli-contract-a", observations: observations({ count: 5 }) }));
  assert.equal(runJson(["comparison", "inspect", packageFile, "--workspace", fixture.home, "--json"]).status, "INSPECTED");
  assert.equal(runJson(["comparison", "validate", packageFile, "--workspace", fixture.home, "--now", "2026-08-20T12:00:00.000Z", "--json"]).status, "VALIDATED");
  assert.equal(runJson(["comparison", "ingest", packageFile, "--workspace", fixture.home, "--now", "2026-08-20T12:00:00.000Z", "--json"]).status, "ACCEPTED");
  const scored = runJson(["comparison", "score", "cli-contract", "--workspace", fixture.home, "--now", "2026-08-20T12:00:00.000Z", "--json"]);
  assert.equal(scored.status, "SCORED");
  assert.equal(scored.nextAction, "proposal-review");
  assert.equal(runJson(["comparison", "report", scored.reportId, "--workspace", fixture.home, "--json"]).status, "FOUND");
  const processed = runJson(["comparison", "process", packageFile, "--workspace", fixture.home, "--now", "2026-08-20T12:00:00.000Z", "--json"]);
  assert.equal(processed.status, "PROCESSED");
  assert.equal(processed.ingestion.status, "DUPLICATE");

  const policies = calibrationPolicies(fixture.home);
  const rescored = runJson(["comparison", "rescore", scored.reportId, "--workspace", fixture.home, "--policy-file", policies.candidateComparison, "--reason", "Validate the candidate comparison policy through append-only replay.", "--now", "2026-08-20T13:00:00.000Z", "--json"]);
  assert.equal(rescored.status, "RESCORED");
  assert.equal(rescored.rawObservationsMutated, false);

  const caseSetFile = writeCalibrationCaseSet(fixture, scored.report, "cli-calibration-cases");
  assert.equal(runJson(["calibration", "validate", caseSetFile, "--workspace", fixture.home, "--json"]).status, "VALIDATED");
  assert.equal(runJson(["calibration", "ingest", caseSetFile, "--workspace", fixture.home, "--json"]).status, "ACCEPTED");
  const calibrated = runJson([
    "calibration", "run", "--workspace", fixture.home, "--case-set-id", "cli-calibration-cases",
    "--baseline-match-policy", policies.baselineMatch, "--candidate-match-policy", policies.candidateMatch,
    "--baseline-comparison-policy", policies.baselineComparison, "--candidate-comparison-policy", policies.candidateComparison,
    "--now", "2026-08-20T14:00:00.000Z", "--json"
  ]);
  assert.equal(calibrated.status, "CALIBRATED");
  assert.ok(calibrated.nextAction);
  assert.equal(runJson(["calibration", "report", calibrated.reportId, "--workspace", fixture.home, "--json"]).status, "FOUND");
});

function comparisonFixture(id) {
  const home = temporaryHome(id);
  runJson(["workspace", "init", "--workspace", home, "--json"]);
  const project = path.join(home, "project");
  fs.mkdirSync(path.join(project, "src"), { recursive: true });
  fs.writeFileSync(path.join(project, "package.json"), JSON.stringify({ name: id, scripts: { build: "node build.js", test: "node test.js" } }), "utf8");
  fs.writeFileSync(path.join(project, "src/server.js"), "// Distributed cache server protocol, key-value store, TTL, eviction, hash slots, persistence, replication, sharding, migration, and failover.\nexport class CacheServer {}\n", "utf8");
  fs.writeFileSync(path.join(project, "README.md"), "Distributed cache product and Redis-compatible key-value store. Build, test, validate, benchmark, and release cache server protocol, TTL, eviction, persistence, replication, sharding, migration, failover, diagnostics, and observability.", "utf8");
  const produced = runJson(["produce", "--workspace", home, "--source-project", project, "--goal", "Evolve the reusable distributed cache product Harness asset.", "--advisor", "off", "--json"], { allowFailure: true });
  assert.equal(produced.reasoning.decision, "EVOLVE_EXISTING");
  const proposal = readYaml(path.join(home, "evolution-runs", produced.runId, "proposal.yaml"));
  const profiles = discoverAssets([path.join(home, "catalogs/builtin/assets")]).filter((item) => item.asset.kind === "HarnessProfile" && item.asset.metadata.lifecycle === "published");
  const baseline = profiles.find((item) => item.asset.metadata.id === produced.reasoning.targetProfile?.id && item.asset.metadata.version === produced.reasoning.targetProfile?.version) ?? profiles[0];
  assert.ok(baseline);
  const catalogCandidate = profiles.find((item) => item.asset.metadata.id !== baseline.asset.metadata.id);
  assert.ok(catalogCandidate);
  const candidateAsset = proposal.proposedAssets.find((item) => item.kind === "HarnessProfile");
  assert.ok(candidateAsset);
  return { home, proposal, baseline, catalogCandidate, candidateAsset };
}

function packageDocument(fixture, { comparisonId, packageId, observations: pairs, environmentDigest = digest("environment") }) {
  const document = {
    apiVersion: "comparison.evopilot.io/v1",
    kind: "HarnessComparisonEvidencePackage",
    metadata: {
      comparisonId,
      packageId,
      version: "1.0.0",
      generatedAt: "2026-08-20T10:00:00.000Z",
      expiresAt: "2026-09-20T10:00:00.000Z",
      producer: { name: "fixture-evaluator", version: "1.0.0", instanceId: packageId },
      packageDigest: "sha256:".padEnd(71, "0")
    },
    approval: { status: "APPROVED", approvedBy: "fixture-reviewer", approvedAt: "2026-08-20T11:00:00.000Z", purpose: "HARNESS_COMPARISON_EVIDENCE" },
    redaction: { status: "REDACTED", method: "fixture-redaction/v1", payloadDigest: "sha256:".padEnd(71, "0") },
    baseline: {
      source: "CATALOG",
      assetRefs: [{ kind: fixture.baseline.asset.kind, id: fixture.baseline.asset.metadata.id, version: fixture.baseline.asset.metadata.version, digest: fixture.baseline.digest }]
    },
    candidate: {
      source: "PROPOSAL",
      assetRefs: [{ kind: fixture.candidateAsset.kind, id: fixture.candidateAsset.metadata.id, version: fixture.candidateAsset.metadata.version, digest: digest(fixture.candidateAsset) }],
      proposalRef: { proposalId: fixture.proposal.proposalId, proposalDigest: reviewInputDigest(fixture.proposal) }
    },
    comparisonContext: {
      task: { id: "redis-failover-task", digest: digest("redis-failover-task") },
      sourceSnapshotDigest: digest("source-snapshot"),
      environmentDigest,
      modelConfigurationDigest: digest("model-configuration"),
      toolchainDigest: digest("toolchain"),
      evaluationPackRef: { id: fixture.proposal.evaluationPack.metadata.id, version: fixture.proposal.evaluationPack.metadata.version, digest: digest(fixture.proposal.evaluationPack) },
      scorerSet: [{ id: "redis-failover-scorer", version: "1.0.0", digest: digest("redis-failover-scorer@1.0.0") }]
    },
    metricDefinitions: [
      { id: "outcome-success", dimension: "OUTCOME", valueType: "BOOLEAN", direction: "TRUE_IS_BETTER", required: true, blocking: false, minimumMeaningfulDelta: 0, maximumAllowedRegression: 0 },
      { id: "safety-safe", dimension: "SAFETY", valueType: "BOOLEAN", direction: "TRUE_IS_BETTER", required: true, blocking: true, minimumMeaningfulDelta: 0, maximumAllowedRegression: 0 },
      { id: "token-cost", dimension: "COST", valueType: "NUMBER", direction: "LOWER_IS_BETTER", unit: "tokens", required: false, blocking: false, minimumMeaningfulDelta: 10, maximumAllowedRegression: 100 }
    ],
    observations: pairs,
    provenance: { sourceId: packageId, sourceType: "EVALUATOR", generatedBy: "fixture-evaluator", evidenceDigests: [digest(`${packageId}-evidence`)] }
  };
  return finalizePackage(document);
}

function catalogPackageDocument(fixture, options) {
  const document = packageDocument(fixture, options);
  document.candidate = {
    source: "CATALOG",
    assetRefs: [{ kind: fixture.catalogCandidate.asset.kind, id: fixture.catalogCandidate.asset.metadata.id, version: fixture.catalogCandidate.asset.metadata.version, digest: fixture.catalogCandidate.digest }]
  };
  return finalizePackage(document);
}

function finalizePackage(document) {
  document.redaction.payloadDigest = comparisonPayloadDigest(document);
  document.metadata.packageDigest = comparisonPackageDigest(document);
  return document;
}

function observations({ count, baselineSuccesses = Math.max(1, count - 2), candidateSuccesses = count, candidateSafetyFailures = 0, pairPrefix = "pair" }) {
  return Array.from({ length: count }, (_, index) => ({
    pairId: `${pairPrefix}-${index + 1}`,
    baseline: {
      executionId: `baseline-${pairPrefix}-${index + 1}`,
      completedAt: `2026-08-20T10:${String(index).padStart(2, "0")}:00.000Z`,
      metrics: [
        { metricId: "outcome-success", status: "OBSERVED", value: index < baselineSuccesses },
        { metricId: "safety-safe", status: "OBSERVED", value: true },
        { metricId: "token-cost", status: "OBSERVED", value: 1000 }
      ]
    },
    candidate: {
      executionId: `candidate-${pairPrefix}-${index + 1}`,
      completedAt: `2026-08-20T11:${String(index).padStart(2, "0")}:00.000Z`,
      metrics: [
        { metricId: "outcome-success", status: "OBSERVED", value: index < candidateSuccesses },
        { metricId: "safety-safe", status: "OBSERVED", value: index >= candidateSafetyFailures },
        { metricId: "token-cost", status: "OBSERVED", value: 990 }
      ]
    }
  }));
}

function calibrationPolicies(home) {
  const baselineMatch = path.join(home, "policies/matcher/default.yaml");
  const candidateMatch = path.join(home, "candidate-match-policy.yaml");
  const match = readYaml(baselineMatch);
  match.metadata.id = "candidate-match-policy";
  match.metadata.version = "2.0.0";
  match.metadata.lifecycle = "review";
  writeYaml(candidateMatch, match);

  const baselineComparison = fs.readdirSync(path.join(home, "policies/comparison")).map((name) => path.join(home, "policies/comparison", name)).find((file) => readYaml(file).kind === "ComparisonPolicyPack");
  const candidateComparison = path.join(home, "candidate-comparison-policy.yaml");
  const comparison = readYaml(baselineComparison);
  comparison.metadata.id = "candidate-comparison-policy";
  comparison.metadata.version = "2.0.0";
  comparison.metadata.lifecycle = "approved";
  comparison.spec.minPairedObservations = 10;
  writeYaml(candidateComparison, comparison);
  return { baselineMatch, candidateMatch, baselineComparison, candidateComparison };
}

function writeCalibrationCaseSet(fixture, comparisonReport, id) {
  const graphFile = path.join(fixture.home, "evolution-runs", fixture.proposal.proposalId, "evidence-graph.json");
  const graph = JSON.parse(fs.readFileSync(graphFile, "utf8"));
  const reportRef = { reportId: comparisonReport.metadata.reportId, reportDigest: comparisonReport.metadata.reportDigest };
  const document = {
    apiVersion: "comparison.evopilot.io/v1",
    kind: "HarnessCalibrationCaseSet",
    metadata: { id, version: "1.0.0", createdAt: "2026-08-20T12:30:00.000Z", caseSetDigest: "sha256:".padEnd(71, "0") },
    review: { status: "APPROVED", reviewedBy: "independent-fixture-reviewer", reviewedAt: "2026-08-20T13:00:00.000Z", evidenceRefs: [digest(`${id}-review-evidence`)] },
    cases: [
      {
        id: `${id}-matching`,
        caseType: "MATCHING",
        evidenceGraphRef: { runId: graph.runId, digest: graph.graphDigest },
        expected: { decision: fixture.proposal.decision, ...(fixture.proposal.targetProfile?.id ? { targetProfileId: fixture.proposal.targetProfile.id } : {}) },
        comparisonReportRef: reportRef
      },
      { id: `${id}-proposal-a`, caseType: "PROPOSAL", comparisonId: comparisonReport.metadata.comparisonId, expectedRecommendation: comparisonReport.recommendation, comparisonReportRef: reportRef },
      { id: `${id}-proposal-b`, caseType: "PROPOSAL", comparisonId: comparisonReport.metadata.comparisonId, expectedRecommendation: comparisonReport.recommendation, comparisonReportRef: reportRef }
    ]
  };
  document.metadata.caseSetDigest = calibrationCaseSetDigest(document);
  const file = path.join(fixture.home, "fixtures", `${id}.yaml`);
  writeYaml(file, document);
  return file;
}

function writeModelsFile(home, url) {
  const file = path.join(home, "models.v41.json");
  fs.writeFileSync(file, `${JSON.stringify({ models: [{ id: "v41-reviewer", name: "v4.1 Review Fixture", vendor: "zhipu", apiKey: "test-only", url }] }, null, 2)}\n`, "utf8");
  return file;
}

async function startReviewServer() {
  const server = http.createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    const prompt = JSON.parse(body.messages.at(-1).content);
    const evidenceId = prompt.evidenceGraph[0].evidenceId;
    const projectMembership = prompt.sources.map((source) => ({ sourceId: source.sourceId, sourceType: source.sourceType, sourceRef: source.sourceRef, status: "IN_SCOPE", rationale: "The cited static evidence supports this bounded engineering asset.", evidenceIds: [source.evidenceIds[0]] }));
    const assessment = {
      verdict: "READY_FOR_HUMAN_APPROVAL",
      summary: "The evidence-bound Proposal is ready for a separate human approval decision.",
      findings: [{ id: "semantic-boundary", severity: "info", dimension: "boundary", conclusion: "The Proposal is bounded and evidence-backed.", reasons: ["Static evidence and deterministic gates support review."], evidenceIds: [evidenceId], suggestedActions: ["Complete explicit human review."] }],
      reasons: ["The Proposal satisfies the semantic review contract."],
      groupCoherence: { status: "COHERENT", rationale: "The evidence has one reusable boundary.", evidenceIds: projectMembership.length > 1 ? [evidenceId] : [] },
      projectMembership,
      boundaryAssessment: { status: "PRECISE", rationale: "The boundary is specific and excludes unrelated ownership.", evidenceIds: [evidenceId] },
      existingAssetOverlap: { status: "REVIEWED", rationale: "Catalog overlap was considered.", candidates: [], evidenceIds: [] },
      definitionQuality: { status: "READY", score: 0.95, rationale: "The definition is constrained and evaluable.", checks: [{ id: "specificity", status: "PASS" }], evidenceIds: [] },
      evaluationSufficiency: { status: "READY_FOR_REVIEW", rationale: "Positive and negative cases are present.", evidenceIds: [] },
      advisorAssessment: { status: "ADVISORY_ONLY", rationale: "The semantic reviewer cannot override deterministic comparison gates.", evidenceIds: [evidenceId] },
      suggestedActions: ["Proceed only when deterministic gates remain current."]
    };
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(assessment) } }], usage: { prompt_tokens: 100, completion_tokens: 80, total_tokens: 180 } }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { url: `http://127.0.0.1:${server.address().port}/v4`, close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())) };
}

function writePackage(home, document, name = `${document.metadata.packageId}.yaml`) {
  const file = path.join(home, "fixtures", name);
  writeYaml(file, document);
  return file;
}

function temporaryHome(id) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), `evopilot-harness-v41-${id}-`));
  test.after(() => fs.rmSync(home, { recursive: true, force: true }));
  return home;
}

function runJson(args, { allowFailure = false } = {}) {
  const run = spawnSync(process.execPath, [cli, ...args], { cwd: root, encoding: "utf8" });
  assert.ok(run.stdout.trim(), run.stderr);
  const body = JSON.parse(run.stdout);
  if (!allowFailure) assert.equal(run.status, 0, JSON.stringify(body));
  return body;
}
