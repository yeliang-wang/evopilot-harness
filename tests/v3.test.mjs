import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { spawn, spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { DEFAULT_ADVISOR_TIMEOUT_MS, DEFAULT_DOCTOR_TIMEOUT_MS, projectAdvisorEvidence } from "../src/v3/advisor.mjs";

const root = path.resolve(import.meta.dirname, "..");
const cli = path.join(root, "src/index.mjs");

test("Advisor and doctor use separate production defaults", () => {
  assert.equal(DEFAULT_ADVISOR_TIMEOUT_MS, 180_000);
  assert.equal(DEFAULT_DOCTOR_TIMEOUT_MS, 60_000);
});

test("Advisor evidence projection is deterministic, bounded, and source-diverse", () => {
  const sources = ["/corpus/alpha", "/corpus/beta", "/corpus/gamma"].map((input) => ({ type: "source-project", input }));
  const nodes = Array.from({ length: 180 }, (_, index) => {
    const source = sources[index % sources.length].input;
    return {
      evidenceId: `evidence-${String(index + 1).padStart(4, "0")}`,
      kind: index % 7 === 0 ? "build-manifest" : "source-code",
      label: `file-${index}.txt`,
      sourceType: "source-project",
      sourceRef: `${source}/file-${index}.txt`,
      concepts: index % 5 === 0 ? ["database-product"] : ["executable-engineering"],
      excerpt: "x".repeat(4000)
    };
  });
  const graph = { graphDigest: "sha256:graph", sources, nodes };
  const reasoning = { evidenceIds: ["evidence-0179", "evidence-0180"] };
  const policy = { spec: { outputContract: { evidenceProjection: {
    algorithm: "reasoning-source-kind-round-robin/v1",
    maxNodes: 12,
    maxCharacters: 12_000,
    maxExcerptCharacters: 1000
  } } } };

  const first = projectAdvisorEvidence(graph, reasoning, policy);
  const second = projectAdvisorEvidence(graph, reasoning, policy);
  assert.equal(first.summary.selectedNodeCount, 12);
  assert.equal(first.summary.omittedNodeCount, 168);
  assert.equal(first.summary.selectedCharacterCount, 12_000);
  assert.equal(first.summary.selectedSourceCount, 3);
  assert.deepEqual(first.summary.selectedEvidenceIds.slice(0, 2), reasoning.evidenceIds);
  assert.equal(first.summary.projectionDigest, second.summary.projectionDigest);
  assert.ok(first.nodes.every((node) => node.excerpt.length <= 1000));
  assert.ok(first.nodes.every((node) => !Object.hasOwn(node, "sourceRef")));
});

test("v3 workspace keeps the Engine read-only and installs complete versioned bootstrap assets", () => {
  const home = temporaryHome();
  const engineBefore = treeDigest(path.join(root, "src"));
  const result = runJson(["workspace", "init", "--workspace", home, "--json"]);
  assert.equal(result.status, "READY");
  assert.equal(result.engine.mode, "read-only");
  assert.equal(result.engine.mutationAllowed, false);
  assert.equal(typeof result.engine.filesystemWritable, "boolean");
  assert.equal(result.workspace.writable, true);
  assert.equal(treeDigest(path.join(root, "src")), engineBefore);

  const assets = runJson(["asset", "v3-validate", "--workspace", home, "--json"]);
  assert.equal(assets.status, "VALIDATED");
  assert.ok(assets.kindCounts.HarnessComponent >= 1);
  assert.ok(assets.kindCounts.HarnessProfile >= 10);
  assert.ok(assets.kindCounts.HarnessBundle >= 10);
  assert.ok(assets.referenceChecks.every((check) => check.status === "PASS"));

  const catalog = runJson(["catalog", "v3-validate", "--workspace", home, "--source", path.join(home, "catalogs/builtin"), "--json"]);
  assert.equal(catalog.status, "VALIDATED");
  const registry = runJson(["registry", "v3-validate", "--workspace", home, "--json"]);
  assert.equal(registry.status, "VALIDATED");
});

test("v3 formal schemas reject incomplete assets and validate governance packs", () => {
  const home = initializedHome();
  const valid = runJson(["asset", "v3-validate", "--workspace", home, "--source", path.join(root, "assets/v3"), "--json"]);
  assert.equal(valid.status, "VALIDATED");

  const invalid = path.join(home, "invalid.yaml");
  fs.writeFileSync(invalid, "apiVersion: harness.evopilot.io/v3\nkind: HarnessComponent\nmetadata: {}\nspec: {}\n");
  const run = runJsonFailure(["ontology", "validate", "--workspace", home, "--file", invalid, "--json"]);
  assert.equal(run.status, "FAILED");

  const ontology = runJson(["ontology", "validate", "--workspace", home, "--json"]);
  assert.equal(ontology.status, "VALIDATED");
  const matcher = runJson(["policy", "validate", "--workspace", home, "--type", "matcher", "--json"]);
  assert.equal(matcher.status, "VALIDATED");
  const advisor = runJson(["policy", "validate", "--workspace", home, "--type", "advisor", "--json"]);
  assert.equal(advisor.status, "VALIDATED");
});

test("v2 migration is non-mutating, validates 9 templates, and rolls back from its journal", () => {
  const home = initializedHome();
  const sourceBefore = treeDigest(path.join(root, "harnesses"));
  const plan = runJson(["migrate", "v2-to-v3", "--workspace", home, "--source", path.join(root, "harnesses"), "--json"]);
  assert.equal(plan.status, "READY");
  assert.equal(plan.templateCount, 9);
  assert.equal(plan.assetCount, 18);
  assert.equal(plan.sourceMutated, false);

  const applied = runJson(["migrate", "v2-to-v3", "--workspace", home, "--source", path.join(root, "harnesses"), "--apply", "--json"]);
  assert.equal(applied.status, "MIGRATED");
  assert.equal(applied.createdAssetCount, 18);
  assert.match(applied.migrationId, /^v2-to-v3-[a-z0-9-]+$/);
  assert.equal(path.basename(applied.journalFile), `${applied.migrationId}.json`);
  assert.equal(treeDigest(path.join(root, "harnesses")), sourceBefore);
  const rollback = runJson(["migrate", "rollback", applied.migrationId, "--workspace", home, "--json"]);
  assert.equal(rollback.status, "ROLLED_BACK");
  assert.ok(rollback.removedCount >= 18);
  assert.equal(treeDigest(path.join(root, "harnesses")), sourceBefore);
  const escaped = runJsonFailure(["migrate", "rollback", "../outside", "--workspace", home, "--json"]);
  assert.match(escaped.error, /journal id .* invalid/i);
});

test("Redis client evidence proposes a new Profile instead of evolving a distributed-cache product", () => {
  const home = initializedHome();
  const project = createRedisClient(path.join(home, "fixtures/redisclient"));
  const result = runJsonFailure(["produce", "--workspace", home, "--source-project", project, "--goal", "Produce a reusable engineering Harness asset.", "--advisor", "off", "--json"]);
  assert.equal(result.status, "BLOCKED");
  assert.equal(result.reasoning.eligibility.decision, "ELIGIBLE");
  assert.equal(result.reasoning.decision, "PROPOSE_NEW_PROFILE");
  assert.equal(result.reasoning.proposedProfile.domain, "redis-client");
  assert.equal(result.reasoning.proposedProfile.role, "redis-client-library");
  assert.equal(result.reasoning.proposedProfile.taskClass, "library-engineering");
  assert.ok(result.reasoning.proposedProfile.negativeConcepts.includes("distributed-cache"));
  assert.match(result.reasoning.rejectionReasons[0], /no published HarnessProfile|strong negative boundary conflict/i);
  assert.equal(result.proposal.proposedAssets[0].id, "redis-client-profile");
  assert.ok(result.proposal.blockers.includes("policy-required-advisor-review-missing"));
  assert.ok(result.proposal.blockers.includes("new-profile-evaluation-review-required"));
  assert.ok(result.reasoning.evidenceIds.every((id) => /^evidence-\d{4}$/.test(id)));
  assert.equal(result.proposal.evaluationStatus, "INSUFFICIENT_EVAL_EVIDENCE");
  const proposal = runJson(["proposal", "review", result.runId, "--workspace", home, "--json"]);
  const profile = proposal.proposedAssets[0];
  assert.equal(profile.spec.classification.domain, "redis-client");
  assert.equal(profile.spec.classification.role, "redis-client-library");
  assert.equal(profile.spec.classification.taskClass, "library-engineering");
  assert.ok(profile.spec.match.negativeConcepts.includes("distributed-cache"));
  assert.ok(profile.spec.boundary.outOfScope.some((item) => item.includes("distributed-cache")));
  assert.ok(profile.spec.acceptance.requiredEvidence.includes("build-manifest-snapshot"));
  assert.ok(profile.spec.acceptance.blockingValidators.includes("domain-boundary-conflict"));
});

test("existing Profile evolution adds evidence-backed contract coverage instead of only bumping metadata", () => {
  const home = initializedHome();
  const project = createDistributedCacheProduct(path.join(home, "fixtures/distributed-cache"));
  const result = runJson(["produce", "--workspace", home, "--source-project", project, "--goal", "Evolve the reusable distributed cache product Harness asset.", "--advisor", "off", "--json"]);
  assert.equal(result.reasoning.decision, "EVOLVE_EXISTING");
  assert.equal(result.reasoning.targetProfile.id, "distributed-cache-product");
  const proposal = runJson(["proposal", "review", result.runId, "--workspace", home, "--json"]);
  const profile = proposal.proposedAssets[0];
  assert.equal(profile.metadata.version, "1.0.1");
  assert.ok(profile.spec.match.requiredEvidenceKinds.includes("architecture-document"));
  assert.ok(profile.spec.acceptance.requiredEvidence.includes("architecture-boundary-review"));
  assert.ok(profile.spec.acceptance.blockingValidators.includes("evidence-citation-closure"));
  assert.ok(profile.provenance.sourceDigests.includes(result.evidenceGraph.digest));
});

test("shared executable-engineering evidence never assigns an arbitrary domain role", () => {
  const home = initializedHome();
  const project = createGenericEngineeringTool(path.join(home, "fixtures/generic-tool"));
  const result = runJsonFailure(["produce", "--workspace", home, "--source-project", project, "--goal", "Produce a reusable engineering Harness asset.", "--advisor", "off", "--json"]);
  assert.equal(result.reasoning.decision, "PROPOSE_NEW_PROFILE");
  assert.equal(result.reasoning.proposedProfile.domain, "unclassified-engineering");
  assert.equal(result.reasoning.proposedProfile.role, "unclassified-engineering");
  assert.equal(result.reasoning.proposedProfile.positiveConcepts.length, 1);
  assert.equal(result.reasoning.proposedProfile.positiveConcepts[0], "executable-engineering");
});

test("policy-required GLM Advisor cites evidence but cannot approve; human approval publishes the Profile", async (t) => {
  const home = initializedHome();
  const project = createRedisClient(path.join(home, "fixtures/redisclient"));
  const requests = [];
  const server = http.createServer((request, response) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      requests.push({ authorization: request.headers.authorization, body: Buffer.concat(chunks).toString("utf8") });
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({
        model: "glm-5.1",
        choices: [{ message: { content: JSON.stringify({
          recommendation: "PROPOSE_NEW_PROFILE",
          rationale: "The evidence describes a client library rather than a cache server product.",
          evidenceIds: ["evidence-0001"],
          risks: ["Review the client/server boundary."],
          proposedDeltas: ["Add a redis-client Ontology role and Profile proposal."]
        }) } }],
        usage: { prompt_tokens: 21, completion_tokens: 9, total_tokens: 30 }
      }));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const modelsFile = path.join(home, "models.json");
  fs.writeFileSync(modelsFile, JSON.stringify({ models: [{ id: "glm-5.1", name: "EvoPilot GLM", vendor: "zhipu", apiKey: "test-secret", url: `http://127.0.0.1:${server.address().port}/v4` }] }));

  const produced = await runJsonAsync(["produce", "--workspace", home, "--source-project", project, "--goal", "Produce a reusable Harness asset.", "--models-file", modelsFile, "--json"]);
  assert.equal(produced.advisor.status, "SUCCEEDED");
  assert.equal(produced.advisor.required, true);
  assert.equal(produced.advisor.mode, "auto");
  assert.equal(produced.advisor.usage.totalTokens, 30);
  assert.equal(produced.advisor.evidenceProjection.selectedNodeCount, produced.advisor.evidenceProjection.totalNodeCount);
  assert.equal(produced.advisor.evidenceProjection.omittedNodeCount, 0);
  assert.ok(fs.existsSync(produced.advisor.resultPath));
  assert.equal(produced.reasoning.decision, "PROPOSE_NEW_PROFILE");
  assert.equal(produced.proposal.blockers.length, 1);
  assert.equal(produced.proposal.blockers[0], "new-profile-evaluation-review-required");
  assert.equal(requests.length, 1);
  assert.equal(requests[0].authorization, "Bearer test-secret");
  assert.match(requests[0].body, /evidence-0001/);
  assert.doesNotMatch(JSON.stringify(produced), /test-secret/);
  const proposal = runJson(["proposal", "review", produced.runId, "--workspace", home, "--json"]);
  assert.equal(proposal.proposedAssets[0].provenance.advisorRunDigest, produced.advisor.responseDigest);

  const approved = runJson(["proposal", "approve", produced.runId, "--workspace", home, "--confirmed-by", "admin@example.com", "--confirmation", "Reviewed evidence, reasoning, Advisor citations, Profile boundary, and evaluation case.", "--evaluation-reviewed", "--json"]);
  assert.equal(approved.status, "APPROVED");
  assert.equal(approved.evaluationStatus, "READY");
  const published = runJson(["proposal", "publish", produced.runId, "--workspace", home, "--json"]);
  assert.equal(published.status, "PUBLISHED");
  assert.ok(published.assets.some((asset) => asset.id === "redis-client-profile"));
  assert.equal(published.catalog.status, "PUBLISHED");
  const catalog = runJson(["catalog", "v3-validate", "--workspace", home, "--json"]);
  assert.equal(catalog.status, "VALIDATED");
});

test("a required Advisor transport failure remains review-blocking and never changes the deterministic decision", async () => {
  const home = initializedHome();
  const project = createRedisClient(path.join(home, "fixtures/redisclient"));
  const modelsFile = path.join(home, "models.json");
  fs.writeFileSync(modelsFile, JSON.stringify({ models: [{ id: "glm-5.1", name: "EvoPilot GLM", vendor: "zhipu", apiKey: "unreachable-secret", url: "http://127.0.0.1:1/v4" }] }));
  const result = await runJsonAsyncFailure(["produce", "--workspace", home, "--source-project", project, "--goal", "Produce a reusable Harness asset.", "--models-file", modelsFile, "--advisor-timeout-ms", "500", "--json"]);
  assert.equal(result.status, "BLOCKED");
  assert.equal(result.reasoning.decision, "PROPOSE_NEW_PROFILE");
  assert.equal(result.advisor.status, "FAILED");
  assert.equal(result.advisor.required, true);
  assert.equal(result.advisor.failureType, "TRANSPORT_ERROR");
  assert.match(result.advisor.reason, /fetch failed/i);
  assert.ok(fs.existsSync(result.advisor.resultPath));
  assert.ok(result.proposal.blockers.includes("policy-required-advisor-review-missing"));
  assert.equal(result.nextAction, "repair-advisor-and-rerun");
  assert.doesNotMatch(JSON.stringify(result), /unreachable-secret/);
});

test("Advisor performs one policy-bounded contract repair and records both attempts", async (t) => {
  const home = initializedHome();
  const project = createRedisClient(path.join(home, "fixtures/redisclient"));
  let attempt = 0;
  const requests = [];
  const server = http.createServer((request, response) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      const body = Buffer.concat(chunks).toString("utf8");
      requests.push(body);
      attempt += 1;
      const content = {
        recommendation: "PROPOSE_NEW_PROFILE",
        rationale: "The cited evidence supports a bounded Profile proposal.",
        evidenceIds: [attempt === 1 ? "evidence-0001X" : "evidence-0001"],
        risks: ["Human review remains required."],
        proposedDeltas: ["Review the proposed Profile boundary."]
      };
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({
        choices: [{ message: { content: JSON.stringify(content) } }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }
      }));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const modelsFile = path.join(home, "models.json");
  fs.writeFileSync(modelsFile, JSON.stringify({ models: [{ id: "glm-5.1", name: "EvoPilot GLM", vendor: "zhipu", apiKey: "repair-secret", url: `http://127.0.0.1:${server.address().port}/v4` }] }));

  const result = await runJsonAsync(["produce", "--workspace", home, "--source-project", project, "--goal", "Produce a reusable Harness asset.", "--advisor", "required", "--models-file", modelsFile, "--json"]);
  assert.equal(result.status, "REVIEW_REQUIRED");
  assert.equal(result.advisor.status, "SUCCEEDED");
  assert.equal(result.advisor.attemptCount, 2);
  assert.equal(result.advisor.repairAttempted, true);
  assert.equal(result.advisor.attempts[0].failureType, "CONTRACT_REJECTED");
  assert.equal(result.advisor.attempts[1].status, "SUCCEEDED");
  assert.equal(result.advisor.usage.totalTokens, 30);
  assert.match(requests[1], /allowedEvidenceIds/);
  assert.match(requests[1], /evidence-0001X/);
  assert.doesNotMatch(JSON.stringify(result), /repair-secret/);
});

test("Advisor remains BLOCKED when the bounded repair also violates citations", async (t) => {
  const home = initializedHome();
  const project = createRedisClient(path.join(home, "fixtures/redisclient"));
  const service = await createModelService(t, { evidenceId: "evidence-9999" });
  const modelsFile = path.join(home, "models.json");
  fs.writeFileSync(modelsFile, JSON.stringify({ models: [{ id: "glm-5.1", name: "EvoPilot GLM", vendor: "zhipu", apiKey: "rejected-secret", url: service.url }] }));

  const result = await runJsonAsyncFailure(["produce", "--workspace", home, "--source-project", project, "--goal", "Produce a reusable Harness asset.", "--advisor", "required", "--models-file", modelsFile, "--json"]);
  assert.equal(result.status, "BLOCKED");
  assert.equal(result.advisor.status, "REJECTED");
  assert.equal(result.advisor.attemptCount, 2);
  assert.equal(result.advisor.repairAttempted, true);
  assert.ok(result.advisor.attempts.every((item) => item.failureType === "CONTRACT_REJECTED"));
  assert.equal(service.requests.length, 2);
  assert.equal(result.nextAction, "repair-advisor-and-rerun");
  assert.doesNotMatch(JSON.stringify(result), /rejected-secret/);
});

test("models inspection is configuration-only and llm v3-doctor proves live connectivity", async (t) => {
  const home = initializedHome();
  const service = await createModelService(t);
  const modelsFile = path.join(home, "models.json");
  fs.writeFileSync(modelsFile, JSON.stringify({ models: [{ id: "glm-5.1", name: "EvoPilot GLM", vendor: "zhipu", apiKey: "doctor-secret", url: service.url }] }));

  const models = runJson(["llm", "v3-models", "--workspace", home, "--models-file", modelsFile, "--json"]);
  assert.equal(models.status, "READY");
  assert.equal(models.readinessScope, "CONFIGURATION_ONLY");
  assert.equal(models.connectionVerified, false);
  assert.equal(models.nextAction, "llm-v3-doctor");

  const doctor = await runJsonAsync(["llm", "v3-doctor", "--workspace", home, "--models-file", modelsFile, "--json"]);
  assert.equal(doctor.status, "READY");
  assert.equal(doctor.readinessScope, "LIVE_CONNECTIVITY");
  assert.equal(doctor.connectionVerified, true);
  assert.equal(doctor.usage.totalTokens, 3);
  assert.doesNotMatch(JSON.stringify(doctor), /doctor-secret/);
});

test("attachments, logs, notes, and GitHub repositories share the Advisor Run Contract", async (t) => {
  const home = initializedHome();
  const service = await createModelService(t);
  const modelsFile = path.join(home, "models.json");
  fs.writeFileSync(modelsFile, JSON.stringify({ models: [{ id: "glm-5.1", name: "EvoPilot GLM", vendor: "zhipu", apiKey: "cross-source-secret", url: service.url }] }));
  const attachment = path.join(home, "input.txt");
  const log = path.join(home, "production.log");
  fs.writeFileSync(attachment, "Architecture and build test plan for a repeatable migration validator.");
  fs.writeFileSync(log, "authorization: Bearer live-secret\nvalidate migrate rollback failed request=42\n");
  const material = await runJsonAsync(["produce", "--workspace", home, "--attachment", attachment, "--production-log", log, "--note", "Review a reusable migration validation task.", "--advisor", "required", "--models-file", modelsFile, "--json"]);
  const graph = JSON.parse(fs.readFileSync(material.evidenceGraph.path, "utf8"));
  assert.ok(graph.sources.some((source) => source.type === "attachment"));
  assert.ok(graph.sources.some((source) => source.type === "runtime-log"));
  assert.ok(graph.sources.some((source) => source.type === "operator-note"));
  assert.doesNotMatch(JSON.stringify(graph), /live-secret/);
  assert.match(JSON.stringify(graph), /\[REDACTED\]/);
  assert.equal(material.advisor.status, "SUCCEEDED");
  assert.ok(fs.existsSync(material.advisor.resultPath));

  const repository = createGitRepository(path.join(home, "fixtures/github-source"));
  const github = await runJsonAsync(["produce", "--workspace", home, "--github-repo", pathToFileURL(repository).href, "--github-ref", "main", "--goal", "Produce a reusable Harness asset.", "--advisor", "required", "--models-file", modelsFile, "--json"]);
  const githubGraph = JSON.parse(fs.readFileSync(github.evidenceGraph.path, "utf8"));
  assert.ok(githubGraph.sources.some((source) => source.type === "github-repository" && /^[a-f0-9]{40}$/.test(source.github.resolvedCommit)));
  assert.equal(github.advisor.status, "SUCCEEDED");
  assert.equal(github.advisor.schema, material.advisor.schema);
  assert.doesNotMatch(JSON.stringify([material, github]), /cross-source-secret/);
});

test("source-root production deduplicates, groups, and returns successful Advisor runs", async (t) => {
  const home = initializedHome();
  const service = await createModelService(t);
  const modelsFile = path.join(home, "models.json");
  fs.writeFileSync(modelsFile, JSON.stringify({ models: [{ id: "glm-5.1", name: "EvoPilot GLM", vendor: "zhipu", apiKey: "corpus-secret", url: service.url }] }));
  const corpus = path.join(home, "corpus");
  createRedisClient(path.join(corpus, "redisclient"));
  const parent = path.join(corpus, "scheduler-platform");
  fs.mkdirSync(path.join(parent, "module-a"), { recursive: true });
  fs.writeFileSync(path.join(parent, "package.json"), JSON.stringify({ name: "scheduler-platform", scripts: { test: "node test.js" } }));
  fs.writeFileSync(path.join(parent, "README.md"), "Scheduler task dispatch worker queue build test rollback.");
  fs.writeFileSync(path.join(parent, "module-a", "package.json"), JSON.stringify({ name: "module-a" }));

  const result = await runJsonAsync(["produce", "--workspace", home, "--source-root", corpus, "--goal", "Produce reusable Harness assets from this corpus.", "--advisor", "required", "--models-file", modelsFile, "--json"]);
  assert.equal(result.status, "REVIEW_REQUIRED");
  assert.equal(result.discoveredProjectCount, 2);
  assert.equal(result.groupCount, 2);
  assert.equal(result.proposals.length, result.groupCount);
  assert.equal(new Set(result.proposals.map((proposal) => proposal.groupId)).size, result.groupCount);
  assert.ok(result.proposals.every((proposal) => proposal.projects.length === 1));
  assert.ok(result.groups.some((group) => group.proposedProfile?.role === "redis-client-library"));
  assert.ok(result.groups.some((group) => group.proposedProfile?.role === "scheduler-platform"));
  assert.ok(result.runs.every((run) => run.reasoning.schema === "evopilot-harness-reasoning-result/v3"));
  assert.equal(result.advisorSummary.runCount, 2);
  assert.equal(result.advisorSummary.succeededCount, 2);
  assert.equal(result.advisorSummary.failedCount, 0);
  assert.ok(result.proposals.every((proposal) => proposal.advisor.status === "SUCCEEDED"));
  assert.ok(result.proposals.every((proposal) => fs.existsSync(proposal.advisor.resultPath)));
  assert.doesNotMatch(JSON.stringify(result), /corpus-secret/);
});

test("source-root required Advisor failures are persisted and aggregate to BLOCKED", async () => {
  const home = initializedHome();
  const modelsFile = path.join(home, "models.json");
  fs.writeFileSync(modelsFile, JSON.stringify({ models: [{ id: "glm-5.1", name: "EvoPilot GLM", vendor: "zhipu", apiKey: "failed-corpus-secret", url: "http://127.0.0.1:1/v4" }] }));
  const corpus = path.join(home, "corpus");
  createRedisClient(path.join(corpus, "redisclient"));
  createGenericEngineeringTool(path.join(corpus, "engineering-tool"));

  const result = await runJsonAsyncFailure(["produce", "--workspace", home, "--source-root", corpus, "--goal", "Produce reusable Harness assets from this corpus.", "--advisor", "required", "--models-file", modelsFile, "--advisor-timeout-ms", "500", "--json"]);
  assert.equal(result.status, "BLOCKED");
  assert.equal(result.nextAction, "repair-advisor-and-rerun");
  assert.equal(result.advisorSummary.failedCount, result.groupCount);
  assert.ok(result.proposals.every((proposal) => proposal.status === "BLOCKED"));
  assert.ok(result.proposals.every((proposal) => proposal.advisor.failureType === "TRANSPORT_ERROR"));
  assert.ok(result.proposals.every((proposal) => fs.existsSync(proposal.advisor.resultPath)));
  assert.ok(result.proposals.every((proposal) => proposal.blockers.includes("policy-required-advisor-review-missing")));
  assert.doesNotMatch(JSON.stringify(result), /failed-corpus-secret/);
});

test("Catalog and Registry support Ed25519 signatures and reject tampering", () => {
  const home = initializedHome();
  const keys = runJson(["keys", "generate", "--workspace", home, "--json"]);
  const catalogFile = path.join(home, "catalogs/builtin/CATALOG.md");
  const signed = runJson(["catalog", "v3-sign", "--workspace", home, "--source", path.join(home, "catalogs/builtin"), "--private-key", keys.privateKeyFile, "--json"]);
  assert.equal(signed.status, "SIGNED");
  const verified = runJson(["catalog", "v3-verify", "--workspace", home, "--source", path.join(home, "catalogs/builtin"), "--public-key", keys.publicKeyFile, "--json"]);
  assert.equal(verified.status, "VERIFIED");
  fs.appendFileSync(catalogFile, "\nmodified\n");
  const failed = runJsonFailure(["catalog", "v3-verify", "--workspace", home, "--source", path.join(home, "catalogs/builtin"), "--public-key", keys.publicKeyFile, "--json"]);
  assert.equal(failed.status, "FAILED");
  assert.equal(failed.digestMatches, false);
});

test("v3 evaluation is explicit about contract coverage and insufficient accuracy evidence", () => {
  const home = initializedHome();
  const result = runJson(["eval", "v3-run", "--workspace", home, "--json"]);
  assert.equal(result.status, "PASSED");
  assert.ok(result.caseCount >= 5);
  assert.equal(result.failedCount, 0);
  assert.equal(result.accuracyClaim, "INSUFFICIENT_EVAL_EVIDENCE");
  assert.match(result.note, /does not establish open-domain matching accuracy/);
});

test("Harness Hub v3 snapshot exposes assets, proposals, governance packs, evaluation, and LLM usage", () => {
  const home = initializedHome();
  const out = path.join(home, "hub.json");
  const result = runJson(["hub", "v3-snapshot", "--workspace", home, "--out", out, "--json"]);
  assert.equal(result.schema, "evopilot-harness-hub-snapshot/v3");
  assert.equal(result.status, "READY");
  assert.ok(result.assetCounts.HarnessComponent >= 1);
  assert.ok(result.assetCounts.HarnessProfile >= 10);
  assert.ok(result.governancePacks.some((pack) => pack.kind === "OntologyPack"));
  assert.ok(result.governancePacks.some((pack) => pack.kind === "MatchPolicyPack"));
  assert.ok(result.governancePacks.some((pack) => pack.kind === "AdvisorPolicyPack"));
  assert.equal(result.evaluation.packCount, 0);
  assert.equal(result.llmUsage.totalTokens, 0);
  assert.ok(fs.existsSync(out));
});

function initializedHome() {
  const home = temporaryHome();
  runJson(["workspace", "init", "--workspace", home, "--json"]);
  return home;
}

function temporaryHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "evopilot-harness-v3-test-"));
}

