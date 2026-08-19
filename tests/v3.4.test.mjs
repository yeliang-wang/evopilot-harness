import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { buildAssetDeltaProposal, buildEvaluationPackV3, validateAssetDeltaClosure } from "../src/v3/delta.mjs";
import { validateDocument } from "../src/v3/schema.mjs";
import { digest, readYaml } from "../src/v3/utils.mjs";

const root = path.resolve(import.meta.dirname, "..");
const cli = path.join(root, "src/index.mjs");
const assetKinds = ["HarnessComponent", "HarnessProfile", "HarnessBundle", "OntologyPack", "MatchPolicyPack", "AdvisorPolicyPack", "EvaluationPack"];

test("AssetDeltaProposal covers every asset kind with exact state and deterministic impact closure", () => {
  for (const kind of assetKinds) {
    const graph = fixtureGraph(`delta-${kind.toLowerCase()}`);
    const reasoning = fixtureReasoning("PROPOSE_NEW_PROFILE", graph);
    const asset = fixtureAsset(kind, graph, reasoning);
    const evaluationPack = buildEvaluationPackV3({ graph, reasoning, proposedAssets: [asset] });
    const proposal = buildAssetDeltaProposal({ graph, reasoning, proposedAssets: [asset], evaluationPack });
    const closure = validateAssetDeltaClosure(proposal, evaluationPack, { proposedAssets: [asset], evidenceGraph: graph, reasoning });
    assert.equal(validateDocument(proposal).valid, true, kind);
    assert.equal(validateDocument(evaluationPack).valid, true, kind);
    assert.equal(closure.status, "VALIDATED", kind);
    assert.equal(proposal.spec.deltas[0].assetKind, kind);
    assert.equal(proposal.spec.deltas[0].after.digest, digest(proposal.spec.deltas[0].after.document));
    assert.equal(proposal.spec.deltas[0].impact.status, "READY");
    assert.match(proposal.spec.deltas[0].impact.expectedEffect.claims[0].description, /1 evidence-linked change is expected/);
  }
});

test("EvaluationPack v3 requires portable positive and negative cases with pinned validators and scorers", () => {
  const graph = fixtureGraph("evaluation-contract");
  const reasoning = fixtureReasoning("PROPOSE_NEW_PROFILE", graph);
  const evaluationPack = buildEvaluationPackV3({ graph, reasoning, proposedAssets: [fixtureAsset("HarnessProfile")] });
  assert.equal(validateDocument(evaluationPack).valid, true);
  assert.deepEqual(new Set(evaluationPack.spec.cases.map((item) => item.polarity)), new Set(["positive", "negative"]));
  assert.ok(evaluationPack.spec.cases.every((item) => item.assertions.length && item.validators.length && item.scorers.length));
  assert.ok(evaluationPack.spec.cases.every((item) => item.regressionBoundary.allowedFailures === 0));

  const missingNegative = structuredClone(evaluationPack);
  missingNegative.spec.cases = missingNegative.spec.cases.filter((item) => item.polarity === "positive");
  assert.equal(validateDocument(missingNegative).valid, false);
});

