import fs from "node:fs";
import path from "node:path";
import { validateDocument } from "./schema.mjs";
import { digest, readYaml, safeId, writeJson, writeYaml } from "./utils.mjs";

export const LEARNING_API_VERSION = "learning.evopilot.io/v1";

const TYPE = {
  adapter: { kind: "ResearchAdapterManifest", id: "adapterId", dir: "learning/adapters" },
  research: { kind: "ResearchEvidencePackage", id: "packageId", dir: "learning/research/packages", rejected: "learning/research/rejected" },
  contribution: { kind: "ContributionEvidencePackage", id: "packageId", dir: "learning/contributions/packages", rejected: "learning/contributions/rejected" },
  curriculum: { kind: "AssetCurriculumEntry", id: "entryId", dir: "learning/curriculum/entries" },
  run: { kind: "EvidenceRunManifest", id: "runId", dir: "learning/runs" },
  domainRole: { kind: "DomainRoleProposal", id: "proposalId", dir: "learning/domain-role/proposals" }
};

export function learningDocumentDigest(document) {
  const copy = structuredClone(document);
  if (copy?.metadata) delete copy.metadata.documentDigest;
  return digest(copy);
}

export function inspectLearningDocument(type, file) {
  const resolved = path.resolve(file);
  try {
    const document = readYaml(resolved);
    const validation = validateLearningDocument(type, document, resolved);
    return { schema: "evopilot-harness-learning-inspection/v1", status: validation.valid ? "INSPECTED" : "FAILED", type, file: resolved, validation, document };
  } catch (error) {
    return { schema: "evopilot-harness-learning-inspection/v1", status: "FAILED", type, file: resolved, error: message(error) };
  }
}

export function validateLearningFile(type, file) {
  const inspection = inspectLearningDocument(type, file);
  return { schema: "evopilot-harness-learning-validation/v1", status: inspection.status === "INSPECTED" ? "VALIDATED" : "FAILED", valid: inspection.status === "INSPECTED", type, file: inspection.file, failures: inspection.validation?.failures ?? [{ id: "file", evidence: [inspection.error] }] };
}

export function ingestLearningDocument({ type, file, home, now = new Date().toISOString() }) {
  const config = requireType(type);
  const resolved = path.resolve(file);
  let document;
  try { document = readYaml(resolved); } catch (error) { return rejection(home, config, type, resolved, now, [{ id: "file", evidence: [message(error)] }]); }
  const validation = validateLearningDocument(type, document, resolved);
  if (!validation.valid) return rejection(home, config, type, resolved, now, validation.failures);
  const id = document.metadata[config.id];
  const existing = stored(home, config).find((record) => record.document.metadata[config.id] === id);
  if (existing) {
    if (existing.document.metadata.documentDigest === document.metadata.documentDigest && learningDocumentDigest(existing.document) === document.metadata.documentDigest) {
      return authority({ schema: "evopilot-harness-learning-ingestion/v1", status: "DUPLICATE", type, id, documentDigest: document.metadata.documentDigest, destination: existing.file, counted: false });
    }
    return rejection(home, config, type, resolved, now, [{ id: "immutable-id-conflict", evidence: [`id=${id}`, `stored=${existing.document.metadata.documentDigest}`, `incoming=${document.metadata.documentDigest}`] }]);
  }
  const destination = path.join(home, config.dir, `${safeId(id)}@${document.metadata.documentDigest.slice(7, 19)}.yaml`);
  writeYaml(destination, document);
  return authority({ schema: "evopilot-harness-learning-ingestion/v1", status: "ACCEPTED", type, id, documentDigest: document.metadata.documentDigest, destination, counted: true });
}

