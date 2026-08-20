import fs from "node:fs";
import path from "node:path";
import { scoreComparison, loadComparisonPolicy, readComparisonReport } from "./comparison.mjs";
import { reasonEvidence } from "./reasoning.mjs";
import { validateDocument } from "./schema.mjs";
import { digest, readYaml, safeId, walkFiles, writeJson, writeYaml } from "./utils.mjs";

export const CALIBRATION_ALGORITHM_VERSION = "cross-version-policy-replay/v1";

const CASE_SET_KIND = "HarnessCalibrationCaseSet";
const REPORT_KIND = "HarnessCalibrationReport";

export function calibrationCaseSetDigest(document) {
  const copy = structuredClone(document);
  if (copy?.metadata) delete copy.metadata.caseSetDigest;
  return digest(copy);
}

export function calibrationReportDigest(document) {
  const copy = structuredClone(document);
  if (copy?.metadata) delete copy.metadata.reportDigest;
  return digest(copy);
}

export function validateCalibrationCaseSet({ file, home }) {
  const resolved = path.resolve(file);
  let document;
  try {
    document = readYaml(resolved);
  } catch (error) {
    return failedCaseSetValidation(resolved, null, [{ id: "case-set-file", status: "FAIL", evidence: [message(error)] }]);
  }
  const checks = [];
  const schemaValidation = validateDocument(document, resolved);
  checks.push(check("schema", schemaValidation.valid, schemaValidation.errors));
  if (document?.kind !== CASE_SET_KIND) return failedCaseSetValidation(resolved, document, checks, schemaValidation);
  const calculatedDigest = calibrationCaseSetDigest(document);
  checks.push(check("case-set-digest", document.metadata.caseSetDigest === calculatedDigest, [`expected=${document.metadata.caseSetDigest}`, `actual=${calculatedDigest}`]));
  checks.push(check("review", document.review?.status === "APPROVED", [`status=${document.review?.status ?? "missing"}`]));
  const caseIds = (document.cases ?? []).map((item) => item.id);
  checks.push(check("case-ids", caseIds.length === new Set(caseIds).size, caseIds));
  const createdAt = Date.parse(document.metadata?.createdAt);
  const reviewedAt = Date.parse(document.review?.reviewedAt);
  checks.push(check("review-time-order", Number.isFinite(createdAt) && Number.isFinite(reviewedAt) && createdAt <= reviewedAt, [`createdAt=${document.metadata?.createdAt}`, `reviewedAt=${document.review?.reviewedAt}`]));
  checks.push(...caseReferenceChecks(document, home));
  const failures = checks.filter((item) => item.status === "FAIL");
  return {
    schema: "evopilot-harness-calibration-case-set-validation/v1",
    status: failures.length ? "REJECTED" : "VALIDATED",
    valid: failures.length === 0,
    file: resolved,
    caseSetId: document.metadata?.id ?? null,
    version: document.metadata?.version ?? null,
    caseSetDigest: document.metadata?.caseSetDigest ?? null,
    calculatedDigest,
    checks,
    failures,
    schemaValidation,
    document
  };
}

export function ingestCalibrationCaseSet({ file, home }) {
  const validation = validateCalibrationCaseSet({ file, home });
  if (validation.status !== "VALIDATED") return { schema: "evopilot-harness-calibration-case-set-ingestion/v1", status: "REJECTED", validation, nextAction: "repair-calibration-case-set" };
  const destination = path.join(home, "comparisons/calibration/case-sets", `${safeId(validation.caseSetId)}@${validation.version}.yaml`);
  if (fs.existsSync(destination)) {
    const existing = readYaml(destination);
    if (calibrationCaseSetDigest(existing) !== validation.calculatedDigest) return { schema: "evopilot-harness-calibration-case-set-ingestion/v1", status: "REJECTED", validation, blockers: ["immutable-case-set-version-conflict"], destination, nextAction: "publish-new-case-set-version" };
    return { schema: "evopilot-harness-calibration-case-set-ingestion/v1", status: "DUPLICATE", validation, destination, nextAction: "run-calibration" };
  }
  writeYaml(destination, validation.document);
  return { schema: "evopilot-harness-calibration-case-set-ingestion/v1", status: "ACCEPTED", validation, destination, nextAction: "run-calibration" };
}