test("v3.4 CLI produces every deterministic reasoning decision and terminal decisions cannot approve or publish", () => {
  const home = temporaryHome();
  runJson(["workspace", "init", "--workspace", home, "--json"]);
  const cases = [
    {
      id: "evolve",
      files: {
        "pom.xml": "<project><artifactId>cache-evolve</artifactId></project>",
        "README.md": "Distributed cache Redis compatible key-value store architecture. Build test validate release TTL eviction failover."
      },
      decision: "EVOLVE_EXISTING"
    },
    {
      id: "compose",
      files: {
        "pom.xml": "<project><artifactId>gateway-cache</artifactId></project>",
        "Main.java": "API gateway reverse proxy route policy rate limit upstream ingress build test validate release distributed cache Redis compatible key-value store TTL eviction."
      },
      decision: "COMPOSE_NEW_BUNDLE"
    },
    {
      id: "new-profile",
      files: {
        "pom.xml": "<project><artifactId>redis-client</artifactId></project>",
        "Client.java": "Redis client Jedis connection factory serializer library build test validate release."
      },
      decision: "PROPOSE_NEW_PROFILE"
    },
    {
      id: "no-change",
      files: {
        "pom.xml": "<project><artifactId>cache-same</artifactId></project>",
        "Main.java": "Distributed cache Redis compatible key-value store build test validate release."
      },
      decision: "NO_CHANGE"
    },
    {
      id: "need-more",
      files: { "Main.java": "distributed cache" },
      decision: "NEED_MORE_EVIDENCE"
    },
    {
      id: "not-eligible",
      files: { "README.md": "personal diary and vacation plan" },
      decision: "NOT_HARNESS_ELIGIBLE"
    }
  ];

  for (const fixture of cases) {
    const project = path.join(home, "fixtures", fixture.id);
    fs.mkdirSync(project, { recursive: true });
    for (const [file, contents] of Object.entries(fixture.files)) fs.writeFileSync(path.join(project, file), contents, "utf8");
    const produced = runJson(["produce", "--workspace", home, "--source-project", project, "--advisor", "off", "--json"], { allowFailure: true });
    assert.equal(produced.reasoning.decision, fixture.decision, fixture.id);
    if (fixture.decision === "NOT_HARNESS_ELIGIBLE") {
      assert.equal(produced.status, "NOT_HARNESS_ELIGIBLE");
      assert.deepEqual(produced.proposal.proposedAssets, []);
      assert.equal(produced.nextAction, "stop-not-harness-asset");
      continue;
    }
    assert.equal(produced.proposal.assetDeltaProposal.decision, fixture.decision, fixture.id);
    assert.equal(produced.proposal.deltaClosure.status, "VALIDATED", fixture.id);
    const validation = runJson(["proposal", "validate", produced.runId, "--workspace", home, "--json"]);
    assert.equal(validation.status, "VALIDATED", fixture.id);
    assert.equal(validation.assetDelta.spec.decision, fixture.decision, fixture.id);
    assert.equal(validation.evaluationPack.apiVersion, "harness.evopilot.io/v3", fixture.id);
    assert.deepEqual(new Set(validation.evaluationPack.spec.cases.map((item) => item.polarity)), new Set(["positive", "negative"]));

    if (["NO_CHANGE", "NEED_MORE_EVIDENCE"].includes(fixture.decision)) {
      assert.equal(validation.assetDelta.spec.publicationAllowed, false);
      const approval = runJson(["proposal", "approve", produced.runId, "--workspace", home, "--confirmed-by", "reviewer", "--confirmation", "Reviewed.", "--evaluation-reviewed", "--json"], { allowFailure: true });
      const publication = runJson(["proposal", "publish", produced.runId, "--workspace", home, "--json"], { allowFailure: true });
      assert.equal(approval.status, "BLOCKED");
      assert.equal(publication.status, "BLOCKED");
    } else {
      assert.equal(validation.assetDelta.spec.publicationAllowed, true);
      assert.ok(validation.assetDelta.spec.deltas.length >= 1);
      assert.ok(validation.assetDelta.spec.deltas.every((item) => item.impact.status === "READY"));
    }
  }
});

