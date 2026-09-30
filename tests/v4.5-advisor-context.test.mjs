import assert from "node:assert/strict";
import test from "node:test";
import { ADVISOR_INPUT_LIMITS, requestTaxonomyAdvisor } from "../src/v4/classification/advisor.mjs";

const citation = (evidenceId, sourceRef, excerpt, family = "lexical-content", trust = "NORMAL") => ({ evidenceId, sourceRef, excerpt, family, trust });
async function capture(citations, definition = "dashboard portal support workflow pipeline release automation") {
  const hypothesis = { hypothesisDigest: "synthetic", concepts: [], citations, dependencySignals: [], structuredSignals: [] };
  const taxonomy = { taxonomyDigest: definition, axes: { domain: { nodes: [{ id: "user-category", label: "User category", definition }] }, product: { nodes: [] } } };
  const retrieval = { retrievalDigest: "synthetic", axes: { domain: [{ axis: "domain", nodeId: "user-category", signals: [], nonLlmEvidence: [], contradictions: [] }], product: [] } };
  const before = structuredClone({ hypothesis, taxonomy, retrieval });
  let input;
  const receipt = await requestTaxonomyAdvisor({ hypothesis, taxonomy, retrieval, provider: async (value) => {
    input = value;
    return { candidates: [{ axis: "domain", nodeId: "user-category", support: "NEUTRAL", confidence: 0, evidenceIds: [], contradictions: [] }], unresolvedConcepts: [] };
  } });
  assert.deepEqual({ hypothesis, taxonomy, retrieval }, before);
  assert.equal(receipt.status, "SUCCEEDED");
  assert.equal(receipt.candidates[0].support, "NEUTRAL");
  assert.equal(receipt.authority.maySelectResult, false);
  return input;
}

test("secondary vocabulary cannot displace an unrelated root purpose from the bounded advisor input", async () => {
  for (const business of ["orchard harvest scheduling", "medical specimen transport", "museum collection loans"]) {
    const evidence = [citation("primary", "README.md", `This project manages ${business}.`, "content-purpose"),
      ...Array.from({ length: 48 }, (_, index) => citation(`noise-${index}`, `tooling/deployment/script-${index}.js`, "dashboard portal support workflow pipeline release automation"))];
    const input = await capture(evidence);
    assert.ok(input.allowedEvidenceIds.includes("primary"));
    assert.ok(input.hypothesis.sourceContextEvidenceIds.includes("primary"));
    assert.ok(input.hypothesis.citations.find((item) => item.evidenceId === "primary").excerpt.includes(business));
    assert.equal(input.allowedEvidenceIds.length, ADVISOR_INPUT_LIMITS.standaloneEvidence);
  }
});

test("source context survives taxonomy changes and input permutation while candidate evidence remains relevant", async () => {
  const evidence = [citation("primary", "README.md", "Scheduling and delivery", "content-purpose"),
    ...Array.from({ length: 40 }, (_, index) => citation(`alpha-${index}`, `alpha/file-${index}.js`, "alpha responsibility")),
    ...Array.from({ length: 40 }, (_, index) => citation(`beta-${index}`, `beta/file-${index}.js`, "beta responsibility"))];
  const alpha = await capture(evidence, "alpha");
  const beta = await capture(evidence.toReversed(), "beta");
  assert.deepEqual(alpha.hypothesis.sourceContextEvidenceIds, beta.hypothesis.sourceContextEvidenceIds);
  assert.equal(alpha.hypothesis.sourceContextEvidenceIds.length, ADVISOR_INPUT_LIMITS.sourceContextEvidence);
  const context = new Set(alpha.hypothesis.sourceContextEvidenceIds);
  assert.ok(alpha.allowedEvidenceIds.filter((id) => !context.has(id)).every((id) => id.startsWith("alpha-")));
  assert.ok(beta.allowedEvidenceIds.filter((id) => !context.has(id)).every((id) => id.startsWith("beta-")));
});

test("source context samples multiple components and does not spend its budget on duplicate file families", async () => {
  const evidence = [citation("overview", "README.md", "Primary responsibility", "content-purpose"), citation("overview-copy", "README.md", "Primary responsibility"),
    ...["alpha", "beta", "gamma"].flatMap((component) => Array.from({ length: 50 }, (_, index) => citation(`${component}-${index}`, `${component}/file-${index}.js`, "module evidence")))];
  const input = await capture(evidence);
  const selected = input.hypothesis.sourceContextEvidenceIds.map((id) => evidence.find((item) => item.evidenceId === id));
  assert.equal(new Set(selected.map((item) => item.sourceRef)).size, selected.length);
  assert.deepEqual(new Set(selected.map((item) => item.sourceRef.split("/")[0])), new Set(["README.md", "alpha", "beta", "gamma"]));
  assert.equal(selected[0].evidenceId, "overview");
});

test("context never admits low-trust, invented or unsupported evidence and keeps excerpts bounded", async () => {
  const input = await capture([
    citation("safe", "README.md", "x".repeat(2000), "content-purpose"),
    citation("unsafe", "README-unsafe.md", "dashboard portal", "content-purpose", "LOW"),
    citation("unsupported", "other.md", "dashboard portal", "low-trust-content-purpose"),
  ]);
  assert.deepEqual(input.allowedEvidenceIds, ["safe"]);
  assert.deepEqual(input.hypothesis.sourceContextEvidenceIds, ["safe"]);
  assert.equal(input.hypothesis.citations[0].excerpt.length, ADVISOR_INPUT_LIMITS.excerptCharacters);
  const empty = await capture([]);
  assert.deepEqual(empty.allowedEvidenceIds, []);
  assert.deepEqual(empty.hypothesis.sourceContextEvidenceIds, []);
});
