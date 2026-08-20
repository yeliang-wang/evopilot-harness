import fs from "node:fs";
import path from "node:path";
import { discoverAssets } from "./catalog.mjs";
import { reviewInputDigest } from "./proposal-digest.mjs";
import { validateDocument } from "./schema.mjs";
import { digest, persistedJson, readYaml, safeId, unique, walkFiles, writeJson, writeYaml } from "./utils.mjs";

export const COMPARISON_API_VERSION = "comparison.evopilot.io/v1";
export const COMPARISON_ALGORITHM_VERSION = "paired-comparison/v1";

const PACKAGE_KIND = "HarnessComparisonEvidencePackage";
const REPORT_KIND = "HarnessComparisonReport";
const RESCORE_KIND = "HarnessComparisonRescoreRecord";
const POLICY_KIND = "ComparisonPolicyPack";
const READY_RECOMMENDATION = "CANDIDATE_READY_FOR_HUMAN_REVIEW";
const BLOCKING_RECOMMENDATIONS = new Set(["NON_COMPARABLE", "NEED_MORE_EVIDENCE", "CONFLICT", "KEEP_BASELINE", "REVISE_CANDIDATE", "ROLLBACK_RECOMMENDED"]);

export function comparisonPayloadDigest(document) {
  return digest({
    baseline: document?.baseline,
    candidate: document?.candidate,
    comparisonContext: document?.comparisonContext,
    metricDefinitions: document?.metricDefinitions,
    observations: document?.observations,
    provenance: document?.provenance
  });
}

export function comparisonPackageDigest(document) {
  const copy = structuredClone(document);
  if (copy?.metadata) delete copy.metadata.packageDigest;
  return digest(copy);
}

export function comparisonReportDigest(document) {
  const copy = structuredClone(document);
  if (copy?.metadata) delete copy.metadata.reportDigest;
  return digest(copy);
}

export function comparisonRescoreDigest(document) {
  const copy = structuredClone(document);
  if (copy?.metadata) delete copy.metadata.recordDigest;
  return digest(copy);
}

export function inspectComparisonPackage(file) {
  const resolved = path.resolve(file);
  try {
    const document = readYaml(resolved);
    const schemaValidation = validateDocument(document, resolved);
    return {
      schema: "evopilot-harness-comparison-inspection/v1",
      status: schemaValidation.valid ? "INSPECTED" : "FAILED",
      file: resolved,
      identity: {
        comparisonId: document?.metadata?.comparisonId ?? null,
        packageId: document?.metadata?.packageId ?? null,
        version: document?.metadata?.version ?? null
      },
      declaredPackageDigest: document?.metadata?.packageDigest ?? null,
      calculatedPackageDigest: document?.kind === PACKAGE_KIND ? comparisonPackageDigest(document) : null,
      declaredPayloadDigest: document?.redaction?.payloadDigest ?? null,
      calculatedPayloadDigest: document?.kind === PACKAGE_KIND ? comparisonPayloadDigest(document) : null,
      pairCount: document?.observations?.length ?? 0,
      metricCount: document?.metricDefinitions?.length ?? 0,
      schemaValidation
    };
  } catch (error) {
    return { schema: "evopilot-harness-comparison-inspection/v1", status: "FAILED", file: resolved, error: message(error) };
  }
}

export function validateComparisonPackage({ file, home, now = new Date().toISOString(), allowExpired = false }) {
  const resolved = path.resolve(file);
  let document;
  try {
    document = readYaml(resolved);
  } catch (error) {
    return failedValidation(resolved, null, [{ id: "comparison-file", status: "FAIL", evidence: [message(error)] }]);
  }
  return validateComparisonDocument({ document, file: resolved, home, now, allowExpired });
}

export function ingestComparisonPackage({ file, home, now = new Date().toISOString() }) {
  const validation = validateComparisonPackage({ file, home, now });
  const packageId = validation.packageId ?? "unknown-package";
  if (validation.status !== "VALIDATED") {
    const rejection = recordRejection(home, { file: path.resolve(file), packageId, now, validation });
    appendEvent(home, { at: now, comparisonId: validation.comparisonId, packageId, packageDigest: validation.packageDigest, status: "REJECTED", reasons: validation.failures.map((item) => item.id) });
    return { schema: "evopilot-harness-comparison-ingestion/v1", status: "REJECTED", packageId, validation, rejection, nextAction: "repair-comparison-package" };
  }

  const existing = storedComparisonPackages(home).find((item) => item.document?.metadata?.packageId === packageId);
  if (existing) {
    if (existing.document.metadata.packageDigest === validation.packageDigest && comparisonPackageDigest(existing.document) === validation.packageDigest) {
      appendEvent(home, { at: now, comparisonId: validation.comparisonId, packageId, packageDigest: validation.packageDigest, status: "DUPLICATE", reasons: [] });
      return {
        schema: "evopilot-harness-comparison-ingestion/v1",
        status: "DUPLICATE",
        comparisonId: validation.comparisonId,
        packageId,
        packageDigest: validation.packageDigest,
        destination: existing.file,
        counted: false,
        validation,
        nextAction: "score-comparison"
      };
    }
    const conflict = {
      ...validation,
      status: "REJECTED",
      valid: false,
      failures: [{ id: "package-id-conflict", status: "FAIL", evidence: [`packageId=${packageId}`, `stored=${existing.document?.metadata?.packageDigest ?? "missing"}`, `incoming=${validation.packageDigest}`] }]
    };
    const rejection = recordRejection(home, { file: path.resolve(file), packageId, now, validation: conflict });
    appendEvent(home, { at: now, comparisonId: validation.comparisonId, packageId, packageDigest: validation.packageDigest, status: "REJECTED", reasons: ["package-id-conflict"] });
    return { schema: "evopilot-harness-comparison-ingestion/v1", status: "REJECTED", comparisonId: validation.comparisonId, packageId, validation: conflict, rejection, nextAction: "issue-unique-package-id" };
  }

  const address = validation.packageDigest.slice(7, 23);
  const destination = path.join(home, "comparisons/packages", `${safeId(packageId)}@${validation.version}-${address}.yaml`);
  writeYaml(destination, validation.document);
  appendEvent(home, { at: now, comparisonId: validation.comparisonId, packageId, packageDigest: validation.packageDigest, status: "ACCEPTED", reasons: [] });
  return {
    schema: "evopilot-harness-comparison-ingestion/v1",
    status: "ACCEPTED",
    comparisonId: validation.comparisonId,
    packageId,
    version: validation.version,
    packageDigest: validation.packageDigest,
    destination,
    counted: true,
    validation,
    nextAction: "score-comparison"
  };
}

