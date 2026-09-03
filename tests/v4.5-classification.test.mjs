import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import Ajv2020 from "ajv/dist/2020.js";
import { stringify as stringifyYaml } from "yaml";
import { analyzeSourceTaxonomy, createClassificationHandoff } from "../src/v4/classification/engine.mjs";
import { createClassificationEvaluationReport } from "../src/v4/classification/evaluation.mjs";
import { aggregateTaxonomyDecision, RETRIEVAL_CONFIG } from "../src/v4/classification/classifier.mjs";
import { ADVISOR_INPUT_LIMITS } from "../src/v4/classification/advisor.mjs";
import { buildSourceConceptHypothesis } from "../src/v4/classification/source-concept.mjs";
import { canonicalDocumentDigestFor, resolveTaxonomy } from "../src/v4/classification/taxonomy.mjs";
import { initializeWorkspace } from "../src/v3/workspace.mjs";
import { digest } from "../src/v3/utils.mjs";
import { continueClassificationToHarness, inspectClassificationSession, resumeClassificationSession, startClassificationSession } from "../src/v4/classification/session-store.mjs";
import { REQUIRED_GOVERNED_HOST_CAPABILITIES } from "../src/v4/interaction/professional-reasoning.mjs";
import { createSessionPlan } from "../src/v4/session/store.mjs";
import { governedHostInteraction, structured, TestMcpClient } from "./helpers/mcp-client.mjs";

function sourceFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "evopilot-v45-source-"));
  fs.writeFileSync(path.join(root, "README.md"), "This middleware provides a Redis distributed cache, key-value storage, TTL, eviction, replication, and cache client operations.\n");
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "cache-service", dependencies: { redis: "5.0.0", ioredis: "5.4.0" } }));
  return root;
}

function taxonomy(overrides = {}) {
  return {
    apiVersion: "harness.evopilot.io/v1",
    kind: "Taxonomy",
    metadata: { namespace: "example", name: "software-products", version: "1.0.0" },
    spec: {
      engineRange: ">=4.5.0 <4.6.0",
      requiredCapabilities: ["taxonomy-c14n/v1", "source-concept-hypothesis/v1", "open-world-taxonomy-classifier/v1", "taxonomy-decision-aggregate/v1"],
      axisPolicies: { domainCardinality: "SINGLE", productCardinality: "SINGLE" },
      domains: [
        { id: "technology", label: "Technology", assignable: false },
        { id: "middleware", label: "Middleware", definition: "Reusable software infrastructure between applications and platforms.", aliases: ["middleware"], parents: ["technology"], assignable: true, positiveEvidenceHints: ["redis", "cache", "middleware"] }
      ],
      products: [
        { id: "infrastructure-product", label: "Infrastructure product", assignable: false },
        { id: "distributed-cache", label: "Distributed cache", definition: "A distributed key-value caching system with expiry and replication.", aliases: ["redis", "cache"], parents: ["infrastructure-product"], assignable: true, positiveEvidenceHints: ["redis", "ttl", "eviction", "replication"] }
      ]
    },
    ...overrides
  };
}

function supportingAdvisor(input) {
  return {
    candidates: Object.entries(input.candidates).flatMap(([axis, candidates]) => candidates.map((candidate) => {
      const evidenceIds = candidate.nonLlmEvidence.slice(0, 2).map((item) => item.evidenceId);
      return { axis, nodeId: candidate.nodeId, support: evidenceIds.length ? "SUPPORT" : "NEUTRAL", confidence: evidenceIds.length ? 0.9 : 0.5, evidenceIds };
    })),
    unresolvedConcepts: []
  };
}

function contradictingAdvisor(input) {
  return {
    candidates: Object.entries(input.candidates).flatMap(([axis, candidates]) => candidates.map((candidate) => {
      const evidenceIds = candidate.nonLlmEvidence.slice(0, 2).map((item) => item.evidenceId);
      return { axis, nodeId: candidate.nodeId, support: evidenceIds.length ? "CONTRADICT" : "NEUTRAL", confidence: evidenceIds.length ? 0.9 : 0.5, evidenceIds };
    })),
    unresolvedConcepts: []
  };
}

function learningResourceTaxonomy() {
  return {
    apiVersion: "harness.evopilot.io/v1",
    kind: "Taxonomy",
    metadata: { namespace: "acceptance", name: "developer-knowledge", version: "1.0.0" },
    spec: {
      engineRange: ">=4.5.0 <4.6.0",
      requiredCapabilities: ["taxonomy-c14n/v1", "source-concept-hypothesis/v1", "open-world-taxonomy-classifier/v1", "taxonomy-decision-aggregate/v1"],
      axisPolicies: { domainCardinality: "SINGLE", productCardinality: "SINGLE" },
      domains: [
        { id: "developer-knowledge-space", label: "Developer knowledge", assignable: false },
        { id: "software-engineering-learning", label: "Software engineering learning", definition: "Structured tutorials and practice for learning software engineering.", parents: ["developer-knowledge-space"], assignable: true, positiveEvidenceHints: ["step by step software engineering learning guides", "system design learning and interview preparation"], exclusionHints: ["software catalog without instructional structure"] },
        { id: "software-resource-discovery", label: "Software resource discovery", definition: "A curated index for discovering software, libraries, services, and technical resources.", parents: ["developer-knowledge-space"], assignable: true, positiveEvidenceHints: ["curated software and library list", "categorized developer resource directory"], exclusionHints: ["one instructional study plan"] }
      ],
      products: [
        { id: "developer-knowledge-asset", label: "Developer knowledge asset", assignable: false },
        { id: "tutorial-reference-collection", label: "Tutorial and reference collection", definition: "A structured learning path containing tutorials, references, and examples.", parents: ["developer-knowledge-asset"], assignable: true, positiveEvidenceHints: ["tutorials and step by step guides", "structured learning reference and examples"], exclusionHints: ["flat software listing without learning narrative"] },
        { id: "curated-software-directory", label: "Curated software directory", definition: "A categorized directory of software, libraries, tools, and services.", parents: ["developer-knowledge-asset"], assignable: true, positiveEvidenceHints: ["curated list of frameworks libraries tools or services", "categorized links with contribution rules"], exclusionHints: ["one instructional study plan"] }
      ]
    }
  };
}

function primaryLearningAdvisor(input) {
  const dispositions = {
    "software-engineering-learning": ["SUPPORT", 0.9],
    "software-resource-discovery": ["SUPPORT", 0.6],
    "tutorial-reference-collection": ["SUPPORT", 0.95],
    "curated-software-directory": ["NEUTRAL", 0.5]
  };
  return {
    candidates: Object.entries(input.candidates).flatMap(([axis, candidates]) => candidates.map((candidate) => {
      const [support, confidence] = dispositions[candidate.nodeId] ?? ["NEUTRAL", 0.5];
      return { axis, nodeId: candidate.nodeId, support, confidence, evidenceIds: support === "NEUTRAL" ? [] : candidate.nonLlmEvidence.slice(0, 2).map((item) => item.evidenceId), contradictions: [] };
    })),
    unresolvedConcepts: []
  };
}

function aiEngineeringTaxonomy() {
  return {
    apiVersion: "harness.evopilot.io/v1",
    kind: "Taxonomy",
    metadata: { namespace: "acceptance", name: "agent-engineering", version: "1.0.0" },
    spec: {
      engineRange: ">=4.5.0 <4.6.0",
      requiredCapabilities: ["taxonomy-c14n/v1", "source-concept-hypothesis/v1", "open-world-taxonomy-classifier/v1", "taxonomy-decision-aggregate/v1"],
      axisPolicies: { domainCardinality: "SINGLE", productCardinality: "SINGLE" },
      domains: [
        { id: "developer-knowledge-space", label: "Developer knowledge", assignable: false },
        { id: "ai-assisted-software-engineering", label: "AI-assisted software engineering", definition: "Reusable AI Agent instructions, skills, and engineering workflows for software development.", parents: ["developer-knowledge-space"], assignable: true, positiveEvidenceHints: ["engineering workflows packaged for AI agents", "reusable coding agent skills"], exclusionHints: ["general software resource list", "personality-only agent roster without an engineering workflow contract"] },
        { id: "software-resource-discovery", label: "Software resource discovery", definition: "A general directory of software and technical resources.", parents: ["developer-knowledge-space"], assignable: true, positiveEvidenceHints: ["curated software and library list"] }
      ],
      products: [
        { id: "developer-knowledge-asset", label: "Developer knowledge asset", assignable: false },
        { id: "agent-instruction-library", label: "Agent instruction library", definition: "A reusable library of production-grade coding-agent instructions and workflows.", parents: ["developer-knowledge-asset"], assignable: true, positiveEvidenceHints: ["production grade engineering skills for coding agents", "composable agent workflows with quality gates"] },
        { id: "curated-software-directory", label: "Curated software directory", definition: "A general categorized directory of software tools.", parents: ["developer-knowledge-asset"], assignable: true, positiveEvidenceHints: ["curated list of frameworks libraries tools or services"] }
      ]
    }
  };
}

function aiEngineeringAdvisor(input) {
  const dispositions = {
    "ai-assisted-software-engineering": ["SUPPORT", 0.95],
    "software-resource-discovery": ["CONTRADICT", 0.9],
    "agent-instruction-library": ["SUPPORT", 0.98],
    "curated-software-directory": ["CONTRADICT", 0.9]
  };
  return {
    candidates: Object.entries(input.candidates).flatMap(([axis, candidates]) => candidates.map((candidate) => {
      const [support, confidence] = dispositions[candidate.nodeId] ?? ["NEUTRAL", 0.5];
      return { axis, nodeId: candidate.nodeId, support, confidence, evidenceIds: support === "NEUTRAL" ? [] : candidate.nonLlmEvidence.slice(0, 4).map((item) => item.evidenceId), contradictions: support === "CONTRADICT" ? ["primary purpose differs"] : [] };
    })),
    unresolvedConcepts: []
  };
}

function largeAgentEngineeringSource(totalFiles) {
  const source = fs.mkdtempSync(path.join(os.tmpdir(), `evopilot-v45-agent-engineering-${totalFiles}-`));
  fs.mkdirSync(path.join(source, ".opencode", "tools"), { recursive: true });
  fs.mkdirSync(path.join(source, "catalog"), { recursive: true });
  fs.writeFileSync(path.join(source, "README.md"), [
    "# Agent Engineering Workflows",
    "This production-ready coding-agent plugin packages reusable engineering workflows and coding-agent skills for software development.",
    "## Included workflows",
    "- composable agent workflows with quality gates",
    "- production-grade engineering skills for coding agents"
  ].join("\n"));
  fs.writeFileSync(path.join(source, "package.json"), JSON.stringify({ name: "agent-engineering-workflows", dependencies: { "agent-runtime": "1.0.0" } }));
  fs.writeFileSync(path.join(source, ".opencode", "tools", "index.ts"), "export const tools = ['review', 'test', 'release'];\n");
  for (let index = 0; index < totalFiles - 3; index += 1) {
    fs.writeFileSync(path.join(source, "catalog", `resource-${String(index).padStart(4, "0")}.md`), "general software resource list with frameworks libraries tools and services\n");
  }
  return source;
}

