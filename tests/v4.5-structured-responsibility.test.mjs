import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { prepareSourceTaxonomyAnalysis } from "../src/v4/classification/engine.mjs";
import { aggregateTaxonomyDecision, RETRIEVAL_CONFIG } from "../src/v4/classification/classifier.mjs";
import { digest } from "../src/v3/utils.mjs";

const vocabularies = [
  ["investment product research", "filter investment products", "research information presentation"],
  ["orchard irrigation scheduling", "route harvest crates", "soil moisture monitoring"],
  ["telescope exposure calibration", "schedule museum exhibits", "optical sensor measurement"]
];
function prepare(t, { vocabulary = vocabularies[0], metadata, filename = "neutral.json", overview, noOverview = false, id = "declared" } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "evopilot-structured-purpose-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  if (!noOverview) fs.writeFileSync(path.join(root, "README.md"), overview ?? `The system provides ${vocabulary[0]} and supports ${vocabulary[2]}.\nHistorical notes mention distributed cache middleware from removed experiments.\n`);
  fs.mkdirSync(path.dirname(path.join(root, filename)), { recursive: true });
  const document = metadata ?? { currentResponsibilities: vocabulary, removedExperiments: ["distributed cache middleware"] };
  fs.writeFileSync(path.join(root, filename), typeof document === "string" ? document : JSON.stringify(document));
  const node = { id, label: id, definition: vocabulary.join(" "), assignable: true, positiveEvidenceHints: [vocabulary[0], vocabulary[2]], exclusionHints: ["distributed cache middleware"] };
  const taxonomy = { apiVersion: "harness.evopilot.io/v1", kind: "Taxonomy", metadata: { namespace: "controlled", name: "structured-purpose", version: "1.0.0" }, spec: {
    engineRange: ">=4.5.0 <5.0.0", requiredCapabilities: ["taxonomy-c14n/v1", "source-concept-hypothesis/v1", "open-world-taxonomy-classifier/v1", "taxonomy-decision-aggregate/v1"],
    axisPolicies: { domainCardinality: "SINGLE", productCardinality: "SINGLE" }, domains: [node], products: [node]
  } };
  const before = Object.fromEntries(fs.readdirSync(root).filter((x) => fs.statSync(path.join(root, x)).isFile()).map((x) => [x, digest(fs.readFileSync(path.join(root, x)))]));
  const result = prepareSourceTaxonomyAnalysis({ source: root, taxonomy });
  for (const [ref, value] of Object.entries(before)) assert.equal(digest(fs.readFileSync(path.join(root, ref))), value);
  return result;
}
function decide(p, support = "SUPPORT") {
  return aggregateTaxonomyDecision({ ...p, advisor: { candidates: Object.entries(p.retrieval.axes).flatMap(([axis, cs]) => cs.map((c) => ({ axis, nodeId: c.nodeId, support, confidence: .95, evidenceIds: c.nonLlmEvidence.map((x) => x.evidenceId) }))), unresolvedConcepts: [] } });
}
const declarations = (p) => p.hypothesis.structuredSignals.filter((x) => x.kind === "declared-responsibility");

test("structured current responsibilities corroborate an independent overview across vocabulary, file and category names", (t) => {
  for (const vocabulary of vocabularies) for (const filename of ["neutral.json", "descriptions.json"]) {
    const p = prepare(t, { vocabulary, filename, id: "renamed-category" }), r = decide(p);
    assert.equal(r.aggregate, "TAXONOMY_MATCHED");
    assert.equal(r.axes.product.selected.nodeId, "renamed-category");
    assert.equal(declarations(p).length, 3);
    for (const item of declarations(p)) {
      assert.equal(item.sourceRef, filename);
      assert.match(item.jsonPointer, /^\/currentResponsibilities\/[0-2]$/);
      assert.equal(item.sourceDigest, p.hypothesis.sourceSnapshot.files.find((x) => x.sourceRef === filename).sourceDigest);
      assert.ok(p.hypothesis.evidenceGraph.evidence.some((x) => x.evidenceId === item.evidenceId));
    }
    for (const axis of Object.values(r.axes)) {
      assert.ok(axis.selected.nonLlmEvidence.some((x) => x.kind === "declared-responsibility"));
      assert.deepEqual(axis.selected.contradictions, []);
    }
    assert.equal(p.hypothesis.provenance.taxonomyExposed, false);
    assert.equal(p.hypothesis.sourceSnapshot.sourceExecution, false);
  }
});