export function processComparisonPackage({ file, home, now = new Date().toISOString(), policyFile }) {
  const inspection = inspectComparisonPackage(file);
  const ingestion = ingestComparisonPackage({ file, home, now });
  if (!["ACCEPTED", "DUPLICATE"].includes(ingestion.status)) {
    return {
      schema: "evopilot-harness-comparison-processing/v1",
      status: "REJECTED",
      inspection,
      validation: ingestion.validation,
      ingestion,
      assetMutation: false,
      sourceExecution: false,
      nextAction: ingestion.nextAction
    };
  }
  const scoring = scoreComparison({ home, comparisonId: ingestion.comparisonId, now, policyFile });
  return {
    schema: "evopilot-harness-comparison-processing/v1",
    status: "PROCESSED",
    inspection,
    validation: ingestion.validation,
    ingestion,
    scoring,
    assetMutation: false,
    sourceExecution: false,
    approvalCreated: false,
    publicationCreated: false,
    nextAction: "review-comparison-report"
  };
}

export function scoreComparison({ home, comparisonId, now = new Date().toISOString(), policyFile, persist = true, reportVariant = "primary", allowReviewPolicy = false, packageDigests = null }) {
  const requestedDigests = packageDigests ? new Set(packageDigests) : null;
  const matching = storedComparisonPackages(home).filter((item) => item.document.metadata.comparisonId === comparisonId);
  const selected = requestedDigests ? matching.filter((item) => requestedDigests.has(item.document.metadata.packageDigest)) : matching;
  if (requestedDigests) {
    const found = new Set(selected.map((item) => item.document.metadata.packageDigest));
    const missing = [...requestedDigests].filter((item) => !found.has(item));
    if (missing.length) throw new Error(`Comparison ${comparisonId} is missing snapshot packages: ${missing.join(", ")}`);
  }
  if (!selected.length) throw new Error(`Comparison ${comparisonId} has no accepted evidence packages.`);
  const validated = selected.map((item) => ({
    ...item,
    validation: validateComparisonDocument({ document: item.document, file: item.file, home, now, allowExpired: true })
  }));
  const invalid = validated.filter((item) => item.validation.status !== "VALIDATED");
  const packages = validated.filter((item) => item.validation.status === "VALIDATED").map((item) => item.document);
  if (!packages.length) throw new Error(`Comparison ${comparisonId} has no currently valid stored packages.`);
  const policyRecord = loadComparisonPolicy(home, policyFile, { allowReview: allowReviewPolicy });
  const report = buildComparisonReport({ comparisonId, packages, invalid, policy: policyRecord.document, policyDigest: policyRecord.digest, reportVariant });
  const validation = validateDocument(report);
  if (!validation.valid) throw new Error(`Generated comparison report failed schema validation: ${JSON.stringify(validation.errors)}`);
  const destination = path.join(home, "comparisons/reports", `${report.metadata.reportId}.json`);
  if (persist) writeImmutableJson(destination, report, "comparison report", comparisonReportDigest);
  return {
    schema: "evopilot-harness-comparison-scoring/v1",
    status: report.comparability.status === "NON_COMPARABLE" ? "NON_COMPARABLE" : "SCORED",
    comparisonId,
    reportId: report.metadata.reportId,
    reportDigest: report.metadata.reportDigest,
    reportPath: persist ? destination : null,
    recommendation: report.recommendation,
    report,
    assetMutation: false,
    nextAction: nextActionForRecommendation(report.recommendation)
  };
}

export function readComparisonReport({ home, reportId }) {
  const file = path.join(home, "comparisons/reports", `${safeId(reportId)}.json`);
  if (!fs.existsSync(file)) throw new Error(`Comparison report ${reportId} was not found.`);
  const report = JSON.parse(fs.readFileSync(file, "utf8"));
  const validation = validateDocument(report, file);
  const digestMatches = report.metadata?.reportDigest === comparisonReportDigest(report);
  return { schema: "evopilot-harness-comparison-report-inspection/v1", status: validation.valid && digestMatches ? "FOUND" : "FAILED", reportId, file, digestMatches, validation, report };
}

export function rescoreComparison({ home, reportId, policyFile, reason, now = new Date().toISOString() }) {
  if (!String(reason ?? "").trim()) throw new Error("Rescoring requires a non-empty reason.");
  const source = readComparisonReport({ home, reportId });
  if (source.status !== "FOUND") throw new Error(`Comparison report ${reportId} failed integrity validation.`);
  const scoring = scoreComparison({ home, comparisonId: source.report.metadata.comparisonId, now, policyFile, reportVariant: `rescore-${safeId(reason).slice(0, 32)}` });
  if (scoring.reportDigest === source.report.metadata.reportDigest) throw new Error("Rescoring produced the same immutable report; provide a different approved ComparisonPolicyPack.");
  const policyRef = scoring.report.metadata.policyRef;
  const record = {
    apiVersion: COMPARISON_API_VERSION,
    kind: RESCORE_KIND,
    metadata: {
      rescoreId: `${safeId(source.report.metadata.comparisonId)}-rescore-${scoring.reportDigest.slice(7, 19)}`,
      comparisonId: source.report.metadata.comparisonId,
      generatedAt: now,
      recordDigest: "sha256:".padEnd(71, "0")
    },
    sourceReportRef: { reportId: source.report.metadata.reportId, reportDigest: source.report.metadata.reportDigest },
    rescoredReportRef: { reportId: scoring.reportId, reportDigest: scoring.reportDigest },
    sourcePackageDigests: source.report.scope.packageDigests,
    scorerSet: [policyRef],
    reason: String(reason).trim(),
    authority: { rawObservationsMutated: false, priorReportsMutated: false, mayApprove: false, mayPublish: false }
  };
  record.metadata.recordDigest = comparisonRescoreDigest(record);
  const validation = validateDocument(record);
  if (!validation.valid) throw new Error(`Generated rescore record failed schema validation: ${JSON.stringify(validation.errors)}`);
  const destination = path.join(home, "comparisons/rescores", `${record.metadata.rescoreId}.json`);
  writeImmutableJson(destination, record, "comparison rescore record", comparisonRescoreDigest);
  return { schema: "evopilot-harness-comparison-rescore/v1", status: "RESCORED", record, recordPath: destination, scoring, rawObservationsMutated: false, priorReportsMutated: false, nextAction: "review-rescored-comparison" };
}

