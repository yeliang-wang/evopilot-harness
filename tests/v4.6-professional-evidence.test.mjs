import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { collectEvidence, reasonEvidence } from "../src/v3/reasoning.mjs";
import { initializeWorkspace } from "../src/v3/workspace.mjs";
import { digest } from "../src/v3/utils.mjs";
import { deriveProfessionalEvidence, verifyProfessionalEvidence, PROFESSIONAL_SOURCE_FIELDS } from "../src/v3/professional-evidence.mjs";
import { createBusinessInteractionProjection } from "../src/v4/interaction/business-projection.mjs";

function graph(text) {
  const node = { evidenceId: "evidence-declaration", sourceRef: "/frozen/source/spec.md", sourceDigest: digest(text), excerpt: text, excerptDigest: digest(text) };
  const value = { nodes: [node] };return { ...value, graphDigest: digest(value) };
}

test("professional facts are extracted from seven distinct static domains with exact immutable citations", () => {
  const observed = new Set();
  for (const domain of ["CRM", "ERP", "middleware", "diagnosis", "reconciliation", "recovery", "non-Harness"]) {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "professional-facts-workspace-"));
    const source = fs.mkdtempSync(path.join(os.tmpdir(), "professional-facts-source-"));
    initializeWorkspace(home);
    const declared = Object.fromEntries(PROFESSIONAL_SOURCE_FIELDS.map(field => [field, [`${domain} declared ${field}`]]));
    const file = path.join(source, "spec.json"), text = JSON.stringify(declared);fs.writeFileSync(file, text);
    const original = digest(fs.readFileSync(file));
    const { graph: collected } = collectEvidence({ options: { "source-project": source } }, home);
    const { graph: enriched, result } = reasonEvidence(collected, home);
    const proof = result.professionalEvidence;
    assert.deepEqual(proof.facets, declared);assert.equal(proof.facts.length, PROFESSIONAL_SOURCE_FIELDS.length);
    assert.equal(proof.graphDigest, enriched.graphDigest);assert.ok(verifyProfessionalEvidence(proof, enriched));
    for (const fact of proof.facts) {
      const node = enriched.nodes.find(node => node.evidenceId === fact.evidenceId);
      assert.equal(fact.sourceDigest, node.sourceDigest);assert.equal(fact.excerptDigest, digest(node.excerpt));
      assert.equal(fact.extractionMethod, "STATIC_DECLARED_FIELD");assert.equal(fact.authority, "EVIDENCE_ONLY");
      assert.equal(fact.value, JSON.parse(node.excerpt)[fact.field][0]);
    }
    assert.equal(proof.authority.provesEligibility, false);assert.equal(proof.authority.advisorDerived, false);
    assert.deepEqual(deriveProfessionalEvidence(enriched), proof);assert.equal(digest(fs.readFileSync(file)), original);
    observed.add(digest(proof.facets));
  }
  assert.equal(observed.size, 7);
});

test("professional extraction preserves explicit headings, unknowns and counter-evidence without guessing from labels", () => {
  const source = graph("## 业务对象\n- 可核对的记录\nTasks: Verify the record\nFailure modes: A conflicting record\nCounter-evidence: No independent recovery result\nA random label mentions roles and validators without declaring them.\n");
  const result = deriveProfessionalEvidence(source);
  assert.deepEqual(result.facets.businessObjects, ["可核对的记录"]);
  assert.deepEqual(result.facets.tasks, ["Verify the record"]);
  assert.deepEqual(result.facets.counterEvidence, ["No independent recovery result"]);
  assert.deepEqual(result.facets.roles, []);assert.deepEqual(result.facets.validators, []);
  assert.ok(result.missingFields.includes("recoveryStrategies"));assert.equal(result.authority.mayApprove, false);
  assert.deepEqual(result, deriveProfessionalEvidence(source));
  const code = graph("export class DeclaredRecord {}\nexport function validateRecord() {}\n// class NotADeclaration {}\n");
  code.nodes[0].label = "record.ts";const candidates = deriveProfessionalEvidence(code);
  assert.deepEqual(candidates.facets.businessObjects, ["DeclaredRecord"]);assert.deepEqual(candidates.facets.tasks, ["validateRecord"]);
  assert.ok(candidates.facts.every(fact => fact.uncertainty === "STRUCTURAL_CANDIDATE_REQUIRES_SEMANTIC_REVIEW"));
  assert.equal(candidates.authority.provesEligibility, false);assert.equal(candidates.facets.validators.length, 0, "A callable name is not proof of a working validator");
});

test("professional extraction refuses forged citations and recomputed invented fact digests", () => {
  const source = graph('Business objects: Immutable record\n'), result = deriveProfessionalEvidence(source);
  const forged = structuredClone(result);forged.facts[0].value = "Invented capability";delete forged.professionalEvidenceDigest;forged.professionalEvidenceDigest = digest(forged);
  assert.equal(verifyProfessionalEvidence(forged, source), false);
  const changed = structuredClone(source);changed.nodes[0].excerpt += "tampered";
  const denied = deriveProfessionalEvidence(changed);assert.equal(denied.facts.length, 0);
  assert.equal(denied.rejectedEvidence[0].reason, "IMMUTABLE_CONTENT_BINDING_MISMATCH");
  assert.equal(verifyProfessionalEvidence(result, changed), false);
  const legacy = structuredClone(source);delete legacy.nodes[0].sourceDigest;
  const incomplete = deriveProfessionalEvidence(legacy);
  assert.equal(incomplete.facts.length, 0);assert.equal(incomplete.rejectedEvidence[0].reason, "IMMUTABLE_CONTENT_BINDING_UNAVAILABLE");
});

