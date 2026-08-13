import fs from "node:fs";
import path from "node:path";
import { discoverAssets } from "./catalog.mjs";
import { EFFECTIVENESS_API_VERSION, FEEDBACK_API_VERSION } from "./constants.mjs";
import { validateDocument } from "./schema.mjs";
import { digest, readYaml, safeId, walkFiles, writeJson, writeYaml } from "./utils.mjs";

const FEEDBACK_KIND = "HarnessExecutionFeedbackPackage";
const REPORT_KIND = "HarnessEffectivenessReport";

export function feedbackPayloadDigest(document) {
  return digest({
    harnessBinding: document?.harnessBinding,
    executionContext: document?.executionContext,
    dimensions: document?.dimensions,
    provenance: document?.provenance
  });
}

export function feedbackPackageDigest(document) {
  const copy = structuredClone(document);
  if (copy?.metadata) delete copy.metadata.packageDigest;
  return digest(copy);
}

export function effectivenessReportDigest(document) {
  const copy = structuredClone(document);
  if (copy?.metadata) delete copy.metadata.reportDigest;
  return digest(copy);
}

export function inspectFeedbackPackage(file) {
  const resolved = path.resolve(file);
  try {
    const document = readYaml(resolved);
    const schemaValidation = validateDocument(document, resolved);
    return {
      schema: "evopilot-harness-feedback-inspection/v1",
      status: schemaValidation.valid ? "INSPECTED" : "FAILED",
      file: resolved,
      identity: {
        kind: document?.kind ?? null,
        packageId: document?.metadata?.packageId ?? null,
        version: document?.metadata?.version ?? null
      },
      declaredPackageDigest: document?.metadata?.packageDigest ?? null,
      calculatedPackageDigest: document?.kind === FEEDBACK_KIND ? feedbackPackageDigest(document) : null,
      declaredPayloadDigest: document?.redaction?.payloadDigest ?? null,
      calculatedPayloadDigest: document?.kind === FEEDBACK_KIND ? feedbackPayloadDigest(document) : null,
      binding: document?.harnessBinding ?? null,
      dimensions: document?.dimensions ? Object.keys(document.dimensions) : [],
      schemaValidation
    };
  } catch (error) {
    return failedInspection(resolved, error);
  }
}

export function validateFeedbackPackage({ file, home, now = new Date().toISOString(), allowExpired = false }) {
  const resolved = path.resolve(file);
  let document;
  try {
    document = readYaml(resolved);
  } catch (error) {
    return failedValidation(resolved, null, [{ id: "feedback-file", status: "FAIL", evidence: [message(error)] }]);
  }
  return validateFeedbackDocument({ document, file: resolved, home, now, allowExpired });
}

export function ingestFeedbackPackage({ file, home, now = new Date().toISOString() }) {
  const validation = validateFeedbackPackage({ file, home, now });
  const packageId = validation.packageId ?? "unknown-package";
  if (validation.status !== "VALIDATED") {
    const rejection = recordRejection(home, { file: path.resolve(file), packageId, now, validation });
    appendIngestionEvent(home, { at: now, packageId, packageDigest: validation.packageDigest, status: "REJECTED", reasons: validation.failures.map((item) => item.id) });
    return {
      schema: "evopilot-harness-feedback-ingestion/v1",
      status: "REJECTED",
      packageId,
      validation,
      rejection,
      nextAction: "repair-feedback-package"
    };
  }

  const existing = storedFeedbackPackages(home).find((item) => item.document?.metadata?.packageId === packageId);
  if (existing) {
    if (existing.document.metadata.packageDigest === validation.packageDigest && feedbackPackageDigest(existing.document) === validation.packageDigest) {
      appendIngestionEvent(home, { at: now, packageId, packageDigest: validation.packageDigest, status: "DUPLICATE", reasons: [] });
      return {
        schema: "evopilot-harness-feedback-ingestion/v1",
        status: "DUPLICATE",
        packageId,
        packageDigest: validation.packageDigest,
        destination: existing.file,
        counted: false,
        validation,
        nextAction: "aggregate-feedback"
      };
    }
    const conflict = {
      ...validation,
      status: "REJECTED",
      valid: false,
      failures: [{
        id: "package-id-conflict",
        status: "FAIL",
        evidence: [`packageId=${packageId}`, `stored=${existing.document?.metadata?.packageDigest ?? "missing"}`, `incoming=${validation.packageDigest}`]
      }]
    };
    const rejection = recordRejection(home, { file: path.resolve(file), packageId, now, validation: conflict });
    appendIngestionEvent(home, { at: now, packageId, packageDigest: validation.packageDigest, status: "REJECTED", reasons: ["package-id-conflict"] });
    return {
      schema: "evopilot-harness-feedback-ingestion/v1",
      status: "REJECTED",
      packageId,
      validation: conflict,
      rejection,
      nextAction: "issue-unique-package-id"
    };
  }

  const contentAddress = validation.packageDigest.slice("sha256:".length, "sha256:".length + 16);
  const destination = path.join(home, "feedback/packages", `${safeId(packageId)}@${validation.version}-${contentAddress}.yaml`);
  writeYaml(destination, validation.document);
  appendIngestionEvent(home, { at: now, packageId, packageDigest: validation.packageDigest, status: "ACCEPTED", reasons: [] });
  return {
    schema: "evopilot-harness-feedback-ingestion/v1",
    status: "ACCEPTED",
    packageId,
    version: validation.version,
    packageDigest: validation.packageDigest,
    destination,
    counted: true,
    validation,
    nextAction: "aggregate-feedback"
  };
}