export function comparisonSummary(home) {
  const packages = storedComparisonPackages(home);
  const reports = storedComparisonReports(home);
  const rescores = storedComparisonRescores(home);
  const events = readEvents(home);
  const eventCounts = count(events.map((event) => event.status));
  return {
    packageCount: packages.length,
    acceptedEventCount: eventCounts.ACCEPTED ?? 0,
    rejectedEventCount: eventCounts.REJECTED ?? 0,
    duplicateEventCount: eventCounts.DUPLICATE ?? 0,
    reportCount: reports.length,
    rescoreCount: rescores.length,
    latestReport: reports[0] ?? null,
    reports
  };
}

export function comparisonAssessmentForProposal(home, proposal) {
  const proposalDigest = reviewInputDigest(proposal);
  return comparisonAssessmentForProposalBinding(home, { proposalId: proposal.proposalId, proposalDigest });
}

export function comparisonAssessmentForProposalBinding(home, { proposalId, proposalDigest }) {
  const proposalReports = activeComparisonReports(home, storedComparisonReports(home)).filter((item) => item.report.scope?.candidate?.source === "PROPOSAL" && item.report.scope.candidate.proposalRef?.proposalId === proposalId);
  const reports = proposalReports.filter((item) => item.report.scope.candidate.proposalRef?.proposalDigest === proposalDigest);
  if (!reports.length && proposalReports.length) {
    const latest = proposalReports[0];
    return {
      status: "STALE",
      required: false,
      proposalDigest,
      blocking: true,
      recommendation: null,
      reportId: latest.report.metadata.reportId,
      reportDigest: latest.report.metadata.reportDigest,
      comparisonId: latest.report.metadata.comparisonId,
      packageCount: latest.report.scope.packageDigests.length,
      pairCount: latest.report.scope.pairCount,
      uncertainty: latest.report.uncertainty,
      reasons: ["Governed comparison evidence exists for this Proposal id but is bound to an older Proposal digest."],
      limitations: latest.report.limitations,
      comparativelySupported: false
    };
  }
  if (!reports.length) return { status: "NOT_PROVIDED", required: false, proposalDigest, blocking: false, recommendation: null, reasons: ["No governed comparison report is bound to this Proposal digest."] };
  const ranked = reports.sort((left, right) => right.report.scope.packageDigests.length - left.report.scope.packageDigests.length || right.report.metadata.generatedAt.localeCompare(left.report.metadata.generatedAt));
  const selected = ranked[0];
  const currentPackageDigests = storedComparisonPackages(home).filter((item) => item.document.metadata.comparisonId === selected.report.metadata.comparisonId).map((item) => item.document.metadata.packageDigest).sort();
  const reportPackageDigests = [...selected.report.scope.packageDigests].sort();
  const stale = JSON.stringify(currentPackageDigests) !== JSON.stringify(reportPackageDigests);
  const equalRankRecommendations = unique(ranked.filter((item) => item.report.scope.packageDigests.length === selected.report.scope.packageDigests.length).map((item) => item.report.recommendation));
  const conflict = equalRankRecommendations.length > 1;
  const integrityValid = selected.validation.valid && selected.digestMatches;
  const blocking = stale || conflict || !integrityValid || BLOCKING_RECOMMENDATIONS.has(selected.report.recommendation);
  return {
    status: stale ? "STALE" : conflict ? "CONFLICT" : integrityValid ? "VALIDATED" : "FAILED",
    required: false,
    proposalDigest,
    blocking,
    recommendation: conflict ? "CONFLICT" : selected.report.recommendation,
    reportId: selected.report.metadata.reportId,
    reportDigest: selected.report.metadata.reportDigest,
    comparisonId: selected.report.metadata.comparisonId,
    packageCount: selected.report.scope.packageDigests.length,
    pairCount: selected.report.scope.pairCount,
    uncertainty: selected.report.uncertainty,
    reasons: stale ? ["New accepted comparison packages exist after the selected report; rescore before Proposal Review."] : conflict ? ["Equally complete comparison reports disagree."] : selected.report.reasons,
    limitations: selected.report.limitations,
    comparativelySupported: !blocking && selected.report.recommendation === READY_RECOMMENDATION
  };
}

export function loadComparisonPolicy(home, file, { allowReview = false } = {}) {
  const candidates = file ? [path.resolve(file)] : walkFiles(path.join(home, "policies/comparison"), (item) => /\.ya?ml$/i.test(item));
  const records = candidates.map((item) => {
    try {
      const document = readYaml(item);
      return document.kind === POLICY_KIND ? { file: item, document, digest: digest(document) } : null;
    } catch { return null; }
  }).filter(Boolean).sort((left, right) => String(right.document.metadata.version).localeCompare(String(left.document.metadata.version), undefined, { numeric: true }));
  const allowed = allowReview ? ["review", "approved", "published"] : ["approved", "published"];
  const record = records.find((item) => allowed.includes(item.document.metadata.lifecycle));
  if (!record) throw new Error(`No ${allowReview ? "review, approved, or published" : "approved or published"} ComparisonPolicyPack is available.`);
  const validation = validateDocument(record.document, record.file);
  if (!validation.valid) throw new Error(`ComparisonPolicyPack failed schema validation: ${JSON.stringify(validation.errors)}`);
  return record;
}

