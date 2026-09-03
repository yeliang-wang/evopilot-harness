import assert from "node:assert/strict";
import crypto from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { initializeWorkspace } from "../src/v3/workspace.mjs";
import { executeV3Operation } from "../src/v3/cli.mjs";
import { discoverAssets } from "../src/v3/catalog.mjs";
import { feedbackPackageDigest, feedbackPayloadDigest } from "../src/v3/feedback.mjs";
import { engineCapabilities, engineOperationDefinition, invokeEngineOperation } from "../src/v4/engine-adapter.mjs";
import { assertExternalWorkspace, assertWorkspaceTreeConfined, operationCompatibility } from "../src/v4/constants.mjs";
import { acknowledgeInteractionFramePresentation, cancelAgentSession, createAgentSession, createSessionPlan, confirmSessionPlan, inspectAgentSession, migrateOperationSessionCoreCompatibility, prepareSessionLifecycleInteraction, recordBusinessViewDelivery, recoverInterruptedSessions, resumeAgentSession, validateAgentSession, validateOperationPlan } from "../src/v4/session/store.mjs";
import { governedHostInteraction, TestMcpClient, structured } from "./helpers/mcp-client.mjs";

const root = path.resolve(import.meta.dirname, "..");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));

test("Digital Expert adapters are generated from one immutable Core", () => {
  execFileSync(process.execPath, ["scripts/generate-digital-expert-adapters.mjs", "--check"], { cwd: root, stdio: "pipe" });
  const lock = JSON.parse(fs.readFileSync(path.join(root, "digital-expert/manifest.lock.json"), "utf8"));
  assert.match(lock.coreDigest, /^sha256:[a-f0-9]{64}$/);
  assert.equal(lock.expertVersion, manifest.version);
  for (const adapter of ["codex/SKILL.md", "workbuddy/WORKBUDDY.md", "claude-code/CLAUDE.md", "mcp/MCP.md", "generic/AGENT.md"]) {
    const content = fs.readFileSync(path.join(root, "digital-expert/adapters", adapter), "utf8");
    assert.match(content, new RegExp(lock.coreDigest.replace(":", "\\:")));
    assert.match(content, /Ask exactly one shortest missing question/);
    assert.match(content, /Approval never authorizes publication/);
    assert.match(content, /Never ask the human to copy, type, or understand an internal decision token/);
  }
  const alias = fs.readFileSync(path.join(root, ".agents/skills/evopilot-harness-guided-operator/SKILL.md"), "utf8");
  assert.match(alias, /Compatibility Alias/);
  assert.doesNotMatch(alias, /operator_guard\.py|guarded human-CLI workflow.*execute/i);
});

test("Digital Expert scenario matrix closes every declared source, decision, operation, and lifecycle branch", () => {
  execFileSync(process.execPath, ["scripts/validate-digital-expert-scenario-coverage.mjs"], { cwd: root, stdio: "pipe" });
  const matrix = parseYaml(fs.readFileSync(path.join(root, "digital-expert/conformance/scenario-matrix.yaml"), "utf8"));
  const workflows = parseYaml(fs.readFileSync(path.join(root, "digital-expert/core/workflows.yaml"), "utf8"));
  assert.deepEqual([...matrix.engineOperations].sort(), engineCapabilities().map((item) => item.id).sort());
  assert.deepEqual([...matrix.terminalDecisions].sort(), [...workflows.terminalDecisions].sort());
  const workflowSources = new Set(workflows.workflows.flatMap((item) => item.sources ?? []));
  for (const source of matrix.evidenceSources) assert.ok(workflowSources.has(source), `missing workflow source ${source}`);
  for (const branch of ["plan-review", "publication-operation-authorization", "proposal-approval", "separate-publication-authorization", "process-interruption", "blocked-proposal-review-retry", "digest-drift", "cancellation", "close", "cleanup", "unsupported-capability"]) {
    assert.ok(matrix.lifecycleBranches.includes(branch), `missing lifecycle branch ${branch}`);
  }
});

test("v3 Engine exposes structured in-process results without parsing CLI output", async () => {
  const home = temporary("engine-adapter");
  const response = await executeV3Operation({ positionals: ["workspace", "init"], options: { workspace: home } });
  assert.equal(response.exitCode, 0);
  assert.equal(response.result.status, "READY");
  assert.equal(response.result.home, home);
});

test("Agent Workspace rejects lexical and symlink aliases into the Release", () => {
  assert.throws(() => assertExternalWorkspace(path.join(root, "agent-workspace")), /must be outside/);
  const parent = temporary("workspace-symlink");
  const releaseAlias = path.join(parent, "release-alias");
  fs.symlinkSync(root, releaseAlias);
  assert.throws(() => assertExternalWorkspace(releaseAlias), /must be outside/);
  assert.throws(() => assertExternalWorkspace(path.join(releaseAlias, "not-created")), /must be outside/);

  const external = temporary("workspace-external");
  const externalAlias = path.join(parent, "external-alias");
  fs.symlinkSync(external, externalAlias);
  assert.equal(assertExternalWorkspace(externalAlias), fs.realpathSync(external));
});

test("Agent Workspace rejects internal Session and receipt symlinks before writing", async () => {
  const sessionHome = temporary("session-root-symlink");
  const outsideSessions = temporary("outside-sessions");
  initializeWorkspace(sessionHome);
  fs.symlinkSync(outsideSessions, path.join(sessionHome, "agent-sessions"));
  assert.throws(
    () => createAgentSession({ home: sessionHome, intent: "This Session must remain inside its Workspace", adapterId: "codex" }),
    (error) => error.code === "WORKSPACE_WRITE_BOUNDARY_VIOLATION"
  );
  assert.deepEqual(fs.readdirSync(outsideSessions), []);

  const receiptHome = temporary("receipt-root-symlink");
  const outsideReceipts = temporary("outside-receipts");
  initializeWorkspace(receiptHome);
  fs.symlinkSync(outsideReceipts, path.join(receiptHome, "agent-operation-receipts"));
  await assert.rejects(
    () => invokeEngineOperation({
      home: receiptHome,
      operation: "feedback.aggregate",
      input: { now: "2026-08-19T00:00:00.000Z" },
      authority: "planned",
      idempotencyKey: "a".repeat(64)
    }),
    (error) => error.code === "WORKSPACE_WRITE_BOUNDARY_VIOLATION"
  );
  assert.deepEqual(fs.readdirSync(outsideReceipts), []);
});

test("immutable GitHub Source snapshots may preserve repository symlinks without weakening writable Workspace boundaries", () => {
  const home = temporary("workspace-source-symlink");
  initializeWorkspace(home);
  const snapshot = path.join(home, "source-cache", "github", "snapshots", "a".repeat(64), "b".repeat(40));
  fs.mkdirSync(snapshot, { recursive: true });
  fs.symlinkSync("missing-source-owned-file.md", path.join(snapshot, "source-link.md"));
  assert.equal(assertWorkspaceTreeConfined(home), fs.realpathSync(home));

  const outside = temporary("workspace-source-symlink-outside");
  fs.symlinkSync(outside, path.join(home, "agent-sessions-link"));
  assert.throws(() => assertWorkspaceTreeConfined(home), (error) => error.code === "WORKSPACE_WRITE_BOUNDARY_VIOLATION");
});

test("Session state rejects raw secrets in intent and every scenario goal", () => {
  const home = temporary("session-secrets");
  initializeWorkspace(home);
  for (const secret of [
    "sk-1234567890abcdef",
    "ghp_1234567890abcdefghijkl",
    "glpat-1234567890abcdef",
    "authorization: Bearer raw-production-token",
    "password=must-not-persist",
    "cookie: session=must-not-persist",
    "credentials: must-not-persist",
    "https://operator:password@example.com/private",
    "-----BEGIN PRIVATE KEY-----\nraw-private-material\n-----END PRIVATE KEY-----"
  ]) {
    assert.throws(() => createAgentSession({ home, intent: `Reject ${secret}`, adapterId: "codex" }), (error) => error.code === "SENSITIVE_SESSION_INPUT_REJECTED", secret);
  }
  assert.equal(fs.existsSync(path.join(home, "agent-sessions")), false);

  const created = createAgentSession({ home, intent: "Use the reviewed modelsFile profile and privateKey path", adapterId: "codex" });
  for (const [scenario, goal, sources, operations] of [
    ["evolve", "authorization: Bearer raw-production-token", { notes: ["static product evidence"] }, []],
    ["feedback", "password=must-not-persist", { feedbackFile: path.join(home, "feedback.json") }, []],
    ["maintenance", "Publish with ghp_1234567890abcdefghijkl", {}, [{ operation: "keys.generate", input: { privateKey: path.join(home, "keys/private.pem"), publicKey: path.join(home, "keys/public.pem") } }]]
  ]) {
    assert.throws(() => createSessionPlan({ home, sessionId: created.sessionId, expectedSessionDigest: created.sessionDigest, scenario, goal, sources, operations }), (error) => error.code === "SENSITIVE_SESSION_INPUT_REJECTED");
  }
  const persisted = fs.readFileSync(path.join(home, "agent-sessions", created.sessionId, "session.json"), "utf8");
  assert.doesNotMatch(persisted, /raw-production-token|must-not-persist|ghp_1234567890/);
});

test("real stdio MCP executes every Evidence Source through Digital Expert Session and Engine", async () => {
  const home = temporary("plan-source-coverage");
  const fakeBin = temporary("controlled-network-tools");
  const fakeCurl = path.join(fakeBin, "curl");
  fs.writeFileSync(fakeCurl, "#!/bin/sh\nprintf '%s\\n' 'Architecture build test validate rollback release evidence from reviewed public research.'\n", "utf8");
  fs.chmodSync(fakeCurl, 0o755);
  const project = createCacheSource(temporary("plan-source-project"));
  const sourceRoot = temporary("plan-source-root");
  createCacheSource(sourceRoot);
  const gitProject = createCacheSource(temporary("plan-github-project"));
  execFileSync("git", ["init", "-b", "main"], { cwd: gitProject, stdio: "pipe" });
  execFileSync("git", ["config", "user.name", "Conformance"], { cwd: gitProject });
  execFileSync("git", ["config", "user.email", "conformance@example.invalid"], { cwd: gitProject });
  execFileSync("git", ["add", "."], { cwd: gitProject });
  execFileSync("git", ["commit", "-m", "conformance fixture"], { cwd: gitProject, stdio: "pipe" });
  const attachment = path.join(home, "architecture.pdf");
  const productionLog = path.join(home, "production.log");
  const historicalHarness = path.join(home, "historical-harness.yaml");
  const feedbackFile = path.join(home, "feedback.json");
  fs.mkdirSync(home, { recursive: true });
  for (const file of [attachment, productionLog, historicalHarness]) fs.writeFileSync(file, "Architecture build test validate rollback release static acceptance evidence.\n");
  const cases = [
    ["sourceProjects", "evolve", { sourceProjects: [project], advisor: "off" }],
    ["sourceRoot", "evolve", { sourceRoot, advisor: "off" }],
    ["githubRepositories", "evolve", { githubRepositories: [gitProject], githubRef: "main", advisor: "off" }],
    ["attachments", "evolve", { attachments: [attachment], advisor: "off" }],
    ["productionLogs", "evolve", { productionLogs: [productionLog], advisor: "off" }],
    ["historicalHarnesses", "evolve", { historicalHarnesses: [historicalHarness], advisor: "off" }],
    ["notes", "evolve", { notes: ["Architecture build test validate rollback release evidence."], advisor: "off" }],
    ["researchUrls", "evolve", { researchUrls: ["https://example.com/research"], allowInternetResearch: true, advisor: "off" }]
  ];
  const client = new TestMcpClient({ command: process.execPath, args: ["src/index.mjs", "mcp", "serve", "--workspace", home], cwd: root, env: { ...process.env, PATH: `${fakeBin}:${process.env.PATH}` } });
  try {
    await client.initialize();
    const manifest = await client.request("resources/read", { uri: "evopilot-harness://digital-expert/manifest" });
    assert.equal(JSON.parse(manifest.contents[0].text).schema, "evopilot-harness-digital-expert/v1");
    assert.equal(structured(await client.tool("prepare_workspace", { initialize: true })).status, "READY");
    fs.writeFileSync(feedbackFile, `${JSON.stringify(createFeedbackPackage(home), null, 2)}\n`, "utf8");
    cases.push(["feedbackFile", "feedback", { feedbackFile, now: "2026-08-19T00:00:00.000Z" }]);
    const traces = {};
    for (const [sourceField, scenario, sources] of cases) {
      const intent = `Evaluate ${sourceField} through the published Digital Expert workflow`;
      const started = structured(await client.tool("start_operation_session", { intent, adapterId: "codex-conformance" }));
      const planned = structured(await client.tool("plan_operation_session", { sessionId: started.sessionId, expectedSessionDigest: started.sessionDigest, scenario, goal: intent, sources }));
      assert.ok(Object.hasOwn(planned.plan.sources, sourceField));
      const confirmed = structured(await client.tool("confirm_operation_plan", { sessionId: planned.sessionId, expectedSessionDigest: planned.sessionDigest, expectedPlanDigest: planned.planDigest, confirmedBy: "conformance-operator", confirmation: `CONFIRM_OPERATION_PLAN:${planned.planDigest}` }));
      const executed = structured(await client.tool("execute_operation_plan", { sessionId: confirmed.sessionId, expectedSessionDigest: confirmed.sessionDigest, expectedPlanDigest: confirmed.planDigest }));
      const completedOperations = executed.operations.filter((item) => item.phase === "plan" && item.planCompleted === true);
      assert.ok(completedOperations.length >= 1, `${sourceField} must persist an Engine result`);
      assert.equal(completedOperations[0].operation, scenario === "feedback" ? "feedback.ingest" : "evidence.produce");
      const journal = fs.readFileSync(path.join(home, "agent-sessions", executed.sessionId, "journal.jsonl"), "utf8");
      for (const event of ["SESSION_CREATED", "PLAN_CREATED", "PLAN_CONFIRMED", "ENGINE_OPERATION_COMPLETED"]) assert.match(journal, new RegExp(`\\\"event\\\":\\\"${event}\\\"`), `${sourceField}:${event}`);
      traces[sourceField] = { sessionId: executed.sessionId, status: executed.status, engineOperations: completedOperations.map((item) => item.operation) };
    }
    assert.deepEqual(Object.keys(traces).sort(), ["attachments", "feedbackFile", "githubRepositories", "historicalHarnesses", "notes", "productionLogs", "researchUrls", "sourceProjects", "sourceRoot"]);
  } finally {
    await client.close();
  }
});