test("Taxonomy/v1 canonical resolution is ordering-independent and business-value neutral", () => {
  const first = taxonomy();
  const second = taxonomy();
  second.spec.domains.reverse();
  second.spec.products.reverse();
  second.spec.products[0]?.aliases?.reverse();
  const a = resolveTaxonomy(first);
  const b = resolveTaxonomy(second);
  assert.equal(a.taxonomyDigest, b.taxonomyDigest);
  assert.deepEqual(a.foundation.businessValues, []);
  assert.equal(a.canonicalization.algorithm, "taxonomy-c14n/v1");
  assert.equal(a.taxonomy.canonicalDocumentDigest, "sha256:15c881febd5254bd9b8834f9add3cd0fff1eb02b0c445875a78a102beeb4f69b");
  assert.equal(a.taxonomyDigest, "sha256:4398b3d3946e4fe00243313d3aa8a8a5a98e45a8d9eab0364081fc2bb15b37c4");
});

test("Taxonomy/v1 JSON and YAML serializations resolve to one canonical golden snapshot", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "evopilot-v45-taxonomy-format-"));
  const jsonFile = path.join(root, "taxonomy.json");
  const yamlFile = path.join(root, "taxonomy.yaml");
  fs.writeFileSync(jsonFile, `${JSON.stringify(taxonomy(), null, 2)}\n`);
  fs.writeFileSync(yamlFile, stringifyYaml(taxonomy()));
  const fromJson = resolveTaxonomy(jsonFile);
  const fromYaml = resolveTaxonomy(yamlFile);
  assert.deepEqual(fromJson, fromYaml);
  assert.equal(fromJson.taxonomyDigest, "sha256:4398b3d3946e4fe00243313d3aa8a8a5a98e45a8d9eab0364081fc2bb15b37c4");
});

test("Taxonomy validation rejects normalization collision, unsupported range/capability, digest drift, and invalid hierarchy before Source access", async () => {
  const collision = taxonomy();
  collision.spec.products.push({ id: "other-cache", label: " Redis ", definition: "Other cache.", assignable: true });
  assert.throws(() => resolveTaxonomy(collision), (error) => error.code === "TAXONOMY_ALIAS_COLLISION");
  const unsupportedRange = taxonomy();
  unsupportedRange.spec.engineRange = ">=4.6.0 <5.0.0";
  assert.throws(() => resolveTaxonomy(unsupportedRange), (error) => error.code === "TAXONOMY_ENGINE_RANGE_UNSUPPORTED");
  const unsupportedCapability = taxonomy();
  unsupportedCapability.spec.requiredCapabilities = ["taxonomy-c14n/v1"];
  assert.throws(() => resolveTaxonomy(unsupportedCapability), (error) => error.code === "TAXONOMY_CAPABILITY_UNSUPPORTED");
  const drift = taxonomy();
  drift.spec.expectedCanonicalDigest = canonicalDocumentDigestFor(drift);
  expectDigestAccepted(drift);
  drift.spec.products[1].definition = "Changed after the declared digest.";
  assert.throws(() => resolveTaxonomy(drift), (error) => error.code === "TAXONOMY_DIGEST_DRIFT");
  const cycle = taxonomy();
  cycle.spec.domains[0].parents = ["middleware"];
  assert.throws(() => resolveTaxonomy(cycle), (error) => error.code === "TAXONOMY_CYCLE");
  const invalid = taxonomy();
  invalid.metadata.name = "Invalid Name";
  await assert.rejects(analyzeSourceTaxonomy({ source: "/path/that/must/not/be-read", taxonomy: invalid, advisorProvider: supportingAdvisor }), (error) => error.code === "TAXONOMY_SCHEMA_INVALID");
});

function expectDigestAccepted(document) {
  assert.equal(resolveTaxonomy(document).taxonomy.canonicalDocumentDigest, document.spec.expectedCanonicalDigest);
}

test("SourceConceptHypothesis is taxonomy-blind, LLM-free, static, and independently corroborated", () => {
  const source = sourceFixture();
  const before = buildSourceConceptHypothesis(source);
  resolveTaxonomy(taxonomy());
  const after = buildSourceConceptHypothesis(source);
  assert.equal(before.hypothesisDigest, after.hypothesisDigest);
  assert.equal(before.provenance.taxonomyExposed, false);
  assert.equal(before.provenance.advisorUsed, false);
  assert.equal(before.provenance.sourceExecution, false);
  assert.ok(before.concepts.find((item) => item.term === "redis")?.evidenceFamilies.length >= 2);
});

test("algorithm plus one Advisor call produces independently corroborated per-axis and aggregate match", async () => {
  const source = sourceFixture();
  let calls = 0;
  const result = await analyzeSourceTaxonomy({ source, taxonomy: taxonomy(), advisorProvider: async (input) => { calls += 1; return supportingAdvisor(input); } });
  assert.equal(calls, 1);
  assert.equal(result.schema, "evopilot-harness-taxonomy-analysis-result/v1");
  assert.equal(result.aggregate, "TAXONOMY_MATCHED");
  assert.equal(result.axes.domain.status, "TAXONOMY_MATCHED");
  assert.equal(result.axes.product.status, "TAXONOMY_MATCHED");
  assert.ok(new Set(result.axes.product.selected.nonLlmEvidence.map((item) => item.family)).size >= 2);
  assert.equal(result.advisor.invocationCount, 1);
  assert.equal(result.authority.advisorMayDecide, false);
  assert.equal(result.authority.classificationProvesEligibility, false);
  assert.deepEqual(result.nextOperations, ["CONTINUE_TO_HARNESS", "CLOSE"]);
});

test("Advisor sees only the bounded candidate projection and an explicit output contract", async () => {
  let observed;
  const result = await analyzeSourceTaxonomy({ source: sourceFixture(), taxonomy: taxonomy(), advisorProvider: async (input) => { observed = input; return supportingAdvisor(input); } });
  assert.equal(result.aggregate, "TAXONOMY_MATCHED");
  assert.deepEqual(observed.outputContract.requiredFields, ["candidates", "unresolvedConcepts"]);
  assert.ok(observed.hypothesis.concepts.length <= ADVISOR_INPUT_LIMITS.concepts);
  assert.ok(observed.candidates.domain.length <= ADVISOR_INPUT_LIMITS.candidatesPerAxis);
  assert.ok(observed.candidates.product.length <= ADVISOR_INPUT_LIMITS.candidatesPerAxis);
  assert.ok(Object.values(observed.candidates).flat().every((candidate) => candidate.nonLlmEvidence.length <= ADVISOR_INPUT_LIMITS.evidencePerCandidate));
  assert.deepEqual(Object.fromEntries(Object.entries(observed.taxonomy.axes).map(([axis, nodes]) => [axis, nodes.map((node) => node.id)])), Object.fromEntries(Object.entries(observed.candidates).map(([axis, candidates]) => [axis, candidates.map((candidate) => candidate.nodeId)])));
  assert.ok(new Set(observed.allowedEvidenceIds).size <= ADVISOR_INPUT_LIMITS.evidencePerCandidate * 2 * ADVISOR_INPUT_LIMITS.candidatesPerAxis);
  assert.ok(observed.hypothesis.citations.some((item) => item.family === "content-purpose" && item.excerpt.includes("distributed cache")));
  assert.ok(Object.values(observed.taxonomy.axes).flat().every((node) => Array.isArray(node.positiveEvidenceHints) && Array.isArray(node.exclusionHints)));
  assert.ok(result.presentation.domain.evidence.length <= 12);
  assert.ok(result.presentation.product.evidence.length <= 12);
  for (const axis of [result.presentation.domain, result.presentation.product]) {
    assert.ok(axis.evidence.every((item) => item.kind !== "Source 依据"));
    assert.ok(axis.evidence.every((item) => !/^(?:and|service|data|information)$/i.test(item.clue)));
    assert.equal(new Set(axis.evidence.map((item) => item.clue.toLowerCase())).size, axis.evidence.length);
  }
});

test("a README larger than the ordinary file limit still yields bounded semantic purpose and inventory evidence", async () => {
  const source = fs.mkdtempSync(path.join(os.tmpdir(), "evopilot-v45-large-overview-"));
  const overview = [
    "# Distributed Cache",
    "A Redis distributed cache provides key-value storage, TTL eviction, replication, and client failover.",
    "## Capabilities",
    "- Redis key-value cache",
    "- TTL eviction and replication",
    "- cache client operations",
    "",
    "background filler ".repeat(10_000)
  ].join("\n");
  fs.writeFileSync(path.join(source, "README.md"), overview);
  const hypothesis = buildSourceConceptHypothesis(source);
  assert.ok(fs.statSync(path.join(source, "README.md")).size > 128_000);
  assert.equal(hypothesis.sourceSnapshot.files[0].readable, false);
  assert.equal(hypothesis.sourceSnapshot.characterCount, 0);
  assert.ok(hypothesis.citations.some((item) => item.family === "content-purpose"));
  assert.ok(hypothesis.citations.some((item) => item.family === "content-inventory"));
  const result = await analyzeSourceTaxonomy({ source, taxonomy: taxonomy(), advisorProvider: supportingAdvisor });
  assert.equal(result.aggregate, "TAXONOMY_MATCHED");
});

test("single-file allocation uses the total bounded character budget instead of the 512-file share", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "evopilot-v45-single-file-budget-"));
  const source = path.join(root, "design.md");
  fs.writeFileSync(source, "financial product research comparison and investment information service\n".repeat(1_500));
  const hypothesis = buildSourceConceptHypothesis(source);
  assert.ok(hypothesis.sourceSnapshot.characterCount > 50_000);
  assert.equal(hypothesis.sourceSnapshot.files[0].readable, true);
});

test("bounded file citations preserve head, middle, and tail business evidence", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "evopilot-v45-representative-excerpt-"));
  const source = path.join(root, "service.java");
  const filler = "framework boilerplate ".repeat(200);
  fs.writeFileSync(source, `headerMarker ${filler} middleBusinessMarker ${filler} tailProductMarker`);
  const hypothesis = buildSourceConceptHypothesis(source);
  const excerpt = hypothesis.citations.find((item) => item.sourceRef === "service.java").excerpt;
  assert.match(excerpt, /headerMarker/);
  assert.match(excerpt, /middleBusinessMarker/);
  assert.match(excerpt, /tailProductMarker/);
  assert.ok(excerpt.length <= 800);
});

test("large DOCX containers are statically extracted within the bounded text budget", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "evopilot-v45-large-docx-"));
  const word = path.join(root, "word");
  fs.mkdirSync(word);
  fs.writeFileSync(path.join(word, "document.xml"), `<w:document><w:body>${"<w:p>fund research comparison and investment information service</w:p>".repeat(4_000)}</w:body></w:document>`);
  const source = path.join(root, "large-design.docx");
  execFileSync("zip", ["-0", "-q", source, "word/document.xml"], { cwd: root });
  assert.ok(fs.statSync(source).size > 128_000);
  const hypothesis = buildSourceConceptHypothesis(source);
  assert.equal(hypothesis.sourceSnapshot.files[0].readable, true);
  assert.ok(hypothesis.sourceSnapshot.characterCount > 100_000);
  assert.ok(hypothesis.concepts.some((item) => item.term === "research"));
});