function buildComparisonReport({ comparisonId, packages, invalid, policy, policyDigest, reportVariant }) {
  const packageDigests = packages.map((item) => item.metadata.packageDigest).sort();
  const sourceIds = unique(packages.map((item) => item.provenance.sourceId));
  const primary = packages[0];
  const contextDigests = contextDigestMap(primary.comparisonContext);
  const checks = comparabilityChecks(packages, invalid, policy);
  const comparable = checks.every((item) => item.status === "PASS");
  const strata = contextStrata(packages);
  const definitions = mergeMetricDefinitions(packages);
  const allObservations = mergeObservations(packages);
  const observationMerge = comparable ? allObservations : { observations: [], conflicts: [] };
  const metricReports = comparable ? definitions.map((definition) => scoreMetric(definition, observationMerge.observations, policy)) : [];
  const totalSlots = metricReports.reduce((total, item) => total + item.observedPairCount + item.missingPairCount, 0);
  const missingSlots = metricReports.reduce((total, item) => total + item.missingPairCount, 0);
  const missingRatio = totalSlots ? round(missingSlots / totalSlots) : 0;
  const effectivePairCount = comparable ? observationMerge.observations.length : Math.max(0, ...strata.map((item) => item.pairCount));
  const conflictMetrics = metricReports.filter((item) => item.paired.winCount > 0 && item.paired.lossCount > 0).map((item) => item.id);
  const conflicts = unique([...observationMerge.conflicts, ...conflictMetrics.map((id) => `metric-conflict:${id}`)]);
  const uncertaintyReasons = [];
  if (effectivePairCount < policy.spec.minPairedObservations) uncertaintyReasons.push(`paired-observations-below-${policy.spec.minPairedObservations}`);
  if (sourceIds.length < policy.spec.minIndependentSources) uncertaintyReasons.push(`independent-sources-below-${policy.spec.minIndependentSources}`);
  if (missingRatio > policy.spec.maximumMissingRatio) uncertaintyReasons.push(`missing-ratio-above-${policy.spec.maximumMissingRatio}`);
  if (conflicts.length) uncertaintyReasons.push("conflicting-paired-observations");
  if (invalid.length) uncertaintyReasons.push("stored-package-invalid-after-ingestion");
  if (!comparable && strata.length > 1) uncertaintyReasons.push("mixed-context-strata-not-aggregated");
  const uncertainty = {
    level: uncertaintyReasons.length ? !comparable || effectivePairCount < policy.spec.minPairedObservations || conflicts.length ? "HIGH" : "MEDIUM" : "LOW",
    reasons: uncertaintyReasons,
    missingRatio,
    conflicts
  };
  const recommendation = recommend({ comparable, metricReports, uncertainty, candidate: primary.candidate, policy });
  const reasons = recommendationReasons(recommendation, metricReports, checks, uncertainty);
  const generatedAt = packages.map((item) => item.metadata.generatedAt).sort().at(-1);
  const policyRef = { id: policy.metadata.id, version: policy.metadata.version, digest: policyDigest };
  const reportKey = digest({ comparisonId, packageDigests, policyRef, algorithmVersion: COMPARISON_ALGORITHM_VERSION, reportVariant });
  const report = {
    apiVersion: COMPARISON_API_VERSION,
    kind: REPORT_KIND,
    metadata: {
      reportId: `${safeId(comparisonId)}-${safeId(reportVariant)}-${reportKey.slice(7, 19)}`,
      comparisonId,
      generatedAt,
      algorithmVersion: COMPARISON_ALGORITHM_VERSION,
      policyRef,
      reportDigest: "sha256:".padEnd(71, "0")
    },
    scope: {
      packageDigests,
      independentSourceCount: sourceIds.length,
      pairCount: allObservations.observations.length,
      baseline: primary.baseline,
      candidate: primary.candidate,
      contextDigests
    },
    comparability: { status: comparable ? "COMPARABLE" : "NON_COMPARABLE", checks, strata },
    metrics: metricReports,
    uncertainty,
    recommendation,
    reasons,
    limitations: [
      "Comparison evidence supports only the bound task, source snapshot, environment, model configuration, toolchain, EvaluationPack, and scorer versions.",
      "The report does not establish universal accuracy or causal improvement and cannot approve, publish, roll back, or execute a Harness."
    ],
    authority: { mayRecommend: true, mayApprove: false, mayPublish: false, mayRollback: false, mayExecute: false }
  };
  report.metadata.reportDigest = comparisonReportDigest(report);
  return report;
}

