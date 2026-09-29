import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { digest } from "../src/v3/utils.mjs";
import { initializeWorkspace } from "../src/v3/workspace.mjs";
import { createInteractionFrame, FRAME_FIELDS } from "../src/v4/interaction/controller.mjs";
import { createAgentSession, inspectAgentSession, recordBusinessViewDelivery, submitSessionBusinessDecision } from "../src/v4/session/store.mjs";
import { governedHostInteraction, TestMcpClient, structured } from "./helpers/mcp-client.mjs";

const root = path.resolve(import.meta.dirname, "..");

// Persisted conformance fixtures, not live semantic-review evidence.
function blockedFixture(t, verdict = "REVISE", { presented = true, historical = false } = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "evopilot-blocker-choice-"));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  initializeWorkspace(home);
  let session = createAgentSession({ home, intent: "Preserve blocked semantic review and show its existing remediation", adapterId: "conformance", hostInteraction: governedHostInteraction() });
  session.status = "BLOCKED";
  session.blockers = [`proposal-review:fixture:${verdict}`];
  session.nextAction = "collect-missing-boundary-evidence";
  const renderModel = { status: session.status, blockers: session.blockers, reasons: [`${verdict}: source evidence does not establish the proposed product boundary`], evidenceRefs: ["source-001", "review-fixture"], nextAction: session.nextAction };
  const frame = createInteractionFrame({ session, stage: "BLOCKER_PRESENTATION", subject: { type: "SESSION_BLOCKER", id: session.sessionId, digest: digest(renderModel), bindings: { sessionStatus: session.status } }, renderModel, allowedNextOperations: ["inspect_operation_session", "prepare_session_lifecycle_interaction"] });
  if (historical) {
    // Model the old persisted declaration without changing the current renderer.
    frame.decisionDefinition.options = ["REVIEW_REMEDIATION", "CANCEL", "PRESERVE_FOR_LATER"];
    delete frame.frameDigest;
    frame.frameDigest = digest(frame);
  }
  session.interaction.currentFrame = frame;
  session.interaction.frameArchive.push(frame);
  delete session.sessionDigest;
  session.sessionDigest = digest(session);
  const file = path.join(home, "agent-sessions", session.sessionId, "session.json");
  fs.writeFileSync(file, `${JSON.stringify(session, null, 2)}\n`);
  fs.writeFileSync(path.join(home, "immutable-proposal-fixture.json"), JSON.stringify({ verdict, authority: "blocked", approved: false, published: false }));
  if (presented) session = recordBusinessViewDelivery({ home, sessionId: session.sessionId, expectedSessionDigest: session.sessionDigest, expectedFrameDigest: frame.frameDigest, deliveredBusinessViewDigest: frame.businessView.businessViewDigest, renderedBusinessViewDigest: frame.businessView.renderedBusinessViewDigest });
  assert.deepEqual(inspectAgentSession(home, session.sessionId), session);
  return { home, session, frame, renderModel };
}

function files(home) {
  return Object.fromEntries(fs.readdirSync(home, { recursive: true }).sort().filter((p) => fs.statSync(path.join(home, p)).isFile()).map((p) => [p, digest(fs.readFileSync(path.join(home, p)).toString("base64"))]));
}

function decide(fixture, choice, extra = {}) {
  return submitSessionBusinessDecision({ home: fixture.home, sessionId: fixture.session.sessionId, decisionHandle: fixture.frame.decisionDefinition.decisionHandle, choice, decidedBy: "conformance-operator", ...extra });
}

for (const verdict of ["REVISE", "NEED_MORE_EVIDENCE"]) {
  test(`blocked ${verdict} remediation returns the complete immutable Session and retains all evidence`, async (t) => {
    const fixture = blockedFixture(t, verdict);
    assert.deepEqual(fixture.frame.decisionDefinition.options, ["REVIEW_REMEDIATION", "PRESERVE_FOR_LATER"]);
    assert.deepEqual(fixture.frame.renderModel, fixture.renderModel);
    const before = files(fixture.home);
    for (let n = 0; n < 3; n += 1) {
      const result = await decide(fixture, "REVIEW_REMEDIATION");
      assert.deepEqual(result, fixture.session);
      assert.equal(result.status, "BLOCKED");
      assert.equal(result.nextAction, fixture.renderModel.nextAction);
      assert.equal(result.interaction.currentFrame.businessView.canonicalMarkdown, fixture.frame.businessView.canonicalMarkdown);
    }
    assert.deepEqual(files(fixture.home), before);
  });
}