test("removed declarations stay cited with non-current context and cannot become current responsibility support", (t) => {
  const p = prepare(t, { metadata: { currentResponsibilities: vocabularies[0], removedExperiments: ["distributed cache", "gateway", "customer portal"] } });
  assert.ok(p.hypothesis.contradictions.some((x) => x.sourceRef === "neutral.json" && x.jsonPointer === "/removedExperiments/0" && x.excerpt.includes("cache")));
  assert.ok(p.hypothesis.contradictions.some((x) => x.sourceRef === "README.md" && x.excerpt.includes("removed")));
  assert.ok(p.hypothesis.contradictions.some((x) => x.jsonPointer === "/removedExperiments/1" && x.excerpt === "gateway"));
  assert.ok(p.hypothesis.citations.some((x) => x.family === "lexical-content" && x.excerpt.includes("removedExperiments")));
  assert.ok(declarations(p).every((x) => !x.excerpt.includes("cache")));
  assert.ok(p.hypothesis.citations.filter((x) => x.family === "content-purpose").every((x) => !x.excerpt.includes("removed experiments")));
});

test("arbitrary, nested, historical, malformed and negated JSON do not acquire structured responsibility authority", (t) => {
  for (const metadata of [
    { notes: vocabularies[0] },
    { history: { currentResponsibilities: vocabularies[0] } },
    { examples: [{ currentResponsibilities: vocabularies[0] }] },
    { removedResponsibilities: vocabularies[0] },
    { currentResponsibilities: ["Previously investment product research", "No longer research information presentation"] },
    { currentResponsibilities: [{ text: vocabularies[0][0] }] },
    '{"currentResponsibilities": ["investment product research"'
  ]) {
    const p = prepare(t, { metadata });
    assert.equal(declarations(p).length, 0, JSON.stringify(metadata));
    assert.notEqual(decide(p).aggregate, "TAXONOMY_MATCHED", JSON.stringify(metadata));
  }
});

test("low-trust declarations and a single JSON with its lexical duplicate cannot satisfy two evidence families", (t) => {
  for (const options of [{ noOverview: true }, { filename: "examples/neutral.json" }, { filename: "tests/neutral.json" }]) {
    const p = prepare(t, options), r = decide(p);
    assert.notEqual(r.aggregate, "TAXONOMY_MATCHED");
    assert.notEqual(r.aggregate, "TAXONOMY_EXTENSION_SUGGESTED");
  }
});

test("an exact copied overview and JSON statement do not establish independent corroboration", (t) => {
  const value = vocabularies[0][0];
  const p = prepare(t, { overview: value, metadata: { currentResponsibilities: [value] } });
  assert.notEqual(decide(p).aggregate, "TAXONOMY_MATCHED");
});

test("current field formatting is generic while extraction stays bounded and taxonomy-blind", (t) => {
  for (const key of ["responsibilities", "primary_capabilities", "current-capabilities"]) {
    const p = prepare(t, { metadata: { [key]: vocabularies[1] }, vocabulary: vocabularies[1] });
    assert.equal(declarations(p).length, 3);
    assert.equal(decide(p).aggregate, "TAXONOMY_MATCHED");
  }
  const p = prepare(t, { metadata: { currentResponsibilities: Array.from({ length: 80 }, (_, i) => `bounded responsibility value ${i}`) } });
  assert.ok(declarations(p).length <= 32);
});

test("structured evidence does not override Advisor contradiction or alter positive decision thresholds", (t) => {
  const p = prepare(t);
  assert.notEqual(decide(p, "CONTRADICT").aggregate, "TAXONOMY_MATCHED");
  assert.equal(RETRIEVAL_CONFIG.decisionPolicy.minimumNonLlmFamilies, 2);
  assert.equal(RETRIEVAL_CONFIG.decisionPolicy.matchedThreshold, .55);
  assert.equal(RETRIEVAL_CONFIG.decisionPolicy.advisorSupportedMinimumBm25, .45);
  assert.equal(RETRIEVAL_CONFIG.structured.algorithm, "dependency-and-source-structure/v2");
});

test("current historical-data or legacy-system responsibilities are not mistaken for removed experiments", (t) => {
  const vocabulary = ["historical record indexing", "legacy gateway monitoring", "not only irrigation scheduling"];
  const p = prepare(t, { vocabulary, overview: "Historical record indexing provides searchable archives.\nLegacy gateway monitoring provides current operational alerts." });
  assert.equal(declarations(p).length, 3);
  const purpose = p.hypothesis.citations.find((x) => x.family === "content-purpose");
  assert.ok(purpose.excerpt.includes("Historical record indexing"));
  assert.ok(purpose.excerpt.includes("Legacy gateway monitoring"));
});