test("Advisor projection prioritizes normal-trust business evidence and excludes low-trust candidate noise", async () => {
  const source = fs.mkdtempSync(path.join(os.tmpdir(), "evopilot-v45-advisor-relevance-"));
  fs.mkdirSync(path.join(source, "tests"));
  for (let index = 0; index < 32; index += 1) fs.writeFileSync(path.join(source, `${String(index).padStart(2, "0")}-utility.md`), "generic framework utility and transport helper\n");
  fs.writeFileSync(path.join(source, "wealth-fund-research-service.java"), "financial product fund research comparison investment information service\n".repeat(20));
  fs.writeFileSync(path.join(source, "tests", "fund-research-fixture.java"), "financial product fund research comparison fixture\n".repeat(20));
  const document = taxonomy();
  document.spec.domains[1] = { id: "wealth-service", label: "Wealth service", definition: "Financial product research and comparison services.", parents: ["technology"], assignable: true, positiveEvidenceHints: ["fund research comparison", "investment information"] };
  document.spec.products[1] = { id: "wealth-research-system", label: "Wealth research system", definition: "A fund research and product comparison information system.", parents: ["infrastructure-product"], assignable: true, positiveEvidenceHints: ["fund research comparison", "investment information"] };
  let observed;
  await analyzeSourceTaxonomy({ source, taxonomy: document, advisorProvider: async (input) => { observed = input; return supportingAdvisor(input); } });
  assert.ok(observed.hypothesis.citations.some((item) => item.sourceRef === "wealth-fund-research-service.java"));
  assert.ok(observed.hypothesis.structuredSignals.some((item) => item.path === "wealth-fund-research-service.java"));
  assert.ok(Object.values(observed.candidates).flat().every((candidate) => candidate.nonLlmEvidence.every((item) => !item.family.startsWith("low-trust-"))));
  assert.ok(!observed.hypothesis.citations.some((item) => item.sourceRef.includes("fund-research-fixture")));
});

test("governed hybrid match requires corroborated lexical evidence and still honors Advisor contradiction", () => {
  const evidence = [
    { evidenceId: "purpose", family: "content-purpose", sourceRef: "README.md" },
    { evidenceId: "structured", family: "structured", path: "wealth-research-service" }
  ];
  const hypothesis = { concepts: [{ term: "wealth", evidenceIds: evidence.map((item) => item.evidenceId), evidenceFamilies: evidence.map((item) => item.family) }, { term: "research", evidenceIds: evidence.map((item) => item.evidenceId), evidenceFamilies: evidence.map((item) => item.family) }, { term: "service", evidenceIds: evidence.map((item) => item.evidenceId), evidenceFamilies: evidence.map((item) => item.family) }], citations: evidence.slice(0, 1), structuredSignals: evidence.slice(1), dependencySignals: [], sourceSnapshot: { fileCount: 2 }, missingEvidence: [] };
  const resolved = { axes: { domain: { cardinality: "SINGLE", nodes: [{ id: "wealth-service", assignable: true, ancestors: [] }] }, product: { cardinality: "SINGLE", nodes: [{ id: "wealth-system", assignable: true, ancestors: [] }] } } };
  const candidate = (axis, nodeId, bm25) => ({ axis, nodeId, label: nodeId, ancestors: [], score: 0.1, signals: [{ type: "bm25", score: bm25, matches: ["wealth"], citations: evidence.map((item) => item.evidenceId), contradictions: [] }], nonLlmEvidence: evidence.map((item) => ({ evidenceId: item.evidenceId, family: item.family, term: "wealth research" })), contradictions: [], rejectedAlternatives: [], rejectedByExclusion: false });
  const retrieval = { axes: { domain: [candidate("domain", "wealth-service", 0.5)], product: [candidate("product", "wealth-system", 0.5)] } };
  const support = { candidates: [{ axis: "domain", nodeId: "wealth-service", support: "SUPPORT", confidence: 0.8, evidenceIds: ["purpose"] }, { axis: "product", nodeId: "wealth-system", support: "SUPPORT", confidence: 0.8, evidenceIds: ["purpose"] }], unresolvedConcepts: [] };
  assert.equal(aggregateTaxonomyDecision({ hypothesis, taxonomy: resolved, retrieval, advisor: support }).aggregate, "TAXONOMY_MATCHED");
  const neutral = { candidates: [{ axis: "domain", nodeId: "wealth-service", support: "NEUTRAL", confidence: 0.1, evidenceIds: [] }, { axis: "product", nodeId: "wealth-system", support: "NEUTRAL", confidence: 0.1, evidenceIds: [] }], unresolvedConcepts: [] };
  assert.equal(aggregateTaxonomyDecision({ hypothesis, taxonomy: resolved, retrieval, advisor: neutral }).aggregate, "TAXONOMY_MATCHED");
  const contradict = { candidates: [{ axis: "domain", nodeId: "wealth-service", support: "CONTRADICT", confidence: 0.9, evidenceIds: ["purpose"] }, { axis: "product", nodeId: "wealth-system", support: "CONTRADICT", confidence: 0.9, evidenceIds: ["purpose"] }], unresolvedConcepts: [] };
  assert.notEqual(aggregateTaxonomyDecision({ hypothesis, taxonomy: resolved, retrieval, advisor: contradict }).aggregate, "TAXONOMY_MATCHED");
  const weakLexical = { axes: { domain: [candidate("domain", "wealth-service", 0.2)], product: [candidate("product", "wealth-system", 0.2)] } };
  assert.notEqual(aggregateTaxonomyDecision({ hypothesis, taxonomy: resolved, retrieval: weakLexical, advisor: support }).aggregate, "TAXONOMY_MATCHED");
});

test("Advisor contradiction removes a candidate before the governed safe-margin decision", () => {
  const evidence = [
    { evidenceId: "purpose", family: "content-purpose", sourceRef: "README.md" },
    { evidenceId: "inventory", family: "content-inventory", sourceRef: "README.md" }
  ];
  const hypothesis = {
    concepts: ["software", "curated", "directory"].map((term) => ({
      term,
      evidenceIds: evidence.map((item) => item.evidenceId),
      evidenceFamilies: evidence.map((item) => item.family)
    })),
    citations: evidence,
    structuredSignals: [],
    dependencySignals: [],
    sourceSnapshot: { fileCount: 1 },
    missingEvidence: []
  };
  const resolved = {
    axes: {
      domain: {
        cardinality: "SINGLE",
        nodes: [
          { id: "software-resource-discovery", assignable: true, ancestors: [] },
          { id: "software-engineering-learning", assignable: true, ancestors: [] }
        ]
      },
      product: {
        cardinality: "SINGLE",
        nodes: [{ id: "curated-software-directory", assignable: true, ancestors: [] }]
      }
    }
  };
  const candidate = (axis, nodeId, score) => ({
    axis,
    nodeId,
    label: nodeId,
    ancestors: [],
    score,
    signals: [{ type: "bm25", score: 0.75, matches: ["software"], citations: evidence.map((item) => item.evidenceId), contradictions: [] }],
    nonLlmEvidence: evidence.map((item) => ({ evidenceId: item.evidenceId, family: item.family, term: "curated software directory" })),
    contradictions: [],
    rejectedAlternatives: [],
    rejectedByExclusion: false
  });
  const retrieval = {
    axes: {
      domain: [
        candidate("domain", "software-resource-discovery", 0.602),
        candidate("domain", "software-engineering-learning", 0.582)
      ],
      product: [candidate("product", "curated-software-directory", 0.661)]
    }
  };
  const advisor = {
    candidates: [
      { axis: "domain", nodeId: "software-resource-discovery", support: "SUPPORT", confidence: 0.95, evidenceIds: ["purpose", "inventory"] },
      { axis: "domain", nodeId: "software-engineering-learning", support: "CONTRADICT", confidence: 0.9, evidenceIds: ["purpose", "inventory"] },
      { axis: "product", nodeId: "curated-software-directory", support: "SUPPORT", confidence: 0.95, evidenceIds: ["purpose", "inventory"] }
    ],
    unresolvedConcepts: []
  };
  const result = aggregateTaxonomyDecision({ hypothesis, taxonomy: resolved, retrieval, advisor });
  assert.equal(result.aggregate, "TAXONOMY_MATCHED");
  assert.equal(result.axes.domain.selected.nodeId, "software-resource-discovery");
  assert.equal(result.axes.domain.candidates.find((item) => item.nodeId === "software-engineering-learning").advisorSignal.support, "CONTRADICT");

  const neutralAdvisor = {
    ...advisor,
    candidates: advisor.candidates.map((item) => item.axis === "domain" ? { ...item, support: "NEUTRAL", confidence: 0.5, evidenceIds: [] } : item)
  };
  const unresolved = aggregateTaxonomyDecision({ hypothesis, taxonomy: resolved, retrieval, advisor: neutralAdvisor });
  assert.equal(unresolved.axes.domain.status, "TAXONOMY_AMBIGUOUS");
  assert.equal(unresolved.axes.domain.ambiguityBasis, "UNRESOLVED_DETERMINISTIC_SCORE_MARGIN");
});

test("manifest and repository machinery without primary business evidence remain insufficient", async () => {
  const source = fs.mkdtempSync(path.join(os.tmpdir(), "evopilot-v45-no-overview-"));
  fs.mkdirSync(path.join(source, ".github", "workflows"), { recursive: true });
  fs.writeFileSync(path.join(source, "package.json"), JSON.stringify({ name: "public-api-list", devDependencies: { prettier: "3.0.0" } }));
  fs.writeFileSync(path.join(source, ".github", "workflows", "lint.yml"), "name: lint\non: pull_request\njobs: {}\n");
  const result = await analyzeSourceTaxonomy({ source, taxonomy: taxonomy(), advisorProvider: supportingAdvisor });
  assert.equal(result.aggregate, "TAXONOMY_EVIDENCE_INSUFFICIENT");
  assert.equal(result.axes.domain.status, "TAXONOMY_EVIDENCE_INSUFFICIENT");
  assert.equal(result.axes.product.status, "TAXONOMY_EVIDENCE_INSUFFICIENT");
});

test("a lexical copy and semantic projection derived from one weak README count as one evidence family", async () => {
  const source = fs.mkdtempSync(path.join(os.tmpdir(), "evopilot-v45-single-origin-"));
  fs.writeFileSync(path.join(source, "README.md"), "# Utility project\n\nThis repository contains reusable utilities. More design and product information will be added later.\n");
  const hypothesis = buildSourceConceptHypothesis(source);
  const product = hypothesis.concepts.find((item) => item.term === "product");
  assert.deepEqual(product.evidenceFamilies, ["content-purpose", "lexical-content"]);
  const result = await analyzeSourceTaxonomy({ source, taxonomy: taxonomy(), advisorProvider: contradictingAdvisor });
  assert.equal(result.aggregate, "TAXONOMY_EVIDENCE_INSUFFICIENT");
  assert.equal(result.axes.domain.status, "TAXONOMY_EVIDENCE_INSUFFICIENT");
  assert.equal(result.axes.product.status, "TAXONOMY_EVIDENCE_INSUFFICIENT");
  assert.equal(result.axes.domain.advisorDisposition.contradictionMayCreateExtension, false);
  assert.equal(result.axes.product.advisorDisposition.contradictionMaySatisfyNonLlmEvidenceMinimum, false);
  assert.deepEqual(result.nextOperations, ["SUPPLY_MORE_SOURCE_EVIDENCE", "REANALYZE", "CLOSE"]);
});

test("Advisor contradiction cannot veto a taxonomy-blind gap with genuinely independent non-LLM evidence", async () => {
  const gap = taxonomy();
  gap.spec.domains = [{ id: "finance", label: "Finance", definition: "Financial services and transactions.", assignable: true, positiveEvidenceHints: ["banking"] }];
  gap.spec.products = [{ id: "customer-portal", label: "Customer portal", definition: "A customer interaction portal.", assignable: true, positiveEvidenceHints: ["ticket", "customer"] }];
  const result = await analyzeSourceTaxonomy({ source: sourceFixture(), taxonomy: gap, advisorProvider: contradictingAdvisor });
  assert.equal(result.aggregate, "TAXONOMY_EXTENSION_SUGGESTED");
  assert.equal(result.axes.domain.extensionBasis, "TAXONOMY_BLIND_CONCEPT_WITH_INDEPENDENT_NON_LLM_EVIDENCE");
  assert.equal(result.axes.product.extensionBasis, "TAXONOMY_BLIND_CONCEPT_WITH_INDEPENDENT_NON_LLM_EVIDENCE");
  assert.ok(result.axes.domain.advisorDisposition.contradictedCandidateIds.length > 0);
  assert.equal(result.axes.domain.advisorDisposition.contradictionMayCreateExtension, false);
});

