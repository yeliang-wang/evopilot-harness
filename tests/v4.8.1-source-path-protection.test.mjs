import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { digest } from "../src/v3/utils.mjs";
import { initializeWorkspace } from "../src/v3/workspace.mjs";
import { collectEvidence, discoverSourceProjects } from "../src/v3/reasoning.mjs";
import { assertSourcePath, captureSourceFile, walkSourceFiles, SOURCE_CONTENT_POLICY, SOURCE_CONTENT_POLICY_DIGEST, MAX_SOURCE_FILE_BYTES } from "../src/v4/source/path-policy.mjs";
import { extractStaticSourceText } from "../src/v4/source/static-text.mjs";
import { buildSourceConceptHypothesis } from "../src/v4/classification/source-concept.mjs";
import { normalizeSourceDescriptor, resolveSourceDescriptor } from "../src/v4/classification/source-descriptor.mjs";
import { analyzeSourceTaxonomy, createClassificationHandoff } from "../src/v4/classification/engine.mjs";
import { startClassificationSession, resumeClassificationSession, inspectClassificationSession, continueClassificationToHarness } from "../src/v4/classification/session-store.mjs";
import { createSessionPlan, executeSessionPlan, resumeAgentSession, resolveInterruptedOperation } from "../src/v4/session/store.mjs";
import { TestMcpClient } from "./helpers/mcp-client.mjs";

const protectedPaths = [".codex/config.toml", ".codebuddy/mcp.json", ".workbuddy/state.json", ".claude/settings.json", ".opencode/models.json", ".cursor/mcp.json", ".ssh/id_rsa", ".aws/credentials", ".azure/accessTokens.json", ".kube/config", ".gnupg/key", ".config/provider/config.json", ".cache/host/state.json", ".local/share/host/state.json", "Library/Keychains/login.keychain", "Library/Application Support/host/state.json", ".netrc", ".npmrc", ".pypirc", ".git-credentials", "auth.json", "credentials.json", "credentials.yaml", "credentials.yml", "models.json", "models.yaml", "models.yml", "model-config.json", "model-config.yaml", "model-config.yml", "mcp.json", "mcp.config.json", "mcp.config.yaml", "mcp.config.yml", ".env", ".env.local", "private.pem", "private.key", "private.p12", "private.pfx", "private.keystore", "nested/.codex/config.toml", ".CoDeX/config.toml", "CREDENTIALS.JSON"];
function fixture(t) { const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "source-policy-"))); t.after(() => fs.rmSync(root, { recursive: true, force: true })); return root; }
function put(root, name, text = "SYNTHETIC_PRIVATE_CONTENT_MUST_NOT_BE_READ") { const file = path.join(root, name); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); return file; }
function guards(t, forbidden) {
  const reads = [], opens = [], originalRead = fs.readFileSync, originalOpen = fs.openSync;
  t.mock.method(fs, "readFileSync", function(file, ...args) { if (typeof file !== "number" && forbidden.has(path.resolve(String(file)))) { reads.push(String(file)); throw Error("forbidden content read"); } return originalRead.call(this, file, ...args); });
  t.mock.method(fs, "openSync", function(file, ...args) { if (forbidden.has(path.resolve(String(file)))) { opens.push(String(file)); throw Error("forbidden content open"); } return originalOpen.call(this, file, ...args); });
  t.mock.method(fs, "createReadStream", () => { throw Error("Source must not bypass captured reads"); });
  return { reads, opens };
}
const policyError = error => error.code === "SOURCE_PROTECTED_PATH" && !error.message.includes("SYNTHETIC_PRIVATE") && !error.message.includes(os.tmpdir());
function taxonomy() { return { apiVersion: "harness.evopilot.io/v1", kind: "Taxonomy", metadata: { namespace: "example", name: "source-boundary", version: "1.0.0" }, spec: { engineRange: ">=4.5.0 <5.0.0", requiredCapabilities: ["taxonomy-c14n/v1", "source-concept-hypothesis/v1", "open-world-taxonomy-classifier/v1", "taxonomy-decision-aggregate/v1"], axisPolicies: { domainCardinality: "SINGLE", productCardinality: "SINGLE" }, domains: [{ id: "middleware", label: "Middleware", definition: "Reusable infrastructure cache", assignable: true, positiveEvidenceHints: ["redis", "cache", "middleware"] }], products: [{ id: "cache", label: "Distributed cache", definition: "Redis cache with replication", assignable: true, positiveEvidenceHints: ["redis", "cache", "ttl", "replication"] }] } }; }
function advisor(input) { return { candidates: Object.entries(input.candidates).flatMap(([axis, candidates]) => candidates.map(c => ({ axis, nodeId: c.nodeId, support: c.nonLlmEvidence.length ? "SUPPORT" : "NEUTRAL", confidence: c.nonLlmEvidence.length ? .95 : .5, evidenceIds: c.nonLlmEvidence.slice(0, 2).map(e => e.evidenceId) }))), unresolvedConcepts: [] }; }
function publicSource(root) { const source = path.join(root, "source"); put(source, "README.md", "This middleware implements a Redis distributed cache with TTL eviction replication and key-value storage.\n"); put(source, "package.json", JSON.stringify({ name: "cache-service", dependencies: { redis: "5.0.0", ioredis: "5.4.0" } })); return source; }