test("tampering with state, derived impact, proposed assets, or EvaluationPack linkage fails deterministic closure", () => {
  const graph = fixtureGraph("tamper-closure");
  const reasoning = fixtureReasoning("PROPOSE_NEW_PROFILE", graph);
  const asset = fixtureAsset("HarnessProfile", graph, reasoning);
  const evaluationPack = buildEvaluationPackV3({ graph, reasoning, proposedAssets: [asset] });
  const proposal = buildAssetDeltaProposal({ graph, reasoning, proposedAssets: [asset], evaluationPack });

  const stateTamper = structuredClone(proposal);
  stateTamper.spec.deltas[0].after.document.metadata.description = "tampered";
  assert.equal(validateAssetDeltaClosure(stateTamper, evaluationPack, { proposedAssets: [asset], evidenceGraph: graph, reasoning }).status, "FAILED");

  const impactTamper = structuredClone(proposal);
  impactTamper.spec.deltas[0].impact.compatibility.status = "COMPATIBLE";
  const impactClosure = validateAssetDeltaClosure(impactTamper, evaluationPack, { proposedAssets: [asset], evidenceGraph: graph, reasoning });
  assert.equal(impactClosure.status, "FAILED");
  assert.ok(impactClosure.blockers.includes("asset-delta:deterministic-derived-fields"));

  const proposedAssetTamper = structuredClone(asset);
  proposedAssetTamper.metadata.description = `${proposedAssetTamper.metadata.description} Changed outside Delta.`;
  const proposedAssetClosure = validateAssetDeltaClosure(proposal, evaluationPack, { proposedAssets: [proposedAssetTamper], evidenceGraph: graph, reasoning });
  assert.equal(proposedAssetClosure.status, "FAILED");
  assert.ok(proposedAssetClosure.blockers.includes("asset-delta:proposed-assets-delta-binding"));

  const evaluationTamper = structuredClone(evaluationPack);
  evaluationTamper.spec.cases[0].expectedOutcome = "changed after proposal binding";
  assert.equal(validateAssetDeltaClosure(proposal, evaluationTamper, { proposedAssets: [asset], evidenceGraph: graph, reasoning }).status, "FAILED");

  const invalidAsset = structuredClone(asset);
  delete invalidAsset.spec.boundary;
  const invalidEvaluation = buildEvaluationPackV3({ graph, reasoning, proposedAssets: [invalidAsset] });
  const invalidProposal = buildAssetDeltaProposal({ graph, reasoning, proposedAssets: [invalidAsset], evaluationPack: invalidEvaluation });
  const invalidClosure = validateAssetDeltaClosure(invalidProposal, invalidEvaluation, { proposedAssets: [invalidAsset], evidenceGraph: graph, reasoning });
  assert.equal(invalidClosure.status, "FAILED");
  assert.ok(invalidClosure.blockers.includes("asset-delta:embedded-document-schemas"));

  const evidenceTamper = structuredClone(proposal);
  evidenceTamper.spec.evidence.graphDigest = digest("unrelated-graph");
  evidenceTamper.spec.evidence.reasoningDigest = digest("unrelated-reasoning");
  const evidenceClosure = validateAssetDeltaClosure(evidenceTamper, evaluationPack, { proposedAssets: [asset], evidenceGraph: graph, reasoning });
  assert.equal(evidenceClosure.status, "FAILED");
  assert.ok(evidenceClosure.blockers.includes("asset-delta:evidence-context-binding"));
});

test("Delta closure fails closed when an immutable before-state is absent from the current Catalog", () => {
  const graph = fixtureGraph("missing-baseline");
  const base = fixtureAsset("HarnessProfile", graph, fixtureReasoning("EVOLVE_EXISTING", graph));
  const reasoning = fixtureReasoning("EVOLVE_EXISTING", graph);
  reasoning.targetProfile = { id: base.metadata.id, version: base.metadata.version };
  delete reasoning.proposedProfile;
  const candidate = structuredClone(base);
  candidate.metadata.version = "0.1.1";
  candidate.metadata.description = `${candidate.metadata.description} Evidence-backed update.`;
  const records = [{ asset: base, digest: digest(base) }];
  const evaluationPack = buildEvaluationPackV3({ graph, reasoning, records, proposedAssets: [candidate] });
  const proposal = buildAssetDeltaProposal({ graph, reasoning, records, proposedAssets: [candidate], evaluationPack });
  assert.equal(validateAssetDeltaClosure(proposal, evaluationPack, { proposedAssets: [candidate], records, evidenceGraph: graph, reasoning }).status, "VALIDATED");

  const missingBaseline = validateAssetDeltaClosure(proposal, evaluationPack, { proposedAssets: [candidate], records: [], evidenceGraph: graph, reasoning });
  assert.equal(missingBaseline.status, "FAILED");
  assert.ok(missingBaseline.blockers.includes("asset-delta:catalog-baseline-binding"));
});