export function runCalibration({ home, caseSetFile, caseSetId, baselineMatchPolicyFile, candidateMatchPolicyFile, baselineComparisonPolicyFile, candidateComparisonPolicyFile, now = new Date().toISOString() }) {
  const resolvedCaseSet = resolveCaseSetFile(home, caseSetFile, caseSetId);
  const validation = validateCalibrationCaseSet({ file: resolvedCaseSet, home });
  if (validation.status !== "VALIDATED") return { schema: "evopilot-harness-calibration-run/v1", status: "BLOCKED", validation, nextAction: "repair-calibration-case-set" };
  const caseSet = validation.document;
  const hasMatching = caseSet.cases.some((item) => item.caseType === "MATCHING");
  const hasProposal = caseSet.cases.some((item) => item.caseType === "PROPOSAL");
  if (hasMatching && (!baselineMatchPolicyFile || !candidateMatchPolicyFile)) throw new Error("Matching calibration requires baseline and candidate MatchPolicyPack files.");
  if (hasProposal && (!baselineComparisonPolicyFile || !candidateComparisonPolicyFile)) throw new Error("Proposal calibration requires baseline and candidate ComparisonPolicyPack files.");

  const bindings = {
    baseline: [],
    candidate: []
  };
  let baselineMatch = null;
  let candidateMatch = null;
  let baselineComparison = null;
  let candidateComparison = null;
  if (hasMatching) {
    baselineMatch = loadPolicyFile(baselineMatchPolicyFile, "MatchPolicyPack", ["approved", "published"]);
    candidateMatch = loadPolicyFile(candidateMatchPolicyFile, "MatchPolicyPack", ["review", "approved", "published"]);
    bindings.baseline.push(policyRef(baselineMatch));
    bindings.candidate.push(policyRef(candidateMatch));
  }
  if (hasProposal) {
    baselineComparison = loadComparisonPolicy(home, baselineComparisonPolicyFile);
    candidateComparison = loadComparisonPolicy(home, candidateComparisonPolicyFile, { allowReview: true });
    bindings.baseline.push(policyRef(baselineComparison));
    bindings.candidate.push(policyRef(candidateComparison));
  }

  const cases = caseSet.cases.map((calibrationCase) => calibrationCase.caseType === "MATCHING"
    ? runMatchingCase(home, calibrationCase, baselineMatch, candidateMatch)
    : runProposalCase(home, calibrationCase, baselineComparison, candidateComparison, now));
  const regressions = cases.filter((item) => item.regression).map((item) => item.id);
  const conflicts = cases.filter((item) => item.baselineActual !== item.candidateActual).map((item) => item.id);
  const baselineSummary = summarize(cases, "baseline");
  const candidateSummary = summarize(cases, "candidate");
  const governingPolicy = candidateComparison?.document ?? loadComparisonPolicy(home).document;
  const minimumCases = governingPolicy.spec.calibration.minimumReviewedCases;
  const enoughCases = cases.length >= minimumCases;
  const uncertaintyReasons = [
    ...(enoughCases ? [] : [`reviewed-cases-below-${minimumCases}`]),
    ...(conflicts.length ? ["baseline-candidate-policy-disagreement"] : []),
    ...(!hasMatching ? ["matching-calibration-not-covered"] : []),
    ...(!hasProposal ? ["proposal-calibration-not-covered"] : [])
  ];
  const uncertainty = {
    level: !enoughCases ? "HIGH" : uncertaintyReasons.length ? "MEDIUM" : "LOW",
    reasons: uncertaintyReasons,
    reviewedCaseCount: cases.length,
    minimumReviewedCases: minimumCases
  };
  const ranking = rankPolicies(baselineSummary, candidateSummary);
  const falseRatesReady = (candidateSummary.falseUpgradeRate ?? 0) <= governingPolicy.spec.calibration.maximumFalseUpgradeRate && (candidateSummary.falseNewProfileRate ?? 0) <= governingPolicy.spec.calibration.maximumFalseNewProfileRate;
  const regressionReady = !governingPolicy.spec.calibration.requireNoBlockingRegression || regressions.length === 0;
  const recommendation = !enoughCases ? "NEED_MORE_REVIEWED_CASES" : falseRatesReady && regressionReady ? "CANDIDATE_POLICY_ELIGIBLE_FOR_HUMAN_REVIEW" : "REVISE_CANDIDATE_POLICY";
  const reportKey = digest({ caseSetDigest: validation.caseSetDigest, bindings, cases, algorithmVersion: CALIBRATION_ALGORITHM_VERSION });
  const generatedAt = calibrationGeneratedAt(caseSet, home);
  const report = {
    apiVersion: "comparison.evopilot.io/v1",
    kind: REPORT_KIND,
    metadata: {
      reportId: `${safeId(caseSet.metadata.id)}-calibration-${reportKey.slice(7, 19)}`,
      generatedAt,
      algorithmVersion: CALIBRATION_ALGORITHM_VERSION,
      reportDigest: "sha256:".padEnd(71, "0")
    },
    caseSetRef: { id: caseSet.metadata.id, version: caseSet.metadata.version, digest: validation.caseSetDigest },
    policyBindings: bindings,
    summary: {
      reviewedCaseCount: cases.length,
      matchingCaseCount: cases.filter((item) => item.caseType === "MATCHING").length,
      proposalCaseCount: cases.filter((item) => item.caseType === "PROPOSAL").length,
      baseline: baselineSummary,
      candidate: candidateSummary,
      regressions
    },
    cases,
    ranking,
    conflicts,
    uncertainty,
    recommendation,
    authority: { activePolicyMutated: false, mayApprove: false, mayPublish: false }
  };
  report.metadata.reportDigest = calibrationReportDigest(report);
  const reportValidation = validateDocument(report);
  if (!reportValidation.valid) throw new Error(`Generated calibration report failed schema validation: ${JSON.stringify(reportValidation.errors)}`);
  const destination = path.join(home, "comparisons/calibration/reports", `${report.metadata.reportId}.json`);
  let idempotentReplay = false;
  if (fs.existsSync(destination)) {
    const existing = JSON.parse(fs.readFileSync(destination, "utf8"));
    if (calibrationReportDigest(existing) !== report.metadata.reportDigest) throw new Error(`Immutable calibration report conflict at ${destination}`);
    idempotentReplay = true;
  } else writeJson(destination, report);
  return { schema: "evopilot-harness-calibration-run/v1", status: "CALIBRATED", reportId: report.metadata.reportId, reportDigest: report.metadata.reportDigest, reportPath: destination, recommendation, report, activePolicyMutated: false, idempotentReplay, nextAction: calibrationNextAction(recommendation) };
}

