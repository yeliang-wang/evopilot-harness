import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { initializeWorkspace } from "../src/v3/workspace.mjs";
import { createCurriculumSnapshot, createEvidenceRunManifest, ingestLearningDocument, learningDocumentDigest, rescoreProfessionalCompleteness, scoreProfessionalCompleteness, validateLearningFile } from "../src/v3/learning.mjs";
import { digest, readYaml, writeYaml } from "../src/v3/utils.mjs";
import { engineCapabilities } from "../src/v4/engine-adapter.mjs";

const now = "2026-08-21T08:00:00.000Z";
const zero = "sha256:".padEnd(71, "0");

test("v4.2 Engine exposes the complete governed professional learning operation family", () => {
  const expected = ["learning.artifact", "learning.ingest", "learning.inspect", "learning.rescore", "learning.run-manifest", "learning.score", "learning.snapshot", "learning.validate"];
  assert.deepEqual(engineCapabilities().map((item) => item.id).filter((id) => id.startsWith("learning.")).sort(), expected);
});

test("v4.2 curriculum intake is immutable, idempotent, supersedable, and authority-free", () => {
  const home = workspace();
  const entry = finalize({ apiVersion: "learning.evopilot.io/v1", kind: "AssetCurriculumEntry", metadata: { entryId: "missing-negative-cases", version: "1.0.0", createdAt: now }, category: "completeness-gap", severity: "HIGH", assetRefs: [{ id: "software-engineering", digest: digest("asset") }], evidenceRefs: [digest("review")], missingEvidence: ["negative-boundary-cases"], exitCriteria: ["reviewed-negative-cases"], conflicts: [], duplicateOf: null, supersedes: [], statusEvents: [{ at: now, status: "OPEN", by: "reviewer" }], authority: authority() });
  const file = save(home, "entry.yaml", entry);
  assert.equal(ingestLearningDocument({ type: "curriculum", file, home, now }).status, "ACCEPTED");
  assert.equal(ingestLearningDocument({ type: "curriculum", file, home, now }).status, "DUPLICATE");
  const changed = structuredClone(entry); changed.severity = "LOW"; changed.metadata.documentDigest = learningDocumentDigest(changed);
  assert.equal(ingestLearningDocument({ type: "curriculum", file: save(home, "changed.yaml", changed), home, now }).status, "REJECTED");
  const snapshot = createCurriculumSnapshot({ home, snapshotId: "snapshot-a", entryIds: ["missing-negative-cases"], policyRef: { id: "selection", digest: digest("selection") }, now });
  assert.equal(snapshot.document.entries.length, 1);
  assert.equal(snapshot.document.authority.mayPublish, false);
});

test("v4.2 research adapters are declarative and research remains reviewed supplemental static evidence", () => {
  const home = workspace();
  const adapter = finalize({ apiVersion: "learning.evopilot.io/v1", kind: "ResearchAdapterManifest", metadata: { adapterId: "markdown-static", version: "1.0.0" }, mediaTypes: ["text/markdown"], requiredFields: ["provenance", "license"], mapping: { title: "metadata.title", body: "content.canonicalText" }, limits: { maximumBytes: 100000, maximumDocuments: 10 }, conformanceFixtures: ["fixtures/markdown.yaml"], authority: "supplemental-evidence-only" });
  assert.equal(validateLearningFile("adapter", save(home, "adapter.yaml", adapter)).status, "VALIDATED");
  const malicious = structuredClone(adapter); malicious.command = "curl https://example.invalid"; malicious.metadata.documentDigest = learningDocumentDigest(malicious);
  assert.equal(validateLearningFile("adapter", save(home, "malicious.yaml", malicious)).status, "FAILED");
  const text = "reviewed static professional evidence";
  const research = finalize({ apiVersion: "learning.evopilot.io/v1", kind: "ResearchEvidencePackage", metadata: { packageId: "research-a", version: "1.0.0", createdAt: now }, adapterRef: { id: "markdown-static", version: "1.0.0" }, content: { mediaType: "text/markdown", canonicalText: text, digest: digest(text) }, provenance: { sourceReference: "urn:source:paper-a", acquisitionMethod: "EXTERNAL_REVIEWED_IMPORT", acquiredAt: now, publisher: "example" }, license: { status: "KNOWN", identifier: "Apache-2.0", citation: "paper-a" }, review: { status: "REVIEWED", reviewedBy: "human", purpose: "curriculum" }, redaction: { status: "REDACTED" }, secretScan: { status: "PASSED" }, trust: { classification: "SUPPLEMENTAL" }, authority: authority() });
  const result = ingestLearningDocument({ type: "research", file: save(home, "research.yaml", research), home, now });
  assert.equal(result.status, "ACCEPTED");
  assert.equal(result.networkAccess, false);
  assert.equal(result.pluginExecution, false);
  assert.equal(result.catalogMutation, false);
});

