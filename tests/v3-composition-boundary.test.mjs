import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { reasonEvidence } from "../src/v3/reasoning.mjs";
import { initializeProfessionalFixture } from "./helpers/professional-supply.mjs";

const cache = "Distributed cache server Redis-compatible key-value store TTL eviction persistence replication sharding migration failover. Build test validate release.";
const gateway = "API gateway reverse proxy route policy rate limit upstream ingress. Build test validate release.";

function run(t, files, { emptyCatalog = false } = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "harness-boundary-"));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  initializeProfessionalFixture(home);
  if (emptyCatalog) {
    for (const catalog of ["builtin", "organization"])
      fs.rmSync(path.join(home, "catalogs", catalog, "assets"), { recursive: true, force: true });
  }
  const graph = {
    runId: "boundary-fixture", sources: [{ type: "source-project", input: "/selected/examples/vendor" }],
    nodes: files.map(([label, excerpt, kind = "source-code"], index) => ({
      evidenceId: `case-${index}`, kind, label, excerpt,
      sourceType: "source-project", sourceRef: `/selected/examples/vendor/${label}`
    }))
  };
  const before = JSON.stringify(graph);
  const value = reasonEvidence(graph, home);
  assert.equal(JSON.stringify(graph), before);
  assert.equal(value.graph.nodes.length, graph.nodes.length);
  for (let i = 0; i < graph.nodes.length; i++) {
    assert.equal(value.graph.nodes[i].excerpt, graph.nodes[i].excerpt);
    assert.equal(value.graph.nodes[i].sourceRef, graph.nodes[i].sourceRef);
  }
  return value;
}

test("auxiliary gateway references cannot compose or extend a cache product boundary", (t) => {
  const files = [["package.json", "build test validate", "build-manifest"], ["README.md", cache, "architecture-document"], ["src/cache.js", cache]];
  for (const label of ["AGENTS.md", "deps/README.md", "deps/tool.py", "vendor/gateway.js", "tests/gateway.js", "examples/gateway.js"])
    files.push([label, gateway]);
  files.push(["MAINTAINERS.md", "Maintainers work at Oracle and MySQL."]);
  const { result } = run(t, files);
  assert.equal(result.decision, "EVOLVE_EXISTING");
  assert.equal(result.targetProfile.id, "distributed-cache-product");
  assert.ok(!result.candidates[0].novelConcepts.includes("api-gateway"));
  assert.ok(!result.candidates[0].novelConcepts.includes("database-product"));
  assert.deepEqual(result.candidates[0].evidenceIds, ["case-1", "case-2"]);
  assert.deepEqual(result.candidates.find((candidate) => candidate.id === "api-gateway")?.evidenceIds ?? [], []);
});

test("genuine gateway and cache responsibilities in one file still compose", (t) => {
  const { result } = run(t, [["package.json", "build test validate", "build-manifest"], ["src/server.js", `${gateway} ${cache}`], ["README.md", `${gateway} ${cache}`, "architecture-document"]]);
  assert.equal(result.decision, "COMPOSE_NEW_BUNDLE");
  assert.deepEqual(result.composeProfiles.map((profile) => profile.domain).sort(), ["api-gateway", "distributed-cache"]);
  assert.ok(result.evidenceIds.every((id) => ["case-1", "case-2"].includes(id)));
});

test("a small real secondary-domain module retains its professional evidence", (t) => {
  const files = [["package.json", "build test validate", "build-manifest"], ["src/gateway.js", gateway]];
  for (let i = 0; i < 40; i++) files.push([`src/cache-${i}.js`, cache]);
  const { result } = run(t, files);
  const candidate = result.candidates.find((item) => item.id === "api-gateway");
  assert.ok(candidate);
  assert.deepEqual(candidate.evidenceIds, ["case-1"]);
});

test("a selected project beneath examples or vendor is not treated as auxiliary", (t) => {
  const { result } = run(t, [["package.json", "build test validate", "build-manifest"], ["README.md", cache, "architecture-document"], ["src/server.js", cache]]);
  assert.equal(result.targetProfile.id, "distributed-cache-product");
  assert.deepEqual(result.candidates[0].evidenceIds, ["case-1", "case-2"]);
});

test("generic engineering nodes cannot crowd professional citations out of the bound", (t) => {
  const files = [["package.json", "build test validate", "build-manifest"]];
  for (let i = 0; i < 20; i++) files.push([`src/helper-${i}.js`, "Build test validate release reusable engineering."]);
  files.push(["src/cache.js", cache]);
  const { result } = run(t, files);
  assert.deepEqual(result.candidates.find((item) => item.id === "distributed-cache-product").evidenceIds, ["case-21"]);
});

test("auxiliary-only domain evidence requests more evidence without a professional proposal", (t) => {
  const { result } = run(t, [["package.json", "build test validate", "build-manifest"], ["src/helper.js", "Build test validate engineering tool"], ["deps/cache.js", cache], ["AGENTS.md", gateway]]);
  assert.equal(result.decision, "NEED_MORE_EVIDENCE");
  assert.equal(result.composeProfiles, undefined);
  assert.match(result.rejectionReasons.join(" "), /more discriminating evidence/);
});

test("an empty Catalog cannot turn auxiliary-only domains into an unclassified Profile", (t) => {
  const { result } = run(t, [["package.json", "build test validate", "build-manifest"], ["src/helper.js", "Build test validate engineering tool"], ["deps/cache.js", cache]], { emptyCatalog: true });
  assert.equal(result.candidates.length, 0);
  assert.equal(result.decision, "NEED_MORE_EVIDENCE");
});

test("an empty Catalog still permits a Profile for a genuinely evidenced domain", (t) => {
  const { result } = run(t, [["package.json", "build test validate", "build-manifest"], ["src/cache.js", cache]], { emptyCatalog: true });
  assert.equal(result.candidates.length, 0);
  assert.equal(result.decision, "PROPOSE_NEW_PROFILE");
  assert.equal(result.proposedProfile.domain, "distributed-cache");
});