function createRedisClient(project) {
  fs.mkdirSync(path.join(project, "src/main/java/example"), { recursive: true });
  fs.writeFileSync(path.join(project, "pom.xml"), "<project><dependencies><dependency><groupId>org.springframework.data</groupId><artifactId>spring-data-redis</artifactId></dependency><dependency><groupId>redis.clients</groupId><artifactId>jedis</artifactId></dependency></dependencies></project>");
  fs.writeFileSync(path.join(project, "src/main/java/example/RedisClient.java"), "import org.springframework.data.redis.core.RedisTemplate; import redis.clients.jedis.Jedis; class RedisClient { RedisTemplate template; Jedis client; }");
  fs.writeFileSync(path.join(project, "README.md"), "Redis client library connection factory serializer wrapper. Build test validate release.");
  return project;
}

function createDistributedCacheProduct(project) {
  fs.mkdirSync(path.join(project, "src"), { recursive: true });
  fs.writeFileSync(path.join(project, "package.json"), JSON.stringify({ name: "distributed-cache-product", scripts: { build: "node build.js", test: "node test.js" } }));
  fs.writeFileSync(path.join(project, "src/server.js"), "// Distributed cache server protocol, key-value store, TTL, eviction, hash slots, persistence, replication, sharding, migration, and failover.\nexport class CacheServer {}\n");
  fs.writeFileSync(path.join(project, "README.md"), "Distributed cache product and Redis-compatible key-value store. Build, test, validate, benchmark, and release cache server protocol, TTL, eviction, persistence, replication, sharding, migration, failover, diagnostics, and observability.");
  return project;
}

