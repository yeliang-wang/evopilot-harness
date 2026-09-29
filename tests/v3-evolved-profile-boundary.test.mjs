import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createProposal } from "../src/v3/lifecycle.mjs";
import { reasonEvidence } from "../src/v3/reasoning.mjs";
import { digest, readYaml } from "../src/v3/utils.mjs";
import { initializeWorkspace } from "../src/v3/workspace.mjs";

const cache = "Distributed cache server Redis-compatible key-value store TTL eviction persistence replication sharding migration failover. Build test validate release.";
const auxiliary = "API gateway reverse proxy; code generation Java service; cron scheduler; MySQL database; enterprise management reporting.";

function draft(t, extra) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "harness-evolved-boundary-"));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  initializeWorkspace(home);
  const files = [["README.md", cache, "architecture-document"], ["src/cache.js", cache], ...extra];
  const raw = {
    schema: "evopilot-harness-evidence-graph/v1", runId: "evolved-boundary-fixture", createdAt: "2026-09-29T00:00:00.000Z",
    redactionApplied: true, sourceCount: 1, nodeCount: files.length,
    sources: [{ type: "source-project", input: "/selected/examples/vendor", authority: "local", evidenceNodeCount: files.length }],
    nodes: files.map(([label, excerpt, kind = "source-code", sourceType = "source-project"], i) => ({
      evidenceId: `evidence-${String(i + 1).padStart(4, "0")}`, kind, label, excerpt, sourceType,
      sourceRef: `/selected/examples/vendor/${label}`, authority: "local", redactionApplied: true,
      sourceDigest: digest(excerpt), excerptDigest: digest(excerpt), snapshotRef: `/immutable/evidence-${i}.txt`
    }))
  };
  raw.graphDigest = digest(raw);
  const { graph, result } = reasonEvidence(raw, home);
  assert.equal(result.decision, "EVOLVE_EXISTING");
  assert.equal(result.targetProfile.id, "distributed-cache-product");
  const before = JSON.stringify(graph), runRoot = path.join(home, "evolution-runs", graph.runId);
  fs.mkdirSync(runRoot, { recursive: true });
  const created = createProposal({ home, runRoot, graph, reasoning: result, advisor: { status: "SKIPPED", required: false, mode: "auto" } });
  assert.equal(created.status, "REVIEW_REQUIRED");
  assert.equal(JSON.stringify(graph), before);
  const proposal = readYaml(created.proposalPath);
  assert.equal(proposal.evidenceGraphDigest, graph.graphDigest);
  assert.equal(proposal.humanApprovalRequired, true);
  assert.ok(proposal.blockers.includes("evaluation-review-required"));
  return { asset: proposal.proposedAssets[0], graph, proposal };
}

function lacks(asset, concepts) {
  for (const concept of concepts) {
    assert.ok(!asset.spec.match.positiveConcepts.includes(concept), concept);
    assert.ok(!asset.spec.boundary.inScope.some(line => line.includes(concept)), concept);
  }
}

test("evolved Profile excludes auxiliary-only professional concepts from matching and boundary", t => {
  const { asset, graph } = draft(t, ["AGENTS.md", "deps/tool.py", "vendor/server.js", "tests/server.js", "examples/server.js", ".github/workflows/cron.yaml", "MAINTAINERS.md"].map(label => [label, auxiliary]));
  lacks(asset, ["api-gateway", "language-service", "scheduler", "database-product", "management-software"]);
  assert.equal(graph.nodes.length, 9);
  assert.ok(graph.nodes.slice(2).every(n => n.excerpt === auxiliary && n.concepts.includes("api-gateway")));
});

test("evolved Profile retains genuine primary-source professional additions", t => {
  const { asset } = draft(t, [["src/telemetry.js", "Prometheus metrics tracing observability"]]);
  assert.ok(asset.spec.match.positiveConcepts.includes("observability"));
  assert.ok(asset.spec.boundary.inScope.some(line => line.includes("observability")));
});

test("one primary file can establish multiple real capabilities in an evolved Profile", t => {
  const { asset } = draft(t, [["src/cache-control.js", `${cache} Prometheus metrics tracing observability cron scheduling.`]]);
  assert.ok(asset.spec.match.positiveConcepts.includes("observability"));
  assert.ok(asset.spec.match.positiveConcepts.includes("scheduler"));
});

test("primary path lookalikes and an auxiliary-named checkout parent remain professional", t => {
  const { asset } = draft(t, [["src/dependencies_manager.js", "Prometheus metrics tracing observability"]]);
  assert.ok(asset.spec.match.positiveConcepts.includes("observability"));
  assert.ok(asset.spec.match.positiveConcepts.includes("distributed-cache"));
});

test("non-project attachment evidence retains its professional concept behavior", t => {
  const { asset } = draft(t, [["examples/telemetry.md", "Prometheus metrics tracing observability", "attachment", "attachment"]]);
  assert.ok(asset.spec.match.positiveConcepts.includes("observability"));
});

test("draft creation preserves the complete graph including auxiliary nodes and digests", t => {
  const { graph, proposal } = draft(t, [["deps/observability.js", "Prometheus metrics tracing observability"]]);
  assert.equal(graph.nodeCount, 3);
  assert.equal(graph.nodes[2].label, "deps/observability.js");
  assert.ok(graph.nodes[2].concepts.includes("observability"));
  assert.equal(proposal.proposedAssets[0].provenance.sourceDigests.at(-1), graph.graphDigest);
  assert.ok(!proposal.proposedAssets[0].spec.match.positiveConcepts.includes("observability"));
  assert.ok(!proposal.proposedAssets[0].spec.boundary.inScope.some(line => line.startsWith("Validate evidence-backed") && line.includes("observability")));
});

test("evolved Profile preserves base concepts and excludes its negative concepts", t => {
  const { asset } = draft(t, [["src/cache.js", `${cache} Client library connection pool.`]]);
  for (const concept of ["distributed-cache", "executable-engineering"]) assert.ok(asset.spec.match.positiveConcepts.includes(concept));
  assert.ok(asset.spec.match.negativeConcepts.includes("redis-client"));
  assert.ok(!asset.spec.match.positiveConcepts.includes("redis-client"));
});