test("real stdio MCP surfaces every Engine terminal decision through persistent Sessions", async () => {
  const home = temporary("mcp-terminal-decisions");
  const client = new TestMcpClient({ command: process.execPath, args: ["src/index.mjs", "mcp", "serve", "--workspace", home], cwd: root });
  const observed = new Set();
  try {
    await client.initialize();
    const manifest = await client.request("resources/read", { uri: "evopilot-harness://digital-expert/manifest" });
    assert.equal(JSON.parse(manifest.contents[0].text).schema, "evopilot-harness-digital-expert/v1");
    structured(await client.tool("prepare_workspace", { initialize: true }));
    const cases = [
      ["EVOLVE_EXISTING", { "pom.xml": "<project><artifactId>cache-evolve</artifactId></project>", "README.md": "Distributed cache Redis compatible key-value store architecture. Build test validate release TTL eviction failover." }],
      ["COMPOSE_NEW_BUNDLE", {
        "pom.xml": "<project><artifactId>gateway-cache</artifactId></project>",
        "CacheEngine.java": "Distributed cache Redis compatible key-value store TTL eviction hash slot failover cluster cache. Build test validate release the cache server protocol, persistence, replication, sharding, migration, and failover.",
        "GATEWAY.md": "API gateway reverse proxy route policy rate limit upstream ingress. Validate gateway routes, traffic policy, upstream selection, and release behavior."
      }],
      ["PROPOSE_NEW_PROFILE", { "pom.xml": "<project><artifactId>redis-client</artifactId></project>", "Client.java": "Redis client Jedis connection factory serializer library build test validate release." }],
      ["NO_CHANGE", { "pom.xml": "<project><artifactId>cache-same</artifactId></project>", "Main.java": "Distributed cache Redis compatible key-value store build test validate release." }],
      ["NEED_MORE_EVIDENCE", { "Main.java": "distributed cache" }],
      ["NOT_HARNESS_ELIGIBLE", { "README.md": "personal diary and vacation plan" }]
    ];
    for (const [decision, files] of cases) {
      const source = path.join(home, "decision-fixtures", decision.toLowerCase());
      fs.mkdirSync(source, { recursive: true });
      for (const [name, content] of Object.entries(files)) fs.writeFileSync(path.join(source, name), content, "utf8");
      const executed = await executeEvolutionMcpSession(client, source, "Evaluate the static engineering evidence and produce the appropriate reusable Harness proposal");
      const surfacedDecision = executed.proposals[0]?.decision ?? executed.operations.at(-1)?.status;
      assert.equal(surfacedDecision, decision, JSON.stringify(executed));
      assert.ok(executed.operations.some((item) => item.operation === "evidence.produce" && item.phase === "plan" && item.planCompleted === true));
      observed.add(decision);
    }

    const blockedSource = path.join(home, "decision-fixtures", "blocked");
    fs.mkdirSync(blockedSource, { recursive: true });
    fs.writeFileSync(path.join(blockedSource, "pom.xml"), "<project><artifactId>redis-client-blocked</artifactId></project>");
    fs.writeFileSync(path.join(blockedSource, "Client.java"), "Redis client Jedis connection factory serializer library build test validate release.");
    const blocked = await executeEvolutionMcpSession(client, blockedSource, "Observe BLOCKED when a required Advisor is unavailable");
    assert.equal(blocked.status, "BLOCKED");
    assert.equal(blocked.operations.at(-1).status, "BLOCKED");
    observed.add("BLOCKED");

    const invalidPack = path.join(home, "invalid-ontology.yaml");
    fs.writeFileSync(invalidPack, "apiVersion: harness.evopilot.io/v3\nkind: OntologyPack\nmetadata: {}\nspec: {}\n", "utf8");
    let failed = structured(await client.tool("start_operation_session", { intent: "Observe FAILED from an invalid reviewed publication input", adapterId: "codex-conformance" }));
    failed = structured(await client.tool("plan_operation_session", { sessionId: failed.sessionId, expectedSessionDigest: failed.sessionDigest, scenario: "maintenance", goal: failed.intent.text, operations: [{ operation: "ontology.publish", input: { file: invalidPack } }] }));
    failed = structured(await client.tool("confirm_operation_plan", { sessionId: failed.sessionId, expectedSessionDigest: failed.sessionDigest, expectedPlanDigest: failed.planDigest, confirmedBy: "conformance-operator", confirmation: `CONFIRM_OPERATION_PLAN:${failed.planDigest}` }));
    failed = structured(await client.tool("execute_operation_plan", { sessionId: failed.sessionId, expectedSessionDigest: failed.sessionDigest, expectedPlanDigest: failed.planDigest }));
    const pending = failed.pendingOperationAuthorization;
    failed = structured(await client.tool("authorize_plan_publication_operation", { sessionId: failed.sessionId, expectedSessionDigest: failed.sessionDigest, expectedPlanDigest: failed.planDigest, operationIndex: pending.operationIndex, expectedOperationDigest: pending.operationDigest, confirmedBy: "conformance-operator", confirmation: `AUTHORIZE_PLAN_PUBLICATION:${failed.sessionId}:${failed.planDigest}:${pending.operationIndex}:${pending.operationDigest}` }));
    failed = structured(await client.tool("execute_operation_plan", { sessionId: failed.sessionId, expectedSessionDigest: failed.sessionDigest, expectedPlanDigest: failed.planDigest }));
    assert.equal(failed.status, "BLOCKED");
    assert.equal(failed.operations.at(-1).status, "FAILED");
    observed.add("FAILED");

    assert.deepEqual([...observed].sort(), ["BLOCKED", "COMPOSE_NEW_BUNDLE", "EVOLVE_EXISTING", "FAILED", "NEED_MORE_EVIDENCE", "NOT_HARNESS_ELIGIBLE", "NO_CHANGE", "PROPOSE_NEW_PROFILE"]);
  } finally {
    await client.close();
  }
});

test("real stdio MCP persists a REVISE Proposal Review as a blocked Session", async () => {
  const home = temporary("mcp-review-revise");
  const source = createCacheSource(temporary("mcp-review-revise-source"));
  const reviewer = await startReviewServer({ verdict: "REVISE" });
  const modelsFile = path.join(home, "models.test.json");
  fs.mkdirSync(home, { recursive: true });
  fs.writeFileSync(modelsFile, `${JSON.stringify({ models: [{ id: "contract-reviewer", name: "Contract Reviewer", vendor: "zhipu", apiKey: "test-only", url: reviewer.url }] }, null, 2)}\n`, "utf8");
  const client = new TestMcpClient({ command: process.execPath, args: ["src/index.mjs", "mcp", "serve", "--workspace", home], cwd: root });
  try {
    await client.initialize();
    structured(await client.tool("prepare_workspace", { initialize: true }));
    const produced = await executeEvolutionMcpSession(client, source, "Require a REVISE Proposal Review through the Engine");
    const reviewed = structured(await client.tool("review_session_proposals", { sessionId: produced.sessionId, expectedSessionDigest: produced.sessionDigest, modelsFile, model: "contract-reviewer", reviewTimeoutMs: 5000 }));
    assert.equal(reviewed.status, "BLOCKED");
    assert.equal(reviewed.proposals[0].review.verdict, "REVISE");
    assert.match(fs.readFileSync(path.join(home, "agent-sessions", reviewed.sessionId, "journal.jsonl"), "utf8"), /"event":"PROPOSAL_REVIEW_BLOCKED"/);
  } finally {
    await client.close();
    await reviewer.close();
  }
});

test("Engine-owned OperationJob returns quickly, deduplicates repeated starts, and persists the authoritative Review", async () => {
  const home = temporary("operation-job-review");
  const source = createCacheSource(temporary("operation-job-review-source"));
  const reviewer = await startReviewServer({ delayMs: 250 });
  const modelsFile = path.join(home, "models.test.json");
  fs.mkdirSync(home, { recursive: true });
  fs.writeFileSync(modelsFile, `${JSON.stringify({ models: [{ id: "contract-reviewer", name: "Contract Reviewer", vendor: "zhipu", apiKey: "test-only", url: reviewer.url }] }, null, 2)}\n`, "utf8");
  const client = new TestMcpClient({ command: process.execPath, args: ["src/index.mjs", "mcp", "serve", "--workspace", home], cwd: root });
  try {
    await client.initialize();
    structured(await client.tool("prepare_workspace", { initialize: true }));
    const workbuddy = { ...governedHostInteraction("workbuddy", "5.2.6"), supportsOperationJobs: true, maxSynchronousMcpRequestMs: 30000 };
    const produced = await executeEvolutionMcpSession(client, source, "Review this Proposal through one durable OperationJob", workbuddy);
    const request = { sessionId: produced.sessionId, expectedSessionDigest: produced.sessionDigest, operation: "proposal.review", input: { modelsFile, model: "contract-reviewer", reviewTimeoutMs: 5000 } };
    const forbiddenSync = await client.rawTool("review_session_proposals", { sessionId: produced.sessionId, expectedSessionDigest: produced.sessionDigest, modelsFile, model: "contract-reviewer", reviewTimeoutMs: 5000 });
    assert.equal(forbiddenSync.isError, true);
    assert.equal(forbiddenSync.structuredContent.code, "ASYNC_OPERATION_JOB_REQUIRED");
    const startedAt = Date.now();
    const first = structured(await client.tool("start_operation_job", request));
    assert.ok(Date.now() - startedAt < 200, "start_operation_job must not wait for semantic Review completion");
    assert.equal(first.status, "RUNNING");
    const repeated = structured(await client.tool("start_operation_job", request));
    assert.equal(repeated.jobId, first.jobId);
    assert.equal(repeated.identityDigest, first.identityDigest);
    const conflict = await client.rawTool("start_operation_job", { ...request, input: { ...request.input, reviewTimeoutMs: 6000 } });
    assert.equal(conflict.isError, true);
    assert.equal(conflict.structuredContent.code, "OPERATION_JOB_CONFLICT");
    const forged = await client.rawTool("inspect_operation_job", { jobId: first.jobId, expectedJobDigest: `sha256:${"f".repeat(64)}` });
    assert.equal(forged.isError, true);
    assert.equal(forged.structuredContent.code, "OPERATION_JOB_DIGEST_MISMATCH");
    let job = repeated;
    await waitUntil(async () => {
      job = structured(await client.tool("inspect_operation_job", { jobId: first.jobId }));
      return job.status !== "RUNNING";
    }, 7000);
    assert.equal(job.status, "SUCCEEDED");
    assert.equal(job.result.status, "PROPOSAL_REVIEW_PRESENTATION_REQUIRED");
    assert.equal(job.result.proposal.reviewVerdict, "READY_FOR_HUMAN_APPROVAL");
    assert.match(job.result.presentation.canonicalMarkdown, /Proposal|Harness/i);
    assert.equal(job.result.presentation.auditEnvelope, undefined);
    assert.equal(job.result.auditResource, `evopilot-harness://sessions/${produced.sessionId}`);
    assert.equal(reviewer.requests(), 1);
    const authoritativeSession = structured(await client.tool("inspect_operation_session", { sessionId: produced.sessionId }));
    assert.equal(authoritativeSession.sessionDigest, job.automaticPresentationDelivery.sessionDigest);
    assert.equal(authoritativeSession.status, "HUMAN_APPROVAL_REQUIRED");
    assert.equal(job.automaticPresentationDelivery.status, "RECORDED");
    assert.equal(job.automaticPresentationDelivery.authority.humanApproval, false);
    assert.equal(authoritativeSession.proposals[0].approval, undefined);
    assert.equal(authoritativeSession.proposals[0].publication, undefined);
    const sameCompleted = structured(await client.tool("start_operation_job", request));
    assert.equal(sameCompleted.jobId, first.jobId);
    assert.equal(sameCompleted.resultDigest, job.resultDigest);
    assert.equal(reviewer.requests(), 1);
  } finally {
    await client.close();
    await reviewer.close();
  }
});