// A post-read redaction cannot satisfy these assertions: opening a protected
// content file itself throws, before any byte can enter Engine memory.
test("Source path protection excludes every declared private path before content open and preserves public material", t => {
  const root = fixture(t), source = publicSource(root);
  for (const name of ["src/main.js", "docs/architecture.md", ".agents/skills/public/SKILL.md", "models.example.json", ".env.example", ".env.sample", ".env.template"]) put(source, name, "public cache architecture\n");
  const privateFiles = new Set(protectedPaths.map(name => put(source, name)));
  const baseline = buildSourceConceptHypothesis(source); // before guarded execution; only public bytes are selected
  const monitor = guards(t, privateFiles);
  const current = buildSourceConceptHypothesis(source);
  assert.equal(current.provenance.sourceContentBoundary.policy, SOURCE_CONTENT_POLICY);
  assert.equal(current.provenance.sourceContentBoundary.policyDigest, SOURCE_CONTENT_POLICY_DIGEST);
  assert.deepEqual(current, baseline);
  assert.ok(current.sourceSnapshot.files.some(f => f.sourceRef === ".agents/skills/public/SKILL.md"));
  assert.ok(current.sourceSnapshot.files.some(f => f.sourceRef === "models.example.json"));
  for (const file of current.sourceSnapshot.files) assert.equal(privateFiles.has(path.join(source, file.sourceRef)), false);
  assert.equal(JSON.stringify(current).includes("SYNTHETIC_PRIVATE"), false);
  assert.deepEqual(monitor, { reads: [], opens: [] });
});

test("Source public snapshot remains byte-compatible and excludes policy bookkeeping", t => {
  const root = fixture(t), file = put(root, "README.md", "public evidence\n"), actual = buildSourceConceptHypothesis(file);
  const expected = { schema: "evopilot-harness-static-source-snapshot/v1", sourceBinding: { type: "LOCAL_FILE", sourceId: undefined }, files: [{ sourceRef: "README.md", sourceDigest: digest("public evidence\n"), bytes: 16, readable: true }], fileCount: 1, characterCount: 16, bounded: false, redactionResult: { policy: "evopilot-harness-source-redaction/v1", applied: false, redactedFileCount: 0 }, sourceExecution: false, networkAcquisition: false };
  assert.equal(actual.sourceSnapshotDigest, digest(expected));
  const source = publicSource(root), first = buildSourceConceptHypothesis(source);
  put(source, ".codex/config.toml", "private one"); const second = buildSourceConceptHypothesis(source);
  put(source, ".codex/config.toml", "private two"); const third = buildSourceConceptHypothesis(source);
  assert.equal(first.sourceSnapshotDigest, second.sourceSnapshotDigest); assert.equal(second.sourceSnapshotDigest, third.sourceSnapshotDigest); assert.equal(second.hypothesisDigest, third.hypothesisDigest);
  put(source, "README.md", "changed public evidence\n"); assert.notEqual(buildSourceConceptHypothesis(source).sourceSnapshotDigest, third.sourceSnapshotDigest);
});