test("a persona-only Agent roster is proposed as a taxonomy gap instead of an engineering workflow match", async () => {
  const source = fs.mkdtempSync(path.join(os.tmpdir(), "evopilot-v45-persona-roster-"));
  fs.writeFileSync(path.join(source, "README.md"), [
    "# AI Agent Personas",
    "A personality-only agent roster provides general prompt personas and named roles, without engineering workflows or quality gates.",
    "## Persona roster",
    "- Architect persona and personality",
    "- Developer persona and role"
  ].join("\n"));
  const document = taxonomy();
  document.spec.domains = [
    { id: "developer-space", label: "Developer space", assignable: false },
    { id: "ai-engineering", label: "AI engineering", definition: "Reusable engineering workflows for coding agents.", parents: ["developer-space"], assignable: true, positiveEvidenceHints: ["reusable coding agent skills", "engineering workflows for AI agents"], exclusionHints: ["personality-only agent roster without engineering workflow contract"] }
  ];
  document.spec.products = [
    { id: "knowledge-asset", label: "Knowledge asset", assignable: false },
    { id: "agent-workflow-library", label: "Agent workflow library", definition: "Installable agent workflows with quality gates.", parents: ["knowledge-asset"], assignable: true, positiveEvidenceHints: ["agent workflows with quality gates"], exclusionHints: ["general prompt persona roster"] }
  ];
  const result = await analyzeSourceTaxonomy({ source, taxonomy: document, advisorProvider: supportingAdvisor });
  assert.equal(result.aggregate, "TAXONOMY_EXTENSION_SUGGESTED");
  assert.equal(result.axes.domain.status, "TAXONOMY_EXTENSION_SUGGESTED");
  assert.equal(result.axes.product.status, "TAXONOMY_EXTENSION_SUGGESTED");
  assert.notEqual(result.axes.product.extension.proposedLabel, "workflow");
  const rejectedDomain = result.axes.domain.candidates.find((item) => item.nodeId === "ai-engineering");
  assert.equal(rejectedDomain.rejectedByExclusion, true);
  assert.equal(rejectedDomain.exclusionProofs.length, 1);
  assert.ok(rejectedDomain.exclusionProofs[0].originGroups.length >= 2);
  assert.equal(rejectedDomain.exclusionProofs[0].structuredPathMayEstablishExclusion, false);
});

test("incidental resource-list content and generic structured paths cannot veto a supported Agent-engineering classification", async () => {
  const impact = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, "fixtures/v4.5/candidate14-journey08-impact.json"), "utf8"));
  assert.equal(impact.sourceSnapshotDigest, "sha256:398dea5edb00703cf4c7c662e25a7e32e50f0df127908300d9260e536ba1956c");
  assert.equal(impact.expectedAggregate, "TAXONOMY_MATCHED");
  for (const totalFiles of [511, 512, 513]) {
    const result = await analyzeSourceTaxonomy({ source: largeAgentEngineeringSource(totalFiles), taxonomy: aiEngineeringTaxonomy(), advisorProvider: aiEngineeringAdvisor });
    assert.equal(result.aggregate, "TAXONOMY_MATCHED", totalFiles);
    assert.equal(result.axes.domain.selected.nodeId, "ai-assisted-software-engineering", totalFiles);
    assert.equal(result.axes.product.selected.nodeId, "agent-instruction-library", totalFiles);
    const domain = result.axes.domain.candidates.find((item) => item.nodeId === "ai-assisted-software-engineering");
    assert.equal(domain.rejectedByExclusion, false, totalFiles);
    assert.deepEqual(domain.exclusionProofs, [], totalFiles);
    assert.equal(result.axes.domain.extension, undefined, totalFiles);
  }
});

test("generic artifact-form vocabulary cannot manufacture a synthetic Domain or Product extension", async () => {
  const source = fs.mkdtempSync(path.join(os.tmpdir(), "evopilot-v45-generic-artifacts-"));
  fs.writeFileSync(path.join(source, "README.md"), [
    "# Reusable skills and workflows",
    "This repository provides reusable skills, workflows, tools, libraries, services, plugins, hooks, commands, rules, scripts, and software.",
    "## Contents",
    "- skills workflows tools libraries services plugins hooks commands rules scripts"
  ].join("\n"));
  const unrelated = taxonomy();
  unrelated.spec.domains = [{ id: "finance", label: "Finance", definition: "Financial transactions and account services.", assignable: true, positiveEvidenceHints: ["bank ledger"] }];
  unrelated.spec.products = [{ id: "customer-portal", label: "Customer portal", definition: "A customer request and ticket portal.", assignable: true, positiveEvidenceHints: ["ticket customer"] }];
  const result = await analyzeSourceTaxonomy({ source, taxonomy: unrelated, advisorProvider: supportingAdvisor });
  assert.equal(result.aggregate, "TAXONOMY_EVIDENCE_INSUFFICIENT");
  assert.equal(result.axes.domain.status, "TAXONOMY_EVIDENCE_INSUFFICIENT");
  assert.equal(result.axes.product.status, "TAXONOMY_EVIDENCE_INSUFFICIENT");
});

test("a genuinely mixed learning and resource-discovery overview remains ambiguous", async () => {
  const source = fs.mkdtempSync(path.join(os.tmpdir(), "evopilot-v45-mixed-purpose-"));
  fs.writeFileSync(path.join(source, "README.md"), [
    "# Developer Learning and Resource Guide",
    "This collection combines step-by-step software engineering tutorials with a curated categorized directory of libraries and tools.",
    "## Learning guides",
    "- system design tutorial and exercises",
    "## Resource directory",
    "- curated frameworks and libraries"
  ].join("\n"));
  const document = taxonomy();
  document.spec.domains = [
    { id: "developer-space", label: "Developer space", assignable: false },
    { id: "learning", label: "Learning", definition: "Developer learning guides.", parents: ["developer-space"], assignable: true, positiveEvidenceHints: ["learning guides"] },
    { id: "discovery", label: "Discovery", definition: "Developer resource directory.", parents: ["developer-space"], assignable: true, positiveEvidenceHints: ["resource directory"] }
  ];
  document.spec.products = [
    { id: "knowledge-asset", label: "Knowledge asset", assignable: false },
    { id: "tutorials", label: "Tutorials", definition: "Tutorial guides.", parents: ["knowledge-asset"], assignable: true, positiveEvidenceHints: ["tutorial guides"] },
    { id: "directory", label: "Directory", definition: "Software directory.", parents: ["knowledge-asset"], assignable: true, positiveEvidenceHints: ["software directory"] }
  ];
  const result = await analyzeSourceTaxonomy({ source, taxonomy: document, advisorProvider: supportingAdvisor });
  assert.equal(result.aggregate, "TAXONOMY_AMBIGUOUS");
  assert.equal(result.axes.product.status, "TAXONOMY_AMBIGUOUS");
  assert.equal(result.axes.product.ambiguityBasis, "DISTINCT_PRIMARY_PURPOSES");
  assert.equal(result.axes.product.mixedPurposeEvidence.status, "PROVEN");
  assert.equal(result.axes.product.mixedPurposeEvidence.basis, "EXPLICIT_COEQUAL_STATEMENT");
  assert.deepEqual(result.axes.product.mixedPurposeEvidence.assertions.map((item) => item.purpose), ["LEARNING", "RESOURCE_DISCOVERY"]);
  assert.equal(new Set(result.axes.product.mixedPurposeEvidence.assertions.map((item) => item.assertionDigest)).size, 2);
  assert.equal(new Set(result.axes.product.mixedPurposeEvidence.assertions.map((item) => item.originGroup)).size, 2);
});

test("one coequal sentence without separate semantic support cannot manufacture two primary purposes", async () => {
  const source = fs.mkdtempSync(path.join(os.tmpdir(), "evopilot-v45-unsubstantiated-coequal-"));
  fs.writeFileSync(path.join(source, "README.md"), [
    "# Developer knowledge",
    "This collection combines step-by-step software engineering tutorials with a curated categorized directory of software libraries and tools."
  ].join("\n"));
  const result = await analyzeSourceTaxonomy({ source, taxonomy: learningResourceTaxonomy(), advisorProvider: supportingAdvisor });
  for (const axis of [result.axes.domain, result.axes.product]) {
    assert.notEqual(axis.ambiguityBasis, "EXPLICIT_COOEQUAL_PRIMARY_PURPOSES");
    assert.equal(axis.mixedPurposeEvidence, undefined);
  }
});

test("one primary learning purpose with a subordinate resource appendix remains matched", async () => {
  for (const [name, appendix] of [
    ["list", "- curated list of programming-language references"],
    ["catalog", "- categorized catalog of libraries, tools, and external reference links"]
  ]) {
    const source = fs.mkdtempSync(path.join(os.tmpdir(), `evopilot-v45-primary-learning-${name}-`));
    fs.writeFileSync(path.join(source, "README.md"), [
      "# Coding Interview Study Plan",
      "This repository provides a multi-month study plan for becoming a software engineer.",
      "The curriculum offers step-by-step software engineering tutorials, system-design learning, interview preparation, and practice exercises.",
      "## Supporting programming-language resources",
      appendix
    ].join("\n"));
    const result = await analyzeSourceTaxonomy({ source, taxonomy: learningResourceTaxonomy(), advisorProvider: primaryLearningAdvisor });
    assert.equal(result.aggregate, "TAXONOMY_MATCHED", name);
    assert.equal(result.axes.domain.selected.nodeId, "software-engineering-learning", name);
    assert.equal(result.axes.product.selected.nodeId, "tutorial-reference-collection", name);
    assert.equal(result.axes.domain.ambiguityBasis, undefined, name);
    assert.equal(result.axes.product.ambiguityBasis, undefined, name);
  }
});

test("explicit coequal primary purposes remain ambiguous under every Advisor disposition", async () => {
  const source = fs.mkdtempSync(path.join(os.tmpdir(), "evopilot-v45-coequal-purpose-"));
  fs.writeFileSync(path.join(source, "README.md"), [
    "# Developer learning and directory service",
    "This collection combines step-by-step software engineering tutorials with a curated categorized directory of software libraries and tools.",
    "It provides learning exercises and separately maintains the software directory as an equal primary purpose.",
    "## Learning guides",
    "- system design tutorial, interview preparation, and practice exercises",
    "## Resource directory",
    "- curated frameworks, libraries, tools, and services"
  ].join("\n"));
  for (const [name, advisorProvider] of [["balanced", supportingAdvisor], ["discriminating", primaryLearningAdvisor], ["contradicting", contradictingAdvisor]]) {
    const result = await analyzeSourceTaxonomy({ source, taxonomy: learningResourceTaxonomy(), advisorProvider });
    assert.equal(result.aggregate, "TAXONOMY_AMBIGUOUS", name);
    assert.equal(result.axes.domain.ambiguityBasis, "DISTINCT_PRIMARY_PURPOSES", name);
    assert.equal(result.axes.product.ambiguityBasis, "DISTINCT_PRIMARY_PURPOSES", name);
    assert.equal(result.authority.advisorMayDecide, false, name);
  }
});