test("MCP process loss preserves the detached OperationJob and reconnects without re-execution", async () => {
  const home = temporary("operation-job-interruption");
  const source = createCacheSource(temporary("operation-job-interruption-source"));
  const reviewer = await startReviewServer({ delayMs: 1500 });
  const modelsFile = path.join(home, "models.test.json");
  fs.mkdirSync(home, { recursive: true });
  fs.writeFileSync(modelsFile, `${JSON.stringify({ models: [{ id: "contract-reviewer", name: "Contract Reviewer", vendor: "zhipu", apiKey: "test-only", url: reviewer.url }] }, null, 2)}\n`, "utf8");
  const first = new TestMcpClient({ command: process.execPath, args: ["src/index.mjs", "mcp", "serve", "--workspace", home], cwd: root });
  await first.initialize();
  structured(await first.tool("prepare_workspace", { initialize: true }));
  const produced = await executeEvolutionMcpSession(first, source, "Interrupt but never duplicate this Proposal Review");
  const request = { sessionId: produced.sessionId, expectedSessionDigest: produced.sessionDigest, operation: "proposal.review", input: { modelsFile, model: "contract-reviewer", reviewTimeoutMs: 5000 } };
  const started = structured(await first.tool("start_operation_job", request));
  assert.equal(started.status, "RUNNING");
  first.kill("SIGKILL");
  await first.waitForExit();

  const second = new TestMcpClient({ command: process.execPath, args: ["src/index.mjs", "mcp", "serve", "--workspace", home], cwd: root });
  try {
    await second.initialize();
    let recovered;
    await waitUntil(async () => {
      recovered = structured(await second.tool("inspect_operation_job", { jobId: started.jobId }));
      return recovered.status !== "RUNNING";
    }, 7000);
    assert.equal(recovered.status, "SUCCEEDED");
    const replay = structured(await second.tool("start_operation_job", request));
    assert.equal(replay.jobId, started.jobId);
    assert.equal(replay.status, "SUCCEEDED");
    assert.equal(replay.resultDigest, recovered.resultDigest);
    assert.equal(reviewer.requests(), 1);
  } finally {
    await second.close();
    await reviewer.close();
  }
});

test("real stdio MCP requires a presented, digest-bound authorization before retrying a repairable blocked Proposal Review", async () => {
  const home = temporary("mcp-review-revise");
  const source = createCacheSource(temporary("mcp-review-revise-source"));
  const modelsFile = path.join(home, "models.test.json");
  fs.mkdirSync(home, { recursive: true });
  fs.writeFileSync(modelsFile, `${JSON.stringify({ models: [{ id: "contract-reviewer", name: "Contract Reviewer", vendor: "zhipu", apiKey: "test-only", url: "http://127.0.0.1:1/v4" }] }, null, 2)}\n`, "utf8");
  const client = new TestMcpClient({ command: process.execPath, args: ["src/index.mjs", "mcp", "serve", "--workspace", home], cwd: root });
  try {
    await client.initialize();
    structured(await client.tool("prepare_workspace", { initialize: true }));
    const produced = await executeEvolutionMcpSession(client, source, "Require a REVISE Proposal Review through the Engine");
    assert.equal(produced.status, "PROPOSAL_REVIEW_REQUIRED");
    let reviewed = structured(await client.tool("review_session_proposals", { sessionId: produced.sessionId, expectedSessionDigest: produced.sessionDigest, modelsFile, model: "contract-reviewer", reviewTimeoutMs: 5000 }));
    assert.equal(reviewed.status, "BLOCKED");
    assert.equal(reviewed.proposals[0].review.verdict, "NEED_MORE_EVIDENCE");
    assert.match(fs.readFileSync(path.join(home, "agent-sessions", reviewed.sessionId, "journal.jsonl"), "utf8"), /"event":"PROPOSAL_REVIEW_BLOCKED"/);

    assert.ok(reviewed.interaction.presentationReceipts.some((item) => item.frameDigest === reviewed.interaction.currentFrame.frameDigest && item.automatic === true));
    let retry = structured(await client.rawTool("prepare_session_lifecycle_interaction", {
      sessionId: reviewed.sessionId,
      expectedSessionDigest: reviewed.sessionDigest,
      action: "BLOCKED_RETRY"
    }));
    assert.equal(retry.status, "BLOCKED", JSON.stringify(retry));
    assert.equal(retry.interaction.currentFrame.stage, "BLOCKED_RETRY_PRESENTATION");
    const retryModel = retry.interaction.currentFrame.renderModel;
    assert.ok(retry.interaction.presentationReceipts.some((item) => item.frameDigest === retry.interaction.currentFrame.frameDigest && item.automatic === true));

    const confirmation = `AUTHORIZE_BLOCKED_OPERATION_RETRY:${retry.sessionId}:${retryModel.failedResultDigest}:${retryModel.workspaceDigest}`;
    const authorized = structured(await client.rawTool("authorize_blocked_operation_retry", {
      sessionId: retry.sessionId,
      expectedSessionDigest: retry.sessionDigest,
      expectedFailedResultDigest: retryModel.failedResultDigest,
      expectedWorkspaceDigest: retryModel.workspaceDigest,
      confirmedBy: "blocked-retry-test",
      confirmation
    }));
    assert.equal(authorized.status, "PROPOSAL_REVIEW_REQUIRED");
    assert.deepEqual(authorized.blockers, []);
    assert.equal(authorized.nextAction, "run-engine-proposal-review");
    assert.match(fs.readFileSync(path.join(home, "agent-sessions", reviewed.sessionId, "journal.jsonl"), "utf8"), /"event":"BLOCKED_OPERATION_RETRY_AUTHORIZED"/);

    const retried = structured(await client.tool("review_session_proposals", { sessionId: authorized.sessionId, expectedSessionDigest: authorized.sessionDigest, modelsFile, model: "contract-reviewer", reviewTimeoutMs: 5000 }));
    assert.equal(retried.status, "BLOCKED");
    assert.equal(retried.proposals[0].review.verdict, "NEED_MORE_EVIDENCE");
  } finally {
    await client.close();
  }
});

test("Engine Adapter executes the complete maintenance capability family with structured results", async () => {
  const home = temporary("engine-maintenance-coverage");
  const invoke = async (operation, input = {}) => {
    const access = engineOperationDefinition(operation).access;
    const authority = access === "publication" ? "publication" : access === "planned" ? "planned" : "direct";
    const result = await invokeEngineOperation({ home, operation, input, authority });
    assert.equal(result.operation, operation);
    assert.equal(result.exitCode, 0, `${operation}: ${JSON.stringify(result.result)}`);
    assert.notEqual(result.status, "FAILED", operation);
    return result;
  };

  await invoke("workspace.prepare");
  await invoke("workspace.inspect");
  const keys = await invoke("keys.generate");
  const privateKey = keys.result.privateKeyFile;
  const publicKey = keys.result.publicKeyFile;
  const assetRoot = path.join(home, "catalogs/builtin/assets");
  const assetFile = path.join(assetRoot, "profiles/observability-apm/1.2.0/asset.yaml");
  await invoke("asset.validate", { source: assetRoot });
  await invoke("asset.test", { source: assetRoot });
  await invoke("asset.inspect", { assetId: "observability-apm", kind: "HarnessProfile", source: assetRoot });
  const assetSignature = path.join(home, "signatures/asset.sig.json");
  await invoke("asset.sign", { file: assetFile, privateKey, signature: assetSignature });
  await invoke("asset.verify", { file: assetFile, publicKey, signature: assetSignature });

  const catalog = path.join(home, "catalogs/conformance");
  await invoke("catalog.publish", { source: assetRoot, out: catalog, catalogId: "conformance", generatedAt: "2026-08-19T00:00:00.000Z" });
  await invoke("catalog.validate", { source: catalog });
  await invoke("catalog.diff", { left: catalog, right: catalog });
  const catalogSignature = path.join(home, "signatures/catalog.sig.json");
  await invoke("catalog.sign", { source: catalog, privateKey, signature: catalogSignature });
  await invoke("catalog.verify", { source: catalog, publicKey, signature: catalogSignature });

  const registry = path.join(home, "harness-registry.yaml");
  await invoke("registry.validate", { registry });
  const registrySignature = path.join(home, "signatures/registry.sig.json");
  await invoke("registry.sign", { registry, privateKey, signature: registrySignature });
  await invoke("registry.verify", { registry, publicKey, signature: registrySignature });

  const ontology = path.join(home, "ontology/builtin/software-engineering.yaml");
  await invoke("ontology.inspect");
  await invoke("ontology.validate", { file: ontology });
  await invoke("ontology.diff", { left: ontology, right: ontology });
  const ontologyCandidate = path.join(home, "conformance-ontology.yaml");
  const ontologyDocument = parseYaml(fs.readFileSync(ontology, "utf8"));
  ontologyDocument.metadata.id = "conformance-ontology";
  ontologyDocument.metadata.version = "1.0.0";
  ontologyDocument.metadata.lifecycle = "approved";
  fs.writeFileSync(ontologyCandidate, stringifyYaml(ontologyDocument), "utf8");
  await invoke("ontology.publish", { file: ontologyCandidate });

  const policy = path.join(home, "policies/matcher/default.yaml");
  await invoke("policy.inspect");
  await invoke("policy.validate", { file: policy });
  await invoke("policy.diff", { left: policy, right: policy });
  const policyCandidate = path.join(home, "conformance-policy.yaml");
  const policyDocument = parseYaml(fs.readFileSync(policy, "utf8"));
  policyDocument.metadata.id = "conformance-policy";
  policyDocument.metadata.version = "1.0.0";
  policyDocument.metadata.lifecycle = "approved";
  fs.writeFileSync(policyCandidate, stringifyYaml(policyDocument), "utf8");
  await invoke("policy.publish", { file: policyCandidate });

  const feedbackAggregate = await invoke("feedback.aggregate", { now: "2026-08-19T00:00:00.000Z" });
  await invoke("feedback.report", { reportId: feedbackAggregate.result.reportId });
  await invoke("evaluation.run");
  await invoke("hub.snapshot", { out: path.join(home, "cache/conformance-hub.json") });
});