function validateComparisonDocument({ document, file, home, now, allowExpired }) {
  const checks = [];
  const schemaValidation = validateDocument(document, file);
  checks.push(check("schema", schemaValidation.valid, schemaValidation.errors));
  if (document?.apiVersion !== COMPARISON_API_VERSION || document?.kind !== PACKAGE_KIND) return failedValidation(file, document, checks, schemaValidation);
  let calculatedPackageDigest = null;
  let calculatedPayloadDigest = null;
  try {
    calculatedPackageDigest = comparisonPackageDigest(document);
    calculatedPayloadDigest = comparisonPayloadDigest(document);
    checks.push(check("package-digest", document.metadata.packageDigest === calculatedPackageDigest, [`expected=${document.metadata.packageDigest}`, `actual=${calculatedPackageDigest}`]));
    checks.push(check("payload-digest", document.redaction.payloadDigest === calculatedPayloadDigest, [`expected=${document.redaction.payloadDigest}`, `actual=${calculatedPayloadDigest}`]));
  } catch (error) {
    checks.push(check("digest-input", false, [message(error)]));
  }
  checks.push(check("approval", document.approval?.status === "APPROVED", [`status=${document.approval?.status ?? "missing"}`]));
  checks.push(check("redaction", document.redaction?.status === "REDACTED", [`status=${document.redaction?.status ?? "missing"}`]));
  const generatedAt = Date.parse(document.metadata?.generatedAt);
  const approvedAt = Date.parse(document.approval?.approvedAt);
  const expiresAt = Date.parse(document.metadata?.expiresAt);
  const current = Date.parse(now);
  checks.push(check("time-valid", [generatedAt, approvedAt, expiresAt, current].every(Number.isFinite), [`now=${now}`]));
  checks.push(check("time-order", Number.isFinite(generatedAt) && Number.isFinite(approvedAt) && Number.isFinite(expiresAt) && generatedAt <= approvedAt && approvedAt < expiresAt, [`generatedAt=${document.metadata?.generatedAt}`, `approvedAt=${document.approval?.approvedAt}`, `expiresAt=${document.metadata?.expiresAt}`]));
  checks.push(check("not-from-future", Number.isFinite(approvedAt) && Number.isFinite(current) && approvedAt <= current, [`approvedAt=${document.approval?.approvedAt}`, `now=${now}`]));
  checks.push(check("not-expired", allowExpired || (Number.isFinite(expiresAt) && Number.isFinite(current) && current < expiresAt), [`expiresAt=${document.metadata?.expiresAt}`, `now=${now}`]));
  checks.push(...packageConsistencyChecks(document));
  checks.push(...assetBindingChecks(document, home));
  const failures = checks.filter((item) => item.status === "FAIL");
  return {
    schema: "evopilot-harness-comparison-validation/v1",
    status: failures.length ? "REJECTED" : "VALIDATED",
    valid: failures.length === 0,
    file,
    comparisonId: document.metadata?.comparisonId ?? null,
    packageId: document.metadata?.packageId ?? null,
    version: document.metadata?.version ?? null,
    packageDigest: document.metadata?.packageDigest ?? null,
    calculatedPackageDigest,
    calculatedPayloadDigest,
    checks,
    failures,
    schemaValidation,
    document
  };
}

function packageConsistencyChecks(document) {
  const checks = [];
  const definitions = document.metricDefinitions ?? [];
  const ids = definitions.map((item) => item.id);
  checks.push(check("metric-definition-ids", ids.length === new Set(ids).size, ids));
  checks.push(check("metric-direction-types", definitions.every((item) => item.valueType === "BOOLEAN" ? item.direction === "TRUE_IS_BETTER" : item.direction !== "TRUE_IS_BETTER"), definitions.map((item) => `${item.id}:${item.valueType}/${item.direction}`)));
  const pairIds = (document.observations ?? []).map((item) => item.pairId);
  checks.push(check("pair-ids", pairIds.length === new Set(pairIds).size, pairIds));
  for (const pair of document.observations ?? []) {
    for (const side of ["baseline", "candidate"]) {
      const metrics = pair[side]?.metrics ?? [];
      const metricIds = metrics.map((item) => item.metricId);
      checks.push(check(`metric-ids:${pair.pairId}:${side}`, metricIds.length === new Set(metricIds).size && metricIds.every((id) => ids.includes(id)), metricIds));
      for (const metric of metrics) {
        const definition = definitions.find((item) => item.id === metric.metricId);
        const typeValid = metric.status !== "OBSERVED" || (definition?.valueType === "BOOLEAN" ? typeof metric.value === "boolean" : typeof metric.value === "number" && Number.isFinite(metric.value));
        checks.push(check(`metric-type:${pair.pairId}:${side}:${metric.metricId}`, typeValid, [`expected=${definition?.valueType ?? "missing"}`, `actual=${typeof metric.value}`]));
      }
      const requiredIds = definitions.filter((item) => item.required).map((item) => item.id);
      checks.push(check(`required-metrics:${pair.pairId}:${side}`, requiredIds.every((id) => metricIds.includes(id)), requiredIds.filter((id) => !metricIds.includes(id))));
    }
  }
  checks.push(check("different-bindings", digest(document.baseline) !== digest(document.candidate), [digest(document.baseline), digest(document.candidate)]));
  return checks;
}

function assetBindingChecks(document, home) {
  const checks = [];
  for (const [side, binding] of [["baseline", document.baseline], ["candidate", document.candidate]]) {
    const resolved = resolveBinding(home, binding);
    checks.push(...resolved.checks.map((item) => ({ ...item, id: `${side}-${item.id}` })));
  }
  if (document.candidate?.source === "PROPOSAL") {
    const proposalFile = path.join(home, "evolution-runs", safeId(document.candidate.proposalRef?.proposalId), "proposal.yaml");
    if (fs.existsSync(proposalFile)) {
      const proposal = readYaml(proposalFile);
      const evaluation = document.comparisonContext?.evaluationPackRef;
      checks.push(check("candidate-evaluation-pack", proposal.evaluationPack?.metadata?.id === evaluation?.id && proposal.evaluationPack?.metadata?.version === evaluation?.version && digest(proposal.evaluationPack) === evaluation?.digest, [`expected=${formatRef(evaluation)}`, `actual=${proposal.evaluationPack ? `${proposal.evaluationPack.metadata.id}@${proposal.evaluationPack.metadata.version}:${digest(proposal.evaluationPack)}` : "missing"}`]));
    }
  }
  return checks;
}