export function createCurriculumSnapshot({ home, snapshotId, entryIds = [], policyRef, timeBoundary, now = new Date().toISOString() }) {
  const entries = stored(home, TYPE.curriculum).filter((record) => entryIds.length === 0 || entryIds.includes(record.document.metadata.entryId));
  const missing = entryIds.filter((id) => !entries.some((record) => record.document.metadata.entryId === id));
  if (missing.length) throw new Error(`Curriculum entries not found: ${missing.join(", ")}`);
  const document = finalize({ apiVersion: LEARNING_API_VERSION, kind: "AssetCurriculumSnapshot", metadata: { snapshotId, version: "1.0.0", createdAt: now }, timeBoundary: timeBoundary ?? now, policyRef, entries: entries.map(({ document: entry }) => ({ entryId: entry.metadata.entryId, documentDigest: entry.metadata.documentDigest, status: latestStatus(entry) })), authority: evidenceAuthority() });
  return persistGenerated(home, "learning/curriculum/snapshots", snapshotId, document, "curriculum snapshot");
}

export function createEvidenceRunManifest({ home, runId, operationId, curriculumSnapshotRef, selectedEvidence = [], excludedEvidence = [], missingItems = [], erroredItems = [], bindings, outputs = [], receipt = {}, now = new Date().toISOString() }) {
  const document = finalize({ apiVersion: LEARNING_API_VERSION, kind: "EvidenceRunManifest", metadata: { runId, operationId, version: "1.0.0", createdAt: now }, curriculumSnapshotRef, selectedEvidence, excludedEvidence, missingItems, erroredItems, bindings, selectionPolicy: { deterministic: true, timeBoundary: now }, outputs, receipt, authority: evidenceAuthority() });
  const validation = validateLearningDocument("run", document, "<generated>");
  if (!validation.valid) throw new Error(`Evidence run manifest failed validation: ${JSON.stringify(validation.failures)}`);
  return persistGenerated(home, "learning/runs", runId, document, "evidence run manifest");
}

export function scoreProfessionalCompleteness({ home, reportId, runId, curriculumSnapshotId, policyFile, now = new Date().toISOString(), variant = "primary" }) {
  const run = findStored(home, TYPE.run, runId).document;
  const snapshot = findGenerated(home, "learning/curriculum/snapshots", curriculumSnapshotId, "snapshotId");
  const policy = readYaml(path.resolve(policyFile));
  const policyValidation = validateDocument(policy, policyFile);
  if (!policyValidation.valid) throw new Error(`Professional completeness policy failed validation: ${JSON.stringify(policyValidation.errors)}`);
  const dimensions = policy.dimensions.map((dimension) => {
    const applicable = snapshot.entries.filter((entry) => !dimension.categories?.length || dimension.categories.includes(entry.status));
    const satisfied = applicable.filter((entry) => entry.status === "RESOLVED").length;
    return { id: dimension.id, numerator: satisfied, denominator: applicable.length, value: applicable.length ? satisfied / applicable.length : null, missingCount: run.missingItems.length, errorCount: run.erroredItems.length, limitation: applicable.length ? null : "NO_APPLICABLE_EVIDENCE" };
  });
  const blockers = [...run.missingItems.map((item) => `missing:${typeof item === "string" ? item : item.id}`), ...run.erroredItems.map((item) => `error:${typeof item === "string" ? item : item.id}`)];
  const document = finalize({ apiVersion: LEARNING_API_VERSION, kind: "ProfessionalCompletenessReport", metadata: { reportId: `${reportId}-${safeId(variant)}`, version: "1.0.0", createdAt: now }, runRef: ref(run.metadata.runId, run.metadata.documentDigest), curriculumSnapshotRef: ref(snapshot.metadata.snapshotId, snapshot.metadata.documentDigest), policyRef: ref(policy.metadata.id, learningDocumentDigest(policy)), dimensions, accounting: { selected: run.selectedEvidence.length, excluded: run.excludedEvidence.length, missing: run.missingItems.length, errors: run.erroredItems.length }, blockers, recommendation: blockers.length ? "NEED_MORE_EVIDENCE" : "READY_FOR_HUMAN_REVIEW", claims: { universalQuality: false, causalImprovement: false, reviewedAccuracySeparate: true }, authority: evidenceAuthority() });
  return persistGenerated(home, "learning/completeness/reports", document.metadata.reportId, document, "professional completeness report");
}