test("real stdio MCP routes every maintenance Engine operation through its authority gate", async () => {
  const home = temporary("mcp-maintenance-coverage");
  const doctor = await startDoctorServer();
  const modelsFile = path.join(home, "models.test.json");
  fs.mkdirSync(home, { recursive: true });
  fs.writeFileSync(modelsFile, `${JSON.stringify({ models: [{ id: "glm-conformance", name: "GLM Conformance", vendor: "zhipu", apiKey: "test-only", url: doctor.url }] }, null, 2)}\n`, "utf8");
  const client = new TestMcpClient({ command: process.execPath, args: ["src/index.mjs", "mcp", "serve", "--workspace", home], cwd: root });
  const directOperations = [];
  const plannedOperations = [];
  const publicationOperations = [];
  const diagnostic = async (operation, input = {}) => {
    const result = structured(await client.tool("run_engine_diagnostic", { operation, input }));
    assert.equal(result.operation, operation);
    assert.equal(result.exitCode, 0, `${operation}: ${JSON.stringify(result.result)}`);
    directOperations.push(operation);
    return result;
  };
  const maintenance = async (goal, operations) => {
    let session = structured(await client.tool("start_operation_session", { intent: goal, adapterId: "codex-conformance" }));
    session = structured(await client.tool("plan_operation_session", { sessionId: session.sessionId, expectedSessionDigest: session.sessionDigest, scenario: "maintenance", goal, operations }));
    session = structured(await client.tool("confirm_operation_plan", { sessionId: session.sessionId, expectedSessionDigest: session.sessionDigest, expectedPlanDigest: session.planDigest, confirmedBy: "conformance-operator", confirmation: `CONFIRM_OPERATION_PLAN:${session.planDigest}` }));
    for (;;) {
      session = structured(await client.tool("execute_operation_plan", { sessionId: session.sessionId, expectedSessionDigest: session.sessionDigest, expectedPlanDigest: session.planDigest }));
      if (session.status !== "OPERATION_AUTHORIZATION_REQUIRED") break;
      const pending = session.pendingOperationAuthorization;
      publicationOperations.push(pending.operation);
      session = structured(await client.tool("authorize_plan_publication_operation", {
        sessionId: session.sessionId,
        expectedSessionDigest: session.sessionDigest,
        expectedPlanDigest: session.planDigest,
        operationIndex: pending.operationIndex,
        expectedOperationDigest: pending.operationDigest,
        confirmedBy: "conformance-operator",
        confirmation: `AUTHORIZE_PLAN_PUBLICATION:${session.sessionId}:${session.planDigest}:${pending.operationIndex}:${pending.operationDigest}`
      }));
    }
    assert.equal(session.status, "COMPLETED", JSON.stringify(session.blockers));
    plannedOperations.push(...session.operations.filter((item) => item.phase === "plan" && item.planCompleted === true).map((item) => item.operation));
    return session;
  };

  try {
    await client.initialize();
    assert.equal(structured(await client.tool("prepare_workspace", { initialize: true })).status, "READY");
    plannedOperations.push("workspace.prepare");
    await diagnostic("workspace.inspect");
    await diagnostic("llm.inspect", { modelsFile, model: "glm-conformance" });
    await diagnostic("llm.diagnose", { modelsFile, model: "glm-conformance", timeoutMs: 5000 });
    await diagnostic("llm.readiness", { modelsFile });
    const initializedModel = structured(await client.tool("initialize_model_configuration", { modelsFile, model: "glm-conformance", timeoutMs: 5000 }));
    assert.equal(initializedModel.status, "CONFIGURED_AND_VERIFIED");
    assert.equal(initializedModel.connectionVerified, true);

    const assetRoot = path.join(home, "catalogs/builtin/assets");
    const assetFile = path.join(assetRoot, "profiles/observability-apm/1.2.0/asset.yaml");
    const privateKey = path.join(home, "keys/catalog-signing-private.pem");
    const publicKey = path.join(home, "keys/catalog-signing-public.pem");
    const assetSignature = path.join(home, "signatures/asset.sig.json");
    const catalog = path.join(home, "catalogs/conformance");
    const catalogSignature = path.join(home, "signatures/catalog.sig.json");
    const registry = path.join(home, "harness-registry.yaml");
    const registrySignature = path.join(home, "signatures/registry.sig.json");
    const ontology = path.join(home, "ontology/builtin/software-engineering.yaml");
    const ontologyCandidate = path.join(home, "conformance-ontology.yaml");
    const ontologyDocument = parseYaml(fs.readFileSync(ontology, "utf8"));
    ontologyDocument.metadata.id = "conformance-ontology";
    ontologyDocument.metadata.version = "1.0.0";
    ontologyDocument.metadata.lifecycle = "approved";
    fs.writeFileSync(ontologyCandidate, stringifyYaml(ontologyDocument), "utf8");
    const policy = path.join(home, "policies/matcher/default.yaml");
    const policyCandidate = path.join(home, "conformance-policy.yaml");
    const policyDocument = parseYaml(fs.readFileSync(policy, "utf8"));
    policyDocument.metadata.id = "conformance-policy";
    policyDocument.metadata.version = "1.0.0";
    policyDocument.metadata.lifecycle = "approved";
    fs.writeFileSync(policyCandidate, stringifyYaml(policyDocument), "utf8");
    const feedbackFile = path.join(home, "feedback-conformance.json");
    fs.writeFileSync(feedbackFile, `${JSON.stringify(createFeedbackPackage(home), null, 2)}\n`, "utf8");
    const now = "2026-08-19T00:02:00.000Z";

    await diagnostic("asset.validate", { source: assetRoot });
    await diagnostic("asset.test", { source: assetRoot });
    await diagnostic("asset.inspect", { assetId: "observability-apm", kind: "HarnessProfile", source: assetRoot });
    await diagnostic("registry.validate", { registry });
    await diagnostic("ontology.inspect");
    await diagnostic("ontology.validate", { file: ontology });
    await diagnostic("ontology.diff", { left: ontology, right: ontology });
    await diagnostic("policy.inspect");
    await diagnostic("policy.validate", { file: policy });
    await diagnostic("policy.diff", { left: policy, right: policy });
    await diagnostic("feedback.inspect", { file: feedbackFile });
    await diagnostic("feedback.validate", { file: feedbackFile, now });
    await diagnostic("migration.plan", { source: path.join(root, "harnesses") });
    await diagnostic("evaluation.run");

    await maintenance("Exercise every planned and publication maintenance operation", [
      { operation: "keys.generate", input: { privateKey, publicKey } },
      { operation: "asset.sign", input: { file: assetFile, privateKey, signature: assetSignature } },
      { operation: "catalog.publish", input: { source: assetRoot, out: catalog, catalogId: "conformance", generatedAt: now } },
      { operation: "catalog.sign", input: { source: catalog, privateKey, signature: catalogSignature } },
      { operation: "registry.sign", input: { registry, privateKey, signature: registrySignature } },
      { operation: "ontology.publish", input: { file: ontologyCandidate } },
      { operation: "policy.publish", input: { file: policyCandidate } },
      { operation: "feedback.ingest", input: { file: feedbackFile, now } },
      { operation: "feedback.process", input: { file: feedbackFile, now } },
      { operation: "feedback.aggregate", input: { now } },
      { operation: "migration.apply", input: { source: path.join(root, "harnesses") } },
      { operation: "hub.snapshot", input: { out: path.join(home, "cache/conformance-hub.json") } }
    ]);

    await diagnostic("asset.verify", { file: assetFile, publicKey, signature: assetSignature });
    await diagnostic("catalog.validate", { source: catalog });
    await diagnostic("catalog.diff", { left: catalog, right: catalog });
    await diagnostic("catalog.verify", { source: catalog, publicKey, signature: catalogSignature });
    await diagnostic("registry.verify", { registry, publicKey, signature: registrySignature });
    const reportId = path.basename(fs.readdirSync(path.join(home, "feedback/reports")).sort().at(-1), ".json");
    await diagnostic("feedback.report", { reportId });
    const migrationId = path.basename(fs.readdirSync(path.join(home, "migrations")).find((name) => name.endsWith(".json")), ".json");
    await maintenance("Rollback the conformance migration through a confirmed Plan", [{ operation: "migration.rollback", input: { migrationId } }]);

    const covered = new Set([...directOperations, ...plannedOperations, ...publicationOperations]);
    const proposalFamily = new Set(["proposal.inspect", "proposal.validate", "proposal.review", "proposal.review.inspect", "proposal.approve", "proposal.publish"]);
    const evidenceFamily = new Set(["evidence.produce"]);
    const comparativeFamily = new Set(engineCapabilities().map((item) => item.id).filter((operation) => operation.startsWith("comparison.") || operation.startsWith("calibration.")));
    const learningFamily = new Set(engineCapabilities().map((item) => item.id).filter((operation) => operation.startsWith("learning.")));
    const expected = engineCapabilities().map((item) => item.id).filter((operation) => !proposalFamily.has(operation) && !evidenceFamily.has(operation) && !comparativeFamily.has(operation) && !learningFamily.has(operation));
    assert.deepEqual([...covered].sort(), expected.sort());
  } finally {
    await client.close();
    await doctor.close();
  }
});

test("planned Engine operation receipts replay an immutable result without duplicate mutation", async () => {
  const home = temporary("operation-receipt");
  initializeWorkspace(home);
  const source = createCacheSource(temporary("operation-receipt-source"));
  const idempotencyKey = crypto.createHash("sha256").update("operation-receipt-test").digest("hex");
  const request = { home, operation: "evidence.produce", input: { sourceProjects: [source], goal: "Evolve a distributed cache Harness", advisor: "off" }, authority: "planned", idempotencyKey };
  const first = await invokeEngineOperation(request);
  const runsAfterFirst = fs.readdirSync(path.join(home, "evolution-runs")).sort();
  const second = await invokeEngineOperation(request);
  const runsAfterSecond = fs.readdirSync(path.join(home, "evolution-runs")).sort();
  assert.deepEqual(second, first);
  assert.deepEqual(runsAfterSecond, runsAfterFirst);
});

test("Agent Operation Session binds plan digests and resumes across adapters", () => {
  const home = temporary("session");
  initializeWorkspace(home);
  const created = createAgentSession({ home, intent: "Evolve a reusable distributed cache Harness", adapterId: "codex", hostInteraction: governedHostInteraction() });
  assert.equal(validateAgentSession(created).status, "VALIDATED");
  const source = createCacheSource(home);
  const planned = createSessionPlan({ home, sessionId: created.sessionId, expectedSessionDigest: created.sessionDigest, goal: created.intent.text, sources: { sourceProjects: [source], advisor: "off" } });
  assert.equal(planned.status, "PLAN_REVIEW_REQUIRED");
  assert.equal(validateOperationPlan(planned.plan).status, "VALIDATED");
  assert.equal(planned.interaction.frameArchive.length, 1);
  assert.equal(planned.interaction.frameArchive[0].frameDigest, planned.interaction.currentFrame.frameDigest);
  assert.throws(() => confirmSessionPlan({ home, sessionId: planned.sessionId, expectedSessionDigest: planned.sessionDigest, expectedPlanDigest: planned.planDigest, confirmedBy: "operator", confirmation: "continue" }), /Complete visible PLAN_PRESENTATION presentation is required/);
  const frame = planned.interaction.currentFrame;
  const presented = recordBusinessViewDelivery({ home, sessionId: planned.sessionId, expectedSessionDigest: planned.sessionDigest, expectedFrameDigest: frame.frameDigest, deliveredBusinessViewDigest: frame.businessView.businessViewDigest, renderedBusinessViewDigest: `sha256:${crypto.createHash("sha256").update(frame.businessView.canonicalMarkdown).digest("hex")}` });
  assert.throws(() => confirmSessionPlan({ home, sessionId: presented.sessionId, expectedSessionDigest: presented.sessionDigest, expectedPlanDigest: presented.planDigest, confirmedBy: "operator", confirmation: "continue" }), /Plan confirmation must equal/);
  const confirmed = confirmSessionPlan({ home, sessionId: presented.sessionId, expectedSessionDigest: presented.sessionDigest, expectedPlanDigest: presented.planDigest, confirmedBy: "operator", confirmation: `CONFIRM_OPERATION_PLAN:${presented.planDigest}` });
  assert.throws(() => resumeAgentSession({ home, sessionId: confirmed.sessionId, expectedSessionDigest: planned.sessionDigest, adapterId: "stale-agent" }), /Session changed since the caller last read it/);
  const resumed = resumeAgentSession({ home, sessionId: confirmed.sessionId, expectedSessionDigest: confirmed.sessionDigest, adapterId: "generic-mcp-agent" });
  assert.deepEqual(resumed.adapter.history, ["codex", "generic-mcp-agent"]);
  assert.deepEqual(resumed.compatibility, operationCompatibility());
  assert.equal(inspectAgentSession(home, resumed.sessionId).sessionDigest, resumed.sessionDigest);
  const cancellable = createAgentSession({ home, intent: "Cancel this reviewed test Session without executing a Plan", adapterId: "codex", hostInteraction: governedHostInteraction() });
  const cancelPrepared = prepareSessionLifecycleInteraction({ home, sessionId: cancellable.sessionId, expectedSessionDigest: cancellable.sessionDigest, action: "CANCEL" });
  const cancelFrame = cancelPrepared.interaction.currentFrame;
  const cancelPresented = recordBusinessViewDelivery({ home, sessionId: cancelPrepared.sessionId, expectedSessionDigest: cancelPrepared.sessionDigest, expectedFrameDigest: cancelFrame.frameDigest, deliveredBusinessViewDigest: cancelFrame.businessView.businessViewDigest, renderedBusinessViewDigest: `sha256:${crypto.createHash("sha256").update(cancelFrame.businessView.canonicalMarkdown).digest("hex")}` });
  const cancelled = cancelAgentSession({ home, sessionId: cancelPresented.sessionId, expectedSessionDigest: cancelPresented.sessionDigest, confirmedBy: "operator", confirmation: `CANCEL_SESSION:${cancelPresented.sessionId}:${cancelPresented.sessionDigest}` });
  assert.equal(cancelled.status, "CANCELLED");
});