test("a style guide plus independently installable configuration remains ambiguous even when Advisor favors the guide", async () => {
  const source = fs.mkdtempSync(path.join(os.tmpdir(), "evopilot-v45-guide-and-tooling-"));
  fs.mkdirSync(path.join(source, "packages", "eslint-config-base"), { recursive: true });
  fs.writeFileSync(path.join(source, "README.md"), [
    "# JavaScript Style Guide",
    "A practical reference guide with examples for writing maintainable JavaScript.",
    "## References",
    "- language examples and style recommendations"
  ].join("\n"));
  fs.writeFileSync(path.join(source, "packages", "eslint-config-base", "README.md"), [
    "# eslint-config-base package",
    "This package provides an extensible shared config for ESLint.",
    "We export two ESLint configurations for installation and usage with libraries and tools."
  ].join("\n"));
  fs.writeFileSync(path.join(source, "package.json"), JSON.stringify({ name: "style-guide-and-config", dependencies: { eslint: "9.0.0" } }));
  const result = await analyzeSourceTaxonomy({ source, taxonomy: learningResourceTaxonomy(), advisorProvider: primaryLearningAdvisor });
  assert.equal(result.aggregate, "TAXONOMY_AMBIGUOUS");
  assert.equal(result.axes.product.status, "TAXONOMY_AMBIGUOUS");
  assert.equal(result.axes.product.ambiguityBasis, "DISTINCT_PRIMARY_PURPOSES");
  assert.deepEqual(new Set(result.axes.product.mixedPurposeEvidence.assertions.map((item) => item.purpose)), new Set(["LEARNING", "INSTALLABLE_TOOLING"]));
  assert.equal(result.axes.product.candidates.find((item) => item.nodeId === "tutorial-reference-collection").advisorSignal.support, "SUPPORT");
});

test("one broad guide token cannot satisfy a multi-concept structured hint", async () => {
  const source = fs.mkdtempSync(path.join(os.tmpdir(), "evopilot-v45-single-guide-token-"));
  fs.writeFileSync(path.join(source, "README.md"), "# JavaScript guide\nThis guide documents one coding convention.\n");
  const result = await analyzeSourceTaxonomy({ source, taxonomy: learningResourceTaxonomy(), advisorProvider: primaryLearningAdvisor });
  const candidate = result.retrieval.axes.product.find((item) => item.nodeId === "tutorial-reference-collection");
  assert.equal(candidate.signals.find((item) => item.type === "structured").score, 0);
  assert.ok(candidate.signals.find((item) => item.type === "bm25").score > 0);
});

test("bounded stratified Source sampling prevents one copied framework tree from hiding current business responsibility", async () => {
  const source = fs.mkdtempSync(path.join(os.tmpdir(), "evopilot-v45-stratified-"));
  const framework = path.join(source, "AppFramework", "LogUnified", "src", "main", "java", "ch", "qos", "logback");
  const business = path.join(source, "BusinessResearch");
  fs.mkdirSync(framework, { recursive: true });
  fs.mkdirSync(business, { recursive: true });
  fs.mkdirSync(path.join(source, "tests", "fixtures"), { recursive: true });
  for (let index = 0; index < 600; index += 1) fs.writeFileSync(path.join(framework, `Logger${String(index).padStart(3, "0")}.java`), "package ch.qos.logback; public class Logger { String framework = \"logback logging adapter\"; }\n");
  fs.writeFileSync(path.join(business, "README.md"), "Investment information research, product comparison, and research information presentation are the current business responsibilities.\n");
  fs.writeFileSync(path.join(business, "package.json"), JSON.stringify({ name: "research-information-service", description: "investment information and research presentation" }));
  fs.writeFileSync(path.join(source, "tests", "fixtures", "removed-experiment.md"), "distributed cache middleware\n".repeat(40));
  const document = taxonomy();
  document.spec.domains = [
    { id: "business-services", label: "Business services", assignable: false },
    { id: "investment-research", label: "Investment research", definition: "Investment information research and comparison.", parents: ["business-services"], assignable: true, positiveEvidenceHints: ["investment information research", "product comparison"] }
  ];
  document.spec.products = [
    { id: "information-systems", label: "Information systems", assignable: false },
    { id: "research-information-service", label: "Research information service", definition: "Research information presentation product.", parents: ["information-systems"], assignable: true, positiveEvidenceHints: ["research information presentation"], exclusionHints: ["distributed cache middleware"] }
  ];
  const result = await analyzeSourceTaxonomy({ source, taxonomy: document, advisorProvider: supportingAdvisor });
  assert.equal(result.aggregate, "TAXONOMY_MATCHED");
  assert.equal(result.sourceSnapshot.fileCount, 512);
  assert.ok(result.sourceSnapshot.files.some((item) => item.sourceRef.startsWith("BusinessResearch/")));
  assert.equal(result.axes.domain.selected.nodeId, "investment-research");
  assert.equal(result.axes.product.selected.nodeId, "research-information-service");
  assert.deepEqual(result.axes.product.selected.contradictions, []);
  assert.ok(result.presentation.domain.evidence.length <= 12);
  assert.ok(result.presentation.product.evidence.length <= 12);
});

test("Advisor failure blocks without creating a Taxonomy result or deterministic fallback", async () => {
  const result = await analyzeSourceTaxonomy({ source: sourceFixture(), taxonomy: taxonomy(), advisorProvider: async () => { const error = new Error("timeout"); error.code = "TRANSPORT_TIMEOUT"; throw error; } });
  assert.equal(result.status, "ANALYSIS_BLOCKED_ADVISOR");
  assert.equal(result.advisor.classificationResultCreated, false);
  assert.equal(result.advisor.authority.fallbackAllowed, false);
  assert.equal(result.analysisResultDigest, undefined);
});

test("Advisor timeout normalizes DOMException numeric codes into a stable typed blocker", async () => {
  const result = await analyzeSourceTaxonomy({ source: sourceFixture(), taxonomy: taxonomy(), advisorProvider: async () => { const error = new Error("The operation was aborted due to timeout"); error.name = "TimeoutError"; error.code = 23; throw error; } });
  assert.equal(result.status, "ANALYSIS_BLOCKED_ADVISOR");
  assert.equal(result.advisor.code, "TRANSPORT_TIMEOUT");
  assert.equal(result.advisor.invocationCount, 1);
  assert.equal(result.advisor.classificationResultCreated, false);
});

test("malformed, secret-bearing, or out-of-candidate Advisor output is rejected without repair", async () => {
  for (const advisorProvider of [
    async () => ({ candidates: [{ axis: "domain", nodeId: "invented", support: "SUPPORT", confidence: 1, evidenceIds: ["invented"] }], unresolvedConcepts: [] }),
    async (input) => ({ ...supportingAdvisor(input), unresolvedConcepts: [{ proposedLabel: "secret", definition: "api_key=must-not-persist", evidenceIds: input.hypothesis.citations.slice(0, 2).map((item) => item.evidenceId) }] })
  ]) {
    const result = await analyzeSourceTaxonomy({ source: sourceFixture(), taxonomy: taxonomy(), advisorProvider });
    assert.equal(result.status, "ANALYSIS_BLOCKED_ADVISOR");
    assert.equal(result.advisor.code, "ADVISOR_CONTRACT_REJECTED");
    assert.equal(result.advisor.invocationCount, 1);
    assert.equal(result.advisor.classificationResultCreated, false);
  }
});

test("materially tied candidates return ambiguity and cannot hand off", async () => {
  const document = taxonomy();
  document.spec.products.push({ id: "ioredis-platform", label: "IORedis", definition: "A Redis caching platform with expiry and replication.", aliases: ["ioredis"], parents: ["infrastructure-product"], assignable: true, positiveEvidenceHints: ["redis", "ttl", "eviction", "replication"] });
  const result = await analyzeSourceTaxonomy({ source: sourceFixture(), taxonomy: document, advisorProvider: supportingAdvisor });
  assert.equal(result.aggregate, "TAXONOMY_AMBIGUOUS");
  assert.throws(() => createClassificationHandoff({ classificationSessionId: "classification-1", result, decidedBy: "user", decisionToken: "anything" }), (error) => error.code === "CLASSIFICATION_MATCH_REQUIRED");
});

test("deterministic classification distinguishes scheme extension, insufficient evidence, ambiguity, and mixed-axis precedence", async () => {
  const gap = taxonomy();
  gap.spec.domains = [{ id: "finance", label: "Finance", definition: "Financial services and transactions.", assignable: true, positiveEvidenceHints: ["banking"] }];
  gap.spec.products = [{ id: "customer-portal", label: "Customer portal", definition: "A customer interaction portal.", assignable: true, positiveEvidenceHints: ["ticket", "customer"] }];
  const extension = await analyzeSourceTaxonomy({ source: sourceFixture(), taxonomy: gap, advisorProvider: supportingAdvisor });
  assert.equal(extension.aggregate, "TAXONOMY_EXTENSION_SUGGESTED");
  assert.equal(extension.axes.domain.status, "TAXONOMY_EXTENSION_SUGGESTED");
  assert.ok(extension.axes.domain.extension.proposedLabel);
  assert.equal(extension.axes.domain.extension.automaticMutationAllowed, false);

  const mixed = taxonomy();
  mixed.spec.products = gap.spec.products;
  const mixedResult = await analyzeSourceTaxonomy({ source: sourceFixture(), taxonomy: mixed, advisorProvider: supportingAdvisor });
  assert.equal(mixedResult.axes.domain.status, "TAXONOMY_MATCHED");
  assert.equal(mixedResult.axes.product.status, "TAXONOMY_EXTENSION_SUGGESTED");
  assert.equal(mixedResult.aggregate, "TAXONOMY_EXTENSION_SUGGESTED");

  const weakSource = fs.mkdtempSync(path.join(os.tmpdir(), "evopilot-v45-weak-"));
  fs.writeFileSync(path.join(weakSource, "a.md"), "x\n");
  const insufficient = await analyzeSourceTaxonomy({ source: weakSource, taxonomy: taxonomy(), advisorProvider: supportingAdvisor });
  assert.equal(insufficient.aggregate, "TAXONOMY_EVIDENCE_INSUFFICIENT");
  assert.equal(insufficient.axes.domain.status, "TAXONOMY_EVIDENCE_INSUFFICIENT");
  assert.equal(insufficient.axes.product.status, "TAXONOMY_EVIDENCE_INSUFFICIENT");
});

test("a MULTIPLE axis preserves independent specific matches instead of collapsing Domain and Product", async () => {
  const document = taxonomy();
  document.spec.axisPolicies.productCardinality = "MULTIPLE";
  document.spec.products.push({ id: "replicated-key-value-store", label: "Replicated key value store", aliases: ["ioredis"], definition: "A replicated key value storage product.", parents: ["infrastructure-product"], assignable: true, positiveEvidenceHints: ["ioredis", "key-value", "replication", "ttl"] });
  const result = await analyzeSourceTaxonomy({ source: sourceFixture(), taxonomy: document, advisorProvider: supportingAdvisor });
  assert.equal(result.axes.product.status, "TAXONOMY_MATCHED");
  assert.equal(result.axes.product.cardinality, "MULTIPLE");
  assert.ok(result.axes.product.selectedNodes.length >= 2);
  assert.equal(result.axes.domain.axis, "domain");
  assert.equal(result.axes.product.axis, "product");
});