test("Source directory scans omit protected two-part paths even when the rule straddles the selected root", t => {
  const root = fixture(t);
  for (const [parent, child] of [["Library", "Keychains"], ["Library", "Application Support"], [".local", "share"]]) {
    const source = path.join(root, parent), good = put(source, "README.md", "public"), bad = put(source, `${child}/state.json`);
    const monitor = guards(t, new Set([bad]));
    assert.deepEqual(walkSourceFiles(source).files, [good]); assert.equal(buildSourceConceptHypothesis(source).sourceSnapshot.fileCount, 1);
    assert.deepEqual(monitor, { reads: [], opens: [] }); t.mock.restoreAll();
  }
});

test("Source explicit paths, legacy and resolved inputs, ordered members and extractors refuse before any content read", t => {
  const root = fixture(t), good = put(root, "good.md", "public"), bad = put(root, ".codex/config.toml"), monitor = guards(t, new Set([bad, good]));
  for (const type of ["LOCAL_FILE", "CONTROLLED_FIXTURE", "LOCAL_DIRECTORY", "LOCAL_GIT_REPOSITORY"]) assert.throws(() => normalizeSourceDescriptor({ type, path: type.includes("DIRECTORY") || type.includes("REPOSITORY") ? path.dirname(bad) : bad }), policyError);
  for (const invoke of [() => buildSourceConceptHypothesis(bad), () => buildSourceConceptHypothesis({ path: bad, type: "LOCAL_FILE" }), () => buildSourceConceptHypothesis({ type: "ORDERED_ATTACHMENT_SET", files: [{ path: good }, { path: bad }] }), () => resolveSourceDescriptor({ descriptor: { type: "ORDERED_ATTACHMENT_SET", members: [{ path: good }, { path: bad }] }, workspace: root }), () => extractStaticSourceText(bad), () => captureSourceFile(bad)]) assert.throws(invoke, policyError);
  assert.deepEqual(monitor, { reads: [], opens: [] });
});

test("Source selected symlinks, hard links and swapped file identity reject before reading the replacement", t => {
  const root = fixture(t), privateFile = put(root, ".codex/config.toml"), alias = path.join(root, "alias.md");
  fs.symlinkSync(privateFile, alias); assert.throws(() => captureSourceFile(alias), policyError);
  const linkRoot = path.join(root, "source-link"); fs.symlinkSync(path.dirname(privateFile), linkRoot); assert.throws(() => walkSourceFiles(linkRoot), policyError);
  const directory = path.join(root, "public"); put(directory, "README.md", "public"); fs.symlinkSync(path.dirname(privateFile), path.join(directory, "linked")); assert.deepEqual(walkSourceFiles(directory).files.map(f => path.basename(f)), ["README.md"]);
  const hard = path.join(root, "hard.md"); fs.linkSync(privateFile, hard); assert.throws(() => captureSourceFile(hard), policyError);
  const source = put(root, "race.md", "public"), original = fs.openSync; let changed = false; const read = fs.readSync;
  t.mock.method(fs, "openSync", function(file, ...args) { if (file === source && !changed) { changed = true; fs.renameSync(source, source + ".saved"); fs.copyFileSync(privateFile, source); } return original.call(this, file, ...args); });
  t.mock.method(fs, "readSync", () => { throw Error("replacement content was read"); });
  assert.throws(() => captureSourceFile(source), e => e.code === "SOURCE_PATH_CHANGED"); assert.equal(changed, true);
  t.mock.restoreAll(); assert.equal(fs.readSync, read);
});

test("Source roots inside a managed checkout remain supported while nested protected state is excluded", t => {
  const root = fixture(t); t.mock.method(os, "homedir", () => root); const repository = path.join(root, ".codex/worktrees/fixture/repository"); put(repository, "README.md", "public"); put(repository, ".codex/config.toml");
  assert.equal(assertSourcePath(repository), repository); assert.deepEqual(walkSourceFiles(repository).files, [path.join(repository, "README.md")]);
  assert.throws(() => assertSourcePath(path.join(root, ".codex/worktrees")), policyError);
  const nested = put(repository, ".codex/worktrees/evil/repository/README.md", "must remain protected");
  assert.throws(() => assertSourcePath(nested), policyError);
  const alias = path.join(root, "public-alias"); fs.symlinkSync(repository, alias);
  assert.throws(() => captureSourceFile(path.join(alias, "README.md")), policyError);
});

