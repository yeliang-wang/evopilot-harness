import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createProposal } from "../src/v3/lifecycle.mjs";
import { loadKnowledge, professionalEvidenceGraph, reasonEvidence } from "../src/v3/reasoning.mjs";
import { digest, readYaml } from "../src/v3/utils.mjs";
import { initializeProfessionalFixture } from "./helpers/professional-supply.mjs";

const cache = "Distributed cache server key-value store TTL eviction failover. Build test validate release.";
const ambiguous = [
  ["database-product", "/* walk functions */ void *walk_iterator(void);"],
  ["database-product", "extstore_delete() informs the storage engine that an item was removed from its page."],
  ["api-gateway", "// can throw an error upstream.\nlua_call(L, 1, 1);"],
  ["language-service", "pthread_t manager_tid; // deallocation management thread"],
  ["management-software", "If you are reporting a security bug please contact a maintainer privately."],
  ["observability", "/* This could span two chunks of the buffer. */"],
  ["scheduler", "// Very basic scheduler for configuration callbacks.\nstatic void run_crons(void) { /* Fetch the cron table */ }"],
  ["scheduler", "P_DEBUG(\"running inline worker queue\");"]
];

function run(t, texts, { generic = false, sourceType = "source-project" } = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "harness-professional-support-"));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  initializeProfessionalFixture(home);
  const entries = [generic ? "Build test validate a reusable engineering tool." : cache, "build test validate", ...texts];
  const raw = {
    schema: "evopilot-harness-evidence-graph/v1", runId: "professional-support",
    createdAt: "2026-09-29T00:00:00.000Z", redactionApplied: true,
    sourceCount: 1, nodeCount: entries.length,
    sources: [{ type: sourceType, input: "/immutable/source", authority: "local", evidenceNodeCount: entries.length }],
    nodes: entries.map((excerpt, index) => ({
      evidenceId: `evidence-${String(index + 1).padStart(4, "0")}`, kind: index === 0 ? "architecture-document" : index === 1 ? "build-manifest" : "source-code",
      label: `primary-${index}.txt`, sourceType, sourceRef: `/immutable/source/primary-${index}.txt`,
      excerpt, excerptDigest: digest(excerpt), sourceDigest: digest(excerpt), snapshotRef: `/snapshot/${index}.txt`, authority: "local", redactionApplied: true
    }))
  };
  raw.graphDigest = digest(raw);
  const rawBytes = JSON.stringify(raw);
  const value = reasonEvidence(raw, home);
  assert.equal(JSON.stringify(raw), rawBytes);
  const view = professionalEvidenceGraph(value.graph, loadKnowledge(home).ontology);
  const before = JSON.stringify(value.graph);
  const runRoot = path.join(home, "evolution-runs", raw.runId);
  fs.mkdirSync(runRoot, { recursive: true });
  const created = createProposal({ home, runRoot, graph: value.graph, reasoning: value.result, advisor: { status: "SKIPPED", required: false, mode: "auto" } });
  assert.equal(JSON.stringify(value.graph), before);
  return { ...value, view, proposal: readYaml(created.proposalPath), raw };
}

for (const [index, [concept, text]] of ambiguous.entries()) {
  test(`primary implementation context ${index + 1} does not establish ${concept}`, t => {
    const { result, graph, view, proposal, raw } = run(t, [text]);
    assert.equal(result.decision, "EVOLVE_EXISTING");
    assert.equal(result.targetProfile.id, "distributed-cache-product");
    assert.ok(graph.nodes[2].concepts.includes(concept), "raw lexical evidence remains inspectable");
    assert.ok(!view.nodes[2].concepts.includes(concept));
    assert.ok(!result.candidates[0].novelConcepts.includes(concept));
    assert.ok(!proposal.proposedAssets[0].spec.match.positiveConcepts.includes(concept));
    const base = readYaml(path.resolve(import.meta.dirname, "../assets/v3/profiles/distributed-cache-product/asset.yaml"));
    const addedBoundary = proposal.proposedAssets[0].spec.boundary.inScope.filter(line => !base.spec.boundary.inScope.includes(line));
    assert.ok(!addedBoundary.some(line => line.includes(concept)));
    assert.ok(base.spec.boundary.inScope.every(line => proposal.proposedAssets[0].spec.boundary.inScope.includes(line)));
    assert.equal(graph.nodes.length, raw.nodes.length);
    for (const key of ["excerpt", "excerptDigest", "sourceDigest", "sourceRef", "snapshotRef"])
      assert.equal(graph.nodes[2][key], raw.nodes[2][key]);
    assert.equal(proposal.status, "REVIEW_REQUIRED", JSON.stringify(proposal.deltaClosure));
    assert.equal(proposal.humanApprovalRequired, true);
    assert.ok(proposal.blockers.includes("evaluation-review-required"));
  });
}

