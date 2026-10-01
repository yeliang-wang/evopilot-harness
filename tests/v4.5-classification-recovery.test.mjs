import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
import test from "node:test";
import { initializeWorkspace } from "../src/v3/workspace.mjs";
import { closeClassificationSession, continueClassificationToHarness, inspectClassificationSession, listClassificationSessions, reanalyzeClassificationSession, resumeClassificationSession, startClassificationSession } from "../src/v4/classification/session-store.mjs";

const storeUrl = new URL("../src/v4/classification/session-store.mjs", import.meta.url).href;
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "classification-recovery-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const home = path.join(root, "workspace"), source = path.join(root, "synthetic-source");
  initializeWorkspace(home);
  fs.mkdirSync(source);
  fs.writeFileSync(path.join(source, "README.md"), "Redis distributed cache: key-value storage, TTL, eviction and replication.\n");
  fs.writeFileSync(path.join(source, "package.json"), JSON.stringify({ dependencies: { redis: "5.0.0" } }));
  const taxonomy = {
    apiVersion: "harness.evopilot.io/v1", kind: "Taxonomy", metadata: { namespace: "test", name: "recovery", version: "1.0.0" },
    spec: { engineRange: ">=4.5.0 <5.0.0", requiredCapabilities: ["taxonomy-c14n/v1", "source-concept-hypothesis/v1", "open-world-taxonomy-classifier/v1", "taxonomy-decision-aggregate/v1"], axisPolicies: { domainCardinality: "SINGLE", productCardinality: "SINGLE" },
      domains: [{ id: "technology", label: "Technology", assignable: false }, { id: "middleware", label: "Middleware", definition: "Reusable infrastructure", aliases: ["redis", "cache"], parents: ["technology"], assignable: true }],
      products: [{ id: "infrastructure", label: "Infrastructure", assignable: false }, { id: "cache", label: "Cache", definition: "Distributed caching", aliases: ["redis", "ttl", "eviction"], parents: ["infrastructure"], assignable: true }] }
  };
  return { home, source, taxonomy, intent: "synthetic classification recovery test" };
}
function supporting(input) {
  return { candidates: Object.entries(input.candidates).flatMap(([axis, candidates]) => candidates.map(c => ({ axis, nodeId: c.nodeId, support: c.nonLlmEvidence.length ? "SUPPORT" : "NEUTRAL", confidence: 0.95, evidenceIds: c.nonLlmEvidence.slice(0, 2).map(e => e.evidenceId) }))), unresolvedConcepts: [] };
}
function pendingAdvisor() {
  let release, called;
  const arrived = new Promise(r => { called = r; });
  const reply = new Promise(r => { release = r; });
  let calls = 0;
  async function controlled(input) { calls++; called(); await reply; return supporting(input); }
  return { controlled, arrived, release, calls: () => calls };
}
const onlySession = home => {
  const listed = listClassificationSessions(home);
  assert.equal(listed.length, 1);
  return inspectClassificationSession(home, listed[0].sessionId);
};

test("rejected Advisor payload is absent from durable outcomes and resumed sessions", async t => {
  const input = fixture(t);
  let calls = 0;
  const advisorProvider = async value => {
    calls++;
    return { ...supporting(value), unresolvedConcepts: [{ proposedLabel: "secret", definition: "api_key=must-not-persist", evidenceIds: value.hypothesis.citations.slice(0, 2).map(item => item.evidenceId) }] };
  };
  const result = await startClassificationSession({ ...input, advisorProvider });
  assert.equal(result.status, "ANALYSIS_BLOCKED_ADVISOR");
  assert.equal(result.currentResult.advisor.code, "ADVISOR_CONTRACT_REJECTED");
  assert.ok(result.currentResult.advisor.validation.checks.some(item => item.id === "secret-free" && item.status === "FAIL"));
  assert.match(result.currentResult.advisor.rawDigest, /^sha256:[a-f0-9]{64}$/);
  const inspectFiles = directory => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) inspectFiles(file);
      else assert.doesNotMatch(fs.readFileSync(file, "utf8"), /must-not-persist/, file);
    }
  };
  inspectFiles(input.home);
  const resumed = resumeClassificationSession({ home: input.home, sessionId: result.sessionId, expectedSessionDigest: result.sessionDigest, adapterId: "fresh-test-process" });
  assert.equal(resumed.status, "ANALYSIS_BLOCKED_ADVISOR");
  assert.equal(resumed.currentResult.advisor.rawDigest, result.currentResult.advisor.rawDigest);
  assert.doesNotMatch(JSON.stringify(resumed), /must-not-persist/);
  assert.equal(calls, 1);
});