test("Source declared public evidence fixtures retain unrelated Host ancestors without admitting Host state", t => {
  const root = fixture(t); t.mock.method(os, "homedir", () => root);
  const source = path.join(root, ".codex/evidence/review/fixture"), publicFile = put(source, "README.md", "public evidence\n");
  const bad = put(source, ".codex/worktrees/nested/project/README.md"), config = put(source, ".codebuddy/mcp.json");
  const monitor = guards(t, new Set([bad, config]));
  assert.deepEqual(walkSourceFiles(source).files, [publicFile]);
  assert.equal(buildSourceConceptHypothesis(source).sourceSnapshot.fileCount, 1);
  assert.equal(buildSourceConceptHypothesis(publicFile).sourceSnapshot.fileCount, 1);
  assert.equal(normalizeSourceDescriptor({ type: "CONTROLLED_FIXTURE", path: publicFile }).locator.path, publicFile);
  assert.equal(buildSourceConceptHypothesis({ type: "ORDERED_ATTACHMENT_SET", files: [{ path: publicFile, memberIndex: 0, sourceId: "declared-fixture" }] }).sourceSnapshot.fileCount, 1);
  for (const relative of [".codex", ".codex/evidence", ".codex/worktrees", ".codex/worktrees/id", ".codex/config.toml", ".codex/sessions/current.json", ".codex/skills/public/SKILL.md", ".codebuddy/mcp.json", ".codex/evidence/review/fixture/.codex/worktrees/nested/project/README.md", ".codex/evidence/review/fixture/.codebuddy/mcp.json"]) assert.throws(() => assertSourcePath(path.join(root, relative), { mustExist: false }), policyError);
  assert.throws(() => captureSourceFile(publicFile, { root: path.join(root, "unrelated") }), policyError);
  assert.deepEqual(walkSourceFiles(root).files, []); // selecting home never traverses the Host container
  assert.deepEqual(monitor, { reads: [], opens: [] });
});

test("Source intermediate directory replacement and public hard links fail before content acquisition", t => {
  const root = fixture(t), source = path.join(root, "source"), file = put(source, "README.md", "public"), privateRoot = path.join(root, ".codex"); put(privateRoot, "README.md");
  const hard = path.join(root, "public-copy.md"); fs.linkSync(file, hard);
  assert.throws(() => captureSourceFile(hard), policyError); assert.throws(() => captureSourceFile(file), policyError); fs.unlinkSync(hard);
  const originalOpen = fs.openSync; let swapped = false;
  t.mock.method(fs, "openSync", function(target, ...args) { if (target === file && !swapped) { swapped = true; fs.renameSync(source, source + "-saved"); fs.symlinkSync(privateRoot, source); } return originalOpen.call(this, target, ...args); });
  t.mock.method(fs, "readSync", () => { throw Error("replacement content was read"); });
  assert.throws(() => captureSourceFile(file), e => e.code === "SOURCE_PATH_CHANGED"); assert.equal(swapped, true);
});

test("Source v3 evidence ingestion protects project and attachment paths without changing model configuration", t => {
  const root = fixture(t), home = path.join(root, "workspace"), source = publicSource(root); initializeWorkspace(home);
  const bad = put(source, ".codebuddy/mcp.json"), monitor = guards(t, new Set([bad]));
  const graph = collectEvidence({ options: { "source-project": source, "run-id": "public-only" } }, home).graph;
  assert.ok(graph.nodes.length >= 2); assert.equal(JSON.stringify(graph).includes("SYNTHETIC_PRIVATE"), false); assert.deepEqual(discoverSourceProjects(source), [source]);
  assert.throws(() => collectEvidence({ options: { attachment: [path.join(source, "README.md"), bad], "run-id": "protected-explicit" } }, home), policyError);
  assert.deepEqual(monitor, { reads: [], opens: [] });
});

test("Source file byte limit refuses before allocating or opening contents", t => {
  const root = fixture(t), file = put(root, "large.md", ""); fs.truncateSync(file, MAX_SOURCE_FILE_BYTES + 1); const monitor = guards(t, new Set([file]));
  assert.throws(() => captureSourceFile(file), e => e.code === "SOURCE_FILE_LIMIT"); assert.deepEqual(monitor, { reads: [], opens: [] });
});