test("real stdio MCP rejects incompatible versions and exposes no network transport", async () => {
  const home = temporary("mcp-version");
  const rejected = new TestMcpClient({ command: process.execPath, args: ["src/index.mjs", "mcp", "serve", "--transport", "stdio", "--workspace", home], cwd: root });
  await assert.rejects(() => rejected.initialize("1900-01-01"), /Unsupported MCP protocol version/);
  const stopped = await rejected.close();
  assert.equal(stopped.code, 0);

  const incompatible = new TestMcpClient({ command: process.execPath, args: ["src/index.mjs", "mcp", "serve", "--transport", "stdio", "--workspace", home], cwd: root });
  const mismatched = { ...operationCompatibility(), coreDigest: `sha256:${"0".repeat(64)}` };
  await assert.rejects(() => incompatible.initialize("2025-06-18", mismatched), /Agent compatibility is missing or incompatible/);
  const incompatibleStopped = await incompatible.close();
  assert.equal(incompatibleStopped.code, 0);
  assert.equal(fs.existsSync(path.join(home, "config.yaml")), false, "compatibility mismatch must fail before Workspace initialization");

  const standard = new TestMcpClient({ command: process.execPath, args: ["src/index.mjs", "mcp", "serve", "--transport", "stdio", "--workspace", home], cwd: root });
  try {
    const initialized = await standard.initializeStandard("2025-11-25");
    assert.equal(initialized.protocolVersion, "2025-11-25");
    const capabilities = structured(await standard.tool("inspect_capabilities"));
    assert.deepEqual(capabilities.compatibility, operationCompatibility());
    assert.equal(fs.existsSync(path.join(home, "config.yaml")), false, "standard initialization and capability inspection must remain read-only");
  } finally {
    await standard.close();
  }

  const client = new TestMcpClient({ command: process.execPath, args: ["src/index.mjs", "mcp", "serve", "--transport", "stdio", "--workspace", home], cwd: root });
  try {
    const initialized = await client.initialize();
    assert.equal(initialized.protocolVersion, "2025-06-18");
    assert.equal(initialized.serverInfo.name, "evopilot-harness-operation-server");
    const capabilities = structured(await client.tool("inspect_capabilities"));
    assert.equal(capabilities.mcp.transport, "stdio");
    assert.equal(capabilities.mcp.networkListening, false);
    assert.equal(capabilities.authority.sourceExecutionAllowed, false);
    assert.deepEqual(capabilities.compatibility, operationCompatibility());
    const listeners = spawnSync("lsof", ["-nP", "-a", "-p", String(client.child.pid), "-iTCP", "-sTCP:LISTEN"], { encoding: "utf8" });
    assert.equal(listeners.error, undefined, `lsof network-listener inspection failed: ${listeners.error?.message ?? "unknown error"}`);
    assert.equal(listeners.stdout?.trim(), "");
    const tools = await client.request("tools/list");
    assert.ok(tools.tools.length >= 16);
    await assert.rejects(() => client.tool("run_engine_diagnostic", { operation: "catalog.publish", input: {} }), /must be one of/);
    const resources = await client.request("resources/list");
    assert.ok(resources.resources.some((item) => item.uri === "evopilot-harness://digital-expert/manifest"));
  } finally {
    const closed = await client.close();
    assert.equal(closed.code, 0);
    assert.equal(closed.signal, null);
  }

  const signaled = new TestMcpClient({ command: process.execPath, args: ["src/index.mjs", "mcp", "serve", "--transport", "stdio", "--workspace", home], cwd: root });
  await signaled.initialize();
  signaled.kill("SIGTERM");
  const graceful = await signaled.waitForExit();
  assert.equal(graceful.code, 0);
  assert.equal(graceful.signal, null);
  assert.match(graceful.stderr, /"status":"GRACEFUL"/);
});

test("incompatible MCP clients cannot recover or mutate persisted Sessions", async () => {
  const home = temporary("mcp-handshake-mutation");
  initializeWorkspace(home);
  const created = createAgentSession({ home, intent: "Preserve this running Session until a compatible host initializes", adapterId: "codex" });
  const file = path.join(home, "agent-sessions", created.sessionId, "session.json");
  const running = JSON.parse(fs.readFileSync(file, "utf8"));
  running.status = "RUNNING";
  running.nextAction = "wait-for-engine-results";
  delete running.sessionDigest;
  running.sessionDigest = `sha256:${crypto.createHash("sha256").update(JSON.stringify(sortValue(running))).digest("hex")}`;
  fs.writeFileSync(file, `${JSON.stringify(running, null, 2)}\n`);
  const before = fs.readFileSync(file, "utf8");

  const incompatible = new TestMcpClient({ command: process.execPath, args: ["src/index.mjs", "mcp", "serve", "--workspace", home], cwd: root });
  const mismatch = { ...operationCompatibility(), expertVersion: "0.0.0" };
  await assert.rejects(() => incompatible.initialize("2025-06-18", mismatch), /Agent compatibility is missing or incompatible/);
  await incompatible.close();
  assert.equal(fs.readFileSync(file, "utf8"), before);

  const compatible = new TestMcpClient({ command: process.execPath, args: ["src/index.mjs", "mcp", "serve", "--workspace", home], cwd: root });
  try {
    await compatible.initialize();
    const recovered = structured(await compatible.tool("inspect_operation_session", { sessionId: created.sessionId }));
    assert.equal(recovered.status, "INTERRUPTED");
    assert.ok(recovered.blockers.includes("operation-server-stopped-during-engine-operation"));
  } finally {
    await compatible.close();
  }
});

test("recovery preserves incompatible persisted Sessions byte-for-byte", () => {
  const home = temporary("persisted-session-compatibility");
  initializeWorkspace(home);
  const created = createAgentSession({ home, intent: "Preserve an incompatible running Session", adapterId: "codex" });
  const file = path.join(home, "agent-sessions", created.sessionId, "session.json");
  const running = JSON.parse(fs.readFileSync(file, "utf8"));
  running.status = "RUNNING";
  running.nextAction = "wait-for-engine-results";
  running.compatibility.expertVersion = "0.0.0";
  delete running.sessionDigest;
  running.sessionDigest = `sha256:${crypto.createHash("sha256").update(JSON.stringify(sortValue(running))).digest("hex")}`;
  fs.writeFileSync(file, `${JSON.stringify(running, null, 2)}\n`);
  const before = fs.readFileSync(file);

  const recovery = recoverInterruptedSessions(home);
  assert.deepEqual(recovery, [{ sessionId: created.sessionId, status: "INCOMPATIBLE_PRESERVED", code: "AGENT_COMPATIBILITY_MISMATCH", nextAction: "reload-current-digital-expert-adapter-and-reinitialize" }]);
  assert.deepEqual(fs.readFileSync(file), before);
});

test("every Session mutation rejects persisted Digital Expert Core drift without changing state", () => {
  const home = temporary("persisted-session-core-drift");
  initializeWorkspace(home);
  const created = createAgentSession({ home, intent: "Reject same-version Digital Expert Core drift", adapterId: "codex" });
  const file = path.join(home, "agent-sessions", created.sessionId, "session.json");
  const stale = JSON.parse(fs.readFileSync(file, "utf8"));
  stale.compatibility.coreDigest = `sha256:${"0".repeat(64)}`;
  delete stale.sessionDigest;
  stale.sessionDigest = `sha256:${crypto.createHash("sha256").update(JSON.stringify(sortValue(stale))).digest("hex")}`;
  fs.writeFileSync(file, `${JSON.stringify(stale, null, 2)}\n`);
  const before = fs.readFileSync(file, "utf8");

  assert.throws(
    () => createSessionPlan({
      home,
      sessionId: stale.sessionId,
      expectedSessionDigest: stale.sessionDigest,
      scenario: "evolve",
      goal: "This mutation must fail closed",
      sources: { note: "static evidence" }
    }),
    (error) => error.code === "SESSION_COMPATIBILITY_BINDING_MISMATCH"
      && error.nextAction === "reload-current-digital-expert-adapter-and-reinitialize"
  );
  assert.equal(fs.readFileSync(file, "utf8"), before);
});

test("stopped Protocol v3 Sessions explicitly migrate across a same-boundary Core replacement without authority drift", () => {
  const home = temporary("session-core-compatible-migration");
  initializeWorkspace(home);
  const created = createAgentSession({ home, intent: "Resume after compatible candidate Core replacement", adapterId: "workbuddy" });
  const file = path.join(home, "agent-sessions", created.sessionId, "session.json");
  const stale = JSON.parse(fs.readFileSync(file, "utf8"));
  const priorCoreDigest = `sha256:${"1".repeat(64)}`;
  stale.compatibility.coreDigest = priorCoreDigest;
  delete stale.sessionDigest;
  stale.sessionDigest = `sha256:${crypto.createHash("sha256").update(JSON.stringify(sortValue(stale))).digest("hex")}`;
  fs.writeFileSync(file, `${JSON.stringify(stale, null, 2)}\n`);

  assert.throws(() => migrateOperationSessionCoreCompatibility({
    home,
    sessionId: stale.sessionId,
    expectedSessionDigest: stale.sessionDigest,
    expectedPriorCoreDigest: `sha256:${"2".repeat(64)}`,
    adapterId: "workbuddy"
  }), (error) => error.code === "SESSION_PRIOR_CORE_DIGEST_MISMATCH");

  const migrated = migrateOperationSessionCoreCompatibility({
    home,
    sessionId: stale.sessionId,
    expectedSessionDigest: stale.sessionDigest,
    expectedPriorCoreDigest: priorCoreDigest,
    adapterId: "workbuddy"
  });
  assert.deepEqual(migrated.compatibility, operationCompatibility());
  assert.equal(migrated.status, created.status);
  assert.deepEqual(migrated.humanDecisions, created.humanDecisions);
  assert.equal(migrated.migrationHistory.at(-1).authorityChanged, false);
  assert.equal(migrated.migrationHistory.at(-1).businessStateChanged, false);
});

test("independent Generic Agent Host matches the Codex Adapter plan and stop semantics", async () => {
  const home = temporary("generic-host");
  const sourceHome = temporary("generic-source");
  const source = createCacheSource(sourceHome);
  const sourceBefore = treeDigest(source);
  const output = execFileSync(process.execPath, ["digital-expert/conformance/generic-host.mjs", "--workspace", home, "--source", source, "--goal", "Evolve a reusable distributed cache Harness"], { cwd: root, encoding: "utf8" });
  const report = JSON.parse(output);
  assert.equal(report.status, "PASSED");
  assert.equal(report.adapterId, "generic");
  assert.equal(report.networkListening, false);
  assert.equal(report.digitalExpertSchema, "evopilot-harness-digital-expert/v1");
  assert.equal(report.workflow.renderedDecision.status, "PROPOSAL_REVIEW_REQUIRED");
  assert.equal(report.workflow.renderedDecision.frameStage, "PLAN_PRESENTATION");
  assert.match(report.workflow.renderedDecision.businessViewDigest, /^sha256:[a-f0-9]{64}$/);
  assert.match(report.workflow.renderedDecision.renderedBusinessViewDigest, /^sha256:[a-f0-9]{64}$/);
  assert.match(report.workflow.renderedDecision.deliveryReceiptDigest, /^sha256:[a-f0-9]{64}$/);
  const codex = await runAdapterPlanTrace(temporary("codex-host"), source, "codex");
  assert.deepEqual(semanticWorkflow(report.workflow), semanticWorkflow(codex));
  assert.equal(treeDigest(source), sourceBefore);
});