test("classification persists an honest pending receipt before call and excludes concurrent duplicates", async t => {
  const input = fixture(t), provider = pendingAdvisor();
  const running = startClassificationSession({ ...input, advisorProvider: provider.controlled });
  await provider.arrived;
  const pending = onlySession(input.home);
  assert.equal(pending.status, "ANALYSIS_BLOCKED_ADVISOR");
  assert.equal(pending.attempts.length, 0);
  assert.equal(pending.inFlightAnalysis.state, "OUTCOME_UNKNOWN");
  assert.equal(pending.inFlightAnalysis.physicalAdvisorInvocationCount, null);
  assert.equal(pending.currentDecision, null);
  assert.throws(() => continueClassificationToHarness({ home: input.home, sessionId: pending.sessionId, expectedSessionDigest: pending.sessionDigest }), e => e.code === "CLASSIFICATION_MATCH_REQUIRED");
  await assert.rejects(startClassificationSession({ ...input, advisorProvider: provider.controlled }), e => e.code === "CLASSIFICATION_INVOCATION_UNCERTAIN");
  assert.equal(provider.calls(), 1);
  provider.release();
  const completed = await running;
  assert.equal(completed.inFlightAnalysis, undefined);
  assert.equal(completed.attempts.length, 1);
  assert.equal(completed.attempts[0].physicalAdvisorInvocationCount, 1);
  assert.equal(completed.attempts[0].analysisAttemptDigest, pending.inFlightAnalysis.analysisAttemptDigest);
  const replay = await startClassificationSession({ ...input, advisorProvider: provider.controlled });
  assert.equal(replay.attempts[0].executionMode, "REPLAY");
  assert.equal(provider.calls(), 1);
});

test("process death retains discoverable invocation and fresh resume cannot silently repeat it", async t => {
  const input = fixture(t);
  const script = `import { startClassificationSession } from ${JSON.stringify(storeUrl)};
    const input = JSON.parse(process.argv[1]);
    async function controlled() { process.send({ received: true }); await new Promise(() => {}); }
    setInterval(() => {}, 1000);
    await startClassificationSession({ ...input, advisorProvider: controlled });`;
  const child = spawn(process.execPath, ["--input-type=module", "--eval", script, JSON.stringify(input)], { stdio: ["ignore", "ignore", "pipe", "ipc"] });
  t.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL"); });
  let stderr = ""; child.stderr.on("data", b => { stderr += b; });
  const timeout = AbortSignal.timeout(15000);
  await Promise.race([once(child, "message", { signal: timeout }), once(child, "exit", { signal: timeout }).then(() => { throw Error(stderr); })]);
  const pending = onlySession(input.home);
  const retained = fs.readFileSync(path.join(input.home, "classification-invocations", `${pending.inFlightAnalysis.analysisAttemptDigest.slice(7)}.request.json`));
  const exited = once(child, "exit"); child.kill("SIGKILL"); await exited;
  const resumed = resumeClassificationSession({ home: input.home, sessionId: pending.sessionId, expectedSessionDigest: pending.sessionDigest, adapterId: "fresh-test-process" });
  assert.equal(resumed.inFlightAnalysis.receiptDigest, pending.inFlightAnalysis.receiptDigest);
  assert.equal(resumed.status, "ANALYSIS_BLOCKED_ADVISOR");
  let calls = 0; function controlled(input) { calls++; return supporting(input); }
  await assert.rejects(startClassificationSession({ ...input, advisorProvider: controlled }), e => e.code === "CLASSIFICATION_INVOCATION_UNCERTAIN");
  await assert.rejects(reanalyzeClassificationSession({ ...input, sessionId: resumed.sessionId, expectedSessionDigest: resumed.sessionDigest, advisorProvider: controlled }), e => e.code === "CLASSIFICATION_INVOCATION_UNCERTAIN");
  assert.equal(calls, 0);
  const changed = await startClassificationSession({ ...input, model: "explicit-distinct-model", advisorProvider: controlled });
  assert.equal(calls, 1);
  assert.notEqual(changed.attempts[0].analysisRequestDigest, pending.inFlightAnalysis.analysisRequestDigest);
  assert.deepEqual(fs.readFileSync(path.join(input.home, "classification-invocations", `${pending.inFlightAnalysis.analysisAttemptDigest.slice(7)}.request.json`)), retained);
});