test("matched classification requires an exact explicit handoff and grants no downstream authority", async () => {
  const result = await analyzeSourceTaxonomy({ source: sourceFixture(), taxonomy: taxonomy(), advisorProvider: supportingAdvisor });
  assert.throws(() => createClassificationHandoff({ classificationSessionId: "classification-1", result, decidedBy: "user", decisionToken: "continue" }), (error) => error.code === "EXPLICIT_HANDOFF_DECISION_REQUIRED");
  const handoff = createClassificationHandoff({ classificationSessionId: "classification-1", result, decidedBy: "user", decisionToken: `CONTINUE_TO_HARNESS:classification-1:${result.analysisResultDigest}` });
  assert.equal(handoff.authority.explicitHumanDecision, true);
  assert.equal(handoff.authority.provesEligibility, false);
  assert.equal(handoff.authority.createsProposal, false);
  assert.equal(handoff.authority.approves, false);
  assert.equal(handoff.authority.publishes, false);
});

test("persistent Classification Session explicitly hands the same immutable context into the retained Operation Session", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "evopilot-v45-workspace-"));
  initializeWorkspace(home);
  const classification = await startClassificationSession({ home, source: sourceFixture(), taxonomy: taxonomy(), intent: "理解素材并在匹配后继续演进 Harness", advisorProvider: supportingAdvisor, adapterId: "generic", hostInteraction: governedHostInteraction("generic-independent-host", "1.0.0") });
  assert.equal(classification.status, "TAXONOMY_MATCHED");
  assert.equal(inspectClassificationSession(home, classification.sessionId).sessionDigest, classification.sessionDigest);
  const decisionToken = `CONTINUE_TO_HARNESS:${classification.sessionId}:${classification.currentResult.analysisResultDigest}`;
  const handedOff = continueClassificationToHarness({
    home,
    sessionId: classification.sessionId,
    expectedSessionDigest: classification.sessionDigest,
    decisionToken,
    decidedBy: "ordinary-user",
    intent: "基于已确认分类演进 Harness",
    adapterId: "generic",
    hostInteraction: { id: "generic-independent-host", version: "1.0.0", level: "GOVERNED_HUMAN_GATE_COMPATIBLE", capabilities: [...REQUIRED_GOVERNED_HOST_CAPABILITIES], locale: "zh-CN", supportsOperationJobs: true, maxSynchronousMcpRequestMs: 180000 }
  });
  assert.equal(handedOff.status, "HANDED_OFF");
  assert.equal(handedOff.operationSession.classificationHandoff.handoffDigest, handedOff.classificationSession.handoff.handoffDigest);
  assert.equal(handedOff.operationSession.sessionId, classification.agentOperationSessionId);
  assert.equal(handedOff.operationSession.status, "CREATED");
  assert.equal(handedOff.operationSession.nextAction, "create-operation-plan");
  assert.equal(handedOff.operationSession.classificationLifecycle.operation, "ANALYZE_TAXONOMY");
  assert.equal(handedOff.operationSession.classificationLifecycle.status, "HANDED_OFF");
  assert.equal(handedOff.operationSession.classificationLifecycle.analysisReceiptDigest, classification.attempts[0].analysisReceipt.receiptDigest);
  assert.equal(classification.attempts[0].analysisReceipt.authority.humanDecision, false);
  assert.equal(handedOff.authority.provesEligibility, false);
  const planned = createSessionPlan({ home, sessionId: handedOff.operationSession.sessionId, expectedSessionDigest: handedOff.operationSession.sessionDigest, scenario: "evolve", goal: "基于同一 Source 和分类上下文演进 Harness", sources: { sourceProjects: [classification.source.ref], advisor: "off" } });
  assert.equal(planned.evolutionContext.classificationHandoffBinding.handoffDigest, handedOff.operationSession.classificationHandoff.handoffDigest);
  assert.equal(planned.evolutionContext.classificationHandoffBinding.provesEligibility, false);
});

test("SourceDescriptor handoff automatically carries the exact classified Source into Harness planning", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "evopilot-v45-source-handoff-"));
  initializeWorkspace(home);
  const source = sourceFixture();
  const classification = await startClassificationSession({
    home,
    sourceDescriptor: { sourceId: "cache-source", type: "LOCAL_DIRECTORY", path: source },
    taxonomy: taxonomy(),
    intent: "classify and continue with the exact source",
    advisorProvider: supportingAdvisor,
    adapterId: "generic",
    hostInteraction: governedHostInteraction("generic-independent-host", "1.0.0")
  });
  const handedOff = continueClassificationToHarness({
    home,
    sessionId: classification.sessionId,
    expectedSessionDigest: classification.sessionDigest,
    decisionToken: classification.currentDecision.internalDecisionToken,
    decidedBy: "ordinary-user"
  });
  const planned = createSessionPlan({ home, sessionId: handedOff.operationSession.sessionId, expectedSessionDigest: handedOff.operationSession.sessionDigest, scenario: "evolve", goal: "evolve from the exact classified Source", sources: { advisor: "off" } });
  assert.deepEqual(planned.plan.sources.sourceProjects, [source]);
  assert.equal(planned.evolutionContext.sourceSnapshotDigest, classification.currentResult.sourceSnapshotDigest);
  assert.equal(planned.evolutionContext.classificationHandoffBinding.sourceDescriptorDigest, classification.source.descriptorDigest);
  assert.equal(planned.evolutionContext.classificationHandoffBinding.sourceResolutionDigest, classification.source.resolutionDigest);
});

test("Source drift after classification invalidates the handoff before Harness planning", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "evopilot-v45-source-drift-"));
  initializeWorkspace(home);
  const source = sourceFixture();
  const classification = await startClassificationSession({ home, sourceDescriptor: { sourceId: "drift-source", type: "LOCAL_DIRECTORY", path: source }, taxonomy: taxonomy(), intent: "detect source drift", advisorProvider: supportingAdvisor });
  const handedOff = continueClassificationToHarness({ home, sessionId: classification.sessionId, expectedSessionDigest: classification.sessionDigest, decisionToken: classification.currentDecision.internalDecisionToken, decidedBy: "ordinary-user" });
  fs.appendFileSync(path.join(source, "README.md"), "changed after handoff\n");
  assert.throws(() => createSessionPlan({ home, sessionId: handedOff.operationSession.sessionId, expectedSessionDigest: handedOff.operationSession.sessionDigest, scenario: "evolve", goal: "must not use a stale classification", sources: { advisor: "off" } }), (error) => error.code === "CLASSIFICATION_SOURCE_DRIFT");
});

test("an unchanged completed classification context replays with zero physical Advisor calls", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "evopilot-v45-replay-"));
  initializeWorkspace(home);
  const source = sourceFixture();
  let calls = 0;
  async function stableAdvisor(input) { calls += 1; return supportingAdvisor(input); }
  const first = await startClassificationSession({ home, source, taxonomy: taxonomy(), intent: "same immutable context", locale: "zh-CN", advisorProvider: stableAdvisor });
  const replay = await startClassificationSession({ home, source, taxonomy: taxonomy(), intent: "same immutable context", locale: "zh-CN", advisorProvider: stableAdvisor });
  assert.equal(calls, 1);
  assert.equal(first.currentResult.analysisResultDigest, replay.currentResult.analysisResultDigest);
  assert.equal(replay.attempts[0].executionMode, "REPLAY");
  assert.equal(replay.attempts[0].physicalAdvisorInvocationCount, 0);
});

test("an unfinished classification resumes through its bound generic AgentOperationSession", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "evopilot-v45-resume-"));
  initializeWorkspace(home);
  const started = await startClassificationSession({ home, source: sourceFixture(), taxonomy: taxonomy(), intent: "resume classification", advisorProvider: supportingAdvisor });
  const resumed = resumeClassificationSession({ home, sessionId: started.sessionId, expectedSessionDigest: started.sessionDigest, adapterId: "replacement-adapter" });
  assert.equal(resumed.status, "TAXONOMY_MATCHED");
  assert.notEqual(resumed.agentOperationSessionDigest, started.agentOperationSessionDigest);
  assert.equal(inspectClassificationSession(home, resumed.sessionId).sessionDigest, resumed.sessionDigest);
});

test("blocked Advisor attempts are never cached or silently repeated", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "evopilot-v45-blocked-"));
  initializeWorkspace(home);
  const source = sourceFixture();
  let calls = 0;
  async function failingAdvisor() { calls += 1; const error = new Error("uncertain timeout"); error.code = "ADVISOR_TIMEOUT_UNCERTAIN"; throw error; }
  const first = await startClassificationSession({ home, source, taxonomy: taxonomy(), intent: "blocked context", advisorProvider: failingAdvisor });
  const second = await startClassificationSession({ home, source, taxonomy: taxonomy(), intent: "blocked context", advisorProvider: failingAdvisor });
  assert.equal(calls, 2);
  assert.equal(first.status, "ANALYSIS_BLOCKED_ADVISOR");
  assert.equal(second.status, "ANALYSIS_BLOCKED_ADVISOR");
  assert.notEqual(first.attempts[0].analysisAttemptDigest, second.attempts[0].analysisAttemptDigest);
});

test("the frozen 48-case Gold matrix passes exact outcomes, hierarchy, replay, mixed-axis folding, and zero false broad matches", async () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, "fixtures/v4.5/classification-gold-manifest.json"), "utf8"));
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "evopilot-v45-gold-"));
  initializeWorkspace(home);
  const sources = goldSources();
  const observations = [];
  for (const gold of manifest.cases) {
    const document = goldTaxonomy(gold.taxonomyVariant);
    const source = sources[gold.sourceVariant];
    const intent = `gold-case:${gold.id}`;
    const first = await startClassificationSession({ home, source, taxonomy: document, intent, locale: "zh-CN", advisorProvider: supportingAdvisor });
    const replay = await startClassificationSession({ home, source, taxonomy: document, intent, locale: "zh-CN", advisorProvider: supportingAdvisor });
    const result = first.currentResult;
    const replayResult = replay.currentResult;
    if (gold.stratum === "KNOWN_MATCH" && gold.literalSelectedVocabularyPresent === false) assertSelectedVocabularyAbsent(source, result);
    const decisionDigest = (value) => digest({ axes: value.axes, aggregate: value.aggregate, retrieval: value.retrieval });
    observations.push({
      caseId: gold.id,
      axes: { domain: result.axes.domain.status, product: result.axes.product.status },
      aggregate: result.aggregate,
      hierarchyCorrect: hierarchyIsSpecific(result),
      replayExact: replay.attempts[0].physicalAdvisorInvocationCount === 0 && decisionDigest(result) === decisionDigest(replayResult),
      falseBroadOrSyntheticMatch: gold.stratum === "MISLEADING_NEGATIVE" && result.aggregate === "TAXONOMY_MATCHED",
      resultDigest: result.analysisResultDigest,
      taxonomyDigest: result.taxonomyDigest,
      sourceSnapshotDigest: result.sourceSnapshotDigest,
      retrievalConfigDigest: result.retrieval.configDigest,
      algorithmDigest: digest(RETRIEVAL_CONFIG.algorithm),
      policyDigest: result.evolutionContext.decisionPolicyDigest,
      advisorBindingDigest: digest(result.advisor.modelBinding)
    });
  }
  const report = createClassificationEvaluationReport({ goldManifest: manifest, observations });
  assert.equal(report.caseCount, 48);
  assert.equal(report.composition.semanticKnownMatches, 6);
  assert.equal(report.composition.mixedAxisCases, 8);
  assert.equal(report.metrics.expectedOutcomeRate, 1);
  assert.equal(report.metrics.hierarchyCorrectnessRate, 1);
  assert.equal(report.metrics.replayRate, 1);
  assert.equal(report.metrics.falseBroadOrSyntheticMatches, 0);
  assert.equal(report.status, "PASS");
  const reportSchema = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, "../schemas/classification-evaluation-report-v1.schema.json"), "utf8"));
  assert.equal(new Ajv2020({ strict: true }).compile(reportSchema)(report), true);
});