export function readCalibrationReport({ home, reportId }) {
  const file = path.join(home, "comparisons/calibration/reports", `${safeId(reportId)}.json`);
  if (!fs.existsSync(file)) throw new Error(`Calibration report ${reportId} was not found.`);
  const report = JSON.parse(fs.readFileSync(file, "utf8"));
  const validation = validateDocument(report, file);
  const digestMatches = report.metadata?.reportDigest === calibrationReportDigest(report);
  return { schema: "evopilot-harness-calibration-report-inspection/v1", status: validation.valid && digestMatches ? "FOUND" : "FAILED", reportId, file, digestMatches, validation, report };
}

export function calibrationSummary(home) {
  const caseSets = walkFiles(path.join(home, "comparisons/calibration/case-sets"), (file) => /\.ya?ml$/i.test(file)).map((file) => {
    try {
      const document = readYaml(file);
      return { id: document.metadata.id, version: document.metadata.version, digest: document.metadata.caseSetDigest, caseCount: document.cases.length, file };
    } catch { return null; }
  }).filter(Boolean);
  const reports = walkFiles(path.join(home, "comparisons/calibration/reports"), (file) => file.endsWith(".json")).map((file) => {
    try {
      const report = JSON.parse(fs.readFileSync(file, "utf8"));
      return {
        reportId: report.metadata.reportId,
        generatedAt: report.metadata.generatedAt,
        reportDigest: report.metadata.reportDigest,
        recommendation: report.recommendation,
        blockers: report.recommendation === "CANDIDATE_POLICY_ELIGIBLE_FOR_HUMAN_REVIEW" ? [] : [...new Set([...report.summary.regressions, ...report.conflicts, ...report.uncertainty.reasons])],
        uncertainty: report.uncertainty,
        provenance: { caseSetRef: report.caseSetRef, policyBindings: report.policyBindings, algorithmVersion: report.metadata.algorithmVersion },
        limitations: [
          "Calibration is limited to the independently reviewed immutable case set and exact policy bindings.",
          "The recommendation cannot mutate or activate a policy, approve a Proposal, or publish a Harness."
        ],
        nextAction: calibrationNextAction(report.recommendation),
        authority: report.authority,
        caseCount: report.summary.reviewedCaseCount,
        file
      };
    } catch { return null; }
  }).filter(Boolean).sort((left, right) => right.generatedAt.localeCompare(left.generatedAt));
  return { caseSetCount: caseSets.length, reportCount: reports.length, latestReport: reports[0] ?? null, caseSets, reports };
}