test("cancel during classification retains the uncertain receipt and late reply cannot reopen the Session", async t => {
  const input = fixture(t), provider = pendingAdvisor();
  const running = startClassificationSession({ ...input, advisorProvider: provider.controlled });
  await provider.arrived;
  const pending = onlySession(input.home);
  const closed = closeClassificationSession({ home: input.home, sessionId: pending.sessionId, expectedSessionDigest: pending.sessionDigest, decidedBy: "test-operator", decision: "CANCEL" });
  provider.release();
  const returned = await running;
  assert.equal(returned.sessionDigest, closed.sessionDigest);
  assert.equal(onlySession(input.home).status, "CANCELLED");
  assert.equal(provider.calls(), 1);
});

test("reanalysis records pending context without rewriting prior completed receipts", async t => {
  const input = fixture(t), provider = pendingAdvisor();
  const first = await startClassificationSession({ ...input, advisorProvider: supporting });
  const running = reanalyzeClassificationSession({ ...input, sessionId: first.sessionId, expectedSessionDigest: first.sessionDigest, model: "changed-model", advisorProvider: provider.controlled });
  await provider.arrived;
  const pending = onlySession(input.home);
  assert.deepEqual(pending.attempts, first.attempts);
  assert.notEqual(pending.inFlightAnalysis.analysisRequestDigest, first.attempts[0].analysisRequestDigest);
  provider.release();
  const next = await running;
  assert.equal(next.attempts.length, 2);
  assert.deepEqual(next.attempts[0], first.attempts[0]);
});

test("invalid Taxonomy fails before Source access, invocation claims or Session creation", async t => {
  const input = fixture(t); let calls = 0;
  await assert.rejects(startClassificationSession({ ...input, source: "/absent/synthetic-source", taxonomy: {}, advisorProvider() { calls++; } }), e => /TAXONOMY/.test(e.code));
  assert.equal(calls, 0);
  for (const area of ["classification-invocations", "classification-sessions", "agent-sessions"]) assert.equal(fs.existsSync(path.join(input.home, area)), false);
});

for (const splitAt of ["generic-session", "classification-session"]) test(`durable outcome reconciles ${splitAt} write interruption without calling the Advisor again`, async t => {
  const input = fixture(t), provider = pendingAdvisor();
  const running = startClassificationSession({ ...input, advisorProvider: provider.controlled });
  await provider.arrived;
  const pending = onlySession(input.home);
  const priorBytes = fs.readFileSync(path.join(input.home, "classification-sessions", pending.sessionId, "session.json"));
  const originalRename = fs.renameSync;
  const area = splitAt === "generic-session" ? "agent-sessions" : "classification-sessions";
  let injected = false;
  fs.renameSync = (from, to) => {
    if (!injected && String(to).includes(`/${area}/`) && String(to).endsWith("/session.json")) { injected = true; throw Error("synthetic interrupted Session write"); }
    return originalRename(from, to);
  };
  try { provider.release(); await assert.rejects(running, /synthetic interrupted Session write/); }
  finally { fs.renameSync = originalRename; }
  assert.equal(injected, true);
  const observed = onlySession(input.home);
  // Inspection reconciles a projection in memory; it does not rewrite history.
  assert.deepEqual(fs.readFileSync(path.join(input.home, "classification-sessions", pending.sessionId, "session.json")), priorBytes);
  const resumed = resumeClassificationSession({ home: input.home, sessionId: observed.sessionId, expectedSessionDigest: observed.sessionDigest, adapterId: "replacement-host" });
  assert.equal(resumed.inFlightAnalysis, undefined);
  assert.equal(resumed.attempts.length, 1);
  assert.equal(resumed.attempts[0].analysisAttemptDigest, pending.inFlightAnalysis.analysisAttemptDigest);
  assert.equal(provider.calls(), 1);
  assert.equal(fs.readdirSync(path.join(input.home, "classification-invocations")).some(f => f.endsWith(".claim.json")), false);
  assert.equal(inspectClassificationSession(input.home, resumed.sessionId).sessionDigest, resumed.sessionDigest);
});
