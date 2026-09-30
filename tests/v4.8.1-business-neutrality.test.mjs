import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { initializeWorkspace } from "../src/v3/workspace.mjs";
import { discoverAssets } from "../src/v3/catalog.mjs";
import { collectEvidence, loadKnowledge, reasonEvidence } from "../src/v3/reasoning.mjs";
import { digest, readYaml, writeYaml } from "../src/v3/utils.mjs";

const root = path.resolve(import.meta.dirname, "..");
function workspace(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "harness-neutrality-"));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  initializeWorkspace(home);
  return home;
}
function graph(home, text) {
  return collectEvidence({ options: { note: [text, "Validate the documented public capability with independently collected test evidence."] } }, home).graph;
}
function externalKnowledge(home) {
  const source = path.join(root, "ontology/builtin/software-engineering.yaml");
  const document = readYaml(source);
  writeYaml(path.join(home, "ontology", "reviewed-test-knowledge.yaml"), document);
  return document;
}

test("fresh bootstrap has no business vocabulary or professional Built-in profiles", t => {
  const home = workspace(t);
  assert.equal(fs.existsSync(path.join(home, "ontology/builtin/software-engineering.yaml")), false);
  const knowledge = loadKnowledge(home);
  assert.equal(knowledge.ontologyFile, null);
  assert.deepEqual(knowledge.ontology.spec.concepts, []);
  assert.deepEqual(knowledge.ontology.spec.roles, []);
  const assets = discoverAssets([path.join(home, "catalogs/builtin/assets")]);
  assert.ok(assets.length > 0);
  assert.ok(assets.every(record => record.asset.kind === "HarnessComponent"));
});

test("no user vocabulary gives an honest gap without discarding independent Eligibility", t => {
  const home = workspace(t);
  const evidence = graph(home, "Build and test a distributed cache with key-value storage, ttl and eviction. Validate and benchmark its public capability.");
  const result = reasonEvidence(evidence, home).result;
  assert.equal(result.eligibility.decision, "ELIGIBLE");
  assert.equal(result.decision, "NEED_MORE_EVIDENCE");
  assert.equal(result.targetProfile, undefined);
  assert.equal(result.proposedProfile.positiveConcepts.includes("distributed-cache"), false);
});

test("explicit user-owned knowledge retains professional new-profile reasoning", t => {
  const home = workspace(t);
  const original = externalKnowledge(home);
  const evidence = graph(home, "Our product implements a distributed cache and a key-value store with ttl, eviction and failover. Build, test and validate the product.");
  const { result, knowledge } = reasonEvidence(evidence, home);
  assert.equal(digest(knowledge.ontology), digest(original));
  assert.equal(result.decision, "PROPOSE_NEW_PROFILE");
  assert.equal(result.proposedProfile.domain, "distributed-cache");
  assert.ok(result.proposedProfile.positiveConcepts.includes("distributed-cache"));
  assert.equal(result.humanApprovalRequired, true);
});

test("old Built-in and examples cannot regain authority through implicit lookup or aliases", t => {
  const home = workspace(t);
  for (const directory of ["builtin", "examples"]) {
    const file = path.join(home, "ontology", directory, "legacy.yaml");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.copyFileSync(path.join(root, "ontology/builtin/software-engineering.yaml"), file);
    fs.symlinkSync(file, path.join(home, "ontology", `${directory}-alias.yaml`));
  }
  assert.equal(loadKnowledge(home).ontologyFile, null);
});

test("reinitialization preserves existing published legacy Catalog bytes", t => {
  const home = workspace(t);
  const oldRoot = path.join(home, "catalogs/builtin/assets/profiles/retained");
  fs.mkdirSync(oldRoot, { recursive: true });
  const source = path.join(root, "assets/v3/profiles/distributed-cache-product/asset.yaml");
  fs.copyFileSync(source, path.join(oldRoot, "asset.yaml"));
  const catalog = path.join(home, "catalogs/builtin/CATALOG.md");
  const before = fs.readFileSync(catalog);
  initializeWorkspace(home, { force: true });
  assert.deepEqual(fs.readFileSync(catalog), before);
  assert.deepEqual(fs.readFileSync(path.join(oldRoot, "asset.yaml")), fs.readFileSync(source));
  externalKnowledge(home);
  const result = reasonEvidence(graph(home, "Our product implements a distributed cache with ttl and eviction. Build and test this key-value store."), home).result;
  assert.equal(result.decision, "PROPOSE_NEW_PROFILE");
  assert.deepEqual(result.candidates, []);
});

test("renamed user declarations retain reasoning without Engine business labels", t => {
  const home = workspace(t);
  const ontology = externalKnowledge(home);
  ontology.metadata.id = "user-owned-vocabulary";
  ontology.spec.concepts = [{ id: "lunar-widget", terms: ["lunar widget", "spectral assembly"] }, { id: "executable-engineering", terms: ["build", "test", "validate"] }];
  ontology.spec.roles = [{ id: "spectral-producer", domain: "lunar-widget", taskClass: "product-engineering", concepts: ["lunar-widget", "executable-engineering"] }];
  writeYaml(path.join(home, "ontology/reviewed-test-knowledge.yaml"), ontology);
  const result = reasonEvidence(graph(home, "Our product implements a lunar widget with spectral assembly. Build, test and validate its public capability."), home).result;
  assert.equal(result.decision, "PROPOSE_NEW_PROFILE");
  assert.equal(result.proposedProfile.domain, "lunar-widget");
  assert.equal(result.proposedProfile.role, "spectral-producer");
});

test("explicit paths cannot activate packaged examples, legacy Built-ins or their aliases", t => {
  const home = workspace(t);
  const builtin = path.join(home, "ontology/builtin/legacy.yaml");
  fs.mkdirSync(path.dirname(builtin), { recursive: true });
  fs.copyFileSync(path.join(root, "ontology/builtin/software-engineering.yaml"), builtin);
  const alias = path.join(home, "legacy-alias.yaml");
  fs.symlinkSync(builtin, alias);
  for (const ontologyFile of [builtin, alias, path.join(root, "eval/v3/asset-fixtures/ontology.yaml")]) {
    assert.throws(() => loadKnowledge(home, { ontologyFile }), /not user-owned producer authority/);
  }
});

test("invalid or unpublished user knowledge cannot become producer authority", t => {
  const home = workspace(t);
  const ontology = externalKnowledge(home);
  const file = path.join(home, "ontology/reviewed-test-knowledge.yaml");
  ontology.metadata.lifecycle = "approved";
  writeYaml(file, ontology);
  assert.equal(loadKnowledge(home).ontologyFile, null);
  assert.throws(() => loadKnowledge(home, { ontologyFile: file }), /valid published OntologyPack/);
  ontology.metadata.lifecycle = "published";
  ontology.spec.execute = "not-an-allowed-declarative-field";
  writeYaml(file, ontology);
  assert.throws(() => loadKnowledge(home), /valid published OntologyPack/);
});