test("Agent-to-MCP-to-Engine lifecycle keeps plan, approval, and publication separate", async () => {
  const home = temporary("mcp-lifecycle");
  const sourceCommandSentinel = path.join(home, "source-command-must-not-run");
  const source = createCacheSource(home, sourceCommandSentinel);
  const sourceBefore = treeDigest(source);
  const releaseBefore = releaseDigest();
  const reviewer = await startReviewServer();
  const modelsFile = path.join(home, "models.test.json");
  fs.writeFileSync(modelsFile, `${JSON.stringify({ models: [{ id: "contract-reviewer", name: "Contract Reviewer", vendor: "zhipu", apiKey: "test-only", url: reviewer.url, supportsToolCall: true, supportsReasoning: false }] }, null, 2)}\n`, "utf8");
  const modelsBefore = fileDigest(modelsFile);

  const client = new TestMcpClient({ command: process.execPath, args: ["src/index.mjs", "mcp", "serve", "--transport", "stdio", "--workspace", home], cwd: root });
  try {
    await client.initialize();
    const prepared = structured(await client.tool("prepare_workspace", { initialize: true }));
    assert.equal(prepared.status, "READY");
    const started = structured(await client.tool("start_operation_session", { intent: "Evolve a reusable distributed cache product Harness from static evidence", adapterId: "codex" }));
    await assert.rejects(() => client.tool("plan_operation_session", {
      sessionId: started.sessionId,
      expectedSessionDigest: started.sessionDigest,
      scenario: "evolve",
      goal: started.intent.text,
      sources: { sourceProjects: [source], apiKey: "must-never-persist" }
    }), /does not accept: apiKey/);
    const noteSecret = await client.tool("plan_operation_session", {
      sessionId: started.sessionId,
      expectedSessionDigest: started.sessionDigest,
      scenario: "evolve",
      goal: started.intent.text,
      sources: { sourceProjects: [source], notes: ["authorization: Bearer must-never-persist"] }
    });
    assert.equal(noteSecret.isError, true);
    assert.equal(structured(noteSecret).code, "SENSITIVE_SESSION_INPUT_REJECTED");
    assert.doesNotMatch(fs.readFileSync(path.join(home, "agent-sessions", started.sessionId, "session.json"), "utf8"), /must-never-persist/);
    const planned = structured(await client.tool("plan_operation_session", {
      sessionId: started.sessionId,
      expectedSessionDigest: started.sessionDigest,
      scenario: "evolve",
      goal: started.intent.text,
      sources: { sourceProjects: [source], advisor: "off", modelsFile, model: "contract-reviewer" }
    }));
    assert.equal(planned.status, "PLAN_REVIEW_REQUIRED");
    const staleResume = await client.tool("resume_operation_session", { sessionId: planned.sessionId, expectedSessionDigest: started.sessionDigest, adapterId: "stale-agent" });
    assert.equal(staleResume.isError, true);
    assert.equal(structured(staleResume).code, "SESSION_DIGEST_MISMATCH");

    const planFrame = planned.interaction.currentFrame;
    const planPresented = structured(await client.tool("record_business_view_delivery", {
      sessionId: planned.sessionId,
      expectedSessionDigest: planned.sessionDigest,
      expectedFrameDigest: planFrame.frameDigest,
      deliveredBusinessViewDigest: planFrame.businessView.businessViewDigest,
      renderedBusinessViewDigest: `sha256:${crypto.createHash("sha256").update(planFrame.businessView.canonicalMarkdown).digest("hex")}`
    }));
    const invalidConfirmation = await client.rawTool("confirm_operation_plan", {
      sessionId: planPresented.sessionId,
      expectedSessionDigest: planPresented.sessionDigest,
      expectedPlanDigest: planned.planDigest,
      confirmedBy: "acceptance-operator",
      confirmation: "continue"
    });
    assert.equal(invalidConfirmation.isError, true);
    assert.equal(structured(invalidConfirmation).code, "EXPLICIT_PLAN_CONFIRMATION_REQUIRED");

    const confirmed = structured(await client.tool("confirm_operation_plan", {
      sessionId: planPresented.sessionId,
      expectedSessionDigest: planPresented.sessionDigest,
      expectedPlanDigest: planned.planDigest,
      confirmedBy: "acceptance-operator",
      confirmation: `CONFIRM_OPERATION_PLAN:${planned.planDigest}`
    }));
    const produced = structured(await client.tool("execute_operation_plan", { sessionId: confirmed.sessionId, expectedSessionDigest: confirmed.sessionDigest, expectedPlanDigest: confirmed.planDigest }));
    assert.equal(produced.status, "PROPOSAL_REVIEW_REQUIRED");
    assert.equal(produced.proposals.length, 1);

    const crossAgent = structured(await client.tool("resume_operation_session", { sessionId: produced.sessionId, expectedSessionDigest: produced.sessionDigest, adapterId: "claude-code" }));
    assert.deepEqual(crossAgent.adapter.history, ["codex", "claude-code"]);
    for (const operation of ["proposal.inspect", "proposal.validate"]) {
      const diagnostic = structured(await client.tool("run_engine_diagnostic", { operation, input: { proposalId: crossAgent.proposals[0].proposalId } }));
      assert.equal(diagnostic.operation, operation);
      assert.equal(diagnostic.exitCode, 0);
    }
    const reviewed = structured(await client.tool("review_session_proposals", { sessionId: crossAgent.sessionId, expectedSessionDigest: crossAgent.sessionDigest, modelsFile, model: "contract-reviewer", reviewTimeoutMs: 5000 }));
    assert.equal(reviewed.status, "HUMAN_APPROVAL_REQUIRED", JSON.stringify(reviewed.blockers));
    assert.deepEqual(reviewed.interaction.frameArchive.map((frame) => frame.stage), ["PLAN_PRESENTATION", "PROPOSAL_REVIEW_PRESENTATION"]);
    const proposal = reviewed.proposals[0];
    assert.equal(proposal.review.verdict, "READY_FOR_HUMAN_APPROVAL");
    const reviewInspection = structured(await client.tool("run_engine_diagnostic", { operation: "proposal.review.inspect", input: { proposalId: proposal.proposalId } }));
    assert.equal(reviewInspection.operation, "proposal.review.inspect");
    assert.equal(reviewInspection.exitCode, 0);

    const reviewFrame = reviewed.interaction.currentFrame;
    const reviewPresented = structured(await client.tool("record_business_view_delivery", {
      sessionId: reviewed.sessionId,
      expectedSessionDigest: reviewed.sessionDigest,
      expectedFrameDigest: reviewFrame.frameDigest,
      deliveredBusinessViewDigest: reviewFrame.businessView.businessViewDigest,
      renderedBusinessViewDigest: `sha256:${crypto.createHash("sha256").update(reviewFrame.businessView.canonicalMarkdown).digest("hex")}`
    }));
    const noImplicitApproval = await client.rawTool("approve_session_proposal", {
      sessionId: reviewPresented.sessionId,
      proposalId: proposal.proposalId,
      expectedSessionDigest: reviewPresented.sessionDigest,
      expectedProposalDigest: proposal.proposalDigest,
      expectedReviewDigest: proposal.review.reportDigest,
      confirmedBy: "acceptance-operator",
      confirmation: "continue",
      evaluationReviewed: true
    });
    assert.equal(noImplicitApproval.isError, true);
    const approved = structured(await client.tool("approve_session_proposal", {
      sessionId: reviewPresented.sessionId,
      proposalId: proposal.proposalId,
      expectedSessionDigest: reviewPresented.sessionDigest,
      expectedProposalDigest: proposal.proposalDigest,
      expectedReviewDigest: proposal.review.reportDigest,
      confirmedBy: "acceptance-operator",
      confirmation: `APPROVE_PROPOSAL:${proposal.proposalId}:${proposal.proposalDigest}:${proposal.review.reportDigest}`,
      evaluationReviewed: true
    }));
    assert.equal(approved.status, "PUBLICATION_DECISION_REQUIRED");
    assert.equal(approved.proposals[0].publicationAuthorization, undefined);

    const approvedReference = approved.proposals[0];
    const authorized = structured(await client.tool("authorize_proposal_publication", {
      sessionId: approved.sessionId,
      proposalId: approvedReference.proposalId,
      expectedSessionDigest: approved.sessionDigest,
      expectedProposalDigest: approvedReference.approvedProposalDigest,
      confirmedBy: "acceptance-operator",
      confirmation: `AUTHORIZE_PUBLICATION:${approvedReference.proposalId}:${approvedReference.approvedProposalDigest}`
    }));
    assert.equal(authorized.status, "PUBLICATION_AUTHORIZED");
    const published = structured(await client.tool("publish_session_proposal", {
      sessionId: authorized.sessionId,
      proposalId: approvedReference.proposalId,
      expectedSessionDigest: authorized.sessionDigest,
      expectedAuthorizationDigest: authorized.proposals[0].publicationAuthorization.authorizationDigest
    }));
    assert.equal(published.status, "COMPLETED", JSON.stringify(published.blockers));
    assert.equal(published.proposals[0].publication.catalogStatus, "VALIDATED");

    const closed = structured(await client.tool("close_operation_session", {
      sessionId: published.sessionId,
      expectedSessionDigest: published.sessionDigest,
      confirmedBy: "acceptance-operator",
      confirmation: `CLOSE_SESSION:${published.sessionId}:${published.sessionDigest}`
    }));
    assert.equal(closed.status, "CLOSED");
    const cleaned = structured(await client.tool("cleanup_operation_session", {
      sessionId: closed.sessionId,
      expectedSessionDigest: closed.sessionDigest,
      confirmedBy: "acceptance-operator",
      confirmation: `DELETE_SESSION_STATE:${closed.sessionId}:${closed.sessionDigest}`
    }));
    assert.equal(cleaned.status, "CLEANED");
    assert.ok(cleaned.preserved.includes("assets"));
    assert.equal(treeDigest(source), sourceBefore);
    assert.equal(releaseDigest(), releaseBefore);
    assert.equal(fileDigest(modelsFile), modelsBefore);
    assert.equal(fs.existsSync(sourceCommandSentinel), false);
    const cancellable = structured(await client.tool("start_operation_session", { intent: "Cancel this conformance Session without executing", adapterId: "codex-conformance" }));
    const cancelled = structured(await client.tool("cancel_operation_session", { sessionId: cancellable.sessionId, expectedSessionDigest: cancellable.sessionDigest, confirmedBy: "acceptance-operator", confirmation: `CANCEL_SESSION:${cancellable.sessionId}:${cancellable.sessionDigest}` }));
    assert.equal(cancelled.status, "CANCELLED");
  } finally {
    await client.close();
    await reviewer.close();
  }
});

test("maintenance publication requires a separate digest-bound operation authorization", async () => {
  const home = temporary("maintenance-publication");
  initializeWorkspace(home);
  const sourcePack = path.join(home, "ontology/builtin/software-engineering.yaml");
  const document = parseYaml(fs.readFileSync(sourcePack, "utf8"));
  document.metadata.id = "acceptance-ontology";
  document.metadata.version = "1.0.0";
  document.metadata.lifecycle = "approved";
  const inputFile = path.join(home, "acceptance-ontology.yaml");
  fs.writeFileSync(inputFile, stringifyYaml(document), "utf8");
  const destination = path.join(home, "ontology/acceptance-ontology@1.0.0.yaml");

  const client = new TestMcpClient({ command: process.execPath, args: ["src/index.mjs", "mcp", "serve", "--workspace", home], cwd: root });
  try {
    await client.initialize();
    const started = structured(await client.tool("start_operation_session", { intent: "Publish one reviewed OntologyPack", adapterId: "codex" }));
    const outside = temporary("maintenance-outside");
    const escape = path.join(home, "escape");
    fs.symlinkSync(outside, escape);
    const outsideWrite = await client.tool("plan_operation_session", {
      sessionId: started.sessionId,
      expectedSessionDigest: started.sessionDigest,
      scenario: "maintenance",
      goal: "Attempt a write outside the Workspace",
      operations: [{ operation: "keys.generate", input: { privateKey: path.join(escape, "private.pem"), publicKey: path.join(home, "keys/public.pem") } }]
    });
    assert.equal(outsideWrite.isError, true);
    assert.equal(structured(outsideWrite).code, "WORKSPACE_WRITE_BOUNDARY_VIOLATION");
    assert.equal(fs.existsSync(path.join(outside, "private.pem")), false);
    fs.unlinkSync(escape);
    const planned = structured(await client.tool("plan_operation_session", {
      sessionId: started.sessionId,
      expectedSessionDigest: started.sessionDigest,
      scenario: "maintenance",
      goal: started.intent.text,
      operations: [{ operation: "ontology.publish", input: { file: inputFile } }]
    }));
    const confirmed = structured(await client.tool("confirm_operation_plan", { sessionId: planned.sessionId, expectedSessionDigest: planned.sessionDigest, expectedPlanDigest: planned.planDigest, confirmedBy: "acceptance-operator", confirmation: `CONFIRM_OPERATION_PLAN:${planned.planDigest}` }));
    const stopped = structured(await client.tool("execute_operation_plan", { sessionId: confirmed.sessionId, expectedSessionDigest: confirmed.sessionDigest, expectedPlanDigest: confirmed.planDigest }));
    assert.equal(stopped.status, "OPERATION_AUTHORIZATION_REQUIRED");
    assert.equal(fs.existsSync(destination), false);
    const pending = stopped.pendingOperationAuthorization;
    const implicit = await client.rawTool("authorize_plan_publication_operation", {
      sessionId: stopped.sessionId,
      expectedSessionDigest: stopped.sessionDigest,
      expectedPlanDigest: stopped.planDigest,
      operationIndex: pending.operationIndex,
      expectedOperationDigest: pending.operationDigest,
      confirmedBy: "acceptance-operator",
      confirmation: "continue"
    });
    assert.equal(implicit.isError, true);
    const authorized = structured(await client.tool("authorize_plan_publication_operation", {
      sessionId: stopped.sessionId,
      expectedSessionDigest: stopped.sessionDigest,
      expectedPlanDigest: stopped.planDigest,
      operationIndex: pending.operationIndex,
      expectedOperationDigest: pending.operationDigest,
      confirmedBy: "acceptance-operator",
      confirmation: `AUTHORIZE_PLAN_PUBLICATION:${stopped.sessionId}:${stopped.planDigest}:${pending.operationIndex}:${pending.operationDigest}`
    }));
    assert.equal(authorized.status, "READY_TO_EXECUTE");
    const completed = structured(await client.tool("execute_operation_plan", { sessionId: authorized.sessionId, expectedSessionDigest: authorized.sessionDigest, expectedPlanDigest: authorized.planDigest }));
    assert.equal(completed.status, "COMPLETED");
    assert.equal(fs.existsSync(destination), true);
    assert.ok(completed.humanDecisions.some((item) => item.type === "PLAN_PUBLICATION_AUTHORIZED"));
  } finally {
    await client.close();
  }
});