test("professional extraction is bounded and never promotes repository governance to product facts", () => {
  const source = graph(JSON.stringify({ tasks: Array.from({ length: 600 }, (_, i) => `Task ${i}`) }));
  const bounded = deriveProfessionalEvidence(source);assert.equal(bounded.facts.length, 512);assert.equal(bounded.limits.truncated, true);
  const many = JSON.stringify({ tasks: Array.from({ length: 300 }, (_, i) => `Task ${i}`) });
  const reordered = { nodes: ["second", "first"].map(id => ({ ...graph(many).nodes[0], evidenceId: id })), graphDigest: digest("bound-two-node-fixture") };
  const limited = deriveProfessionalEvidence(reordered);assert.equal(limited.facts.length, 512);
  assert.ok(verifyProfessionalEvidence(limited, reordered), "The verifier must reproduce the exact bounded selection regardless of Evidence Graph storage order");
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "professional-filter-workspace-")), root = fs.mkdtempSync(path.join(os.tmpdir(), "professional-filter-source-"));
  initializeWorkspace(home);fs.writeFileSync(path.join(root, "README.md"), "Business objects: Product record\n");fs.writeFileSync(path.join(root, "AGENTS.md"), "Roles: Repository maintenance bot\n");
  const evidence = collectEvidence({ options: { "source-project": root } }, home);const reasoned = reasonEvidence(evidence.graph, home);
  assert.deepEqual(reasoned.result.professionalEvidence.facets.businessObjects, ["Product record"]);
  assert.deepEqual(reasoned.result.professionalEvidence.facets.roles, []);
  assert.ok(reasoned.graph.nodes.some(node => node.excerpt.includes("maintenance bot")), "Excluded context remains in the complete audit graph");
});

test("Review professional projection retains Source facets, counter-evidence and independently checkable transformation paths", () => {
  const source = graph(JSON.stringify(Object.fromEntries(PROFESSIONAL_SOURCE_FIELDS.map(field => [field, [`Declared ${field}`]]))));
  const proof = deriveProfessionalEvidence(source), model = {
    proposal: { proposalId: "bounded-review", decision: "NEED_MORE_EVIDENCE" },
    review: { summary: "Additional evidence is still needed.", verdict: "NEED_MORE_EVIDENCE", projectMembership: [{ sourceId: "source-001", sourceType: "attachment", sourceRef: source.nodes[0].sourceRef, sourceDigest: source.nodes[0].sourceDigest, evidenceIds: [source.nodes[0].evidenceId], rationale: "Static declaration only.", status: "IN_SCOPE" }] },
    reasoning: { decision: "NEED_MORE_EVIDENCE", professionalEvidence: proof }, sources: []
  };
  const input = { session: { sessionId: "professional-test", sessionDigest: digest("session"), compatibility: {}, interaction: { host: { locale: "zh-CN" } } }, stage: "PROPOSAL_REVIEW_PRESENTATION", subject: { type: "PROPOSAL", id: "bounded-review", digest: digest(model) }, renderModel: model, requiredFields: [], allowedNextOperations: [], forbiddenOperations: [] };
  const before = structuredClone(model), result = createBusinessInteractionProjection(input), analysis = result.professionalAnalysis;
  for (const field of PROFESSIONAL_SOURCE_FIELDS.filter(field => field !== "counterEvidence")) assert.deepEqual(analysis.professionalFacets[field], proof.facets[field]);
  assert.deepEqual(analysis.counterEvidence, ["Declared counterEvidence"]);
  assert.equal(result.sourceOutcomeExplanation.proposalAllowed, false);
  assert.equal(result.sourceReasoningMap.entries[0].facetEvidence.length, PROFESSIONAL_SOURCE_FIELDS.length);
  assert.ok(analysis.capabilities[0].sourceEvidence.some(item => item.locator?.jsonPointer === "/businessObjects/0"));
  assert.deepEqual(result.auditEnvelope.authoritativeRenderModel, before);assert.deepEqual(model, before);
  assert.match(result.businessView.canonicalMarkdown, /Declared businessObjects/);
  assert.match(result.businessView.canonicalMarkdown, /Declared validators/);
  assert.deepEqual(result, createBusinessInteractionProjection(input));
});

test("professional catalog alternatives preserve actual scores, rejection reasons and evidence instead of a generic rationale", () => {
  const reasoning = { decision: "EVOLVE_EXISTING", targetProfile: { id: "selected" }, candidates: [
    { id: "selected", rank: 1, totalScore: 0.9, evidenceIds: ["a"], factors: { evidenceCoverage: 1 }, rejectionReasons: [] },
    { id: "alternative", rank: 2, totalScore: 0.4, evidenceIds: ["b"], factors: { evidenceCoverage: 0.5 }, rejectionReasons: ["Required evidence coverage=0.5"] }
  ] };
  const result = createBusinessInteractionProjection({ session: { sessionId: "catalog-reason", sessionDigest: digest("s"), compatibility: {}, interaction: { host: { locale: "zh-CN" } } }, stage: "PROPOSAL_REVIEW_PRESENTATION", subject: { id: "proposal", digest: digest("p") }, renderModel: { proposal: { decision: "EVOLVE_EXISTING" }, reasoning, sources: [] }, requiredFields: [], allowedNextOperations: [], forbiddenOperations: [] });
  const alternatives = result.professionalAnalysis.catalogComparison.rejectedAlternatives;
  assert.equal(alternatives.length, 1);assert.equal(alternatives[0].alternative, "alternative");
  assert.match(alternatives[0].reason, /Required evidence coverage=0.5/);assert.match(alternatives[0].reason, /selected selected rank 1, score 0.9/);
  assert.deepEqual(alternatives[0].evidenceIds, ["b"]);assert.equal(result.professionalAnalysis.authority.advisorAdvisoryOnly, true);
});