export function rescoreProfessionalCompleteness({ home, reportId, policyFile, reason, now = new Date().toISOString() }) {
  if (!String(reason ?? "").trim()) throw new Error("Completeness rescoring requires a reason.");
  const source = findGenerated(home, "learning/completeness/reports", reportId, "reportId");
  const scored = scoreProfessionalCompleteness({ home, reportId, runId: source.runRef.id, curriculumSnapshotId: source.curriculumSnapshotRef.id, policyFile, now, variant: `rescore-${digest(reason).slice(7, 15)}` });
  const record = finalize({ apiVersion: LEARNING_API_VERSION, kind: "ProfessionalCompletenessRescoreRecord", metadata: { rescoreId: `${safeId(reportId)}-${digest(reason).slice(7, 15)}`, version: "1.0.0", createdAt: now }, sourceReportRef: ref(source.metadata.reportId, source.metadata.documentDigest), rescoredReportRef: ref(scored.document.metadata.reportId, scored.document.metadata.documentDigest), reason: String(reason).trim(), rawEvidenceMutated: false, priorReportsMutated: false, authority: evidenceAuthority() });
  return { ...persistGenerated(home, "learning/completeness/rescores", record.metadata.rescoreId, record, "completeness rescore record"), report: scored };
}

export function readLearningArtifact({ home, area, id }) {
  const areas = { snapshot: ["learning/curriculum/snapshots", "snapshotId"], report: ["learning/completeness/reports", "reportId"], rescore: ["learning/completeness/rescores", "rescoreId"] };
  if (!areas[area]) throw new Error(`Unsupported learning artifact area: ${area}`);
  const document = findGenerated(home, ...areas[area], id);
  return { schema: "evopilot-harness-learning-artifact/v1", status: "FOUND", area, id, document };
}

export function learningSummary(home) {
  const countFiles = (relative) => { const root = path.join(home, relative); return fs.existsSync(root) ? fs.readdirSync(root).filter((name) => /\.(?:json|ya?ml)$/i.test(name)).length : 0; };
  const reportsRoot = path.join(home, "learning/completeness/reports");
  const reports = fs.existsSync(reportsRoot) ? fs.readdirSync(reportsRoot).filter((name) => name.endsWith(".json")).map((name) => JSON.parse(fs.readFileSync(path.join(reportsRoot, name), "utf8"))) : [];
  return {
    adapterCount: countFiles("learning/adapters"),
    researchPackageCount: countFiles("learning/research/packages"),
    contributionPackageCount: countFiles("learning/contributions/packages"),
    curriculumEntryCount: countFiles("learning/curriculum/entries"),
    curriculumSnapshotCount: countFiles("learning/curriculum/snapshots"),
    evidenceRunCount: countFiles("learning/runs"),
    completenessReportCount: reports.length,
    completenessRescoreCount: countFiles("learning/completeness/rescores"),
    domainRoleProposalCount: countFiles("learning/domain-role/proposals"),
    latestCompletenessReport: reports.sort((a, b) => String(b.metadata.createdAt).localeCompare(String(a.metadata.createdAt)))[0] ?? null,
    authority: evidenceAuthority()
  };
}

function validateLearningDocument(type, document, file) {
  const config = requireType(type);
  const schemaValidation = validateDocument(document, file);
  const failures = [];
  if (!schemaValidation.valid) failures.push({ id: "schema", evidence: schemaValidation.errors });
  if (document?.kind !== config.kind) failures.push({ id: "kind", evidence: [`expected=${config.kind}`] });
  if (document?.metadata?.documentDigest !== learningDocumentDigest(document)) failures.push({ id: "document-digest", evidence: ["declared digest does not match canonical document"] });
  if (type === "adapter") validateAdapter(document, failures);
  if (type === "research") validateResearch(document, failures);
  if (type === "contribution") validateContribution(document, failures);
  if (type === "curriculum") validateCurriculum(document, failures);
  if (type === "run") validateRunManifest(document, failures);
  if (type === "domainRole") validateDomainRole(document, failures);
  if (["research", "contribution", "curriculum", "run", "domainRole"].includes(type) && !isEvidenceOnly(document.authority)) failures.push({ id: "authority", evidence: ["authority must forbid approval, publication, Catalog mutation, and source execution"] });
  return { status: failures.length ? "FAILED" : "VALIDATED", valid: failures.length === 0, failures, schemaValidation };
}

