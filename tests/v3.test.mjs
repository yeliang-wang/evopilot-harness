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
import { discoverAssets } from "../src/v3/catalog.mjs";
import { feedbackPackageDigest, feedbackPayloadDigest } from "../src/v3/feedback.mjs";
import { serveHubV3 } from "../src/v3/hub.mjs";
import { validateDocument } from "../src/v3/schema.mjs";
import { digest } from "../src/v3/utils.mjs";

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
  const advisorPolicies = runJson(["policy", "inspect", "--workspace", home, "--type", "advisor", "--json"]);
  assert.ok(advisorPolicies.packs.some((pack) => pack.document.metadata.version === "1.2.1" && pack.document.spec.reviewContract));
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
  const proposal = runJson(["proposal", "inspect", result.runId, "--workspace", home, "--json"]);
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
  const proposal = runJson(["proposal", "inspect", result.runId, "--workspace", home, "--json"]);
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
      const requestBody = JSON.parse(requests.at(-1).body);
      const prompt = JSON.parse(requestBody.messages[1].content);
      const content = prompt.task?.startsWith("Independently review")
        ? readyReviewAssessment(prompt)
        : {
          recommendation: "PROPOSE_NEW_PROFILE",
          rationale: "The evidence describes a client library rather than a cache server product.",
          evidenceIds: ["evidence-0001"],
          risks: ["Review the client/server boundary."],
          proposedDeltas: ["Add a redis-client Ontology role and Profile proposal."]
        };
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({
        model: "glm-5.1",
        choices: [{ message: { content: JSON.stringify(content) } }],
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
  const proposal = runJson(["proposal", "inspect", produced.runId, "--workspace", home, "--json"]);
  assert.equal(proposal.proposedAssets[0].provenance.advisorRunDigest, produced.advisor.responseDigest);

  const review = await runJsonAsync(["proposal", "review", produced.runId, "--workspace", home, "--models-file", modelsFile, "--json"]);
  assert.equal(review.status, "REVIEWED", JSON.stringify(review.deterministicGates));
  assert.equal(review.verdict, "READY_FOR_HUMAN_APPROVAL");
  assert.equal(review.reviewer.status, "SUCCEEDED");
  assert.equal(review.reviewer.authority.mayApprove, false);
  assert.equal(review.humanDecisionRequired, true);
  assert.equal(review.nextAction, "proposal-approve");
  assert.ok(review.remainingBlockers.includes("new-profile-evaluation-review-required"));
  assert.ok(fs.existsSync(review.reportPath));
  assert.ok(review.findings.some((finding) => finding.dimension === "product-boundary"));
  assert.equal(requests.length, 2);

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

test("proposal approval is blocked without a current READY Review Report", async (t) => {
  const home = initializedHome();
  const project = createRedisClient(path.join(home, "fixtures/redisclient"));
  const service = await createProposalReviewService(t, { verdict: "REVISE" });
  const modelsFile = path.join(home, "models.json");
  fs.writeFileSync(modelsFile, JSON.stringify({ models: [{ id: "glm-5.1", name: "EvoPilot GLM", vendor: "zhipu", apiKey: "review-secret", url: service.url }] }));
  const produced = await runJsonAsync(["produce", "--workspace", home, "--source-project", project, "--goal", "Produce a reusable Harness asset.", "--models-file", modelsFile, "--json"]);

  const missingReview = runJsonFailure(["proposal", "approve", produced.runId, "--workspace", home, "--confirmed-by", "admin@example.com", "--confirmation", "Reviewed.", "--evaluation-reviewed", "--json"]);
  assert.deepEqual(missingReview.blockers, ["proposal-review-required"]);

  const review = await runJsonAsync(["proposal", "review", produced.runId, "--workspace", home, "--models-file", modelsFile, "--json"]);
  assert.equal(review.status, "ACTION_REQUIRED");
  assert.equal(review.verdict, "REVISE");
  assert.equal(review.nextAction, "revise-proposal");
  assert.ok(review.findings.some((finding) => finding.severity === "blocking"));
  const blocked = runJsonFailure(["proposal", "approve", produced.runId, "--workspace", home, "--confirmed-by", "admin@example.com", "--confirmation", "Reviewed.", "--evaluation-reviewed", "--json"]);
  assert.ok(blocked.blockers.includes("proposal-review-verdict:revise"));
  assert.equal(blocked.nextAction, "revise-proposal");
  assert.doesNotMatch(JSON.stringify([review, blocked]), /review-secret/);
});

test("proposal approval rejects a Review Report after the Proposal changes", async (t) => {
  const home = initializedHome();
  const project = createRedisClient(path.join(home, "fixtures/redisclient"));
  const service = await createProposalReviewService(t);
  const modelsFile = path.join(home, "models.json");
  fs.writeFileSync(modelsFile, JSON.stringify({ models: [{ id: "glm-5.1", name: "EvoPilot GLM", vendor: "zhipu", apiKey: "stale-secret", url: service.url }] }));
  const produced = await runJsonAsync(["produce", "--workspace", home, "--source-project", project, "--goal", "Produce a reusable Harness asset.", "--models-file", modelsFile, "--json"]);
  const review = await runJsonAsync(["proposal", "review", produced.runId, "--workspace", home, "--models-file", modelsFile, "--json"]);
  assert.equal(review.verdict, "READY_FOR_HUMAN_APPROVAL");
  const proposalFile = path.join(home, "evolution-runs", produced.runId, "proposal.yaml");
  fs.appendFileSync(proposalFile, "\noperatorNote: changed after review\n");
  const blocked = runJsonFailure(["proposal", "approve", produced.runId, "--workspace", home, "--confirmed-by", "admin@example.com", "--confirmation", "Reviewed.", "--evaluation-reviewed", "--json"]);
  assert.ok(blocked.blockers.includes("proposal-review-stale"));
  assert.doesNotMatch(JSON.stringify(blocked), /stale-secret/);
});

test("proposal review accepts production-shaped non-source assessments and normalizes quality checks", async (t) => {
  const home = initializedHome();
  const project = createRedisClient(path.join(home, "fixtures/redisclient"));
  const service = await createProposalReviewService(t, { productionShape: true });
  const modelsFile = path.join(home, "models.json");
  fs.writeFileSync(modelsFile, JSON.stringify({ models: [{ id: "glm-5.1", name: "EvoPilot GLM", vendor: "zhipu", apiKey: "production-shape-secret", url: service.url }] }));
  const produced = await runJsonAsync(["produce", "--workspace", home, "--source-project", project, "--goal", "Produce a reusable Harness asset.", "--models-file", modelsFile, "--json"]);

  const review = await runJsonAsync(["proposal", "review", produced.runId, "--workspace", home, "--models-file", modelsFile, "--json"]);
  assert.equal(review.status, "REVIEWED");
  assert.equal(review.verdict, "READY_FOR_HUMAN_APPROVAL");
  assert.equal(review.reviewer.status, "SUCCEEDED");
  assert.equal(review.reviewer.policy.version, "1.2.1");
  assert.equal(review.reviewer.attempts.length, 1);
  assert.deepEqual(review.existingAssetOverlap.evidenceIds, []);
  assert.deepEqual(review.evaluationSufficiency.evidenceIds, []);
  assert.ok(review.findings.some((finding) => finding.evidenceIds.length === 0));
  assert.ok(review.definitionQuality.checks.every((check) => typeof check === "object" && check.id));
  assert.equal(service.requests.at(-1).request.max_tokens, 8192);
  assert.doesNotMatch(JSON.stringify(review), /production-shape-secret/);
});

test("proposal review still blocks production-shaped output with missing source citations", async (t) => {
  const home = initializedHome();
  const project = createRedisClient(path.join(home, "fixtures/redisclient"));
  const service = await createProposalReviewService(t, { missingSourceCitations: true });
  const modelsFile = path.join(home, "models.json");
  fs.writeFileSync(modelsFile, JSON.stringify({ models: [{ id: "glm-5.1", name: "EvoPilot GLM", vendor: "zhipu", apiKey: "missing-citation-secret", url: service.url }] }));
  const produced = await runJsonAsync(["produce", "--workspace", home, "--source-project", project, "--goal", "Produce a reusable Harness asset.", "--models-file", modelsFile, "--json"]);

  const review = await runJsonAsyncFailure(["proposal", "review", produced.runId, "--workspace", home, "--models-file", modelsFile, "--json"]);
  assert.equal(review.status, "BLOCKED");
  assert.equal(review.verdict, "NEED_MORE_EVIDENCE");
  assert.ok(review.remainingBlockers.includes("semantic-proposal-review-required"));
  assert.equal(review.reviewer.attempts.length, 2);
  assert.ok(review.reviewer.attempts.every((attempt) => attempt.validation.checks.some((check) => check.id === "required-source-citations" && check.status === "FAIL")));
  assert.doesNotMatch(JSON.stringify(review), /missing-citation-secret/);
});

test("proposal review blocks when the independent semantic reviewer is unavailable", () => {
  const home = initializedHome();
  const project = createDistributedCacheProduct(path.join(home, "fixtures/distributed-cache"));
  const produced = runJson(["produce", "--workspace", home, "--source-project", project, "--goal", "Evolve a reusable Harness asset.", "--advisor", "off", "--json"]);
  const result = runJsonFailure(["proposal", "review", produced.runId, "--workspace", home, "--models-file", path.join(home, "missing-models.json"), "--json"]);
  assert.equal(result.status, "BLOCKED");
  assert.equal(result.verdict, "NEED_MORE_EVIDENCE");
  assert.ok(result.remainingBlockers.includes("semantic-proposal-review-required"));
  assert.equal(result.nextAction, "repair-reviewer-and-rerun");
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
  assert.equal(result.llmUsage.reviewRunCount, 0);
  assert.ok(fs.existsSync(out));
});

test("feedback processing validates immutable bindings, ingests idempotently, aggregates four dimensions, and never mutates Catalog assets", () => {
  const home = initializedHome();
  const now = "2026-08-13T08:00:00.000Z";
  const organizationBefore = treeDigest(path.join(home, "catalogs/organization"));
  const builtinBefore = treeDigest(path.join(home, "catalogs/builtin"));
  const proposalsBefore = treeDigest(path.join(home, "evolution-runs"));
  const firstFile = writeFeedbackFixture(home, createFeedbackPackage(home, { packageId: "feedback-alpha", sourceId: "workspace-alpha", score: 0.9 }), "feedback-alpha.yaml");

  const inspected = runJson(["feedback", "inspect", firstFile, "--workspace", home, "--json"]);
  assert.equal(inspected.status, "INSPECTED");
  assert.equal(inspected.declaredPackageDigest, inspected.calculatedPackageDigest);
  assert.equal(inspected.declaredPayloadDigest, inspected.calculatedPayloadDigest);

  const validated = runJson(["feedback", "validate", firstFile, "--workspace", home, "--now", now, "--json"]);
  assert.equal(validated.status, "VALIDATED");
  assert.ok(validated.checks.every((check) => check.status === "PASS"));

  const processed = runJson(["feedback", "process", firstFile, "--workspace", home, "--now", now, "--json"]);
  assert.equal(processed.status, "PROCESSED");
  assert.equal(processed.ingestion.status, "ACCEPTED");
  assert.equal(processed.proposalCreated, false);
  assert.equal(processed.assetMutation, false);
  assert.equal(processed.sourceExecution, false);
  assert.equal(processed.aggregation.report.summary.sampleCount, 1);
  assert.equal(processed.aggregation.report.summary.independentSourceCount, 1);
  assert.equal(processed.aggregation.report.summary.dimensions.outcome.successRate, 1);
  assert.equal(processed.aggregation.report.summary.dimensions.outcome.averageScore, 0.9);
  assert.equal(processed.aggregation.report.summary.dimensions.process.averageRetryCount, 1);
  assert.equal(processed.aggregation.report.summary.dimensions.safety.safeRate, 1);
  assert.equal(processed.aggregation.report.summary.dimensions.cost.averageTotalTokens, 150);
  assert.equal(processed.aggregation.report.summary.uncertainty.level, "HIGH");
  assert.ok(processed.aggregation.report.summary.uncertainty.outcomeSuccessRate95);
  assert.equal(processed.aggregation.report.groups.filter((group) => group.assetRef.kind === "HarnessBundle").length, 1);
  assert.equal(processed.aggregation.report.groups.filter((group) => group.assetRef.kind === "HarnessProfile").length, 1);
  assert.equal(processed.aggregation.report.groups.filter((group) => group.assetRef.kind === "HarnessComponent").length, 1);
  assert.match(path.basename(processed.ingestion.destination), /^feedback-alpha@1\.0\.0-[a-f0-9]{16}\.yaml$/);

  const duplicate = runJson(["feedback", "process", firstFile, "--workspace", home, "--now", now, "--json"]);
  assert.equal(duplicate.ingestion.status, "DUPLICATE");
  assert.equal(duplicate.ingestion.counted, false);
  assert.equal(duplicate.aggregation.packageCount, 1);

  const secondFile = writeFeedbackFixture(home, createFeedbackPackage(home, { packageId: "feedback-beta", sourceId: "workspace-beta", outcome: "FAILED", score: 0.2, safety: "POLICY_VIOLATION", totalTokens: 250, currency: "CNY" }), "feedback-beta.yaml");
  const second = runJson(["feedback", "process", secondFile, "--workspace", home, "--now", now, "--json"]);
  assert.equal(second.ingestion.status, "ACCEPTED");
  assert.equal(second.aggregation.packageCount, 2);
  assert.equal(second.aggregation.report.summary.independentSourceCount, 2);
  assert.equal(second.aggregation.report.summary.dimensions.outcome.successRate, 0.5);
  assert.equal(second.aggregation.report.summary.dimensions.outcome.averageScore, 0.55);
  assert.equal(second.aggregation.report.summary.dimensions.safety.safeRate, 0.5);
  assert.equal(second.aggregation.report.summary.dimensions.cost.averageTotalTokens, 200);
  assert.equal(second.aggregation.report.metadata.algorithmVersion, "effectiveness-aggregate/v1");
  assert.equal(second.aggregation.report.summary.dimensions.cost.averageEstimatedCost, null);
  assert.deepEqual(second.aggregation.report.summary.dimensions.cost.estimatedCostByCurrency.map((item) => item.currency), ["CNY", "USD"]);

  const report = runJson(["feedback", "report", second.aggregation.reportId, "--workspace", home, "--json"]);
  assert.equal(report.status, "FOUND");
  assert.equal(report.digestMatches, true);
  assert.equal(report.report.scope.packageCount, 2);
  assert.equal(report.report.groups.length, 3);
  assert.equal(treeDigest(path.join(home, "catalogs/organization")), organizationBefore);
  assert.equal(treeDigest(path.join(home, "catalogs/builtin")), builtinBefore);
  assert.equal(treeDigest(path.join(home, "evolution-runs")), proposalsBefore);
});

test("feedback validation rejects approval, redaction, freshness, integrity, immutable binding, and identity conflicts", () => {
  const home = initializedHome();
  const now = "2026-08-13T08:00:00.000Z";
  const cases = [
    ["unapproved", (document) => { document.approval.status = "PENDING"; }, "approval"],
    ["unredacted", (document) => { document.redaction.status = "RAW"; }, "redaction"],
    ["expired", (document) => { document.metadata.expiresAt = "2026-08-13T07:59:59.000Z"; }, "not-expired"],
    ["tampered-package", (document) => { document.dimensions.outcome.score = 0.1; }, "package-digest"],
    ["tampered-payload", (document) => { document.redaction.payloadDigest = digest("wrong-payload"); }, "redacted-payload-digest"],
    ["bundle-digest", (document) => { document.harnessBinding.bundleRef.digest = digest("wrong-bundle"); }, "bundle-reference"],
    ["profile-digest", (document) => { document.harnessBinding.profileRef.digest = digest("wrong-profile"); }, "profile-reference"],
    ["component-digest", (document) => { document.harnessBinding.componentRefs[0].digest = digest("wrong-component"); }, "component:engineering-validation-reference"],
    ["acceptance-counts", (document) => { document.dimensions.outcome.acceptancePassed = 5; }, "outcome-acceptance-counts"],
    ["process-counts", (document) => { document.dimensions.process.failedStepCount = 9; }, "process-step-counts"],
    ["token-accounting", (document) => { document.dimensions.cost.totalTokens = 999; }, "cost-token-accounting"]
  ];

  for (const [id, mutate, expectedFailure] of cases) {
    const document = createFeedbackPackage(home, { packageId: `feedback-${id}` });
    mutate(document);
    if (!["tampered-package", "tampered-payload"].includes(id)) finalizeFeedbackPackage(document);
    const file = writeFeedbackFixture(home, document, `${id}.yaml`);
    const rejected = runJsonFailure(["feedback", "process", file, "--workspace", home, "--now", now, "--json"]);
    assert.equal(rejected.status, "REJECTED", id);
    assert.ok(rejected.validation.failures.some((failure) => failure.id === expectedFailure), `${id} should fail ${expectedFailure}`);
    assert.equal(rejected.proposalCreated, false, id);
    assert.equal(rejected.assetMutation, false, id);
    assert.equal(rejected.sourceExecution, false, id);
  }

  const accepted = createFeedbackPackage(home, { packageId: "feedback-conflict", score: 0.8 });
  const acceptedFile = writeFeedbackFixture(home, accepted, "conflict-accepted.yaml");
  assert.equal(runJson(["feedback", "ingest", acceptedFile, "--workspace", home, "--now", now, "--json"]).status, "ACCEPTED");
  const conflicting = createFeedbackPackage(home, { packageId: "feedback-conflict", score: 0.3 });
  const conflictingFile = writeFeedbackFixture(home, conflicting, "conflict-rejected.yaml");
  const conflict = runJsonFailure(["feedback", "ingest", conflictingFile, "--workspace", home, "--now", now, "--json"]);
  assert.equal(conflict.status, "REJECTED");
  assert.ok(conflict.validation.failures.some((failure) => failure.id === "package-id-conflict"));
  assert.equal(walkFilesForTest(path.join(home, "feedback/packages")).length, 1);
  assert.ok(walkFilesForTest(path.join(home, "feedback/rejected")).length >= cases.length + 1);
});

test("feedback inspect is Workspace-independent and malformed packages fail as structured JSON", () => {
  const directory = temporaryHome();
  const malformed = path.join(directory, "malformed.yaml");
  fs.writeFileSync(malformed, "apiVersion: feedback.evopilot.io/v1\nkind: HarnessExecutionFeedbackPackage\nmetadata: {}\n");
  const inspected = runJsonFailure(["feedback", "inspect", malformed, "--workspace", path.join(directory, "not-initialized"), "--json"]);
  assert.equal(inspected.status, "FAILED");
  assert.equal(inspected.schemaValidation.valid, false);
  const home = initializedHome();
  const validated = runJsonFailure(["feedback", "validate", malformed, "--workspace", home, "--now", "2026-08-13T08:00:00.000Z", "--json"]);
  assert.equal(validated.status, "REJECTED");
  assert.ok(validated.failures.length > 0);
});

test("EvaluationPack v1 remains compatible and v2 governs Outcome, Process, Safety, and Cost evidence", () => {
  const v1 = {
    apiVersion: "harness.evopilot.io/v1",
    kind: "EvaluationPack",
    metadata: { id: "legacy-evaluation", version: "1.0.0", lifecycle: "approved", description: "Legacy compatibility fixture." },
    spec: {
      targetRef: "HarnessBundle:distributed-cache-product@3.0.0",
      minimumReviewedCases: 1,
      cases: [{ id: "legacy-case", inputDigest: digest("legacy-input"), expectedDecision: "PASSED", reviewStatus: "approved" }],
      status: "READY"
    }
  };
  assert.equal(validateDocument(v1).valid, true);
  const v2 = {
    apiVersion: "harness.evopilot.io/v2",
    kind: "EvaluationPack",
    metadata: { id: "cache-effectiveness", version: "2.0.0", lifecycle: "approved", description: "Four-dimensional execution evidence gate." },
    spec: {
      targetRef: { kind: "HarnessBundle", id: "distributed-cache-product", version: "3.0.0", digest: digest("bundle") },
      minimumReviewedCases: 3,
      requiredDimensions: ["outcome", "process", "safety", "cost"],
      criteria: {
        outcome: { minimumSuccessRate: 0.8 },
        process: { maximumFailureRate: 0.1, maximumAverageRetryCount: 2 },
        safety: { minimumSafeRate: 1, maximumIncidentCount: 0 },
        cost: { maximumAverageTotalTokens: 5000, maximumAverageEstimatedCost: 1, currency: "USD" }
      },
      cases: [{ id: "reviewed-case", inputDigest: digest("input"), expectedDecision: "SUCCEEDED", reviewStatus: "approved", feedbackPackageRefs: [{ packageId: "feedback-alpha", version: "1.0.0", digest: digest("feedback") }] }],
      status: "READY"
    }
  };
  assert.equal(validateDocument(v2).valid, true);
  delete v2.spec.criteria.safety;
  assert.equal(validateDocument(v2).valid, false);
});

test("Harness Hub exposes feedback as a read-only projection and rejects mutation methods", async (t) => {
  const home = initializedHome();
  const now = "2026-08-13T08:00:00.000Z";
  const file = writeFeedbackFixture(home, createFeedbackPackage(home, { packageId: "feedback-hub" }), "feedback-hub.yaml");
  runJson(["feedback", "process", file, "--workspace", home, "--now", now, "--json"]);
  const snapshot = runJson(["hub", "v3-snapshot", "--workspace", home, "--out", path.join(home, "hub-feedback.json"), "--json"]);
  assert.equal(snapshot.feedback.packageCount, 1);
  assert.equal(snapshot.feedback.acceptedEventCount, 1);
  assert.equal(snapshot.feedback.reportCount, 1);
  assert.equal(snapshot.feedback.latestReport.summary.sampleCount, 1);
  assert.ok(snapshot.lifecycleCommands.includes("feedback process"));

  const server = serveHubV3(home, { host: "127.0.0.1", port: 0 });
  t.after(() => server.close());
  if (!server.listening) await new Promise((resolve) => server.once("listening", resolve));
  const port = server.address().port;
  const response = await fetch(`http://127.0.0.1:${port}/api/v3/snapshot`, { method: "POST" });
  assert.equal(response.status, 405);
  assert.deepEqual(await response.json(), { status: "method-not-allowed", allowed: ["GET"] });
});

function createFeedbackPackage(home, { packageId = "feedback-package", sourceId = "workspace-source", outcome = "SUCCEEDED", score = 0.9, safety = "SAFE", totalTokens = 150, currency = "USD" } = {}) {
  const assets = discoverAssets([path.join(home, "catalogs/builtin/assets")]);
  const bundle = assets.find((record) => record.asset.kind === "HarnessBundle" && record.asset.metadata.id === "distributed-cache-product");
  assert.ok(bundle, "distributed-cache-product Bundle should be available");
  const profile = assets.find((record) => record.asset.kind === "HarnessProfile" && record.asset.metadata.id === bundle.asset.spec.profile.id && record.asset.metadata.version === bundle.asset.spec.profile.version);
  assert.ok(profile, "Bundle Profile should be available");
  const components = bundle.asset.spec.resolvedComponents.map((reference) => {
    const component = assets.find((record) => record.asset.kind === "HarnessComponent" && record.asset.metadata.id === reference.id && record.asset.metadata.version === reference.version);
    assert.ok(component, `Bundle Component ${reference.id} should be available`);
    return { id: component.asset.metadata.id, version: component.asset.metadata.version, digest: component.digest };
  });
  const document = {
    apiVersion: "feedback.evopilot.io/v1",
    kind: "HarnessExecutionFeedbackPackage",
    metadata: {
      packageId,
      version: "1.0.0",
      generatedAt: "2026-08-13T07:00:00.000Z",
      expiresAt: "2026-09-13T07:00:00.000Z",
      producer: { name: "feedback-fixture", version: "1.0.0", instanceId: sourceId },
      packageDigest: digest("placeholder")
    },
    approval: { status: "APPROVED", approvedBy: "reviewer@example.invalid", approvedAt: "2026-08-13T07:30:00.000Z", purpose: "Harness effectiveness evaluation" },
    redaction: { status: "REDACTED", policyVersion: "redaction-v1", removedFieldCount: 2, payloadDigest: digest("placeholder") },
    harnessBinding: {
      bundleRef: { id: bundle.asset.metadata.id, version: bundle.asset.metadata.version, digest: bundle.digest },
      profileRef: { id: profile.asset.metadata.id, version: profile.asset.metadata.version, digest: profile.digest },
      componentRefs: components
    },
    executionContext: { taskClass: "unknown-user-task", complexity: "MEDIUM", environmentDigest: digest(`environment-${sourceId}`), trajectoryRefs: [`trajectory:${packageId}`], startedAt: "2026-08-13T06:50:00.000Z", completedAt: "2026-08-13T06:59:00.000Z" },
    dimensions: {
      outcome: { status: outcome, score, acceptancePassed: outcome === "SUCCEEDED" ? 4 : 2, acceptanceTotal: 4 },
      process: { status: outcome === "FAILED" ? "FAILED" : "COMPLETED", stepCount: 8, failedStepCount: outcome === "FAILED" ? 2 : 0, retryCount: 1, durationMs: 540000 },
      safety: { status: safety, violationCount: safety === "SAFE" ? 0 : 1, incidentCount: safety === "INCIDENT" ? 1 : 0 },
      cost: { status: "RECORDED", inputTokens: Math.floor(totalTokens * 2 / 3), outputTokens: totalTokens - Math.floor(totalTokens * 2 / 3), totalTokens, estimatedCost: totalTokens / 100000, currency }
    },
    provenance: { sourceType: "evopilot-goal-loop", sourceId, requestIds: [`request:${packageId}`], model: { provider: "zhipu", name: "glm-feedback-fixture" }, evidenceRefs: [`evidence:${packageId}`] }
  };
  return finalizeFeedbackPackage(document);
}

function finalizeFeedbackPackage(document) {
  document.redaction.payloadDigest = feedbackPayloadDigest(document);
  document.metadata.packageDigest = feedbackPackageDigest(document);
  return document;
}

function writeFeedbackFixture(home, document, name) {
  const file = path.join(home, "fixtures/feedback", name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(document, null, 2)}\n`);
  return file;
}

function walkFilesForTest(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory).map((name) => path.join(directory, name)).filter((file) => fs.statSync(file).isFile());
}

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

async function createProposalReviewService(t, { verdict = "READY_FOR_HUMAN_APPROVAL", productionShape = false, missingSourceCitations = false } = {}) {
  const requests = [];
  const server = http.createServer((request, response) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      const body = Buffer.concat(chunks).toString("utf8");
      const envelope = JSON.parse(body);
      requests.push({ authorization: request.headers.authorization, body, request: envelope });
      const prompt = JSON.parse(envelope.messages[1].content);
      const reviewPrompt = prompt.task?.startsWith("Independently review") || prompt.task?.startsWith("Repair the previous Proposal Review");
      const reviewShape = prompt.previousOutput ?? (productionShape ? productionShapeReviewAssessment(prompt, verdict) : readyReviewAssessment(prompt, verdict));
      if (missingSourceCitations && reviewShape?.projectMembership) {
        reviewShape.projectMembership = reviewShape.projectMembership.map((item) => ({ ...item, evidenceIds: [] }));
        reviewShape.boundaryAssessment = { ...reviewShape.boundaryAssessment, evidenceIds: [] };
      }
      const content = reviewPrompt
        ? reviewShape
        : {
          recommendation: "PROPOSE_NEW_PROFILE",
          rationale: "The cited evidence supports a bounded reusable engineering Profile proposal.",
          evidenceIds: ["evidence-0001"],
          risks: ["Human review remains required."],
          proposedDeltas: ["Review the proposed boundary and evidence contract."]
        };
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ model: "glm-5.1", choices: [{ message: { content: JSON.stringify(content) } }], usage: { prompt_tokens: 8, completion_tokens: 4, total_tokens: 12 } }));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  return { url: `http://127.0.0.1:${server.address().port}/v4`, requests };
}

function productionShapeReviewAssessment(prompt, verdict) {
  const assessment = readyReviewAssessment(prompt, verdict);
  assessment.findings.push({
    id: "evaluation-policy-review",
    severity: "info",
    dimension: "evaluation-sufficiency",
    conclusion: "The Proposal evaluation policy still requires a separate human decision.",
    reasons: ["This conclusion is derived from the supplied EvaluationPack rather than source evidence."],
    evidenceIds: [],
    suggestedActions: ["Keep the evaluation review as an explicit human gate."]
  });
  assessment.existingAssetOverlap.evidenceIds = [];
  assessment.definitionQuality.evidenceIds = [];
  assessment.definitionQuality.checks = ["classification is present", "negative boundary is present", "validators are present"];
  assessment.evaluationSufficiency.evidenceIds = [];
  return assessment;
}

function readyReviewAssessment(prompt, verdict = "READY_FOR_HUMAN_APPROVAL") {
  const evidenceId = prompt.evidenceGraph?.[0]?.evidenceId ?? "evidence-0001";
  const sources = prompt.sources ?? [];
  const ready = verdict === "READY_FOR_HUMAN_APPROVAL";
  return {
    verdict,
    summary: ready ? "The Proposal is sufficiently bounded for a separate human approval decision." : "The Proposal boundary must be revised before human approval.",
    findings: [{
      id: "product-boundary-review",
      severity: ready ? "info" : "blocking",
      dimension: "product-boundary",
      conclusion: ready ? "The proposed client-library boundary matches the cited evidence." : "The proposed boundary is broader than the cited source ownership.",
      reasons: [ready ? "The evidence identifies a reusable client-library engineering task." : "Dependencies do not prove ownership of the depended-on product."],
      evidenceIds: [evidenceId],
      suggestedActions: ready ? ["Proceed to a separate human approval decision."] : ["Narrow the domain, role, and negative boundary, then regenerate the Proposal."]
    }],
    reasons: [ready ? "Independent semantic review found no blocking boundary conflict." : "The product-versus-usage distinction is unresolved."],
    groupCoherence: { status: sources.length > 1 ? "COHERENT" : "NOT_APPLICABLE", rationale: sources.length > 1 ? "All supplied sources support one reusable boundary." : "One source does not require corpus grouping.", evidenceIds: [evidenceId] },
    projectMembership: sources.map((source) => ({ sourceId: source.sourceId, sourceType: source.sourceType, sourceRef: source.sourceRef, status: "IN_SCOPE", rationale: "The source contributes cited evidence to this Proposal.", evidenceIds: source.evidenceIds.length ? [source.evidenceIds[0]] : [evidenceId] })),
    boundaryAssessment: { status: ready ? "PASS" : "FAIL", rationale: ready ? "In-scope and out-of-scope boundaries are specific enough for human review." : "The proposed role overstates product ownership.", evidenceIds: [evidenceId] },
    existingAssetOverlap: { status: "NONE", rationale: "No published asset duplicates the proposed client-library role.", candidates: [], evidenceIds: [evidenceId] },
    definitionQuality: { status: ready ? "PASS" : "FAIL", score: ready ? 0.9 : 0.45, rationale: ready ? "The definition includes classification, boundaries, evidence, components, and validators." : "The definition needs a narrower boundary.", checks: [{ id: "semantic-boundary", status: ready ? "PASS" : "FAIL" }], evidenceIds: [evidenceId] },
    evaluationSufficiency: { status: ready ? "PASS" : "FAIL", rationale: ready ? "The evaluation case is ready for explicit human review." : "The evaluation expectation encodes the disputed boundary.", evidenceIds: [evidenceId] },
    advisorAssessment: { status: ready ? "CONSISTENT" : "CONFLICTED", rationale: ready ? "The original Advisor is consistent with the independent review." : "The original Advisor did not resolve the product-ownership boundary.", evidenceIds: [evidenceId] },
    suggestedActions: ready ? ["Present this Review Report to the human reviewer."] : ["Revise the Proposal and rerun proposal review."]
  };
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
