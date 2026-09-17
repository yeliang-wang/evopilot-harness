import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { digest } from "../src/v3/utils.mjs";
import { validateDocument } from "../src/v3/schema.mjs";
import { createSemanticCandidateSet, GROUNDING_OUTCOMES, resolveOntologyFoundation, resolveOntologyGrounding } from "../src/v4/semantics/ontology-grounding.mjs";
import { createHarnessSemanticRequirements, evaluateSemanticCompatibility } from "../src/v4/semantics/semantic-compatibility.mjs";
import { initializeWorkspace } from "../src/v3/workspace.mjs";
import { invokeEngineOperation } from "../src/v4/engine-adapter.mjs";

const evidenceIds = ["evidence-content", "evidence-dependency"];
const evidenceFamilies = ["lexical-content", "dependency"];

function hypothesis() {
  return { sourceSnapshotDigest: digest("source"), evidenceGraphDigest: digest("graph"), concepts: [] };
}

function candidate(candidateId, label, extra = {}) {
  return { candidateId, label, metaType: "CAPABILITY", evidenceIds, evidenceFamilies, deterministicSignals: [], uncertainty: "BOUNDED", ...extra };
}

test("v4.6 Foundation is minimal, bounded, deterministic, and contains no business values", () => {
  const first = resolveOntologyFoundation();
  const second = resolveOntologyFoundation();
  assert.deepEqual(first, second);
  assert.equal(first.authority.containsBusinessValues, false);
  assert.equal(first.authority.mayDecideEligibility, false);
  assert.deepEqual(first.metaTypes, ["ACTION", "ACTOR", "ATTRIBUTE", "CAPABILITY", "DATA_ASSET", "ENTITY", "EVENT", "PERMISSION", "RELATIONSHIP", "ROLE", "RULE", "STATE", "SYSTEM", "WORKFLOW"]);
  assert.equal(first.metaTypes.includes("BUSINESS_OBJECT"), false);
  assert.equal(first.businessValues, undefined);
  assert.throws(() => resolveOntologyFoundation({ metaTypes: ["CAPABILITY"] }), (error) => error.code === "ONTOLOGY_FOUNDATION_INVALID");
});

test("v4.6 Grounding Resolver emits exactly six finite outcomes with deterministic precedence", () => {
  const foundation = resolveOntologyFoundation();
  const candidateSet = createSemanticCandidateSet({
    sourceConceptHypothesis: hypothesis(),
    candidates: [
      candidate("resolved", "cache", { authoritativeConceptIds: ["cap.cache"] }),
      candidate("unresolved", "unknown"),
      candidate("ambiguous", "shared", { authoritativeConceptIds: ["cap.one", "cap.two"] }),
      candidate("conflicting", "unsafe", { conflictConceptIds: ["cap.blocked"] }),
      candidate("extension", "novel", { proposedExtension: { parentConceptId: "cap.root", definition: "A bounded novel capability." } }),
      candidate("insufficient", "weak", { evidenceIds: ["evidence-content"], evidenceFamilies: ["lexical-content"] })
    ]
  });
  const concepts = [
    { conceptId: "cap.root", label: "root", metaType: "CAPABILITY" },
    { conceptId: "cap.cache", label: "cache", metaType: "CAPABILITY" },
    { conceptId: "cap.one", label: "one", metaType: "CAPABILITY" },
    { conceptId: "cap.two", label: "two", metaType: "CAPABILITY" },
    { conceptId: "cap.blocked", label: "blocked", metaType: "CAPABILITY" }
  ];
  const result = resolveOntologyGrounding({ foundation, candidateSet, concepts });
  assert.equal(validateDocument(foundation).status, "VALIDATED");
  assert.equal(validateDocument(candidateSet).status, "VALIDATED");
  assert.equal(validateDocument(result).status, "VALIDATED");
  assert.deepEqual(new Set(result.results.map((item) => item.outcome)), new Set(GROUNDING_OUTCOMES));
  assert.deepEqual(result.precedence, ["EVIDENCE_INSUFFICIENT", "CONFLICTING_CONCEPT", "AMBIGUOUS_CONCEPT", "RESOLVED", "EXTENSION_REQUIRED", "UNRESOLVED_CONCEPT"]);
  assert.equal(result.results.every((item) => item.userActions.length > 0), true);
  assert.equal(result.presentation.title, "素材中的业务概念分析");
  assert.equal(result.presentation.hostAuthored, false);
  assert.equal(result.authority.provesHarnessEligibility, false);
  const replay = resolveOntologyGrounding({ foundation, candidateSet, concepts, expected: { foundationDigest: foundation.foundationDigest, candidateSetDigest: candidateSet.candidateSetDigest, conceptSetDigest: result.conceptSetDigest }, priorResults: [result] });
  assert.deepEqual(replay.priorResultDigests, [result.groundingResultDigest]);
  assert.throws(() => resolveOntologyGrounding({ foundation, candidateSet, concepts, expected: { conceptSetDigest: digest("drift") } }), (error) => error.code === "ONTOLOGY_CONTEXT_DRIFT");
});

test("v4.6 rejects LLM-owned authoritative concept identifiers", () => {
  assert.throws(() => createSemanticCandidateSet({ sourceConceptHypothesis: hypothesis(), candidates: [candidate("llm", "cache", { llmAdvice: { selectedConceptId: "cap.cache" } })] }), (error) => error.code === "LLM_AUTHORITY_REJECTED");
});