test("v4.2 completeness binds an immutable run, exposes accounting vectors, and rescoring is append-only", () => {
  const home = workspace();
  const entry = finalize({ apiVersion: "learning.evopilot.io/v1", kind: "AssetCurriculumEntry", metadata: { entryId: "coverage-a", version: "1.0.0", createdAt: now }, category: "accuracy-gap", evidenceRefs: [digest("reviewed-accuracy-gap")], statusEvents: [{ at: now, status: "RESOLVED", by: "reviewer" }], authority: authority() });
  ingestLearningDocument({ type: "curriculum", file: save(home, "entry.yaml", entry), home, now });
  const snapshot = createCurriculumSnapshot({ home, snapshotId: "snapshot-a", entryIds: ["coverage-a"], policyRef: { id: "selection", digest: digest("selection") }, now }).document;
  const run = createEvidenceRunManifest({ home, runId: "run-a", operationId: "op-a", curriculumSnapshotRef: { id: snapshot.metadata.snapshotId, digest: snapshot.metadata.documentDigest }, selectedEvidence: [{ id: "evidence-a", digest: digest("evidence-a") }], excludedEvidence: [{ id: "expired", reason: "expired" }], missingItems: ["independent-review"], erroredItems: [], bindings: { engineVersion: "4.2.0", policyDigest: digest("policy"), scorerVersion: "1.0.0", schemaVersion: "v1", environmentDigest: digest("environment"), workspaceDigest: digest("workspace") }, receipt: { state: "COMPLETED" }, now }).document;
  const policyFile = path.resolve("policies/completeness/default.yaml");
  const scored = scoreProfessionalCompleteness({ home, reportId: "professional-a", runId: run.metadata.runId, curriculumSnapshotId: snapshot.metadata.snapshotId, policyFile, now });
  assert.equal(scored.document.recommendation, "NEED_MORE_EVIDENCE");
  assert.equal(scored.document.accounting.missing, 1);
  assert.equal(scored.document.claims.reviewedAccuracySeparate, true);
  assert.equal(scored.document.claims.universalQuality, false);
  const rescored = rescoreProfessionalCompleteness({ home, reportId: scored.document.metadata.reportId, policyFile, reason: "presentation-policy-review", now: "2026-08-21T09:00:00.000Z" });
  assert.equal(rescored.document.rawEvidenceMutated, false);
  assert.equal(rescored.document.priorReportsMutated, false);
  assert.ok(fs.existsSync(scored.destination));
});

test("v4.2 contributions and domain-role proposals are evidence-only and fail incomplete review", () => {
  const home = workspace();
  const contribution = finalize({ apiVersion: "learning.evopilot.io/v1", kind: "ContributionEvidencePackage", metadata: { packageId: "contribution-a", version: "1.0.0", createdAt: now }, contributor: { identity: "community-alias", provenance: "signed-off" }, license: { terms: "Apache-2.0" }, payload: { type: "EVALUATION", digest: digest("payload") }, positiveCases: [{ id: "positive-a" }], negativeCases: [{ id: "negative-a" }], overlapReview: { duplicate: false, catalogOverlap: [] }, review: { status: "REVIEWED", reviewerEvidence: [digest("review")] }, falsePositiveConsiderations: ["generic-concept"], falseNegativeConsiderations: ["narrow-role"], authority: authority() });
  const accepted = ingestLearningDocument({ type: "contribution", file: save(home, "contribution.yaml", contribution), home, now });
  assert.equal(accepted.status, "ACCEPTED");
  assert.equal(accepted.catalogMutation, false);
  const incomplete = structuredClone(contribution); incomplete.negativeCases = []; incomplete.metadata.packageId = "contribution-b"; incomplete.metadata.documentDigest = learningDocumentDigest(incomplete);
  assert.equal(ingestLearningDocument({ type: "contribution", file: save(home, "incomplete.yaml", incomplete), home, now }).status, "REJECTED");
  const domain = finalize({ apiVersion: "learning.evopilot.io/v1", kind: "DomainRoleProposal", metadata: { proposalId: "domain-role-a", version: "1.0.0", createdAt: now }, domain: "database-client", role: "redis-client", positiveEvidence: [digest("domain-specific")], negativeBoundary: ["not-distributed-cache-product"], ontologyDistinction: ["client-library-not-product"], evaluationCases: { positive: ["redis-client"], negative: ["redis-server"] }, sourceDiversity: 2, falseNewProfileAnalysis: "bounded", falseUpgradeAnalysis: "bounded", ambiguity: [], conflicts: [], recommendation: "READY_FOR_ASSET_DELTA_PROPOSAL", authority: authority() });
  const domainResult = ingestLearningDocument({ type: "domainRole", file: save(home, "domain.yaml", domain), home, now });
  assert.equal(domainResult.status, "ACCEPTED");
  assert.equal(domainResult.approvalCreated, false);
  assert.equal(domainResult.publicationCreated, false);
});

function workspace() { const home = fs.mkdtempSync(path.join(os.tmpdir(), "evopilot-v42-")); initializeWorkspace(home); return home; }
function save(home, name, document) { const file = path.join(home, name); writeYaml(file, document); return file; }
function finalize(document) { document.metadata.documentDigest = zero; document.metadata.documentDigest = learningDocumentDigest(document); return document; }
function authority() { return { evidenceOnly: true, mayApprove: false, mayPublish: false, mayWriteCatalog: false, mayExecuteSource: false, mayActivatePolicy: false }; }
