import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { initializeWorkspace } from "../src/v3/workspace.mjs";
import { digest, persistedJson } from "../src/v3/utils.mjs";
import { confirmSessionPlan, createAgentSession, createSessionPlan, inspectAgentSession, migrateOperationSessionToV3, recordBusinessViewDelivery } from "../src/v4/session/store.mjs";
import { governedHostInteraction } from "./helpers/mcp-client.mjs";

function temporary(label) { return fs.mkdtempSync(path.join(os.tmpdir(), `evopilot-v44-${label}-`)); }
function sessionFile(home, sessionId) { return path.join(home, "agent-sessions", sessionId, "session.json"); }
function writeSession(home, session) {
  const value = persistedJson(session);
  delete value.sessionDigest;
  value.sessionDigest = digest(value);
  fs.writeFileSync(sessionFile(home, value.sessionId), `${JSON.stringify(value, null, 2)}\n`, "utf8");
  return value;
}
function legacyV2(home, session, { status = "CREATED", receipts = [] } = {}) {
  const value = persistedJson(session);
  value.schema = "evopilot-harness-agent-operation-session/v2";
  value.status = status;
  value.compatibility = { ...value.compatibility, productVersion: "4.3.0", expertVersion: "4.3.0", agentProtocolVersion: "evopilot-harness-agent-operations/v2" };
  value.interaction = { ...value.interaction, protocolVersion: "evopilot-harness-agent-operations/v2", currentFrame: null, presentationReceipts: receipts };
  delete value.interaction.frameArchive;
  delete value.interaction.host.locale;
  delete value.interaction.host.conformanceProfile;
  delete value.reevaluation;
  delete value.evolutionContext;
  delete value.migrationHistory;
  return writeSession(home, value);
}

test("v4.5 reset preserves but neither reads nor migrates a pre-v4.5 Protocol v2 Session", () => {
  const home = temporary("v2-reset-boundary");
  initializeWorkspace(home);
  const current = createAgentSession({ home, intent: "Reject a superseded Harness Session representation", adapterId: "legacy-host", hostInteraction: governedHostInteraction("legacy-host", "1.0.0") });
  const legacyReceipt = { schema: "evopilot-harness-interaction-presentation-receipt/v1", frameDigest: digest("legacy-frame"), receiptDigest: digest("legacy-receipt") };
  const legacy = legacyV2(home, current, { receipts: [legacyReceipt] });
  const before = fs.readFileSync(sessionFile(home, legacy.sessionId), "utf8");
  assert.throws(() => inspectAgentSession(home, legacy.sessionId), (error) => error.code === "PRE_V45_SESSION_UNSUPPORTED");
  assert.throws(() => migrateOperationSessionToV3({ home, sessionId: legacy.sessionId, expectedSessionDigest: legacy.sessionDigest, adapterId: "generic-v3", hostInteraction: governedHostInteraction("generic-v3", "1.0.0") }), (error) => error.code === "PRE_V45_SESSION_UNSUPPORTED");
  assert.equal(fs.readFileSync(sessionFile(home, legacy.sessionId), "utf8"), before);
});

test("v4.5 reset preserves but neither reads nor upgrades a pre-v4.5 Protocol v3 Session", () => {
  const home = temporary("v3-frame-archive");
  initializeWorkspace(home);
  const created = createAgentSession({ home, intent: "Read a pre-revision-7 Harness Session", adapterId: "workbuddy", hostInteraction: governedHostInteraction("workbuddy", "5.3.14") });
  const planned = createSessionPlan({ home, sessionId: created.sessionId, expectedSessionDigest: created.sessionDigest, goal: created.intent.text, sources: { notes: ["immutable evidence"], advisor: "off" } });
  const legacy = persistedJson(planned);
  legacy.compatibility.productVersion = "4.4.0";
  legacy.compatibility.expertVersion = "4.4.0";
  delete legacy.interaction.frameArchive;
  delete legacy.reevaluation;
  delete legacy.evolutionContext;
  delete legacy.classificationLifecycle;
  delete legacy.classificationHandoff;
  writeSession(home, legacy);
  const before = fs.readFileSync(sessionFile(home, legacy.sessionId), "utf8");
  assert.throws(() => inspectAgentSession(home, legacy.sessionId), (error) => error.code === "PRE_V45_SESSION_UNSUPPORTED");
  assert.equal(fs.readFileSync(sessionFile(home, legacy.sessionId), "utf8"), before);
});

test("AC16 composite binding drift invalidates the next governed decision", () => {
  const home = temporary("binding-drift");
  initializeWorkspace(home);
  const source = temporary("source");
  fs.writeFileSync(path.join(source, "README.md"), "# immutable source\n", "utf8");
  const created = createAgentSession({ home, intent: "Create a reusable Harness from immutable evidence", adapterId: "workbuddy", hostInteraction: governedHostInteraction("workbuddy", "5.2.6") });
  const planned = createSessionPlan({ home, sessionId: created.sessionId, expectedSessionDigest: created.sessionDigest, goal: created.intent.text, sources: { sourceProjects: [source], advisor: "off" } });
  const frame = planned.interaction.currentFrame;
  const delivered = recordBusinessViewDelivery({ home, sessionId: planned.sessionId, expectedSessionDigest: planned.sessionDigest, expectedFrameDigest: frame.frameDigest, deliveredBusinessViewDigest: frame.businessView.businessViewDigest, renderedBusinessViewDigest: digest(frame.businessView.canonicalMarkdown) });
  const changed = persistedJson(delivered);
  changed.interaction.presentationReceipts[0].compositeDecisionBinding.businessViewDigest = digest("tampered-business-view");
  const tampered = writeSession(home, changed);
  assert.throws(() => confirmSessionPlan({ home, sessionId: tampered.sessionId, expectedSessionDigest: tampered.sessionDigest, expectedPlanDigest: tampered.planDigest, confirmedBy: "operator", confirmation: `CONFIRM_OPERATION_PLAN:${tampered.planDigest}` }), (error) => error.code === "COMPOSITE_DECISION_BINDING_DRIFT");
});