function createGenericEngineeringTool(project) {
  fs.mkdirSync(path.join(project, "src"), { recursive: true });
  fs.writeFileSync(path.join(project, "package.json"), JSON.stringify({ name: "engineering-tool", scripts: { build: "node build.js", test: "node test.js" } }));
  fs.writeFileSync(path.join(project, "src/index.js"), "export function validateInput(value) { return Boolean(value); }\n");
  fs.writeFileSync(path.join(project, "README.md"), "Build, test, validate, verify, release, and rollback a reusable engineering tool.");
  return project;
}

function createGitRepository(project) {
  createRedisClient(project);
  git(["init"], project);
  git(["checkout", "-b", "main"], project);
  git(["config", "user.email", "test@example.com"], project);
  git(["config", "user.name", "Harness Test"], project);
  git(["add", "."], project);
  git(["commit", "-m", "fixture"], project);
  return project;
}

function git(args, cwd) {
  const run = spawnSync("git", args, { cwd, encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr || run.stdout);
}

function runJson(args) {
  const run = spawnSync(process.execPath, [cli, ...args], { encoding: "utf8", env: cleanEnv() });
  assert.equal(run.status, 0, run.stderr || run.stdout);
  assert.equal(run.stderr, "");
  return JSON.parse(run.stdout);
}

function runJsonFailure(args) {
  const run = spawnSync(process.execPath, [cli, ...args], { encoding: "utf8", env: cleanEnv() });
  assert.notEqual(run.status, 0, run.stderr || run.stdout);
  return JSON.parse(run.stdout);
}

async function runJsonAsync(args) {
  const run = await runJsonProcess(args);
  assert.equal(run.status, 0, run.stderr || run.stdout);
  assert.equal(run.stderr, "");
  return JSON.parse(run.stdout);
}

async function runJsonAsyncFailure(args) {
  const run = await runJsonProcess(args);
  assert.notEqual(run.status, 0, run.stderr || run.stdout);
  return JSON.parse(run.stdout);
}

async function runJsonProcess(args) {
  const child = spawn(process.execPath, [cli, ...args], { env: cleanEnv() });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  const status = await new Promise((resolve, reject) => { child.on("error", reject); child.on("close", resolve); });
  return { status, stdout, stderr };
}

async function createModelService(t, { evidenceId = "evidence-0001" } = {}) {
  const requests = [];
  const server = http.createServer((request, response) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      const body = Buffer.concat(chunks).toString("utf8");
      requests.push({ authorization: request.headers.authorization, body });
      const doctor = body.includes('Return exactly {\\"status\\":\\"ok\\"}');
      const content = doctor ? { status: "ok" } : {
        recommendation: "PROPOSE_NEW_PROFILE",
        rationale: "The cited evidence supports a bounded reusable engineering Profile proposal.",
        evidenceIds: [evidenceId],
        risks: ["Human review remains required."],
        proposedDeltas: ["Review the proposed boundary and evidence contract."]
      };
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({
        model: "glm-5.1",
        choices: [{ message: { content: JSON.stringify(content) } }],
        usage: { prompt_tokens: 2, completion_tokens: 1, total_tokens: 3 }
      }));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  return { url: `http://127.0.0.1:${server.address().port}/v4`, requests };
}

function cleanEnv() {
  const env = { ...process.env };
  delete env.EVOPILOT_HARNESS_HOME;
  delete env.EVOPILOT_HARNESS_LLM_MODELS_FILE;
  return env;
}

function treeDigest(directory) {
  const hash = crypto.createHash("sha256");
  for (const file of walk(directory)) {
    hash.update(path.relative(directory, file));
    hash.update(fs.readFileSync(file));
  }
  return hash.digest("hex");
}

function walk(directory) {
  const result = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const resolved = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...walk(resolved));
    else if (entry.isFile()) result.push(resolved);
  }
  return result;
}