export function aggregateFeedback({ home, now = new Date().toISOString() }) {
  const packages = storedFeedbackPackages(home).map((item) => ({
    ...item,
    validation: validateFeedbackDocument({ document: item.document, file: item.file, home, now, allowExpired: true })
  })).filter((item) => item.validation.status === "VALIDATED");
  const documents = packages.map((item) => item.document);
  const groups = new Map();
  for (const document of documents) {
    const refs = [
      { kind: "HarnessBundle", ...document.harnessBinding.bundleRef },
      { kind: "HarnessProfile", ...document.harnessBinding.profileRef },
      ...document.harnessBinding.componentRefs.map((reference) => ({ kind: "HarnessComponent", ...reference }))
    ];
    for (const reference of refs) {
      const key = `${reference.kind}:${reference.id}@${reference.version}:${reference.digest}`;
      const group = groups.get(key) ?? { assetRef: reference, documents: [] };
      group.documents.push(document);
      groups.set(key, group);
    }
  }
  const packageDigests = documents.map((item) => item.metadata.packageDigest).sort();
  const reportId = `effectiveness-${safeId(now)}-${digest({ generatedAt: now, packageDigests }).slice(7, 19)}`;
  const report = {
    apiVersion: EFFECTIVENESS_API_VERSION,
    kind: REPORT_KIND,
    metadata: {
      reportId,
      generatedAt: now,
      algorithmVersion: "effectiveness-aggregate/v1",
      reportDigest: "sha256:".padEnd(71, "0")
    },
    scope: { packageCount: documents.length, packageDigests },
    summary: aggregateDocuments(documents),
    groups: [...groups.values()]
      .sort((left, right) => `${left.assetRef.kind}:${left.assetRef.id}@${left.assetRef.version}`.localeCompare(`${right.assetRef.kind}:${right.assetRef.id}@${right.assetRef.version}`))
      .map((group) => ({ assetRef: group.assetRef, aggregate: aggregateDocuments(group.documents) }))
  };
  report.metadata.reportDigest = effectivenessReportDigest(report);
  const validation = validateDocument(report);
  if (!validation.valid) throw new Error(`Generated effectiveness report failed schema validation: ${JSON.stringify(validation.errors)}`);
  const destination = path.join(home, "feedback/reports", `${report.metadata.reportId}.json`);
  if (fs.existsSync(destination)) {
    const existing = JSON.parse(fs.readFileSync(destination, "utf8"));
    if (existing.metadata?.reportDigest !== report.metadata.reportDigest) throw new Error(`Immutable effectiveness report conflict at ${destination}`);
  }
  writeJson(destination, report);
  return {
    schema: "evopilot-harness-feedback-aggregation/v1",
    status: documents.length ? "AGGREGATED" : "EMPTY",
    reportId: report.metadata.reportId,
    reportDigest: report.metadata.reportDigest,
    packageCount: documents.length,
    ignoredInvalidStoredPackageCount: storedFeedbackPackages(home).length - documents.length,
    groupCount: report.groups.length,
    reportPath: destination,
    report,
    nextAction: "review-effectiveness-report"
  };
}

