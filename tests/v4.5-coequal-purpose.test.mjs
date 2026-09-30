import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { prepareSourceTaxonomyAnalysis } from "../src/v4/classification/engine.mjs";
import { aggregateTaxonomyDecision, RETRIEVAL_CONFIG } from "../src/v4/classification/classifier.mjs";
import { digest } from "../src/v3/utils.mjs";

const declaration = "Both capability families are first-class and the available material does not identify a primary product responsibility.";
const cases = [
  ["The workspace lets customers research and compare investment products.", "It also accepts customer questions, tracks service requests, and routes follow-up work to service staff.", "product research comparison", "customer service request"],
  ["The workspace provides orchard irrigation scheduling.", "It also maintains harvest crate routing.", "orchard irrigation scheduling", "harvest crate routing"],
  ["The workspace provides telescope exposure calibration.", "It also maintains museum exhibit scheduling.", "telescope exposure calibration", "museum exhibit scheduling"]
];
function prepare(t, index = 0, transform = (s) => s, ids = ["first", "second"]) {
  const [one, two, a, b] = cases[index];
  const source = fs.mkdtempSync(path.join(os.tmpdir(), "evopilot-coequal-"));
  t.after(() => fs.rmSync(source, { recursive: true, force: true }));
  fs.writeFileSync(path.join(source, "README.md"), transform([one, two, declaration].join("\n")));
  const taxonomy = { apiVersion: "harness.evopilot.io/v1", kind: "Taxonomy", metadata: { namespace: "controlled", name: "declared-purpose", version: "1.0.0" }, spec: {
    engineRange: ">=4.5.0 <5.0.0", requiredCapabilities: ["taxonomy-c14n/v1", "source-concept-hypothesis/v1", "open-world-taxonomy-classifier/v1", "taxonomy-decision-aggregate/v1"],
    axisPolicies: { domainCardinality: "SINGLE", productCardinality: "SINGLE" },
    domains: [{ id: "domain", label: "Declared scope", definition: "Declared source responsibilities", assignable: true }],
    products: [a, b].map((hint, i) => ({ id: ids[i], label: ids[i], definition: hint, assignable: true, positiveEvidenceHints: [hint] }))
  } };
  return prepareSourceTaxonomyAnalysis({ source, taxonomy });
}
function decide(prepared, disposition = "NEUTRAL") {
  const advisor = { candidates: Object.entries(prepared.retrieval.axes).flatMap(([axis, candidates]) => candidates.map((c) => ({ axis, nodeId: c.nodeId, support: disposition, confidence: 0.99, evidenceIds: c.nonLlmEvidence.map((x) => x.evidenceId) }))), unresolvedConcepts: [] };
  return aggregateTaxonomyDecision({ ...prepared, advisor });
}

test("explicit coequal responsibilities use declared vocabulary and distinct statements under every Advisor stance", (t) => {
  for (let index = 0; index < cases.length; index++) for (const ids of [["first", "second"], ["renamed-alpha", "renamed-beta"]]) {
    const prepared = prepare(t, index, undefined, ids), before = digest(prepared);
    for (const stance of ["SUPPORT", "NEUTRAL", "CONTRADICT"]) {
      const result = decide(prepared, stance), axis = result.axes.product;
      assert.equal(result.aggregate, "TAXONOMY_AMBIGUOUS");
      assert.equal(axis.ambiguityBasis, "EXPLICIT_COOEQUAL_PRIMARY_PURPOSES");
      const proof = axis.mixedPurposeEvidence;
      assert.equal(new Set(proof.assertions.map((x) => x.originGroup)).size, 2);
      assert.deepEqual(new Set(proof.assertions.map((x) => x.purpose)), new Set(ids));
      for (const item of [...proof.assertions, proof.declarationAssertion]) {
        assert.ok(prepared.hypothesis.citations.some((c) => c.evidenceId === item.evidenceId && c.sourceRef === item.sourceRef));
        const { assertionDigest, ...core } = item;
        assert.equal(assertionDigest, digest(core));
      }
      assert.equal(result.authority.advisorMaySelect, false);
    }
    assert.equal(digest(prepared), before);
  }
});

test("coequal words without separate current responsibilities do not create a primary-purpose proof", (t) => {
  const [one, two] = cases[0];
  const variants = [
    one + "\n" + two,
    declaration,
    one + "\n" + declaration,
    one + "\n" + one + "\n" + declaration,
    one + "\n" + two + "\nBoth capability families are not first-class.",
    "Previously, " + one + "\n" + two + "\n" + declaration,
    "For example, " + one + "\n" + two + "\n" + declaration,
    "The workspace does not provide product research comparison.\n" + two + "\n" + declaration,
    "The workspace provides product research comparison and customer service requests.\nIt maintains customer service requests and product research comparison.\n" + declaration,
    one + " " + two + " Both features are available, with customer service as the only primary responsibility."
  ];
  for (const text of variants) {
    const result = decide(prepare(t, 0, () => text), "CONTRADICT");
    assert.equal(result.axes.product.mixedPurposeEvidence, undefined, text);
    assert.notEqual(result.axes.product.status, "TAXONOMY_MATCHED");
    assert.notEqual(result.axes.product.status, "TAXONOMY_EXTENSION_SUGGESTED");
  }
});

test("low-trust or subordinate coequal declarations cannot replace primary Source evidence", (t) => {
  const prepared = prepare(t);
  for (const mode of ["LOW", "NESTED"]) {
    const input = structuredClone(prepared);
    if (mode === "LOW") for (const c of input.hypothesis.citations) c.trust = "LOW";
    else {
      for (const c of input.hypothesis.citations) c.sourceRef = "examples/nested/README.md";
      input.hypothesis.citations.push({ evidenceId: "root-purpose", family: "content-purpose", trust: "NORMAL", sourceRef: "README.md", sourceDigest: digest("root"), excerpt: "This project has one primary responsibility." });
    }
    assert.equal(decide(input, "CONTRADICT").axes.product.mixedPurposeEvidence, undefined);
  }
});

test("an explicit ambiguity never weakens positive evidence or SINGLE cardinality requirements", (t) => {
  const prepared = prepare(t);
  prepared.taxonomy.axes.product.cardinality = "MULTIPLE";
  const result = decide(prepared);
  assert.notEqual(result.axes.product.status, "TAXONOMY_AMBIGUOUS");
  assert.notEqual(result.axes.product.status, "TAXONOMY_MATCHED");
  assert.notEqual(result.axes.product.status, "TAXONOMY_EXTENSION_SUGGESTED");
});

test("coequal repair invalidates old retrieval contexts without changing positive thresholds", (t) => {
  const prepared = prepare(t), prior = structuredClone(prepared.retrieval.config);
  assert.equal(prior.decisionPolicy.mixedPurposeEvidence.algorithm, "primary-purpose-evidence/v4");
  prior.decisionPolicy.mixedPurposeEvidence.algorithm = "primary-purpose-evidence/v3";
  assert.notEqual(digest(prior), prepared.retrieval.configDigest);
  assert.equal(RETRIEVAL_CONFIG.decisionPolicy.minimumNonLlmFamilies, 2);
  assert.equal(RETRIEVAL_CONFIG.decisionPolicy.matchedThreshold, 0.55);
  assert.equal(RETRIEVAL_CONFIG.decisionPolicy.margin, 0.12);
});