const genuine = [
  ["database-product", "This product is a database engine with SQL parser, query optimizer, transaction WAL and MVCC."],
  ["api-gateway", "The server provides an API gateway with reverse proxy and route policy."],
  ["language-service", "This application implements a Java service with REST controller and domain service."],
  ["scheduler", "The platform offers job scheduling and task dispatch for its users."],
  ["observability", "The service provides public observability with telemetry, tracing and metrics."],
  ["management-software", "The application provides an admin console with workflow approval and audit trail."]
];
for (const [concept, text] of genuine) {
  test(`explicit public responsibility preserves ${concept}`, t => {
    const { view } = run(t, [text]);
    assert.ok(view.nodes[2].concepts.includes(concept));
  });
}

test("uncorroborated lexical hits retain NEED_MORE_EVIDENCE instead of creating a professional Profile", t => {
  const { result, proposal } = run(t, ambiguous.map(([, text]) => text), { generic: true });
  assert.equal(result.decision, "NEED_MORE_EVIDENCE");
  assert.equal(proposal.proposedAssets.length, 0);
  assert.equal(proposal.status, "NEED_MORE_EVIDENCE");
});

test("same-file public capabilities survive beside unrelated implementation and negated claims", t => {
  const { view } = run(t, [
    "/* walk the buffer, manager_tid releases it. */\n\n" +
    "The server provides an API gateway with reverse proxy and route policy.\n\n" +
    "This service offers observability with metrics, tracing and telemetry.\n\n" +
    "This is not a database engine and does not provide SQL parser or MVCC."
  ]);
  assert.ok(view.nodes[2].concepts.includes("api-gateway"));
  assert.ok(view.nodes[2].concepts.includes("observability"));
  assert.ok(!view.nodes[2].concepts.includes("database-product"));
  assert.ok(!view.nodes[2].concepts.includes("language-service"));
});

test("professional attachments preserve attributable capabilities without Source path exceptions", t => {
  const { view } = run(t, [genuine[2][1]], { sourceType: "attachment" });
  assert.ok(view.nodes[2].concepts.includes("language-service"));
});

test("repository discussion inside a primary README cannot establish a management product", t => {
  const { view } = run(t, ["# Product\n\nThis is a distributed cache server.\n\n## Bug reports\n\nReporting and workflow approval are required by maintainers.\n\n## Features\n\nThe server provides observability with tracing and telemetry."]);
  assert.ok(!view.nodes[2].concepts.includes("management-software"));
  assert.ok(view.nodes[2].concepts.includes("observability"));
});

test("owned public responsibility supports phrase punctuation and carrier-noun variants", t => {
  const { view, result } = run(t, ["This product is a high-performance data structure server that primarily serves key/value workloads."], { generic: true });
  assert.ok(view.nodes[2].concepts.includes("distributed-cache"));
  assert.equal(result.targetProfile.id, "distributed-cache-product");
});

test("a borrowed public capability is not the Source's own professional responsibility", t => {
  const { view, result } = run(t, ["Our application uses an external database engine with SQL parser and query optimizer."], { generic: true });
  assert.ok(!view.nodes[2].concepts.includes("database-product"));
  assert.equal(result.decision, "NEED_MORE_EVIDENCE");
});