export function readEffectivenessReport({ home, reportId }) {
  const file = path.join(home, "feedback/reports", `${safeId(reportId)}.json`);
  if (!fs.existsSync(file)) throw new Error(`Effectiveness report ${reportId} was not found.`);
  const report = JSON.parse(fs.readFileSync(file, "utf8"));
  const validation = validateDocument(report, file);
  const digestMatches = report.metadata?.reportDigest === effectivenessReportDigest(report);
  return {
    schema: "evopilot-harness-effectiveness-report-inspection/v1",
    status: validation.valid && digestMatches ? "FOUND" : "FAILED",
    reportId,
    file,
    digestMatches,
    validation,
    report
  };
}

export function processFeedbackPackage({ file, home, now = new Date().toISOString() }) {
  const inspection = inspectFeedbackPackage(file);
  const ingestion = ingestFeedbackPackage({ file, home, now });
  if (!["ACCEPTED", "DUPLICATE"].includes(ingestion.status)) {
    return { schema: "evopilot-harness-feedback-processing/v1", status: "REJECTED", inspection, validation: ingestion.validation, ingestion, proposalCreated: false, assetMutation: false, sourceExecution: false, nextAction: ingestion.nextAction };
  }
  const aggregation = aggregateFeedback({ home, now });
  return {
    schema: "evopilot-harness-feedback-processing/v1",
    status: "PROCESSED",
    inspection,
    validation: ingestion.validation,
    ingestion,
    aggregation,
    proposalCreated: false,
    assetMutation: false,
    sourceExecution: false,
    nextAction: "review-effectiveness-report"
  };
}

export function feedbackSummary(home) {
  const packages = storedFeedbackPackages(home);
  const reports = walkFiles(path.join(home, "feedback/reports"), (file) => file.endsWith(".json")).map((file) => {
    try {
      const report = JSON.parse(fs.readFileSync(file, "utf8"));
      return { reportId: report.metadata.reportId, generatedAt: report.metadata.generatedAt, reportDigest: report.metadata.reportDigest, packageCount: report.scope.packageCount, summary: report.summary, groups: report.groups, file };
    } catch { return null; }
  }).filter(Boolean).sort((left, right) => right.generatedAt.localeCompare(left.generatedAt));
  const events = readIngestionEvents(home);
  const counts = countStatuses(events.map((event) => event.status));
  const rejectionReasons = countStatuses(events.filter((event) => event.status === "REJECTED").flatMap((event) => event.reasons ?? []));
  return {
    packageCount: packages.length,
    acceptedEventCount: counts.ACCEPTED ?? 0,
    rejectedEventCount: counts.REJECTED ?? 0,
    duplicateEventCount: counts.DUPLICATE ?? 0,
    rejectionReasons,
    reportCount: reports.length,
    latestReport: reports[0] ?? null,
    reports
  };
}