function runMatchingCase(home, calibrationCase, baselinePolicy, candidatePolicy) {
  const graphFile = path.join(home, "evolution-runs", safeId(calibrationCase.evidenceGraphRef.runId), "evidence-graph.json");
  if (!fs.existsSync(graphFile)) throw new Error(`Calibration Evidence Graph was not found: ${graphFile}`);
  const graph = JSON.parse(fs.readFileSync(graphFile, "utf8"));
  if (graph.graphDigest !== calibrationCase.evidenceGraphRef.digest) throw new Error(`Calibration Evidence Graph digest drift for ${calibrationCase.id}.`);
  const baseline = reasonEvidence(graph, home, { policyFile: baselinePolicy.file }).result;
  const candidate = reasonEvidence(graph, home, { policyFile: candidatePolicy.file }).result;
  const expected = matchingLabel(calibrationCase.expected.decision, calibrationCase.expected.targetProfileId);
  const baselineActual = matchingLabel(baseline.decision, baseline.targetProfile?.id);
  const candidateActual = matchingLabel(candidate.decision, candidate.targetProfile?.id);
  const baselinePassed = baselineActual === expected;
  const candidatePassed = candidateActual === expected;
  return { id: calibrationCase.id, caseType: "MATCHING", expected, baselineActual, candidateActual, baselinePassed, candidatePassed, regression: baselinePassed && !candidatePassed };
}

function runProposalCase(home, calibrationCase, baselinePolicy, candidatePolicy, now) {
  const source = readComparisonReport({ home, reportId: calibrationCase.comparisonReportRef.reportId });
  if (source.status !== "FOUND" || source.report.metadata.reportDigest !== calibrationCase.comparisonReportRef.reportDigest || source.report.metadata.comparisonId !== calibrationCase.comparisonId) {
    throw new Error(`Calibration case ${calibrationCase.id} is not bound to the reviewed Comparison Report snapshot.`);
  }
  const packageDigests = source.report.scope.packageDigests;
  const baseline = scoreComparison({ home, comparisonId: calibrationCase.comparisonId, policyFile: baselinePolicy.file, persist: false, reportVariant: `calibration-baseline-${calibrationCase.id}`, allowReviewPolicy: false, packageDigests, now });
  const candidate = scoreComparison({ home, comparisonId: calibrationCase.comparisonId, policyFile: candidatePolicy.file, persist: false, reportVariant: `calibration-candidate-${calibrationCase.id}`, allowReviewPolicy: true, packageDigests, now });
  const expected = calibrationCase.expectedRecommendation;
  const baselinePassed = baseline.recommendation === expected;
  const candidatePassed = candidate.recommendation === expected;
  return { id: calibrationCase.id, caseType: "PROPOSAL", expected, baselineActual: baseline.recommendation, candidateActual: candidate.recommendation, baselinePassed, candidatePassed, regression: baselinePassed && !candidatePassed };
}