function resolveBinding(home, binding) {
  if (!binding) return { checks: [check("binding", false, ["binding is missing"])] };
  if (binding.source === "CATALOG") {
    const records = discoverAssets([path.join(home, "catalogs/organization/assets"), path.join(home, "catalogs/builtin/assets")]);
    const checks = binding.assetRefs.map((reference) => {
      const record = records.find((item) => item.asset.kind === reference.kind && item.asset.metadata.id === reference.id && item.asset.metadata.version === reference.version);
      return check(`asset:${reference.kind}:${reference.id}`, Boolean(record) && record.digest === reference.digest && record.asset.metadata.lifecycle === "published", [`expected=${formatAssetRef(reference)}`, `actual=${record ? `${record.asset.kind}:${record.asset.metadata.id}@${record.asset.metadata.version}:${record.digest}/${record.asset.metadata.lifecycle}` : "missing"}`]);
    });
    checks.push(check("harness-asset-present", binding.assetRefs.some((item) => ["HarnessComponent", "HarnessProfile", "HarnessBundle"].includes(item.kind)), binding.assetRefs.map((item) => item.kind)));
    return { checks };
  }
  const proposalFile = path.join(home, "evolution-runs", safeId(binding.proposalRef?.proposalId), "proposal.yaml");
  if (!fs.existsSync(proposalFile)) return { checks: [check("proposal", false, [`missing=${proposalFile}`])] };
  const proposal = readYaml(proposalFile);
  const proposalDigest = reviewInputDigest(proposal);
  const candidateDocuments = [...(proposal.proposedAssets ?? []), proposal.evaluationPack].filter(Boolean);
  const checks = [check("proposal-digest", proposalDigest === binding.proposalRef?.proposalDigest, [`expected=${binding.proposalRef?.proposalDigest}`, `actual=${proposalDigest}`])];
  for (const reference of binding.assetRefs) {
    const document = candidateDocuments.find((item) => item.kind === reference.kind && item.metadata?.id === reference.id && item.metadata?.version === reference.version);
    checks.push(check(`asset:${reference.kind}:${reference.id}`, Boolean(document) && digest(document) === reference.digest, [`expected=${formatAssetRef(reference)}`, `actual=${document ? `${document.kind}:${document.metadata.id}@${document.metadata.version}:${digest(document)}` : "missing"}`]));
  }
  checks.push(check("harness-asset-present", binding.assetRefs.some((item) => ["HarnessComponent", "HarnessProfile", "HarnessBundle"].includes(item.kind)), binding.assetRefs.map((item) => item.kind)));
  return { checks };
}

function comparabilityChecks(packages, invalid, policy) {
  const primary = packages[0];
  const required = new Set(policy.spec.requireExactBindings);
  const values = packages.map((item) => ({
    baselineBinding: digest(item.baseline),
    candidateBinding: digest(item.candidate),
    metricDefinitions: digest([...item.metricDefinitions].sort((left, right) => left.id.localeCompare(right.id))),
    ...contextDigestMap(item.comparisonContext)
  }));
  const checkEqual = (id, key) => check(id, new Set(values.map((item) => item[key])).size === 1, values.map((item) => item[key]));
  const checks = [
    check("stored-packages-valid", invalid.length === 0, invalid.map((item) => item.file)),
    checkEqual("baseline-binding", "baselineBinding"),
    checkEqual("candidate-binding", "candidateBinding"),
    checkEqual("metric-definitions", "metricDefinitions")
  ];
  for (const key of ["taskDigest", "sourceSnapshotDigest", "environmentDigest", "modelConfigurationDigest", "toolchainDigest", "evaluationPackDigest", "scorerSetDigest"]) {
    if (required.has(key)) checks.push(checkEqual(key, key));
  }
  checks.push(check("comparison-id", packages.every((item) => item.metadata.comparisonId === primary.metadata.comparisonId), packages.map((item) => item.metadata.comparisonId)));
  return checks;
}

function contextDigestMap(context) {
  return {
    taskDigest: context.task.digest,
    sourceSnapshotDigest: context.sourceSnapshotDigest,
    environmentDigest: context.environmentDigest,
    modelConfigurationDigest: context.modelConfigurationDigest,
    toolchainDigest: context.toolchainDigest,
    evaluationPackDigest: context.evaluationPackRef.digest,
    scorerSetDigest: digest([...context.scorerSet].sort((left, right) => `${left.id}@${left.version}:${left.digest}`.localeCompare(`${right.id}@${right.version}:${right.digest}`)))
  };
}

function contextStrata(packages) {
  const grouped = new Map();
  for (const document of packages) {
    const contextDigests = contextDigestMap(document.comparisonContext);
    const baselineBindingDigest = digest(document.baseline);
    const candidateBindingDigest = digest(document.candidate);
    const metricDefinitionsDigest = digest([...document.metricDefinitions].sort((left, right) => left.id.localeCompare(right.id)));
    const key = digest({ contextDigests, baselineBindingDigest, candidateBindingDigest, metricDefinitionsDigest });
    const current = grouped.get(key) ?? {
      stratumId: `stratum-${key.slice(7, 19)}`,
      contextDigests,
      baselineBindingDigest,
      candidateBindingDigest,
      metricDefinitionsDigest,
      packageDigests: [],
      pairCount: 0,
      independentSourceIds: new Set()
    };
    current.packageDigests.push(document.metadata.packageDigest);
    current.pairCount += document.observations.length;
    current.independentSourceIds.add(document.provenance.sourceId);
    grouped.set(key, current);
  }
  return [...grouped.values()].map((item) => ({
    stratumId: item.stratumId,
    contextDigests: item.contextDigests,
    baselineBindingDigest: item.baselineBindingDigest,
    candidateBindingDigest: item.candidateBindingDigest,
    metricDefinitionsDigest: item.metricDefinitionsDigest,
    packageDigests: item.packageDigests.sort(),
    pairCount: item.pairCount,
    independentSourceCount: item.independentSourceIds.size
  })).sort((left, right) => left.stratumId.localeCompare(right.stratumId));
}

function mergeMetricDefinitions(packages) {
  const values = new Map();
  for (const definition of packages.flatMap((item) => item.metricDefinitions)) if (!values.has(definition.id)) values.set(definition.id, definition);
  return [...values.values()].sort((left, right) => left.id.localeCompare(right.id));
}

function mergeObservations(packages) {
  const values = new Map();
  const conflicts = [];
  for (const packageDocument of packages) {
    for (const observation of packageDocument.observations) {
      const key = observation.pairId;
      const current = values.get(key);
      if (!current) values.set(key, observation);
      else if (digest(current) !== digest(observation)) conflicts.push(`pair-id-conflict:${key}`);
    }
  }
  return { observations: [...values.values()].sort((left, right) => left.pairId.localeCompare(right.pairId)), conflicts: unique(conflicts) };
}