test("Semantic compatibility is independent from Harness Eligibility", () => {
  const foundation = resolveOntologyFoundation();
  const candidateSet = createSemanticCandidateSet({ sourceConceptHypothesis: hypothesis(), candidates: [candidate("resolved", "cache", { authoritativeConceptIds: ["cap.cache"] })] });
  const groundingResult = resolveOntologyGrounding({ foundation, candidateSet, concepts: [{ conceptId: "cap.cache", label: "cache", metaType: "CAPABILITY" }] });
  const requirements = createHarnessSemanticRequirements({ foundationDigest: foundation.foundationDigest, requiredConcepts: [{ conceptId: "cap.cache", metaType: "CAPABILITY", rationale: "Required capability", evidenceRefs: ["evidence-content"] }] });
  const report = evaluateSemanticCompatibility({ requirements, groundingResult, eligibility: { decision: "NOT_ELIGIBLE" } });
  assert.equal(validateDocument(requirements).status, "VALIDATED");
  assert.equal(validateDocument(report).status, "VALIDATED");
  assert.equal(report.status, "COMPATIBLE");
  assert.equal(report.eligibilityObservation.decision, "NOT_ELIGIBLE");
  assert.equal(report.authority.harnessEligibilityIndependent, true);
  assert.equal(report.authority.mayOverrideEligibility, false);
});

test("HarnessBundle accepts optional digest-closed semantic requirements and v4.8 assets require complete schemas", () => {
  const foundation = resolveOntologyFoundation();
  const semanticRequirements = createHarnessSemanticRequirements({ foundationDigest: foundation.foundationDigest, requiredConcepts: [{ conceptId: "cap.cache", metaType: "CAPABILITY", rationale: "Required capability", evidenceRefs: ["evidence-content"] }] });
  const bundle = {
    apiVersion: "harness.evopilot.io/v3",
    kind: "HarnessBundle",
    metadata: { id: "semantic-bundle", version: "1.0.0", name: "Semantic bundle", description: "A semantic requirements validation fixture.", lifecycle: "review" },
    spec: {
      profile: { id: "profile", version: "1.0.0", digest: digest("profile") },
      resolvedComponents: [{ id: "component", version: "1.0.0", digest: digest("component") }],
      executionPlan: ["run-component"], constraints: ["Stay bounded."], evidence: ["source-snapshot"], validators: ["semantic-closure"], semanticRequirements
    }
  };
  assert.equal(validateDocument(bundle).status, "VALIDATED");
  bundle.spec.semanticRequirements.requiredConcepts[0].conceptId = "cap.changed";
  assert.equal(validateDocument(bundle).status, "FAILED");
  const incompleteIndex = validateDocument({ kind: "SemanticIndex" });
  assert.equal(incompleteIndex.status, "FAILED");
  assert.equal(incompleteIndex.valid, false);
  assert.match(incompleteIndex.errors[0].message, /required property/);
});

test("v4.6 semantic diagnostics are exposed through the Engine adapter", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "evopilot-v46-semantic-diagnostics-"));
  initializeWorkspace(home);
  const foundationOperation = await invokeEngineOperation({ home, operation: "semantic.foundation.inspect" });
  assert.equal(foundationOperation.result.schema, "evopilot-harness-ontology-foundation/v1");

  const hypothesisFile = path.join(home, "hypothesis.json");
  fs.writeFileSync(hypothesisFile, `${JSON.stringify(hypothesis(), null, 2)}\n`);
  const candidatesOperation = await invokeEngineOperation({ home, operation: "semantic.candidates.inspect", input: { hypothesis: hypothesisFile } });
  assert.equal(candidatesOperation.result.schema, "evopilot-harness-semantic-candidate-set/v1");

  const foundation = resolveOntologyFoundation();
  const candidateSet = createSemanticCandidateSet({ sourceConceptHypothesis: hypothesis(), candidates: [candidate("resolved", "cache", { authoritativeConceptIds: ["cap.cache"] })] });
  const candidateSetFile = path.join(home, "candidates.json");
  const conceptsFile = path.join(home, "concepts.json");
  fs.writeFileSync(candidateSetFile, `${JSON.stringify(candidateSet, null, 2)}\n`);
  fs.writeFileSync(conceptsFile, `${JSON.stringify({ concepts: [{ conceptId: "cap.cache", label: "cache", metaType: "CAPABILITY" }] }, null, 2)}\n`);
  const groundingOperation = await invokeEngineOperation({ home, operation: "semantic.grounding.inspect", input: { candidateSet: candidateSetFile, concepts: conceptsFile } });
  assert.equal(groundingOperation.result.results[0].outcome, "RESOLVED");

  const requirements = createHarnessSemanticRequirements({ foundationDigest: foundation.foundationDigest, requiredConcepts: [{ conceptId: "cap.cache", metaType: "CAPABILITY", rationale: "Required capability", evidenceRefs: ["evidence-content"] }] });
  const requirementsFile = path.join(home, "requirements.json");
  const groundingFile = path.join(home, "grounding.json");
  fs.writeFileSync(requirementsFile, `${JSON.stringify(requirements, null, 2)}\n`);
  fs.writeFileSync(groundingFile, `${JSON.stringify(groundingOperation.result, null, 2)}\n`);
  const compatibilityOperation = await invokeEngineOperation({ home, operation: "semantic.compatibility.inspect", input: { requirements: requirementsFile, groundingResult: groundingFile } });
  assert.equal(compatibilityOperation.result.status, "COMPATIBLE");
});