function summarize(cases, side) {
  const passedCount = cases.filter((item) => item[`${side}Passed`]).length;
  const matching = cases.filter((item) => item.caseType === "MATCHING");
  const actualKey = `${side}Actual`;
  const falseUpgradeCount = matching.filter((item) => item[actualKey].startsWith("EVOLVE_EXISTING") && !item.expected.startsWith("EVOLVE_EXISTING")).length;
  const falseNewProfileCount = matching.filter((item) => item[actualKey].startsWith("PROPOSE_NEW_PROFILE") && !item.expected.startsWith("PROPOSE_NEW_PROFILE")).length;
  const expectedAbstentions = matching.filter((item) => item.expected.startsWith("NEED_MORE_EVIDENCE") || item.expected.startsWith("NOT_HARNESS_ELIGIBLE"));
  const correctAbstentions = expectedAbstentions.filter((item) => item[actualKey] === item.expected).length;
  return {
    passedCount,
    failedCount: cases.length - passedCount,
    passRate: ratio(passedCount, cases.length),
    falseUpgradeRate: ratio(falseUpgradeCount, matching.length),
    falseNewProfileRate: ratio(falseNewProfileCount, matching.length),
    correctAbstentionRate: ratio(correctAbstentions, expectedAbstentions.length)
  };
}

function rankPolicies(baseline, candidate) {
  const entries = [
    { policySide: "BASELINE", passRate: baseline.passRate, passedCount: baseline.passedCount, failedCount: baseline.failedCount },
    { policySide: "CANDIDATE", passRate: candidate.passRate, passedCount: candidate.passedCount, failedCount: candidate.failedCount }
  ].sort((left, right) => Number(right.passRate ?? -1) - Number(left.passRate ?? -1) || right.passedCount - left.passedCount || left.policySide.localeCompare(right.policySide));
  return entries.map((item, index) => ({ rank: index + 1, ...item }));
}

function caseReferenceChecks(document, home) {
  const checks = [];
  for (const calibrationCase of document.cases ?? []) {
    const reportFile = path.join(home, "comparisons/reports", `${safeId(calibrationCase.comparisonReportRef?.reportId)}.json`);
    if (!fs.existsSync(reportFile)) {
      checks.push(check(`comparison-report:${calibrationCase.id}`, false, [`missing=${reportFile}`]));
      continue;
    }
    const report = JSON.parse(fs.readFileSync(reportFile, "utf8"));
    const comparisonIdMatches = calibrationCase.caseType !== "PROPOSAL" || report.metadata?.comparisonId === calibrationCase.comparisonId;
    checks.push(check(`comparison-report:${calibrationCase.id}`, report.metadata?.reportDigest === calibrationCase.comparisonReportRef?.reportDigest && calibrationReportReferenceValid(report) && comparisonIdMatches, [`expected=${calibrationCase.comparisonReportRef?.reportDigest}`, `actual=${report.metadata?.reportDigest}`, `comparisonId=${report.metadata?.comparisonId ?? "missing"}`]));
    if (calibrationCase.caseType === "MATCHING") {
      const graphFile = path.join(home, "evolution-runs", safeId(calibrationCase.evidenceGraphRef?.runId), "evidence-graph.json");
      if (!fs.existsSync(graphFile)) checks.push(check(`evidence-graph:${calibrationCase.id}`, false, [`missing=${graphFile}`]));
      else {
        const graph = JSON.parse(fs.readFileSync(graphFile, "utf8"));
        checks.push(check(`evidence-graph:${calibrationCase.id}`, graph.graphDigest === calibrationCase.evidenceGraphRef.digest, [`expected=${calibrationCase.evidenceGraphRef.digest}`, `actual=${graph.graphDigest}`]));
      }
    }
  }
  return checks;
}