function scoreMetric(definition, observations, policy) {
  const baselineValues = [];
  const candidateValues = [];
  const orientedDeltas = [];
  let missingPairCount = 0;
  let winCount = 0;
  let lossCount = 0;
  let tieCount = 0;
  for (const pair of observations) {
    const baselineMetric = pair.baseline.metrics.find((item) => item.metricId === definition.id);
    const candidateMetric = pair.candidate.metrics.find((item) => item.metricId === definition.id);
    if (baselineMetric?.status !== "OBSERVED" || candidateMetric?.status !== "OBSERVED") {
      missingPairCount += 1;
      continue;
    }
    const baseline = numericValue(baselineMetric.value);
    const candidate = numericValue(candidateMetric.value);
    baselineValues.push(baseline);
    candidateValues.push(candidate);
    const oriented = definition.direction === "LOWER_IS_BETTER" ? baseline - candidate : candidate - baseline;
    orientedDeltas.push(oriented);
    if (oriented > definition.minimumMeaningfulDelta) winCount += 1;
    else if (oriented < -definition.maximumAllowedRegression) lossCount += 1;
    else tieCount += 1;
  }
  const observedPairCount = orientedDeltas.length;
  const sufficient = observedPairCount >= policy.spec.minPairedObservations;
  let status = "INCONCLUSIVE";
  if (sufficient) {
    if (lossCount > 0 && winCount > 0) status = "INCONCLUSIVE";
    else if (lossCount > 0) status = definition.blocking ? "BLOCKING_REGRESSION" : "REGRESSED";
    else if (winCount > 0) status = "IMPROVED";
    else status = "TIED";
  }
  return {
    id: definition.id,
    dimension: definition.dimension,
    valueType: definition.valueType,
    direction: definition.direction,
    required: definition.required,
    blocking: definition.blocking,
    observedPairCount,
    missingPairCount,
    baseline: summarizeMetric(baselineValues, definition.valueType),
    candidate: summarizeMetric(candidateValues, definition.valueType),
    paired: {
      winCount,
      lossCount,
      tieCount,
      medianDelta: median(orientedDeltas),
      confidenceInterval: confidenceInterval(orientedDeltas, definition.valueType, policy.spec.confidenceLevel)
    },
    status
  };
}

function recommend({ comparable, metricReports, uncertainty, candidate, policy }) {
  if (!comparable) return "NON_COMPARABLE";
  if (uncertainty.reasons.some((item) => item.startsWith("paired-observations-below") || item.startsWith("independent-sources-below") || item.startsWith("missing-ratio-above"))) return "NEED_MORE_EVIDENCE";
  if (uncertainty.conflicts.length || metricReports.some((item) => item.status === "INCONCLUSIVE")) return "CONFLICT";
  const blockingRegression = metricReports.some((item) => item.status === "BLOCKING_REGRESSION") && policy.spec.recommendation.blockOnSafetyRegression;
  if (blockingRegression) return candidate.source === "CATALOG" ? "ROLLBACK_RECOMMENDED" : "REVISE_CANDIDATE";
  const requiredRegression = metricReports.some((item) => item.required && item.status === "REGRESSED");
  if (requiredRegression && policy.spec.recommendation.blockOnRequiredMetricRegression) return "REVISE_CANDIDATE";
  const requiredReady = metricReports.filter((item) => item.required).every((item) => ["IMPROVED", "TIED"].includes(item.status));
  const improved = metricReports.some((item) => item.status === "IMPROVED");
  if (requiredReady && improved && policy.spec.recommendation.allowCandidateWhenAllRequiredMetricsNonRegressing) return READY_RECOMMENDATION;
  return "KEEP_BASELINE";
}

function recommendationReasons(recommendation, metrics, checks, uncertainty) {
  const improved = metrics.filter((item) => item.status === "IMPROVED").map((item) => item.id);
  const regressed = metrics.filter((item) => ["REGRESSED", "BLOCKING_REGRESSION"].includes(item.status)).map((item) => item.id);
  const reasons = [`recommendation=${recommendation}`];
  if (improved.length) reasons.push(`improved=${improved.join(",")}`);
  if (regressed.length) reasons.push(`regressed=${regressed.join(",")}`);
  const failedChecks = checks.filter((item) => item.status === "FAIL").map((item) => item.id);
  if (failedChecks.length) reasons.push(`non-comparable=${failedChecks.join(",")}`);
  if (uncertainty.reasons.length) reasons.push(`uncertainty=${uncertainty.reasons.join(",")}`);
  return reasons;
}

function summarizeMetric(values, valueType) {
  return {
    sampleCount: values.length,
    mean: average(values),
    median: median(values),
    successRate: valueType === "BOOLEAN" ? average(values) : null
  };
}

function confidenceInterval(values, valueType, confidenceLevel) {
  if (!values.length) return null;
  if (valueType === "BOOLEAN") {
    const wins = values.filter((item) => item > 0).length;
    return { ...wilson(wins, values.length, confidenceLevel), method: "WILSON" };
  }
  const sorted = [...values].sort((left, right) => left - right);
  const alpha = (1 - confidenceLevel) / 2;
  return { lower: quantile(sorted, alpha), upper: quantile(sorted, 1 - alpha), method: "PAIRED_QUANTILE" };
}

function storedComparisonPackages(home) {
  return walkFiles(path.join(home, "comparisons/packages"), (file) => /\.ya?ml$/i.test(file)).map((file) => {
    try { return { file, document: readYaml(file) }; } catch { return null; }
  }).filter((item) => item?.document?.kind === PACKAGE_KIND);
}