function fixtureGraph(runId) {
  const excerpt = "Build, test, validate, and release an evidence-backed engineering asset.";
  const node = { evidenceId: "evidence-0001", kind: "source-code", sourceType: "source-project", sourceRef: `/fixtures/${runId}/Main.java`, excerpt, excerptDigest: digest(excerpt), concepts: ["executable-engineering"] };
  const graph = { schema: "evopilot-harness-evidence-graph/v1", runId, createdAt: "2026-08-18T00:00:00.000Z", redactionApplied: true, sourceCount: 1, nodeCount: 1, sources: [{ type: "source-project", input: `/fixtures/${runId}`, authority: "local", evidenceNodeCount: 1 }], nodes: [node] };
  graph.graphDigest = digest(graph);
  return graph;
}

function fixtureReasoning(decision, graph) {
  return {
    schema: "evopilot-harness-reasoning-result/v3",
    algorithmVersion: "fixture/v1",
    ontology: { id: "fixture", version: "1.0.0", digest: digest("ontology") },
    policy: { id: "fixture", version: "1.0.0", digest: digest("policy") },
    evidenceGraph: { runId: graph.runId, graphDigest: graph.graphDigest, nodeCount: graph.nodeCount },
    eligibility: { decision: "ELIGIBLE", evidenceIds: ["evidence-0001"] },
    decision,
    proposedProfile: { id: "fixture-profile", domain: "fixture", role: "fixture-engineering", taskClass: "engineering-task", positiveConcepts: ["executable-engineering"], negativeConcepts: [], evidenceKinds: ["source-code"] },
    confidence: 1,
    advisorRequired: false,
    humanApprovalRequired: true,
    candidates: [],
    rejectionReasons: [],
    evidenceIds: ["evidence-0001"],
    nextAction: "proposal-review"
  };
}

function fixtureAsset(kind, graph, reasoning) {
  if (kind === "EvaluationPack") {
    return buildEvaluationPackV3({ graph, reasoning, proposedAssets: [fixtureAsset("HarnessProfile", graph, reasoning)] });
  }
  const fixtureFiles = {
    HarnessComponent: "assets/v3/components/engineering-validation/asset.yaml",
    HarnessProfile: "assets/v3/profiles/observability-apm/1.2.0/asset.yaml",
    HarnessBundle: "assets/v3/bundles/observability-apm/1.2.0/asset.yaml",
    OntologyPack: "ontology/builtin/software-engineering.yaml",
    MatchPolicyPack: "policies/matcher/default.yaml",
    AdvisorPolicyPack: "policies/advisor/default.yaml"
  };
  const asset = readYaml(path.join(root, fixtureFiles[kind]));
  asset.metadata.id = `fixture-${kind.toLowerCase()}`;
  asset.metadata.version = "0.1.0";
  asset.metadata.lifecycle = "review";
  return asset;
}

function temporaryHome() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "evopilot-harness-v34-"));
  test.after(() => fs.rmSync(home, { recursive: true, force: true }));
  return home;
}

function runJson(args, { allowFailure = false } = {}) {
  const run = spawnSync(process.execPath, [cli, ...args], { cwd: root, encoding: "utf8" });
  assert.ok(run.stdout.trim(), run.stderr);
  const body = JSON.parse(run.stdout);
  if (!allowFailure) assert.equal(run.status, 0, JSON.stringify(body));
  return body;
}