test("multiple Proposals remain publishable until every authorized Proposal is published", async () => {
  const home = temporary("multi-proposal");
  const corpus = createProductCorpus(temporary("multi-proposal-source"));
  const reviewer = await startReviewServer();
  const modelsFile = path.join(home, "models.test.json");
  fs.mkdirSync(home, { recursive: true });
  fs.writeFileSync(modelsFile, `${JSON.stringify({ models: [{ id: "contract-reviewer", name: "Contract Reviewer", vendor: "zhipu", apiKey: "test-only", url: reviewer.url }] }, null, 2)}\n`, "utf8");
  const client = new TestMcpClient({ command: process.execPath, args: ["src/index.mjs", "mcp", "serve", "--workspace", home], cwd: root });
  try {
    await client.initialize();
    structured(await client.tool("prepare_workspace", { initialize: true }));
    let session = structured(await client.tool("start_operation_session", { intent: "Produce reusable Harnesses from two distinct product projects", adapterId: "codex" }));
    session = structured(await client.tool("plan_operation_session", { sessionId: session.sessionId, expectedSessionDigest: session.sessionDigest, scenario: "evolve", goal: session.intent.text, sources: { sourceRoot: corpus, advisor: "required", modelsFile, model: "contract-reviewer" } }));
    session = structured(await client.tool("confirm_operation_plan", { sessionId: session.sessionId, expectedSessionDigest: session.sessionDigest, expectedPlanDigest: session.planDigest, confirmedBy: "acceptance-operator", confirmation: `CONFIRM_OPERATION_PLAN:${session.planDigest}` }));
    session = structured(await client.tool("execute_operation_plan", { sessionId: session.sessionId, expectedSessionDigest: session.sessionDigest, expectedPlanDigest: session.planDigest }));
    assert.ok(session.proposals.length >= 2, JSON.stringify(session.proposals));
    session = structured(await client.tool("review_session_proposals", { sessionId: session.sessionId, expectedSessionDigest: session.sessionDigest, modelsFile, model: "contract-reviewer", reviewTimeoutMs: 5000 }));
    assert.equal(session.status, "HUMAN_APPROVAL_REQUIRED", JSON.stringify(session));
    for (const proposal of session.proposals) {
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
    }
    assert.equal(session.status, "PUBLICATION_DECISION_REQUIRED");
    for (const proposal of session.proposals) {
      session = structured(await client.tool("authorize_proposal_publication", {
        sessionId: session.sessionId,
        proposalId: proposal.proposalId,
        expectedSessionDigest: session.sessionDigest,
        expectedProposalDigest: proposal.approvedProposalDigest,
        confirmedBy: "acceptance-operator",
        confirmation: `AUTHORIZE_PUBLICATION:${proposal.proposalId}:${proposal.approvedProposalDigest}`
      }));
    }
    assert.equal(session.status, "PUBLICATION_AUTHORIZED");
    for (let index = 0; index < session.proposals.length; index += 1) {
      const proposal = session.proposals[index];
      session = structured(await client.tool("publish_session_proposal", {
        sessionId: session.sessionId,
        proposalId: proposal.proposalId,
        expectedSessionDigest: session.sessionDigest,
        expectedAuthorizationDigest: proposal.publicationAuthorization.authorizationDigest
      }));
      assert.equal(session.status, index === session.proposals.length - 1 ? "COMPLETED" : "PUBLICATION_AUTHORIZED");
    }
    assert.ok(session.proposals.every((item) => item.status === "PUBLISHED"));
  } finally {
    await client.close();
    await reviewer.close();
  }
});

test("forced process stop is recovered as an interrupted digest-bound session", async () => {
  const home = temporary("mcp-crash");
  const source = createCacheSource(home);
  for (let index = 0; index < 6000; index += 1) fs.writeFileSync(path.join(source, `evidence-${String(index).padStart(4, "0")}.md`), `Build test validate cache replica failover record ${index}.\n`);
  initializeWorkspace(home);
  const first = new TestMcpClient({ command: process.execPath, args: ["src/index.mjs", "mcp", "serve", "--workspace", home], cwd: root });
  await first.initialize();
  const started = structured(await first.tool("start_operation_session", { intent: "Exercise interruption recovery from static evidence", adapterId: "codex" }));
  const planned = structured(await first.tool("plan_operation_session", { sessionId: started.sessionId, expectedSessionDigest: started.sessionDigest, goal: started.intent.text, sources: { sourceProjects: [source], advisor: "off" } }));
  const confirmed = structured(await first.tool("confirm_operation_plan", { sessionId: planned.sessionId, expectedSessionDigest: planned.sessionDigest, expectedPlanDigest: planned.planDigest, confirmedBy: "recovery-operator", confirmation: `CONFIRM_OPERATION_PLAN:${planned.planDigest}` }));
  const inFlight = first.tool("execute_operation_plan", { sessionId: confirmed.sessionId, expectedSessionDigest: confirmed.sessionDigest, expectedPlanDigest: confirmed.planDigest }).catch(() => null);
  const file = path.join(home, "agent-sessions", confirmed.sessionId, "session.json");
  await waitUntil(() => JSON.parse(fs.readFileSync(file, "utf8")).status === "RUNNING", 3000);
  first.kill("SIGKILL");
  const forced = await first.waitForExit();
  assert.equal(forced.signal, "SIGKILL");
  await inFlight;

  const second = new TestMcpClient({ command: process.execPath, args: ["src/index.mjs", "mcp", "serve", "--workspace", home], cwd: root });
  try {
    await second.initialize();
    const recovered = structured(await second.tool("inspect_operation_session", { sessionId: confirmed.sessionId }));
    assert.equal(recovered.status, "INTERRUPTED");
    assert.equal(recovered.nextAction, "reconcile-interrupted-operation");
    assert.ok(recovered.blockers.includes("operation-server-stopped-during-engine-operation"));
    assert.equal(recovered.inFlightOperation.status, "OUTCOME_UNKNOWN");
    const runRoot = path.join(home, "evolution-runs");
    const runsBefore = fs.existsSync(runRoot) ? fs.readdirSync(runRoot).sort() : [];
    const retry = await second.tool("execute_operation_plan", { sessionId: recovered.sessionId, expectedSessionDigest: recovered.sessionDigest, expectedPlanDigest: recovered.planDigest, retryConfirmation: `RETRY_INTERRUPTED_PLAN:${recovered.sessionId}:${recovered.planDigest}` });
    assert.equal(retry.isError, true);
    assert.equal(structured(retry).code, "INTERRUPTED_OPERATION_RECONCILIATION_REQUIRED");
    const reconciliation = await second.tool("resolve_interrupted_operation", { sessionId: recovered.sessionId, expectedSessionDigest: recovered.sessionDigest, expectedAttemptDigest: recovered.inFlightOperation.attemptDigest, confirmedBy: "recovery-operator", confirmation: "continue" });
    assert.equal(reconciliation.isError, true);
    const reconciliationCode = structured(reconciliation).code;
    const recoveryPresented = structured(await second.tool("inspect_operation_session", { sessionId: recovered.sessionId }));
    if (reconciliationCode === "EXPLICIT_UNCHANGED_RETRY_REQUIRED") {
      const resolved = structured(await second.tool("resolve_interrupted_operation", {
        sessionId: recoveryPresented.sessionId,
        expectedSessionDigest: recoveryPresented.sessionDigest,
        expectedAttemptDigest: recoveryPresented.inFlightOperation.attemptDigest,
        confirmedBy: "recovery-operator",
        confirmation: `CONFIRM_RETRY_UNCHANGED_OPERATION:${recoveryPresented.sessionId}:${recoveryPresented.inFlightOperation.attemptDigest}:${recoveryPresented.inFlightOperation.workspaceDigestBefore}`
      }));
      const completed = structured(await second.tool("execute_operation_plan", { sessionId: resolved.sessionId, expectedSessionDigest: resolved.sessionDigest, expectedPlanDigest: resolved.planDigest }));
      assert.equal(completed.status, "PROPOSAL_REVIEW_REQUIRED");
      const runsAfter = fs.readdirSync(runRoot).sort();
      assert.equal(runsAfter.length, runsBefore.length + 1);
    } else if (reconciliationCode === "EXPLICIT_RECEIPT_ACCEPTANCE_REQUIRED") {
      const receiptFile = path.join(home, "agent-operation-receipts", `${recovered.inFlightOperation.idempotencyKey}.json`);
      const receipt = JSON.parse(fs.readFileSync(receiptFile, "utf8"));
      const resolved = structured(await second.tool("resolve_interrupted_operation", {
        sessionId: recoveryPresented.sessionId,
        expectedSessionDigest: recoveryPresented.sessionDigest,
        expectedAttemptDigest: recoveryPresented.inFlightOperation.attemptDigest,
        confirmedBy: "recovery-operator",
        confirmation: `ACCEPT_OPERATION_RECEIPT:${recoveryPresented.sessionId}:${recoveryPresented.inFlightOperation.attemptDigest}:${receipt.receiptDigest}`
      }));
      const completed = structured(await second.tool("execute_operation_plan", { sessionId: resolved.sessionId, expectedSessionDigest: resolved.sessionDigest, expectedPlanDigest: resolved.planDigest }));
      assert.equal(completed.status, "PROPOSAL_REVIEW_REQUIRED");
      assert.deepEqual(fs.readdirSync(runRoot).sort(), runsBefore);
    } else {
      assert.equal(reconciliationCode, "INTERRUPTED_OPERATION_OUTCOME_UNCERTAIN");
      const runsAfter = fs.existsSync(runRoot) ? fs.readdirSync(runRoot).sort() : [];
      assert.deepEqual(runsAfter, runsBefore);
      const cancelled = structured(await second.tool("cancel_operation_session", { sessionId: recoveryPresented.sessionId, expectedSessionDigest: recoveryPresented.sessionDigest, confirmedBy: "recovery-operator", confirmation: `CANCEL_SESSION:${recoveryPresented.sessionId}:${recoveryPresented.sessionDigest}` }));
      assert.equal(cancelled.status, "CANCELLED");
    }
  } finally {
    await second.close();
  }
});

function temporary(label) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `evopilot-harness-v4-${label}-`));
}

function createCacheSource(home, commandSentinel = path.join(home, "source-command-must-not-run")) {
  const source = path.join(home, "read-only-source");
  fs.mkdirSync(source, { recursive: true });
  fs.writeFileSync(path.join(source, "package.json"), `${JSON.stringify({ name: "distributed-cache-engine", scripts: { test: "node should-not-run.mjs", build: "node should-not-run.mjs" }, description: "Redis compatible distributed cache product with TTL eviction replication failover hash slot migration" }, null, 2)}\n`);
  fs.writeFileSync(path.join(source, "README.md"), "# Distributed Cache Product\n\nBuild, test, validate, diagnose, benchmark, migrate, verify, rollback, and release a Redis-compatible key-value store with TTL, eviction, replication, failover, consistent hash slots, persistence, and protocol compatibility.\n");
  fs.writeFileSync(path.join(source, "should-not-run.mjs"), `import fs from "node:fs"; fs.writeFileSync(${JSON.stringify(commandSentinel)}, "SOURCE COMMAND EXECUTED");\n`);
  return source;
}