function calibrationGeneratedAt(caseSet, home) {
  const timestamps = [caseSet.metadata.createdAt, caseSet.review.reviewedAt];
  for (const calibrationCase of caseSet.cases) {
    const source = readComparisonReport({ home, reportId: calibrationCase.comparisonReportRef.reportId });
    if (source.status !== "FOUND" || source.report.metadata.reportDigest !== calibrationCase.comparisonReportRef.reportDigest) {
      throw new Error(`Calibration case ${calibrationCase.id} has an invalid Comparison Report reference.`);
    }
    timestamps.push(source.report.metadata.generatedAt);
  }
  return timestamps.sort().at(-1);
}

function calibrationNextAction(recommendation) {
  if (recommendation === "CANDIDATE_POLICY_ELIGIBLE_FOR_HUMAN_REVIEW") return "review-candidate-policy-delta";
  if (recommendation === "NEED_MORE_REVIEWED_CASES") return "collect-more-reviewed-calibration-cases";
  return "revise-candidate-policy";
}

function calibrationReportReferenceValid(report) {
  return report.kind === "HarnessComparisonReport" && report.metadata.reportDigest === digestWithout(report, "reportDigest");
}

function resolveCaseSetFile(home, file, id) {
  if (file) return path.resolve(file);
  if (!id) throw new Error("Provide --case-set or --case-set-id.");
  const matches = walkFiles(path.join(home, "comparisons/calibration/case-sets"), (item) => /\.ya?ml$/i.test(item)).filter((item) => {
    try { return readYaml(item).metadata?.id === id; } catch { return false; }
  });
  if (!matches.length) throw new Error(`Calibration case set ${id} was not found.`);
  return matches.sort().at(-1);
}

function loadPolicyFile(file, expectedKind, allowedLifecycles) {
  const resolved = path.resolve(file);
  const document = readYaml(resolved);
  const validation = validateDocument(document, resolved);
  if (!validation.valid || document.kind !== expectedKind) throw new Error(`Expected a valid ${expectedKind}: ${resolved}`);
  if (!allowedLifecycles.includes(document.metadata.lifecycle)) throw new Error(`${expectedKind} lifecycle ${document.metadata.lifecycle} is not allowed for this calibration role.`);
  return { file: resolved, document, digest: digest(document) };
}

function policyRef(record) {
  return { kind: record.document.kind, id: record.document.metadata.id, version: record.document.metadata.version, digest: record.digest };
}

function matchingLabel(decision, targetProfileId) {
  return targetProfileId ? `${decision}:${targetProfileId}` : decision;
}

function failedCaseSetValidation(file, document, checks, schemaValidation = validateDocument(document, file)) {
  const failures = checks.filter((item) => item.status === "FAIL");
  return { schema: "evopilot-harness-calibration-case-set-validation/v1", status: "REJECTED", valid: false, file, caseSetId: document?.metadata?.id ?? null, version: document?.metadata?.version ?? null, caseSetDigest: document?.metadata?.caseSetDigest ?? null, checks, failures, schemaValidation, document };
}

function check(id, passed, evidence = []) {
  return { id: safeId(id), status: passed ? "PASS" : "FAIL", evidence: evidence.map(String) };
}

function digestWithout(document, field) {
  const copy = structuredClone(document);
  if (copy?.metadata) delete copy.metadata[field];
  return digest(copy);
}

function ratio(numerator, denominator) {
  return denominator ? Math.round((numerator / denominator) * 1e6) / 1e6 : null;
}

function message(error) {
  return error instanceof Error ? error.message : String(error);
}