test("blocked guidance retains presentation, handle, declared-choice and actor guards without writes", async (t) => {
  const unpresented = blockedFixture(t, "REVISE", { presented: false });
  const beforeUnpresented = files(unpresented.home);
  await assert.rejects(() => decide(unpresented, "REVIEW_REMEDIATION"), (e) => e.code === "INTERACTION_PRESENTATION_REQUIRED");
  assert.deepEqual(files(unpresented.home), beforeUnpresented);
  const fixture = blockedFixture(t);
  const before = files(fixture.home);
  await assert.rejects(() => decide(fixture, "REVIEW_REMEDIATION", { decisionHandle: "decision-stale" }), (e) => e.code === "BUSINESS_DECISION_HANDLE_MISMATCH");
  await assert.rejects(() => decide(fixture, "REVIEW_REMEDIATION", { decidedBy: "  " }), (e) => e.code === "BUSINESS_DECISION_ACTOR_REQUIRED");
  for (const choice of ["CANCEL", "RETRY_IF_UNCHANGED", "APPROVE", "PUBLISH"]) await assert.rejects(() => decide(fixture, choice), (e) => e.code === "BUSINESS_DECISION_CHOICE_INVALID");
  assert.deepEqual(files(fixture.home), before);
});

test("historical blocker declarations remain readable and their old CANCEL keeps its typed refusal", async (t) => {
  const fixture = blockedFixture(t, "REVISE", { historical: true });
  const before = files(fixture.home);
  assert.deepEqual(await decide(fixture, "REVIEW_REMEDIATION"), fixture.session);
  await assert.rejects(() => decide(fixture, "CANCEL"), (e) => e.code === "BUSINESS_DECISION_CHOICE_UNSUPPORTED");
  assert.deepEqual(files(fixture.home), before);
});

test("PRESERVE_FOR_LATER remains repeatable without changing blocked authority or durable state", async (t) => {
  const fixture = blockedFixture(t);
  const before = files(fixture.home);
  const first = await decide(fixture, "PRESERVE_FOR_LATER");
  assert.deepEqual(await decide(fixture, "PRESERVE_FOR_LATER"), first);
  assert.equal(first.sessionDigest, fixture.session.sessionDigest);
  assert.deepEqual(files(fixture.home), before);
});

test("MCP remediation automatically returns canonical guidance with no new receipt or Engine/provider work", async (t) => {
  const fixture = blockedFixture(t);
  const before = files(fixture.home);
  const client = new TestMcpClient({ command: process.execPath, args: ["src/index.mjs", "mcp", "serve", "--workspace", fixture.home], cwd: root });
  try {
    await client.initialize();
    for (let n = 0; n < 3; n += 1) {
      const response = await client.rawTool("submit_business_decision", { sessionId: fixture.session.sessionId, decisionHandle: fixture.frame.decisionDefinition.decisionHandle, choice: "REVIEW_REMEDIATION", decidedBy: "conformance-operator" });
      assert.equal(response.isError, undefined, JSON.stringify(response.structuredContent));
      assert.deepEqual(structured(response), fixture.session);
      assert.equal(response.content.length, 1);
      assert.equal(response.content[0].text, fixture.frame.businessView.canonicalMarkdown);
      assert.equal(response._meta["evopilot/harnessPresentation"].mode, "EXACT_CANONICAL_MARKDOWN_ONLY");
    }
    assert.deepEqual(files(fixture.home), before);
  } finally {
    await client.close();
  }
});

test("blocker correction does not change retry, cancellation or close declarations", (t) => {
  const { session } = blockedFixture(t);
  for (const [stage, options] of [
    ["BLOCKED_RETRY_PRESENTATION", ["RETRY_IF_UNCHANGED", "CANCEL", "PRESERVE_FOR_LATER"]],
    ["CANCELLATION_PRESENTATION", ["CANCEL", "PRESERVE_FOR_LATER"]],
    ["CLOSE_PRESENTATION", ["CLOSE", "PRESERVE_FOR_LATER"]]
  ]) {
    const renderModel = Object.fromEntries(FRAME_FIELDS[stage].map((field) => [field, `${stage}:${field}`]));
    const frame = createInteractionFrame({ session, stage, subject: { type: "CONFORMANCE", id: "fixture", digest: digest(stage), bindings: {} }, renderModel });
    assert.deepEqual(frame.decisionDefinition.options, options);
  }
});