function createProductCorpus(rootDirectory) {
  const client = path.join(rootDirectory, "redisclient");
  const scheduler = path.join(rootDirectory, "scheduler-platform");
  fs.mkdirSync(path.join(client, "src/main/java"), { recursive: true });
  fs.mkdirSync(scheduler, { recursive: true });
  fs.writeFileSync(path.join(client, "pom.xml"), "<project><artifactId>redisclient</artifactId><dependencies><dependency><artifactId>jedis</artifactId></dependency></dependencies></project>\n");
  fs.writeFileSync(path.join(client, "README.md"), "Redis client library and Jedis wrapper providing connection pools, command adapters, serialization, retries, and client-side observability. It does not implement a Redis server, storage engine, replication, persistence, or cluster failover.\n");
  fs.writeFileSync(path.join(scheduler, "package.json"), JSON.stringify({ name: "scheduler-platform", description: "Scheduler platform task dispatch worker queue cron orchestration" }));
  fs.writeFileSync(path.join(scheduler, "README.md"), "Scheduler platform for cron triggers, task dispatch, worker queues, retries, dependency orchestration, execution history, monitoring, rollback, and release validation.\n");
  return rootDirectory;
}

function createFeedbackPackage(home) {
  const assets = discoverAssets([path.join(home, "catalogs/builtin/assets")]);
  const bundle = assets.find((record) => record.asset.kind === "HarnessBundle" && record.asset.metadata.id === "distributed-cache-product");
  assert.ok(bundle, "distributed-cache-product Bundle should be available");
  const profile = assets.find((record) => record.asset.kind === "HarnessProfile" && record.asset.metadata.id === bundle.asset.spec.profile.id && record.asset.metadata.version === bundle.asset.spec.profile.version);
  assert.ok(profile, "Bundle Profile should be available");
  const componentRefs = bundle.asset.spec.resolvedComponents.map((reference) => {
    const component = assets.find((record) => record.asset.kind === "HarnessComponent" && record.asset.metadata.id === reference.id && record.asset.metadata.version === reference.version);
    assert.ok(component, `Bundle Component ${reference.id} should be available`);
    return { id: component.asset.metadata.id, version: component.asset.metadata.version, digest: component.digest };
  });
  const document = {
    apiVersion: "feedback.evopilot.io/v1",
    kind: "HarnessExecutionFeedbackPackage",
    metadata: { packageId: "v4-conformance-feedback", version: "1.0.0", generatedAt: "2026-08-19T00:00:00.000Z", expiresAt: "2026-09-19T00:00:00.000Z", producer: { name: "v4-conformance", version: "1.0.0", instanceId: "stdio-mcp" }, packageDigest: `sha256:${"0".repeat(64)}` },
    approval: { status: "APPROVED", approvedBy: "conformance@example.invalid", approvedAt: "2026-08-19T00:01:00.000Z", purpose: "Digital Expert runtime conformance" },
    redaction: { status: "REDACTED", policyVersion: "redaction-v1", removedFieldCount: 0, payloadDigest: `sha256:${"0".repeat(64)}` },
    harnessBinding: { bundleRef: { id: bundle.asset.metadata.id, version: bundle.asset.metadata.version, digest: bundle.digest }, profileRef: { id: profile.asset.metadata.id, version: profile.asset.metadata.version, digest: profile.digest }, componentRefs },
    executionContext: { taskClass: "conformance", complexity: "LOW", environmentDigest: `sha256:${"1".repeat(64)}`, trajectoryRefs: ["trajectory:v4-conformance"], startedAt: "2026-08-18T23:58:00.000Z", completedAt: "2026-08-18T23:59:00.000Z" },
    dimensions: { outcome: { status: "SUCCEEDED", score: 1, acceptancePassed: 1, acceptanceTotal: 1 }, process: { status: "COMPLETED", stepCount: 1, failedStepCount: 0, retryCount: 0, durationMs: 60000 }, safety: { status: "SAFE", violationCount: 0, incidentCount: 0 }, cost: { status: "RECORDED", inputTokens: 1, outputTokens: 1, totalTokens: 2, estimatedCost: 0, currency: "USD" } },
    provenance: { sourceType: "reviewed-external-execution", sourceId: "v4-conformance", requestIds: ["request:v4-conformance"], model: { provider: "zhipu", name: "glm-conformance" }, evidenceRefs: ["evidence:v4-conformance"] }
  };
  document.redaction.payloadDigest = feedbackPayloadDigest(document);
  document.metadata.packageDigest = feedbackPackageDigest(document);
  return document;
}

async function runAdapterPlanTrace(home, source, adapterId) {
  const client = new TestMcpClient({ command: process.execPath, args: ["src/index.mjs", "mcp", "serve", "--workspace", home], cwd: root });
  try {
    await client.initialize();
    const prepared = structured(await client.tool("prepare_workspace", { initialize: true }));
    const intent = "Evolve a reusable distributed cache Harness";
    const started = structured(await client.tool("start_operation_session", { intent, adapterId }));
    const planned = structured(await client.tool("plan_operation_session", { sessionId: started.sessionId, expectedSessionDigest: started.sessionDigest, scenario: "evolve", goal: intent, sources: { sourceProjects: [source], advisor: "off" } }));
    const confirmed = structured(await client.tool("confirm_operation_plan", { sessionId: planned.sessionId, expectedSessionDigest: planned.sessionDigest, expectedPlanDigest: planned.planDigest, confirmedBy: `${adapterId}-conformance`, confirmation: `CONFIRM_OPERATION_PLAN:${planned.planDigest}` }));
    const produced = structured(await client.tool("execute_operation_plan", { sessionId: confirmed.sessionId, expectedSessionDigest: confirmed.sessionDigest, expectedPlanDigest: confirmed.planDigest }));
    return {
      statuses: [prepared.status, started.status, planned.status, confirmed.status, produced.status],
      plan: { scenario: planned.plan.scenario, operations: planned.plan.operations.map((item) => item.operation), stopPoints: planned.plan.stopPoints },
      engineCalls: produced.operations.filter((item) => item.phase === "plan" && item.planCompleted === true).map((item) => item.operation),
      renderedDecision: { status: produced.status, nextAction: produced.nextAction, proposalCount: produced.proposals.length },
      session: { sessionId: produced.sessionId, sessionDigest: produced.sessionDigest }
    };
  } finally {
    await client.close();
  }
}

function semanticWorkflow(workflow) {
  return {
    statuses: workflow.statuses,
    plan: workflow.plan,
    engineCalls: workflow.engineCalls,
    renderedDecision: {
      status: workflow.renderedDecision.status,
      nextAction: workflow.renderedDecision.nextAction,
      proposalCount: workflow.renderedDecision.proposalCount
    }
  };
}

function treeDigest(directory) {
  const hash = crypto.createHash("sha256");
  const files = walk(directory);
  for (const file of files) hash.update(path.relative(directory, file)).update(fs.readFileSync(file));
  return hash.digest("hex");
}

function releaseDigest() {
  const hash = crypto.createHash("sha256");
  for (const file of walkRelease(root)) hash.update(path.relative(root, file)).update(fs.readFileSync(file));
  return hash.digest("hex");
}

function fileDigest(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function sortValue(value) {
  if (Array.isArray(value)) return value.map(sortValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortValue(value[key])]));
}

function walkRelease(directory) {
  const excluded = new Set([".git", "dist", "node_modules"]);
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (excluded.has(entry.name)) return [];
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return walkRelease(target);
    return entry.isFile() ? [target] : [];
  }).sort();
}

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(target) : [target];
  }).sort();
}

async function startReviewServer({ verdict = "READY_FOR_HUMAN_APPROVAL", delayMs = 0 } = {}) {
  let requestCount = 0;
  const server = http.createServer(async (request, response) => {
    requestCount += 1;
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    const prompt = JSON.parse(body.messages.at(-1).content);
    if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
    const evidenceIds = prompt.evidenceGraph.map((item) => item.evidenceId);
    const firstEvidence = evidenceIds[0];
    const reviewPrompt = prompt.task?.startsWith("Independently review") || prompt.task?.startsWith("Repair the previous Proposal Review");
    if (!reviewPrompt) {
      const advisor = {
        recommendation: "PROPOSE_NEW_PROFILE",
        rationale: "The cited static evidence supports a bounded reusable Harness Profile proposal.",
        evidenceIds: [firstEvidence],
        risks: ["Human review remains required."],
        proposedDeltas: ["Review the proposed boundary, validators, and Evaluation cases."]
      };
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(advisor) } }], usage: { prompt_tokens: 80, completion_tokens: 40, total_tokens: 120 } }));
      return;
    }
    const projectMembership = prompt.sources.map((source) => ({ sourceId: source.sourceId, sourceType: source.sourceType, sourceRef: source.sourceRef, status: "IN_SCOPE", rationale: "The cited static evidence describes ownership and engineering of the cache product.", evidenceIds: [source.evidenceIds[0]] }));
    const ready = verdict === "READY_FOR_HUMAN_APPROVAL";
    const assessment = {
      verdict,
      summary: ready ? "The evidence-bound Proposal is coherent, specific, and ready for a separate human approval decision." : "The Proposal must be revised before human approval.",
      findings: [{ id: "semantic-boundary", severity: ready ? "info" : "blocking", dimension: "boundary", conclusion: ready ? "The Proposal represents a cache product rather than a client wrapper." : "The proposed boundary is broader than the cited ownership evidence.", reasons: [ready ? "Product protocol, persistence, replication, failover, and migration are cited." : "The source evidence does not justify the full proposed product boundary."], evidenceIds: [firstEvidence], suggestedActions: [ready ? "Review Evaluation cases before approval." : "Narrow the boundary and regenerate the Proposal."] }],
      reasons: [ready ? "Static evidence and deterministic gates support the proposed existing-profile evolution." : "Independent semantic review found a blocking boundary issue."],
      groupCoherence: { status: "COHERENT", rationale: "All source evidence belongs to one product boundary.", evidenceIds: projectMembership.length > 1 ? [firstEvidence] : [] },
      projectMembership,
      boundaryAssessment: { status: ready ? "PRECISE" : "FAIL", rationale: ready ? "The boundary excludes client-only wrappers and covers cache-server engineering." : "The proposed boundary overstates source ownership.", evidenceIds: [firstEvidence] },
      existingAssetOverlap: { status: "EVOLVE_EXISTING", rationale: "The existing distributed-cache profile is the closest professional asset.", candidates: [], evidenceIds: [] },
      definitionQuality: { status: ready ? "READY" : "FAIL", score: ready ? 0.94 : 0.4, rationale: ready ? "The definition is constrained, executable, evidence-backed, and evaluable." : "The definition needs a narrower evidence-backed boundary.", checks: [{ id: "specificity", status: ready ? "PASS" : "FAIL" }], evidenceIds: [] },
      evaluationSufficiency: { status: ready ? "READY_FOR_REVIEW" : "FAIL", rationale: ready ? "Positive and negative Evaluation cases are present for human review." : "Evaluation expectations encode the disputed boundary.", evidenceIds: [] },
      advisorAssessment: { status: ready ? "NOT_REQUIRED" : "CONFLICTED", rationale: ready ? "The deterministic existing-profile match does not require Advisor override." : "The deterministic match does not resolve the semantic boundary conflict.", evidenceIds: [firstEvidence] },
      suggestedActions: [ready ? "Complete the explicit Evaluation review and human approval gate." : "Revise the Proposal and rerun Proposal Review."]
    };
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(assessment) } }], usage: { prompt_tokens: 100, completion_tokens: 80, total_tokens: 180 } }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  return { url: `http://127.0.0.1:${address.port}/v4`, requests: () => requestCount, close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())) };
}

async function executeEvolutionMcpSession(client, source, intent, hostInteraction) {
  let session = structured(await client.tool("start_operation_session", { intent, adapterId: hostInteraction?.id ?? "codex-conformance", ...(hostInteraction ? { hostInteraction } : {}) }));
  session = structured(await client.tool("plan_operation_session", { sessionId: session.sessionId, expectedSessionDigest: session.sessionDigest, scenario: "evolve", goal: intent, sources: { sourceProjects: [source], advisor: "off" } }));
  session = structured(await client.tool("confirm_operation_plan", { sessionId: session.sessionId, expectedSessionDigest: session.sessionDigest, expectedPlanDigest: session.planDigest, confirmedBy: "conformance-operator", confirmation: `CONFIRM_OPERATION_PLAN:${session.planDigest}` }));
  return structured(await client.tool("execute_operation_plan", { sessionId: session.sessionId, expectedSessionDigest: session.sessionDigest, expectedPlanDigest: session.planDigest }));
}

async function startDoctorServer() {
  const server = http.createServer(async (request, response) => {
    for await (const _chunk of request) { /* consume request body */ }
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({
      model: "glm-conformance",
      choices: [{ message: { content: JSON.stringify({ status: "ok" }) } }],
      usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 }
    }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  return { url: `http://127.0.0.1:${address.port}/v4`, close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())) };
}

async function waitUntil(predicate, timeoutMs) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      if (await predicate()) return;
    } catch { /* state file may be between initial creation and update */ }
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  throw new Error(`Condition was not met within ${timeoutMs}ms.`);
}