test("real stdio MCP presents classification as the exact user turn and hands an explicit match into the retained Session", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "evopilot-v45-mcp-"));
  initializeWorkspace(home);
  const source = sourceFixture();
  const taxonomyFile = path.join(home, "business-classification.json");
  fs.writeFileSync(taxonomyFile, `${JSON.stringify(taxonomy(), null, 2)}\n`);
  let advisorCalls = 0;
  const advisorServer = http.createServer((request, response) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => { body += chunk; });
    request.on("end", () => {
      advisorCalls += 1;
      const envelope = JSON.parse(body);
      const input = JSON.parse(envelope.messages.at(-1).content);
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(supportingAdvisor(input)) } }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } }));
    });
  });
  await new Promise((resolve) => advisorServer.listen(0, "127.0.0.1", resolve));
  const modelsFile = path.join(home, "models.json");
  fs.writeFileSync(modelsFile, `${JSON.stringify({ models: [{ id: "classification-advisor", name: "Classification Advisor", vendor: "zhipu", apiKey: "test-only-secret", url: `http://127.0.0.1:${advisorServer.address().port}/v4` }] }, null, 2)}\n`);
  const client = new TestMcpClient({ command: process.execPath, args: [path.join(import.meta.dirname, "../src/index.mjs"), "mcp", "serve", "--transport", "stdio", "--workspace", home], cwd: path.join(import.meta.dirname, "..") });
  try {
    await client.initialize();
    const listed = await client.request("tools/list");
    for (const name of ["start_project_classification", "reanalyze_project_classification", "continue_classification_to_harness", "inspect_project_classification", "resume_project_classification", "close_project_classification"]) assert.ok(listed.tools.some((item) => item.name === name));
    const startTool = listed.tools.find((item) => item.name === "start_project_classification");
    assert.ok(startTool.inputSchema.properties.sourceDescriptor);
    assert.deepEqual(startTool.inputSchema.properties.sourceDescriptor.properties.type.enum, ["LOCAL_FILE", "LOCAL_DIRECTORY", "LOCAL_GIT_REPOSITORY", "GITHUB_REPOSITORY", "CONTROLLED_FIXTURE", "ORDERED_ATTACHMENT_SET"]);
    const closeTool = listed.tools.find((item) => item.name === "close_project_classification");
    assert.equal(closeTool.inputSchema.required.includes("expectedSessionDigest"), false);
    assert.ok(closeTool.inputSchema.properties.expectedSessionDigest);
    const startedResult = await client.rawTool("start_project_classification", { sourceDescriptor: { sourceId: "mcp-local-source", type: "LOCAL_DIRECTORY", path: source }, taxonomyPath: taxonomyFile, intent: "先理解素材，确认后再进化 Harness", locale: "zh-CN", modelsFile, model: "classification-advisor", adapterId: "independent-host", hostInteraction: governedHostInteraction("independent-host", "1.0.0") });
    assert.equal(startedResult.isError, undefined);
    const started = structured(startedResult);
    assert.equal(started.status, "TAXONOMY_MATCHED");
    assert.equal(advisorCalls, 1);
    assert.equal(started.presentationReceipts.length, 1);
    assert.equal(started.presentationReceipts[0].authority.humanDecision, false);
    assert.equal(startedResult.content[0].text, started.presentation.canonicalMarkdown);
    assert.equal(startedResult._meta["evopilot/harnessPresentation"].mode, "EXACT_CANONICAL_MARKDOWN_ONLY");
    assert.match(started.presentation.canonicalMarkdown, /项目分类分析/);
    assert.match(started.presentation.canonicalMarkdown, /业务领域/);
    assert.match(started.presentation.canonicalMarkdown, /产品或系统类型/);
    assert.doesNotMatch(started.presentation.canonicalMarkdown, /sha256:|threshold|score|Taxonomy|Domain|Product/);
    assert.doesNotMatch(JSON.stringify(started), /test-only-secret/);
    const handedOffResult = await client.rawTool("continue_classification_to_harness", {
      classificationSessionId: started.sessionId,
      expectedSessionDigest: started.sessionDigest,
      decisionToken: started.currentDecision.internalDecisionToken,
      decidedBy: "ordinary-user"
    });
    const handedOff = structured(handedOffResult);
    assert.equal(handedOff.status, "HANDED_OFF");
    assert.equal(handedOff.operationSession.status, "CREATED");
    assert.equal(handedOff.operationSession.sessionId, started.agentOperationSessionId);
    assert.equal(handedOff.operationSession.classificationHandoff.handoffDigest, handedOff.classificationSession.handoff.handoffDigest);
    assert.equal(handedOff.authority.provesEligibility, false);

    const closableResult = await client.rawTool("start_project_classification", { sourcePath: source, taxonomyPath: taxonomyFile, intent: "分析后关闭，不进入 Harness", locale: "zh-CN", modelsFile, model: "classification-advisor", adapterId: "workbuddy", hostInteraction: governedHostInteraction("workbuddy", "current") });
    const closable = structured(closableResult);
    assert.equal(closable.status, "TAXONOMY_MATCHED");
    const closedResult = await client.rawTool("close_project_classification", {
      classificationSessionId: closable.sessionId,
      decidedBy: "ordinary-user",
      decision: "CLOSE"
    });
    const closed = structured(closedResult);
    assert.equal(closed.status, "CLOSED");
    assert.equal(closed.humanDecisions.at(-1).decidedBy, "ordinary-user");
    assert.deepEqual(closed.nextOperations, ["INSPECT"]);
    assert.equal(closedResult.content[0].text, closed.presentation.canonicalMarkdown);
    assert.match(closed.presentation.canonicalMarkdown, /项目分类会话已关闭/);
    assert.match(closed.presentation.canonicalMarkdown, /未进入 Harness 适用性判断与进化流程/);
    assert.match(closed.presentation.canonicalMarkdown, /当前没有待确认操作/);
    assert.doesNotMatch(closed.presentation.canonicalMarkdown, /是否基于这份分类结论/);
    assert.equal(closed.presentationReceipts.length, 2);
    assert.equal(closed.presentationReceipts.at(-1).presentationDigest, closed.presentation.presentationDigest);
    const inspectedClosedResult = await client.rawTool("inspect_project_classification", { classificationSessionId: closed.sessionId });
    const inspectedClosed = structured(inspectedClosedResult);
    assert.equal(inspectedClosed.status, "CLOSED");
    assert.equal(inspectedClosedResult.content[0].text, closed.presentation.canonicalMarkdown);
    assert.equal(advisorCalls, 2);
  } finally {
    await client.close();
    await new Promise((resolve) => advisorServer.close(resolve));
  }
});

test("real stdio MCP carries one matched classification through the complete retained Harness publication lifecycle", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "evopilot-v45-complete-lifecycle-"));
  initializeWorkspace(home);
  const source = path.join(home, "read-only-source");
  const commandSentinel = path.join(home, "source-command-must-not-run");
  fs.mkdirSync(source);
  fs.writeFileSync(path.join(source, "package.json"), `${JSON.stringify({ name: "distributed-cache-engine", scripts: { test: "node should-not-run.mjs", build: "node should-not-run.mjs" }, dependencies: { redis: "5.0.0", ioredis: "5.4.0" }, description: "Redis distributed cache with TTL eviction replication and failover" }, null, 2)}\n`);
  fs.writeFileSync(path.join(source, "README.md"), "# Distributed Cache Product\n\nReusable middleware implementing Redis key-value storage, TTL eviction, replication, failover, persistence, and hash-slot migration.\n");
  fs.writeFileSync(path.join(source, "should-not-run.mjs"), `import fs from "node:fs"; fs.writeFileSync(${JSON.stringify(commandSentinel)}, "SOURCE COMMAND EXECUTED");\n`);
  const sourceBefore = directoryDigest(source);
  const taxonomyFile = path.join(home, "business-classification.json");
  fs.writeFileSync(taxonomyFile, `${JSON.stringify(taxonomy(), null, 2)}\n`);
  const advisor = await startLifecycleAdvisorServer();
  const modelsFile = path.join(home, "models.json");
  fs.writeFileSync(modelsFile, `${JSON.stringify({ models: [{ id: "lifecycle-advisor", name: "Lifecycle Advisor", vendor: "zhipu", apiKey: "test-only-secret", url: advisor.url, supportsToolCall: true, supportsReasoning: false }] }, null, 2)}\n`);
  const client = new TestMcpClient({ command: process.execPath, args: [path.join(import.meta.dirname, "../src/index.mjs"), "mcp", "serve", "--transport", "stdio", "--workspace", home], cwd: path.join(import.meta.dirname, "..") });
  try {
    await client.initialize();
    const classified = structured(await client.tool("start_project_classification", {
      sourceDescriptor: { sourceId: "lifecycle-local-source", type: "LOCAL_DIRECTORY", path: source },
      taxonomyPath: taxonomyFile,
      intent: "先理解这份未知素材，再基于确认结果进化 Harness",
      locale: "zh-CN",
      modelsFile,
      model: "lifecycle-advisor",
      adapterId: "independent-host",
      hostInteraction: governedHostInteraction("independent-host", "1.0.0")
    }));
    assert.equal(classified.status, "TAXONOMY_MATCHED");
    const handedOff = structured(await client.tool("continue_classification_to_harness", {
      classificationSessionId: classified.sessionId,
      expectedSessionDigest: classified.sessionDigest,
      decisionToken: classified.currentDecision.internalDecisionToken,
      decidedBy: "acceptance-operator"
    }));
    assert.equal(handedOff.operationSession.sessionId, classified.agentOperationSessionId);
    assert.equal(handedOff.authority.provesEligibility, false);

    let session = structured(await client.tool("plan_operation_session", {
      sessionId: handedOff.operationSession.sessionId,
      expectedSessionDigest: handedOff.operationSession.sessionDigest,
      scenario: "evolve",
      goal: "基于同一静态 Source 和已确认分类上下文进化可复用 Harness",
      sources: { sourceProjects: [source], advisor: "off", modelsFile, model: "lifecycle-advisor" }
    }));
    assert.equal(session.evolutionContext.classificationHandoffBinding.handoffDigest, handedOff.classificationSession.handoff.handoffDigest);
    const planFrame = session.interaction.currentFrame;
    session = structured(await client.tool("record_business_view_delivery", {
      sessionId: session.sessionId,
      expectedSessionDigest: session.sessionDigest,
      expectedFrameDigest: planFrame.frameDigest,
      deliveredBusinessViewDigest: planFrame.businessView.businessViewDigest,
      renderedBusinessViewDigest: digest(planFrame.businessView.canonicalMarkdown)
    }));
    session = structured(await client.tool("confirm_operation_plan", {
      sessionId: session.sessionId,
      expectedSessionDigest: session.sessionDigest,
      expectedPlanDigest: session.planDigest,
      confirmedBy: "acceptance-operator",
      confirmation: `CONFIRM_OPERATION_PLAN:${session.planDigest}`
    }));
    session = structured(await client.tool("execute_operation_plan", { sessionId: session.sessionId, expectedSessionDigest: session.sessionDigest, expectedPlanDigest: session.planDigest }));
    assert.equal(session.status, "PROPOSAL_REVIEW_REQUIRED");
    assert.equal(session.proposals.length, 1);

    session = structured(await client.tool("review_session_proposals", { sessionId: session.sessionId, expectedSessionDigest: session.sessionDigest, modelsFile, model: "lifecycle-advisor", reviewTimeoutMs: 5000 }));
    assert.equal(session.status, "HUMAN_APPROVAL_REQUIRED", JSON.stringify(session.blockers));
    const proposal = session.proposals[0];
    const reviewFrame = session.interaction.currentFrame;
    session = structured(await client.tool("record_business_view_delivery", {
      sessionId: session.sessionId,
      expectedSessionDigest: session.sessionDigest,
      expectedFrameDigest: reviewFrame.frameDigest,
      deliveredBusinessViewDigest: reviewFrame.businessView.businessViewDigest,
      renderedBusinessViewDigest: digest(reviewFrame.businessView.canonicalMarkdown)
    }));
    session = structured(await client.tool("approve_session_proposal", {
      sessionId: session.sessionId,
      proposalId: proposal.proposalId,
      expectedSessionDigest: session.sessionDigest,
      expectedProposalDigest: proposal.proposalDigest,
      expectedReviewDigest: proposal.review.reportDigest,
      confirmedBy: "acceptance-operator",
      confirmation: `APPROVE_PROPOSAL:${proposal.proposalId}:${proposal.proposalDigest}:${proposal.review.reportDigest}`,
      evaluationReviewed: true
    }));
    assert.equal(session.status, "PUBLICATION_DECISION_REQUIRED");
    const approved = session.proposals[0];
    session = structured(await client.tool("authorize_proposal_publication", {
      sessionId: session.sessionId,
      proposalId: approved.proposalId,
      expectedSessionDigest: session.sessionDigest,
      expectedProposalDigest: approved.approvedProposalDigest,
      confirmedBy: "acceptance-operator",
      confirmation: `AUTHORIZE_PUBLICATION:${approved.proposalId}:${approved.approvedProposalDigest}`
    }));
    assert.equal(session.status, "PUBLICATION_AUTHORIZED");
    session = structured(await client.tool("publish_session_proposal", {
      sessionId: session.sessionId,
      proposalId: approved.proposalId,
      expectedSessionDigest: session.sessionDigest,
      expectedAuthorizationDigest: session.proposals[0].publicationAuthorization.authorizationDigest
    }));
    assert.equal(session.status, "COMPLETED");
    assert.equal(session.proposals[0].publication.catalogStatus, "VALIDATED");
    assert.equal(session.classificationHandoff.handoffDigest, handedOff.classificationSession.handoff.handoffDigest);
    session = structured(await client.tool("close_operation_session", {
      sessionId: session.sessionId,
      expectedSessionDigest: session.sessionDigest,
      confirmedBy: "acceptance-operator",
      confirmation: `CLOSE_SESSION:${session.sessionId}:${session.sessionDigest}`
    }));
    assert.equal(session.status, "CLOSED");
    assert.equal(inspectClassificationSession(home, classified.sessionId).status, "HANDED_OFF");
    assert.equal(fs.existsSync(commandSentinel), false);
    assert.equal(directoryDigest(source), sourceBefore);
  } finally {
    await client.close();
    await advisor.close();
  }
});