function validateAdapter(document, failures) {
  const forbidden = JSON.stringify(document).match(/(?:command|script|module|hook|fetch|https?:\/\/|templateExpression|executable)/i);
  if (forbidden) failures.push({ id: "declarative-only", evidence: [`forbidden executable/network token=${forbidden[0]}`] });
  if (document?.authority !== "supplemental-evidence-only") failures.push({ id: "adapter-authority", evidence: ["adapter authority must be supplemental-evidence-only"] });
  if (!document?.limits?.maximumBytes || !document?.mapping || !document?.conformanceFixtures?.length) failures.push({ id: "adapter-portability", evidence: ["bounded limits, deterministic mapping, and conformance fixtures are required"] });
}

function validateResearch(document, failures) {
  if (!document?.provenance?.sourceReference || !document?.provenance?.acquiredAt || !document?.license?.status) failures.push({ id: "research-provenance-license", evidence: ["source, acquisition time, and license status are required"] });
  if (!document?.content?.digest || document.content.digest !== digest(document.content.canonicalText ?? document.content.bytesBase64 ?? "")) failures.push({ id: "content-digest", evidence: ["content digest mismatch"] });
  if (document?.review?.status !== "REVIEWED" || document?.redaction?.status !== "REDACTED" || document?.secretScan?.status !== "PASSED") failures.push({ id: "research-safety-review", evidence: ["review, redaction, and secret scan must pass"] });
}

function validateContribution(document, failures) {
  if (!document?.contributor?.identity || !document?.license?.terms || !document?.positiveCases?.length || !document?.negativeCases?.length) failures.push({ id: "contribution-evidence", evidence: ["identity, terms, positive cases, and negative cases are required"] });
  if (!document?.overlapReview || !document?.review) failures.push({ id: "contribution-review", evidence: ["duplicate/Catalog overlap and reviewer evidence are required"] });
}

function validateCurriculum(document, failures) {
  const categories = new Set(["boundary", "conflict", "production-failure", "evaluation-gap", "accuracy-gap", "completeness-gap"]);
  if (!categories.has(document?.category)) failures.push({ id: "curriculum-category", evidence: ["category must be a governed unresolved-evidence class"] });
  if (!document?.statusEvents?.length || document.statusEvents.some((event) => !event.at || !event.status || !event.by)) failures.push({ id: "append-only-status-events", evidence: ["at least one fully bound status event is required"] });
  if (!Array.isArray(document?.evidenceRefs) || !document.evidenceRefs.length) failures.push({ id: "curriculum-evidence-binding", evidence: ["immutable evidence references are required"] });
}

function validateRunManifest(document, failures) {
  const required = ["engineVersion", "policyDigest", "scorerVersion", "schemaVersion", "environmentDigest", "workspaceDigest"];
  const missing = required.filter((field) => !document?.bindings?.[field]);
  if (missing.length) failures.push({ id: "run-reproducibility-bindings", evidence: missing });
  if (!document?.curriculumSnapshotRef?.id || !document?.curriculumSnapshotRef?.digest) failures.push({ id: "run-curriculum-binding", evidence: ["exact curriculum snapshot id and digest are required"] });
  for (const field of ["selectedEvidence", "excludedEvidence", "missingItems", "erroredItems"]) if (!Array.isArray(document?.[field])) failures.push({ id: `run-${field}`, evidence: [`${field} must remain explicit`] });
}

