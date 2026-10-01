import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { prepareSourceTaxonomyAnalysis } from "../src/v4/classification/engine.mjs";
import { aggregateTaxonomyDecision, retrieveTaxonomyCandidates, RETRIEVAL_CONFIG } from "../src/v4/classification/classifier.mjs";
import { digest } from "../src/v3/utils.mjs";

function prepare(t, words, coherent = false) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "evopilot-positive-evidence-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const [left, right] = words;
  fs.writeFileSync(path.join(root, "README.md"), coherent
    ? `This project manages ${left} ${right} workflows.\n## Capabilities\n- ${left} ${right} scheduling\n`
    : `This project manages ${left} scheduling.\n## Capabilities\n- ${left} planning\n`);
  fs.writeFileSync(path.join(root, "notes.md"), `The supporting module tracks ${right} records.\n## Contents\n- ${right} tracking\n`);
  const node = { id: `${left}-${right}`, label: `${left} ${right}`, aliases: [`${left} workflows ${right}`], definition: `${left} ${right} workflows`, assignable: true, positiveEvidenceHints: [`${left} ${right}`] };
  const taxonomy = { apiVersion: "harness.evopilot.io/v1", kind: "Taxonomy", metadata: { namespace: "controlled", name: "positive-evidence", version: "1.0.0" }, spec: {
    engineRange: ">=4.5.0 <5.0.0", requiredCapabilities: ["taxonomy-c14n/v1", "source-concept-hypothesis/v1", "open-world-taxonomy-classifier/v1", "taxonomy-decision-aggregate/v1"],
    axisPolicies: { domainCardinality: "SINGLE", productCardinality: "SINGLE" }, domains: [node], products: [node]
  } };
  return prepareSourceTaxonomyAnalysis({ source: root, taxonomy });
}

function decide(p, stance = "NEUTRAL") {
  const advisor = { candidates: Object.entries(p.retrieval.axes).flatMap(([axis, cs]) => cs.map((c) => ({ axis, nodeId: c.nodeId, support: stance, confidence: 0.95, evidenceIds: stance === "NEUTRAL" ? [] : c.nonLlmEvidence.slice(0, 2).map((e) => e.evidenceId) }))), unresolvedConcepts: [] };
  return aggregateTaxonomyDecision({ ...p, advisor });
}

test("unrelated file fragments cannot jointly establish a compound positive hint or neutral match", (t) => {
  for (const words of [["orchard", "routing"], ["telescope", "exhibits"], ["billing", "irrigation"]]) {
    const p = prepare(t, words), before = digest(p);
    for (const axis of ["domain", "product"]) {
      const c = p.retrieval.axes[axis][0];
      assert.ok(c.signals.find((s) => s.type === "bm25").score >= 0.45);
      assert.equal(c.signals.find((s) => s.type === "structured").score, 0);
      assert.notEqual(decide(p).axes[axis].status, "TAXONOMY_MATCHED");
    }
    assert.equal(digest(p), before);
  }
});

test("coherent positive evidence with independent corroboration still matches without Advisor support", (t) => {
  for (const words of [["orchard", "routing"], ["telescope", "exhibits"], ["billing", "irrigation"]]) {
    const p = prepare(t, words, true);
    assert.equal(decide(p).aggregate, "TAXONOMY_MATCHED");
    assert.notEqual(decide(p, "CONTRADICT").aggregate, "TAXONOMY_MATCHED");
  }
});

test("low-trust compound text cannot supply the missing coherent anchor", (t) => {
  const p = prepare(t, ["orchard", "routing"]);
  p.hypothesis.citations.push({ evidenceId: "untrusted", family: "low-trust-content-purpose", trust: "LOW", sourceRef: "vendor/README.md", excerpt: "orchard routing" });
  p.retrieval = retrieveTaxonomyCandidates(p.hypothesis, p.taxonomy);
  const axis = decide(p).axes.product;
  assert.notEqual(axis.status, "TAXONOMY_MATCHED");
});

test("positive-evidence repair invalidates cached retrieval contexts without lowering thresholds", (t) => {
  const p = prepare(t, ["orchard", "routing"]), prior = structuredClone(p.retrieval.config);
  delete prior.positiveEvidence;
  assert.notEqual(digest(prior), p.retrieval.configDigest);
  assert.equal(RETRIEVAL_CONFIG.decisionPolicy.matchedThreshold, 0.55);
  assert.equal(RETRIEVAL_CONFIG.decisionPolicy.minimumNonLlmFamilies, 2);
  assert.equal(RETRIEVAL_CONFIG.decisionPolicy.advisorSignalWeight, 0.2);
});