function validateFeedbackDocument({ document, file, home, now, allowExpired }) {
  const checks = [];
  const schemaValidation = validateDocument(document, file);
  checks.push({ id: "schema", status: schemaValidation.valid ? "PASS" : "FAIL", evidence: schemaValidation.errors });
  if (document?.apiVersion !== FEEDBACK_API_VERSION || document?.kind !== FEEDBACK_KIND) {
    return failedValidation(file, document, checks, schemaValidation);
  }

  let calculatedPackageDigest = null;
  let calculatedPayloadDigest = null;
  try {
    calculatedPackageDigest = feedbackPackageDigest(document);
    calculatedPayloadDigest = feedbackPayloadDigest(document);
    checks.push(check("package-digest", document.metadata?.packageDigest === calculatedPackageDigest, [`expected=${document.metadata?.packageDigest ?? "missing"}`, `actual=${calculatedPackageDigest}`]));
    checks.push(check("redacted-payload-digest", document.redaction?.payloadDigest === calculatedPayloadDigest, [`expected=${document.redaction?.payloadDigest ?? "missing"}`, `actual=${calculatedPayloadDigest}`]));
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
  checks.push(check("not-expired", allowExpired || (Number.isFinite(expiresAt) && Number.isFinite(current) && current < expiresAt), [`expiresAt=${document.metadata?.expiresAt}`, `now=${now}`, `allowExpired=${allowExpired}`]));

  checks.push(...dimensionConsistencyChecks(document));
  checks.push(...bindingChecks(document, home));
  const failures = checks.filter((item) => item.status === "FAIL");
  return {
    schema: "evopilot-harness-feedback-validation/v1",
    status: failures.length === 0 ? "VALIDATED" : "REJECTED",
    valid: failures.length === 0,
    file,
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

function bindingChecks(document, home) {
  if (!document?.harnessBinding || typeof document.harnessBinding !== "object") return [check("binding", false, ["harnessBinding is missing or invalid"] )];
  const records = discoverAssets([path.join(home, "catalogs/organization/assets"), path.join(home, "catalogs/builtin/assets")]);
  const find = (kind, reference) => records.find((record) => record.asset.kind === kind && record.asset.metadata.id === reference?.id && record.asset.metadata.version === reference?.version);
  const bundleRef = document.harnessBinding?.bundleRef;
  const profileRef = document.harnessBinding?.profileRef;
  const componentRefs = document.harnessBinding?.componentRefs ?? [];
  const bundle = find("HarnessBundle", bundleRef);
  const profile = find("HarnessProfile", profileRef);
  const checks = [
    referenceCheck("bundle", bundleRef, bundle),
    referenceCheck("profile", profileRef, profile)
  ];
  const resolvedComponents = componentRefs.map((reference) => ({ reference, record: find("HarnessComponent", reference) }));
  checks.push(...resolvedComponents.map(({ reference, record }) => referenceCheck(`component:${reference.id}`, reference, record)));
  if (!bundle || !profile) return checks;

  checks.push(check("bundle-profile-closure", sameReference(bundle.asset.spec.profile, profileRef), [`bundle=${formatRef(bundle.asset.spec.profile)}`, `feedback=${formatRef(profileRef)}`]));
  const bundleComponents = bundle.asset.spec.resolvedComponents ?? [];
  const expected = bundleComponents.map(formatRef).sort();
  const actual = componentRefs.map(formatRef).sort();
  checks.push(check("bundle-component-closure", JSON.stringify(expected) === JSON.stringify(actual), [`bundle=${expected.join(",")}`, `feedback=${actual.join(",")}`]));
  checks.push(check("bundle-internal-profile", bundle.asset.spec.profile.digest === profile.digest, [`bundle=${bundle.asset.spec.profile.digest}`, `actual=${profile.digest}`]));
  for (const reference of bundleComponents) {
    const record = find("HarnessComponent", reference);
    checks.push(check(`bundle-internal-component:${reference.id}`, Boolean(record) && record.digest === reference.digest && record.asset.metadata.lifecycle === "published", [`bundle=${formatRef(reference)}`, `actual=${record ? `${record.asset.metadata.id}@${record.asset.metadata.version}:${record.digest}/${record.asset.metadata.lifecycle}` : "missing"}`]));
  }
  return checks;
}

function referenceCheck(label, reference, record) {
  return check(`${label}-reference`, Boolean(record) && record.digest === reference?.digest && record.asset.metadata.lifecycle === "published", [`expected=${formatRef(reference)}`, `actual=${record ? `${record.asset.metadata.id}@${record.asset.metadata.version}:${record.digest}/${record.asset.metadata.lifecycle}` : "missing"}`]);
}

function aggregateDocuments(documents) {
  const values = (pathParts) => documents.map((document) => pathParts.reduce((value, part) => value?.[part], document)).filter((value) => value != null);
  const outcomeStatuses = values(["dimensions", "outcome", "status"]);
  const safetyStatuses = values(["dimensions", "safety", "status"]);
  const sourceIds = new Set(values(["provenance", "sourceId"]));
  const taskClasses = [...new Set(values(["executionContext", "taskClass"]))].sort();
  const complexities = [...new Set(values(["executionContext", "complexity"]))].sort();
  const environmentDigests = [...new Set(values(["executionContext", "environmentDigest"]))].sort();
  const currencies = [...new Set(values(["dimensions", "cost", "currency"]))].sort();
  const estimatedCostByCurrency = currencies.map((currency) => {
    const costs = documents.filter((document) => document.dimensions?.cost?.currency === currency).map((document) => document.dimensions.cost.estimatedCost).filter((value) => value != null);
    return { currency, sampleCount: costs.length, averageEstimatedCost: average(costs) };
  }).filter((item) => item.sampleCount > 0);
  const missingFields = {};
  for (const field of ["dimensions.outcome.score", "dimensions.process.stepCount", "dimensions.process.retryCount", "dimensions.process.durationMs", "dimensions.cost.inputTokens", "dimensions.cost.outputTokens", "dimensions.cost.totalTokens", "dimensions.cost.estimatedCost", "dimensions.cost.currency"]) {
    const present = values(field.split(".")).length;
    if (present < documents.length) missingFields[field] = documents.length - present;
  }
  const successCount = outcomeStatuses.filter((status) => status === "SUCCEEDED").length;
  const safeCount = safetyStatuses.filter((status) => status === "SAFE").length;
  const reasons = [];
  if (documents.length < 10) reasons.push("sample-count-below-10");
  else if (documents.length < 30) reasons.push("sample-count-below-30");
  if (sourceIds.size < 2) reasons.push("independent-source-count-below-2");
  else if (sourceIds.size < 3) reasons.push("independent-source-count-below-3");
  const level = documents.length < 10 || sourceIds.size < 2 ? "HIGH" : documents.length < 30 || sourceIds.size < 3 ? "MEDIUM" : "LOW";
  return {
    sampleCount: documents.length,
    independentSourceCount: sourceIds.size,
    contexts: { taskClasses, complexities, environmentDigests },
    missingFields,
    dimensions: {
      outcome: { statusCounts: countStatuses(outcomeStatuses), successRate: ratio(successCount, outcomeStatuses.length), averageScore: average(values(["dimensions", "outcome", "score"])) },
      process: { statusCounts: countStatuses(values(["dimensions", "process", "status"])), averageStepCount: average(values(["dimensions", "process", "stepCount"])), averageRetryCount: average(values(["dimensions", "process", "retryCount"])), averageDurationMs: average(values(["dimensions", "process", "durationMs"])) },
      safety: { statusCounts: countStatuses(safetyStatuses), safeRate: ratio(safeCount, safetyStatuses.length), violationCount: sum(values(["dimensions", "safety", "violationCount"])), incidentCount: sum(values(["dimensions", "safety", "incidentCount"])) },
      cost: { statusCounts: countStatuses(values(["dimensions", "cost", "status"])), averageInputTokens: average(values(["dimensions", "cost", "inputTokens"])), averageOutputTokens: average(values(["dimensions", "cost", "outputTokens"])), averageTotalTokens: average(values(["dimensions", "cost", "totalTokens"])), averageEstimatedCost: currencies.length <= 1 ? average(values(["dimensions", "cost", "estimatedCost"])) : null, estimatedCostByCurrency, currencies }
    },
    uncertainty: { level, reasons, outcomeSuccessRate95: wilson(successCount, outcomeStatuses.length), safetySafeRate95: wilson(safeCount, safetyStatuses.length) }
  };
}

function dimensionConsistencyChecks(document) {
  const checks = [];
  const context = document?.executionContext ?? {};
  if (context.startedAt != null || context.completedAt != null) {
    const startedAt = Date.parse(context.startedAt);
    const completedAt = Date.parse(context.completedAt);
    checks.push(check("execution-time-order", Number.isFinite(startedAt) && Number.isFinite(completedAt) && startedAt <= completedAt, [`startedAt=${context.startedAt ?? "missing"}`, `completedAt=${context.completedAt ?? "missing"}`]));
  }
  const outcome = document?.dimensions?.outcome ?? {};
  if (outcome.acceptancePassed != null || outcome.acceptanceTotal != null) checks.push(check("outcome-acceptance-counts", Number.isInteger(outcome.acceptancePassed) && Number.isInteger(outcome.acceptanceTotal) && outcome.acceptancePassed <= outcome.acceptanceTotal, [`passed=${outcome.acceptancePassed ?? "missing"}`, `total=${outcome.acceptanceTotal ?? "missing"}`]));
  const process = document?.dimensions?.process ?? {};
  if (process.failedStepCount != null || process.stepCount != null) checks.push(check("process-step-counts", process.failedStepCount == null || (Number.isInteger(process.stepCount) && process.failedStepCount <= process.stepCount), [`failed=${process.failedStepCount ?? "missing"}`, `total=${process.stepCount ?? "missing"}`]));
  const cost = document?.dimensions?.cost ?? {};
  if (cost.inputTokens != null && cost.outputTokens != null && cost.totalTokens != null) checks.push(check("cost-token-accounting", cost.inputTokens + cost.outputTokens === cost.totalTokens, [`input=${cost.inputTokens}`, `output=${cost.outputTokens}`, `total=${cost.totalTokens}`]));
  return checks;
}

function storedFeedbackPackages(home) {
  return walkFiles(path.join(home, "feedback/packages"), (file) => /\.ya?ml$/i.test(file)).map((file) => {
    try { return { file, document: readYaml(file) }; } catch { return null; }
  }).filter((item) => item?.document?.kind === FEEDBACK_KIND);
}

function recordRejection(home, { file, packageId, now, validation }) {
  const rejectionId = `${safeId(packageId)}-${digest({ packageId, file, now, failures: validation.failures }).slice(7, 19)}`;
  const destination = path.join(home, "feedback/rejected", `${rejectionId}.json`);
  const record = { schema: "evopilot-harness-feedback-rejection/v1", status: "REJECTED", rejectedAt: now, sourceFile: file, packageId, packageDigest: validation.packageDigest, failures: validation.failures };
  writeJson(destination, record);
  return { rejectionId, destination };
}

function appendIngestionEvent(home, event) {
  const file = path.join(home, "feedback/ingestion-events.jsonl");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${JSON.stringify(event)}\n`, "utf8");
}

function readIngestionEvents(home) {
  const file = path.join(home, "feedback/ingestion-events.jsonl");
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean).map((line) => {
    try { return JSON.parse(line); } catch { return null; }
  }).filter(Boolean);
}

function failedInspection(file, error) {
  return { schema: "evopilot-harness-feedback-inspection/v1", status: "FAILED", file, error: message(error) };
}

function failedValidation(file, document, checks, schemaValidation = validateDocument(document, file)) {
  const failures = checks.filter((item) => item.status === "FAIL");
  return { schema: "evopilot-harness-feedback-validation/v1", status: "REJECTED", valid: false, file, packageId: document?.metadata?.packageId ?? null, version: document?.metadata?.version ?? null, packageDigest: document?.metadata?.packageDigest ?? null, checks, failures, schemaValidation, document };
}

function check(id, passed, evidence = []) {
  return { id, status: passed ? "PASS" : "FAIL", evidence };
}

function sameReference(left, right) {
  return left?.id === right?.id && left?.version === right?.version && left?.digest === right?.digest;
}

function formatRef(reference) {
  return reference ? `${reference.id}@${reference.version}:${reference.digest}` : "missing";
}

function average(values) {
  return values.length ? round(values.reduce((total, value) => total + Number(value), 0) / values.length) : null;
}

function sum(values) {
  return values.reduce((total, value) => total + Number(value), 0);
}

function ratio(numerator, denominator) {
  return denominator ? round(numerator / denominator) : null;
}

function wilson(successes, total) {
  if (!total) return null;
  const z = 1.96;
  const p = successes / total;
  const denominator = 1 + (z * z) / total;
  const centre = p + (z * z) / (2 * total);
  const margin = z * Math.sqrt((p * (1 - p) + (z * z) / (4 * total)) / total);
  return { lower: round(Math.max(0, (centre - margin) / denominator)), upper: round(Math.min(1, (centre + margin) / denominator)) };
}

function round(value) {
  return Math.round(value * 1e6) / 1e6;
}

function countStatuses(values) {
  return values.reduce((counts, value) => ({ ...counts, [value]: (counts[value] ?? 0) + 1 }), {});
}

function message(error) {
  return error instanceof Error ? error.message : String(error);
}