function validateDomainRole(document, failures) {
  const requirements = [
    [document?.positiveEvidence?.length, "domain-positive-evidence"],
    [document?.negativeBoundary?.length, "negative-boundary"],
    [document?.ontologyDistinction?.length, "ontology-catalog-distinction"],
    [document?.evaluationCases?.positive?.length && document?.evaluationCases?.negative?.length, "reviewed-positive-negative-evaluation"],
    [Number(document?.sourceDiversity) >= 2, "source-diversity"],
    [String(document?.falseNewProfileAnalysis ?? "").trim(), "false-new-profile-analysis"],
    [String(document?.falseUpgradeAnalysis ?? "").trim(), "false-upgrade-analysis"]
  ];
  const missing = requirements.filter(([present]) => !present).map(([, id]) => id);
  if (missing.length && document?.recommendation !== "NEED_MORE_EVIDENCE") failures.push({ id: "domain-role-evidence-gate", evidence: missing });
  if (/^(?:software|engineering|developer|generic)$/i.test(String(document?.domain ?? "")) && document?.recommendation !== "NEED_MORE_EVIDENCE") failures.push({ id: "generic-domain-abstention", evidence: ["generic engineering concepts require NEED_MORE_EVIDENCE"] });
}

function persistGenerated(home, dir, id, document, label) {
  const validation = validateDocument(document);
  if (!validation.valid) throw new Error(`Generated ${label} failed schema validation: ${JSON.stringify(validation.errors)}`);
  const destination = path.join(home, dir, `${safeId(id)}.json`);
  if (fs.existsSync(destination)) {
    const existing = JSON.parse(fs.readFileSync(destination, "utf8"));
    if (existing.metadata.documentDigest === document.metadata.documentDigest) return authority({ schema: "evopilot-harness-learning-generation/v1", status: "DUPLICATE", id, destination, document: existing });
    throw new Error(`Immutable ${label} id conflict: ${id}`);
  }
  writeJson(destination, document);
  return authority({ schema: "evopilot-harness-learning-generation/v1", status: "CREATED", id, destination, document });
}

function rejection(home, config, type, file, now, failures) {
  let destination = null;
  if (config.rejected) { destination = path.join(home, config.rejected, `${safeId(path.basename(file))}-${digest({ now, failures }).slice(7, 15)}.json`); writeJson(destination, { schema: "evopilot-harness-learning-rejection/v1", type, file, at: now, failures }); }
  return authority({ schema: "evopilot-harness-learning-ingestion/v1", status: "REJECTED", type, failures, rejection: destination });
}

function stored(home, config) {
  const root = path.join(home, config.dir);
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root).filter((name) => /\.(?:json|ya?ml)$/i.test(name)).sort().map((name) => { const file = path.join(root, name); return { file, document: readYaml(file) }; });
}
function findStored(home, config, id) { const record = stored(home, config).find(({ document }) => document.metadata[config.id] === id); if (!record) throw new Error(`${config.kind} ${id} was not found.`); return record; }
function findGenerated(home, dir, id, key) { const file = path.join(home, dir, `${safeId(id)}.json`); if (!fs.existsSync(file)) throw new Error(`${key} ${id} was not found.`); const document = JSON.parse(fs.readFileSync(file, "utf8")); if (document.metadata.documentDigest !== learningDocumentDigest(document)) throw new Error(`${key} ${id} failed integrity validation.`); return document; }
function finalize(document) { document.metadata.documentDigest = "sha256:".padEnd(71, "0"); document.metadata.documentDigest = learningDocumentDigest(document); return document; }
function ref(id, documentDigest) { return { id, digest: documentDigest }; }
function latestStatus(entry) { return entry.statusEvents?.at(-1)?.status ?? "OPEN"; }
function evidenceAuthority() { return { evidenceOnly: true, mayApprove: false, mayPublish: false, mayWriteCatalog: false, mayExecuteSource: false, mayActivatePolicy: false }; }
function isEvidenceOnly(value) { return value?.evidenceOnly === true && value?.mayApprove === false && value?.mayPublish === false && value?.mayWriteCatalog === false && value?.mayExecuteSource === false; }
function authority(result) { return { ...result, assetMutation: false, catalogMutation: false, approvalCreated: false, publicationCreated: false, sourceExecution: false, networkAccess: false, pluginExecution: false }; }
function requireType(type) { const config = TYPE[type]; if (!config) throw new Error(`Unsupported learning document type: ${type}`); return config; }
function message(error) { return error instanceof Error ? error.message : String(error); }