test("Source retained v2 CLI scan, discovery and attachments share pre-read protection without changing public classification", t => {
  const root = fixture(t), source = publicSource(root), log = path.join(root, "forbidden-reads.jsonl");
  const probe = put(root, "probe.mjs", `import fs from 'node:fs'; import path from 'node:path';
    for (const method of ['readFileSync', 'openSync']) { const original = fs[method]; fs[method] = function(file, ...args) {
      if (typeof file !== 'number' && String(file).startsWith(process.env.SOURCE_POLICY_TEST_ROOT) && (String(file).includes(path.sep + '.codex' + path.sep) || process.env.SOURCE_POLICY_TEST_NO_PUBLIC_READ === String(file))) {
        fs.appendFileSync(process.env.SOURCE_POLICY_TEST_LOG, method + '\\n'); throw Error('forbidden Source content acquisition');
      } return original.call(this, file, ...args);
    }; }
  `);
  function cli(args, noPublicRead = "") { return spawnSync(process.execPath, ["--import", probe, "src/index.mjs", "detect", ...args, "--json"], { cwd: path.resolve(import.meta.dirname, ".."), encoding: "utf8", env: { ...process.env, SOURCE_POLICY_TEST_ROOT: source, SOURCE_POLICY_TEST_LOG: log, SOURCE_POLICY_TEST_NO_PUBLIC_READ: noPublicRead } }); }
  const before = cli(["--source-project", source]); assert.equal(before.status, 0, before.stderr);
  const bad = put(source, ".codex/config.toml"); put(source, ".codex/secret-project/pom.xml", "<project><modules><module>private</module></modules></project>");
  const after = cli(["--source-project", source]); assert.equal(after.status, 0, after.stderr);
  assert.deepEqual(JSON.parse(after.stdout).sourceCoverage, JSON.parse(before.stdout).sourceCoverage);
  assert.deepEqual(JSON.parse(after.stdout).sourceProfile, JSON.parse(before.stdout).sourceProfile);
  assert.deepEqual(JSON.parse(after.stdout).autoMatch, JSON.parse(before.stdout).autoMatch);
  const discovered = cli(["batch", "--source-root", source, "--include-modules"]); assert.equal(discovered.status, 0, discovered.stderr); assert.equal(JSON.parse(discovered.stdout).discoveredCount, 1);
  for (const input of [["--source-project", path.dirname(bad)], ["--file", bad], ["--attachment", path.join(source, "README.md"), "--attachment", bad], ["--production-log", bad]]) {
    const rejected = cli(input, path.join(source, "README.md")); assert.equal(rejected.status, 1); assert.match(rejected.stderr, /Protected Host/); assert.equal(rejected.stderr.includes(bad), false);
  }
  assert.equal(fs.existsSync(log), false);
});

test("Source MCP rejects a protected classification member with no session or provider call", async t => {
  const root = fixture(t), home = path.join(root, "workspace"); initializeWorkspace(home); const bad = put(root, ".codex/config.toml"), tax = put(root, "taxonomy.json", JSON.stringify(taxonomy()));
  const client = new TestMcpClient({ command: process.execPath, args: ["src/index.mjs", "mcp", "serve", "--workspace", home], cwd: path.resolve(import.meta.dirname, "..") });
  try { await client.initialize(); const before = await client.rawTool("list_project_classifications", {}); const raw = await client.rawTool("start_project_classification", { sourcePath: bad, taxonomyPath: tax, intent: "public Source only", adapterId: "generic", hostInteraction: { id: "synthetic-contract", version: "1.0.0", level: "GOVERNED_HUMAN_GATE_COMPATIBLE", capabilities: ["deterministic-rendering", "governed-operation-interception", "ordered-visible-transcript-evidence", "interaction-frame-binding", "business-view-digest-binding", "exact-canonical-markdown-rendering", "complete-turn-digest-receipt", "fixed-locale-rendering", "host-prose-suppression", "workspace-state-recovery"] } });
    assert.equal(raw.isError, true); assert.equal(raw.structuredContent.code, "SOURCE_PROTECTED_PATH"); assert.equal(JSON.stringify(raw).includes(bad), false); assert.deepEqual(await client.rawTool("list_project_classifications", {}), before);
  } finally { await client.close(); }
});