async function startLifecycleAdvisorServer() {
  let requestCount = 0;
  const server = http.createServer(async (request, response) => {
    requestCount += 1;
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    const input = JSON.parse(body.messages.at(-1).content);
    let output;
    if (input.schema === "evopilot-harness-advisor-candidate-analysis-input/v1") {
      output = supportingAdvisor(input);
    } else {
      const evidenceIds = input.evidenceGraph.map((item) => item.evidenceId);
      const firstEvidence = evidenceIds[0];
      const reviewPrompt = input.task?.startsWith("Independently review") || input.task?.startsWith("Repair the previous Proposal Review");
      if (!reviewPrompt) {
        output = { recommendation: "PROPOSE_NEW_PROFILE", rationale: "The cited static evidence supports a bounded reusable Harness Profile proposal.", evidenceIds: [firstEvidence], risks: ["Human review remains required."], proposedDeltas: ["Review the proposed boundary, validators, and Evaluation cases."] };
      } else {
        const projectMembership = input.sources.map((source) => ({ sourceId: source.sourceId, sourceType: source.sourceType, sourceRef: source.sourceRef, status: "IN_SCOPE", rationale: "The cited static evidence describes one distributed-cache product boundary.", evidenceIds: [source.evidenceIds[0]] }));
        output = {
          verdict: "READY_FOR_HUMAN_APPROVAL",
          summary: "The evidence-bound Proposal is coherent, specific, and ready for a separate human approval decision.",
          findings: [{ id: "semantic-boundary", severity: "info", dimension: "boundary", conclusion: "The Proposal represents a cache product rather than a client wrapper.", reasons: ["Product protocol, persistence, replication, failover, and migration are cited."], evidenceIds: [firstEvidence], suggestedActions: ["Review Evaluation cases before approval."] }],
          reasons: ["Static evidence and deterministic gates support the proposed Harness evolution."],
          groupCoherence: { status: "COHERENT", rationale: "All Source evidence belongs to one product boundary.", evidenceIds: projectMembership.length > 1 ? [firstEvidence] : [] },
          projectMembership,
          boundaryAssessment: { status: "PRECISE", rationale: "The boundary excludes client-only wrappers and covers cache-server engineering.", evidenceIds: [firstEvidence] },
          existingAssetOverlap: { status: "EVOLVE_EXISTING", rationale: "The existing distributed-cache profile is the closest professional asset.", candidates: [], evidenceIds: [] },
          definitionQuality: { status: "READY", score: 0.94, rationale: "The definition is constrained, executable, evidence-backed, and evaluable.", checks: [{ id: "specificity", status: "PASS" }], evidenceIds: [] },
          evaluationSufficiency: { status: "READY_FOR_REVIEW", rationale: "Positive and negative Evaluation cases are present for human review.", evidenceIds: [] },
          advisorAssessment: { status: "NOT_REQUIRED", rationale: "The deterministic existing-profile match does not require Advisor override.", evidenceIds: [firstEvidence] },
          suggestedActions: ["Complete the explicit Evaluation review and human approval gate."]
        };
      }
    }
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(output) } }], usage: { prompt_tokens: 100, completion_tokens: 80, total_tokens: 180 } }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { url: `http://127.0.0.1:${server.address().port}/v4`, requests: () => requestCount, close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())) };
}

function directoryDigest(directory) {
  const files = fs.readdirSync(directory, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(entry.parentPath ?? entry.path, entry.name))
    .sort();
  return digest(files.map((file) => ({ file: path.relative(directory, file), content: fs.readFileSync(file).toString("base64") })));
}

function goldSources() {
  const literal = sourceFixture();
  const semantic = fs.mkdtempSync(path.join(os.tmpdir(), "evopilot-v45-semantic-"));
  fs.writeFileSync(path.join(semantic, "README.md"), "Sharded Redis cache nodes provide TTL eviction, replication, key value acceleration, and client failover.\n");
  fs.writeFileSync(path.join(semantic, "package.json"), JSON.stringify({ name: "fast-data-node", dependencies: { ioredis: "5.4.0" } }));
  const weak = fs.mkdtempSync(path.join(os.tmpdir(), "evopilot-v45-gold-weak-"));
  fs.writeFileSync(path.join(weak, "a.md"), "x\n");
  const misleading = fs.mkdtempSync(path.join(os.tmpdir(), "evopilot-v45-misleading-"));
  fs.mkdirSync(path.join(misleading, "tests/fixtures"), { recursive: true });
  fs.writeFileSync(path.join(misleading, "README.md"), "Utility package.\n");
  fs.writeFileSync(path.join(misleading, "tests/fixtures/distributed-cache.md"), "redis distributed cache middleware ttl replication distributed cache middleware\n".repeat(20));
  return { CACHE_LITERAL: literal, CACHE_SEMANTIC: semantic, WEAK: weak, MISLEADING_LOW_TRUST: misleading };
}

function goldTaxonomy(variant) {
  const document = taxonomy();
  if (variant === "CACHE") return document;
  if (variant === "CACHE_SEMANTIC") {
    document.spec.domains = [
      { id: "technical-services", label: "Technical services", assignable: false },
      { id: "software-infrastructure-services", label: "Reusable infrastructure services", aliases: ["platform-layer"], definition: "Reusable software facilities providing cache, replication, and data acceleration.", parents: ["technical-services"], assignable: true, positiveEvidenceHints: ["redis", "cache", "ttl", "replication", "ioredis"] }
    ];
    document.spec.products = [
      { id: "data-systems", label: "Data systems", assignable: false },
      { id: "data-acceleration-system", label: "Data acceleration system", aliases: ["accelerator-service"], definition: "A sharded key value acceleration system with expiry and replication.", parents: ["data-systems"], assignable: true, positiveEvidenceHints: ["redis", "cache", "ttl", "replication", "ioredis"] }
    ];
    return document;
  }
  const unrelatedDomain = [{ id: "finance", label: "Finance", definition: "Financial transactions and account services.", assignable: true, positiveEvidenceHints: ["bank", "ledger"] }];
  const unrelatedProduct = [{ id: "customer-portal", label: "Customer portal", definition: "A customer request and ticket portal.", assignable: true, positiveEvidenceHints: ["ticket", "customer"] }];
  if (variant === "DOMAIN_MATCH_PRODUCT_GAP") { document.spec.products = unrelatedProduct; return document; }
  if (variant === "DOMAIN_GAP_PRODUCT_MATCH") { document.spec.domains = unrelatedDomain; return document; }
  if (variant === "AMBIGUOUS") {
    document.spec.domains = [
      { id: "technology", label: "Technology", assignable: false },
      { id: "platform-layer-a", label: "Platform layer A", definition: "Reusable cache and replication infrastructure.", parents: ["technology"], assignable: true, positiveEvidenceHints: ["redis", "cache", "ttl", "replication"] },
      { id: "platform-layer-b", label: "Platform layer B", definition: "Reusable cache and replication infrastructure.", parents: ["technology"], assignable: true, positiveEvidenceHints: ["redis", "cache", "ttl", "replication"] }
    ];
    document.spec.products = [
      { id: "infrastructure-product", label: "Infrastructure product", assignable: false },
      { id: "cache-system-a", label: "Cache system A", definition: "Redis key value cache with expiry and replication.", parents: ["infrastructure-product"], assignable: true, positiveEvidenceHints: ["redis", "cache", "ttl", "replication"] },
      { id: "cache-system-b", label: "Cache system B", definition: "Redis key value cache with expiry and replication.", parents: ["infrastructure-product"], assignable: true, positiveEvidenceHints: ["redis", "cache", "ttl", "replication"] }
    ];
    return document;
  }
  throw new Error(`Unknown Gold taxonomy variant ${variant}`);
}

function assertSelectedVocabularyAbsent(source, result) {
  const text = fs.readdirSync(source).filter((name) => fs.statSync(path.join(source, name)).isFile()).map((name) => fs.readFileSync(path.join(source, name), "utf8").toLowerCase()).join("\n");
  for (const axis of ["domain", "product"]) {
    const selected = result.axes[axis].selected;
    assert.ok(selected, `semantic case did not select ${axis}: ${result.axes[axis].status} ${JSON.stringify(result.axes[axis].candidates)}`);
    const node = result.resolvedTaxonomySnapshot.axes[axis].nodes.find((item) => item.id === selected.nodeId);
    for (const value of [node.id, node.label, ...node.aliases]) assert.equal(text.includes(value.toLowerCase()), false, `literal selected vocabulary leaked into semantic case: ${value}`);
  }
}

function hierarchyIsSpecific(result) {
  return ["domain", "product"].every((axis) => {
    const selected = result.axes[axis].selectedNodes ?? [];
    return selected.every((candidate) => !selected.some((other) => other.nodeId !== candidate.nodeId && other.ancestors.includes(candidate.nodeId)));
  });
}