function storedComparisonReports(home) {
  return walkFiles(path.join(home, "comparisons/reports"), (file) => file.endsWith(".json")).map((file) => {
    try {
      const report = JSON.parse(fs.readFileSync(file, "utf8"));
      if (report.kind !== REPORT_KIND) return null;
      const validation = validateDocument(report, file);
      const digestMatches = report.metadata?.reportDigest === comparisonReportDigest(report);
      return {
        file,
        report,
        validation,
        digestMatches,
        reportId: report.metadata.reportId,
        generatedAt: report.metadata.generatedAt,
        reportDigest: report.metadata.reportDigest,
        comparisonId: report.metadata.comparisonId,
        recommendation: report.recommendation,
        blockers: BLOCKING_RECOMMENDATIONS.has(report.recommendation) ? report.reasons : [],
        uncertainty: report.uncertainty,
        provenance: {
          packageDigests: report.scope.packageDigests,
          baseline: report.scope.baseline,
          candidate: report.scope.candidate,
          policyRef: report.metadata.policyRef,
          algorithmVersion: report.metadata.algorithmVersion
        },
        limitations: report.limitations,
        nextAction: nextActionForRecommendation(report.recommendation),
        pairCount: report.scope.pairCount,
        packageCount: report.scope.packageDigests.length
      };
    } catch { return null; }
  }).filter(Boolean).sort((left, right) => right.generatedAt.localeCompare(left.generatedAt));
}

function storedComparisonRescores(home) {
  return walkFiles(path.join(home, "comparisons/rescores"), (file) => file.endsWith(".json")).map((file) => {
    try {
      const record = JSON.parse(fs.readFileSync(file, "utf8"));
      const validation = validateDocument(record, file);
      const digestMatches = record.kind === RESCORE_KIND && record.metadata?.recordDigest === comparisonRescoreDigest(record);
      return validation.valid && digestMatches ? { file, record } : null;
    } catch { return null; }
  }).filter(Boolean);
}

function activeComparisonReports(home, reports) {
  const byId = new Map(reports.map((item) => [item.reportId, item]));
  const superseded = new Set();
  for (const { record } of storedComparisonRescores(home)) {
    const source = byId.get(record.sourceReportRef.reportId);
    const target = byId.get(record.rescoredReportRef.reportId);
    if (!source || !target) continue;
    if (source.reportDigest !== record.sourceReportRef.reportDigest || target.reportDigest !== record.rescoredReportRef.reportDigest) continue;
    if (!source.validation.valid || !source.digestMatches || !target.validation.valid || !target.digestMatches) continue;
    superseded.add(source.reportId);
  }
  return reports.filter((item) => !superseded.has(item.reportId));
}

function recordRejection(home, { file, packageId, now, validation }) {
  const rejectionId = `${safeId(packageId)}-${digest({ packageId, file, now, failures: validation.failures }).slice(7, 19)}`;
  const destination = path.join(home, "comparisons/rejected", `${rejectionId}.json`);
  writeJson(destination, { schema: "evopilot-harness-comparison-rejection/v1", status: "REJECTED", rejectedAt: now, sourceFile: file, packageId, packageDigest: validation.packageDigest, failures: validation.failures });
  return { rejectionId, destination };
}

function appendEvent(home, event) {
  const file = path.join(home, "comparisons/ingestion-events.jsonl");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${JSON.stringify(event)}\n`, "utf8");
}

function readEvents(home) {
  const file = path.join(home, "comparisons/ingestion-events.jsonl");
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean).map((line) => {
    try { return JSON.parse(line); } catch { return null; }
  }).filter(Boolean);
}

function writeImmutableJson(file, document, label, digestFunction) {
  if (fs.existsSync(file)) {
    const existing = JSON.parse(fs.readFileSync(file, "utf8"));
    if (digestFunction(existing) !== digestFunction(document)) throw new Error(`Immutable ${label} conflict at ${file}`);
    return;
  }
  writeJson(file, document);
}

function failedValidation(file, document, checks, schemaValidation = validateDocument(document, file)) {
  const failures = checks.filter((item) => item.status === "FAIL");
  return { schema: "evopilot-harness-comparison-validation/v1", status: "REJECTED", valid: false, file, comparisonId: document?.metadata?.comparisonId ?? null, packageId: document?.metadata?.packageId ?? null, version: document?.metadata?.version ?? null, packageDigest: document?.metadata?.packageDigest ?? null, checks, failures, schemaValidation, document };
}

function check(id, passed, evidence = []) {
  return { id: safeId(id), status: passed ? "PASS" : "FAIL", evidence: evidence.map(String) };
}

function formatRef(reference) {
  return reference ? `${reference.id}@${reference.version}:${reference.digest}` : "missing";
}

function formatAssetRef(reference) {
  return reference ? `${reference.kind}:${formatRef(reference)}` : "missing";
}

function numericValue(value) {
  return typeof value === "boolean" ? value ? 1 : 0 : Number(value);
}

function average(values) {
  return values.length ? round(values.reduce((total, value) => total + value, 0) / values.length) : null;
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return round(sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2);
}

function quantile(sorted, probability) {
  if (!sorted.length) return null;
  const index = (sorted.length - 1) * probability;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return round(sorted[lower]);
  return round(sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower));
}

function wilson(successes, total, confidenceLevel) {
  if (!total) return null;
  const z = confidenceLevel >= 0.99 ? 2.575829 : confidenceLevel >= 0.95 ? 1.959964 : confidenceLevel >= 0.9 ? 1.644854 : 1.281552;
  const p = successes / total;
  const denominator = 1 + (z * z) / total;
  const centre = p + (z * z) / (2 * total);
  const margin = z * Math.sqrt((p * (1 - p) + (z * z) / (4 * total)) / total);
  return { lower: round(Math.max(0, (centre - margin) / denominator)), upper: round(Math.min(1, (centre + margin) / denominator)) };
}

function round(value) {
  return Math.round(value * 1e6) / 1e6;
}

function count(values) {
  return values.reduce((result, value) => ({ ...result, [value]: (result[value] ?? 0) + 1 }), {});
}

function nextActionForRecommendation(recommendation) {
  return ({
    NON_COMPARABLE: "repair-comparison-context",
    NEED_MORE_EVIDENCE: "collect-more-comparable-observations",
    CONFLICT: "resolve-comparison-conflict",
    KEEP_BASELINE: "retain-baseline",
    REVISE_CANDIDATE: "revise-candidate",
    CANDIDATE_READY_FOR_HUMAN_REVIEW: "proposal-review",
    ROLLBACK_RECOMMENDED: "review-rollback-recommendation"
  })[recommendation];
}

function message(error) {
  return error instanceof Error ? error.message : String(error);
}