test("Source cache binds current policy and rejects a self-consistent old-policy result copied to the new key", async t => {
  const root = fixture(t), home = path.join(root, "workspace"), source = publicSource(root); initializeWorkspace(home); let calls = 0;
  function countedAdvisor(input) { calls += 1; return advisor(input); }
  const args = { home, source, taxonomy: taxonomy(), intent: "policy replay", advisorProvider: countedAdvisor };
  const first = await startClassificationSession(args), replay = await startClassificationSession(args); assert.equal(calls, 1); assert.equal(replay.attempts[0].executionMode, "REPLAY");
  const cache = path.join(home, "classification-results", first.attempts[0].analysisReceipt.analysisRequestDigest.slice(7) + ".json"), result = JSON.parse(fs.readFileSync(cache));
  delete result.sourceConceptHypothesis.provenance.sourceContentBoundary; delete result.analysisResultDigest; result.analysisResultDigest = digest(result); fs.writeFileSync(cache, JSON.stringify(result)); const bytes = fs.readFileSync(cache);
  await assert.rejects(startClassificationSession(args), e => e.code === "SOURCE_POLICY_REANALYSIS_REQUIRED"); assert.equal(calls, 1); assert.deepEqual(fs.readFileSync(cache), bytes);
});

test("Source old-policy resume and direct handoff reject without rewriting historical classification", async t => {
  const root = fixture(t), home = path.join(root, "workspace"), source = publicSource(root); initializeWorkspace(home);
  const result = await analyzeSourceTaxonomy({ source, taxonomy: taxonomy(), advisorProvider: advisor }); assert.equal(result.aggregate, "TAXONOMY_MATCHED");
  const old = structuredClone(result); delete old.sourceConceptHypothesis.provenance.sourceContentBoundary;
  assert.throws(() => createClassificationHandoff({ classificationSessionId: "classification-test", result: old, decidedBy: "fixture", decisionToken: "unused" }), e => e.code === "SOURCE_POLICY_REANALYSIS_REQUIRED");
  const created = await startClassificationSession({ home, source, taxonomy: taxonomy(), intent: "resume policy", advisorProvider: advisor });
  const sessionFile = path.join(home, "classification-sessions", created.sessionId, "session.json"), originalSession = fs.readFileSync(sessionFile), stale = JSON.parse(originalSession);
  delete stale.currentResult.sourceConceptHypothesis.provenance.sourceContentBoundary;
  delete stale.sessionDigest; stale.sessionDigest = digest(stale); fs.writeFileSync(sessionFile, JSON.stringify(stale)); const staleBytes = fs.readFileSync(sessionFile);
  assert.equal(inspectClassificationSession(home, stale.sessionId).sessionDigest, stale.sessionDigest);
  assert.throws(() => resumeClassificationSession({ home, sessionId: stale.sessionId, expectedSessionDigest: stale.sessionDigest, adapterId: "generic" }), e => e.code === "SOURCE_POLICY_REANALYSIS_REQUIRED");
  assert.throws(() => continueClassificationToHarness({ home, sessionId: stale.sessionId, expectedSessionDigest: stale.sessionDigest, decisionToken: stale.currentDecision.internalDecisionToken, decidedBy: "controlled-fixture" }), e => e.code === "SOURCE_POLICY_REANALYSIS_REQUIRED");
  assert.deepEqual(fs.readFileSync(sessionFile), staleBytes); fs.writeFileSync(sessionFile, originalSession);
  const resumed = resumeClassificationSession({ home, sessionId: created.sessionId, expectedSessionDigest: created.sessionDigest, adapterId: "generic" }); assert.equal(resumed.status, created.status);
  const handed = continueClassificationToHarness({ home, sessionId: resumed.sessionId, expectedSessionDigest: resumed.sessionDigest, decisionToken: resumed.currentDecision.internalDecisionToken, decidedBy: "controlled-fixture" });
  const handoff = handed.operationSession.classificationHandoff; assert.ok(handoff.hypothesisDigest);
  const operationFile = path.join(home, "agent-sessions", handed.operationSession.sessionId, "session.json"), originalOperation = fs.readFileSync(operationFile), staleOperation = JSON.parse(originalOperation);
  staleOperation.classificationHandoff.hypothesisDigest = digest("old-policy-hypothesis"); delete staleOperation.classificationHandoff.handoffDigest; staleOperation.classificationHandoff.handoffDigest = digest(staleOperation.classificationHandoff); delete staleOperation.sessionDigest; staleOperation.sessionDigest = digest(staleOperation); fs.writeFileSync(operationFile, JSON.stringify(staleOperation)); const staleOperationBytes = fs.readFileSync(operationFile);
  assert.throws(() => createSessionPlan({ home, sessionId: staleOperation.sessionId, expectedSessionDigest: staleOperation.sessionDigest, scenario: "evolve", goal: "must reanalyze old handoff", sources: { advisor: "off" } }), e => e.code === "CLASSIFICATION_SOURCE_DRIFT");
  assert.deepEqual(fs.readFileSync(operationFile), staleOperationBytes); fs.writeFileSync(operationFile, originalOperation);
  const planned = createSessionPlan({ home, sessionId: handed.operationSession.sessionId, expectedSessionDigest: handed.operationSession.sessionDigest, scenario: "evolve", goal: "current policy handoff", sources: { advisor: "off" } }); assert.equal(planned.status, "PLAN_REVIEW_REQUIRED");
  const receiptKey = digest("controlled-old-policy-receipt").slice(7);
  const receipt = { schema: "evopilot-harness-engine-operation-receipt/v1", idempotencyKey: receiptKey, operation: "evidence.produce", inputDigest: digest(planned.plan.operations[0].input), result: { status: "SYNTHETIC_OLD_POLICY_HISTORY" } }; receipt.receiptDigest = digest(receipt);
  const receiptPath = put(home, `agent-operation-receipts/${receiptKey}.json`, JSON.stringify(receipt)), receiptBytes = fs.readFileSync(receiptPath);
  // Synthetic persisted states model sessions produced by the prior policy.
  // They must fail before any Engine invocation, receipt acceptance or write.
  for (const status of ["PLAN_REVIEW_REQUIRED", "READY_TO_EXECUTE", "INTERRUPTED"]) {
    const stalePlan = structuredClone(planned); stalePlan.status = status;
    if (status === "INTERRUPTED") stalePlan.inFlightOperation = { operationIndex: 0, operation: "evidence.produce", operationDigest: digest("controlled-operation"), inputDigest: receipt.inputDigest, idempotencyKey: receiptKey, workspaceDigestBefore: digest("controlled-workspace"), status: "OUTCOME_UNKNOWN", startedAt: "2026-09-28T00:00:00.000Z", attemptDigest: digest("controlled-attempt") };
    stalePlan.classificationHandoff.hypothesisDigest = digest("old-policy-hypothesis"); delete stalePlan.classificationHandoff.handoffDigest; stalePlan.classificationHandoff.handoffDigest = digest(stalePlan.classificationHandoff);
    delete stalePlan.sessionDigest; stalePlan.sessionDigest = digest(stalePlan); fs.writeFileSync(operationFile, JSON.stringify(stalePlan)); const stored = fs.readFileSync(operationFile);
    const args = { home, sessionId: stalePlan.sessionId, expectedSessionDigest: stalePlan.sessionDigest, expectedPlanDigest: stalePlan.planDigest, adapterId: "generic" };
    const writes = [], originalRead = fs.readFileSync;
    for (const method of ["writeFileSync", "appendFileSync", "mkdirSync", "renameSync"]) {
      const original = fs[method]; t.mock.method(fs, method, function(file, ...rest) { if (String(file).startsWith(home)) { writes.push(method); throw Error("old policy cannot start an Engine operation or mutate Workspace state"); } return original.call(this, file, ...rest); });
    }
    t.mock.method(fs, "readFileSync", function(file, ...rest) { if (file === receiptPath) throw Error("old policy receipt must not be consumed"); return originalRead.call(this, file, ...rest); });
    assert.throws(() => resumeAgentSession(args), e => e.code === "CLASSIFICATION_SOURCE_DRIFT");
    if (status !== "PLAN_REVIEW_REQUIRED") await assert.rejects(executeSessionPlan(args), e => e.code === "CLASSIFICATION_SOURCE_DRIFT");
    if (status === "INTERRUPTED") await assert.rejects(resolveInterruptedOperation(args), e => e.code === "CLASSIFICATION_SOURCE_DRIFT");
    assert.deepEqual(writes, []); t.mock.restoreAll();
    assert.deepEqual(fs.readFileSync(operationFile), stored); assert.deepEqual(fs.readFileSync(receiptPath), receiptBytes);
  }
  fs.writeFileSync(operationFile, JSON.stringify(planned));
  assert.equal(inspectClassificationSession(home, resumed.sessionId).status, "HANDED_OFF");
});
