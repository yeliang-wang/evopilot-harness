import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { initializeWorkspace } from "../src/v3/workspace.mjs";
import { digest, persistedJson } from "../src/v3/utils.mjs";
import { cancelAgentSession, closeAgentSession, confirmSessionPlan, createAgentSession, createSessionPlan, inspectAgentSession, migrateOperationSessionToV3, recordBusinessViewDelivery } from "../src/v4/session/store.mjs";
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

test("AC21 Protocol v2 Sessions remain readable, diagnosable, explicitly cancellable, and safely closable", () => {
  const home = temporary("v2-lifecycle");
  initializeWorkspace(home);
  const current = createAgentSession({ home, intent: "Preserve and close a legacy Harness Session", adapterId: "legacy-workbuddy", hostInteraction: governedHostInteraction("legacy-workbuddy", "5.2.6") });
  const legacy = legacyV2(home, current, { receipts: [{ schema: "evopilot-harness-interaction-presentation-receipt/v1", receiptDigest: digest("legacy") }] });
  assert.equal(inspectAgentSession(home, legacy.sessionId).schema, "evopilot-harness-agent-operation-session/v2");
  const cancelled = cancelAgentSession({ home, sessionId: legacy.sessionId, expectedSessionDigest: legacy.sessionDigest, confirmedBy: "operator", confirmation: `CANCEL_SESSION:${legacy.sessionId}:${legacy.sessionDigest}` });
  assert.equal(cancelled.status, "CANCELLED");
  assert.equal(cancelled.humanDecisions.at(-1).bindings.compatibilityPath, "v2-explicit-safe-cancel");
  const closed = closeAgentSession({ home, sessionId: cancelled.sessionId, expectedSessionDigest: cancelled.sessionDigest, confirmedBy: "operator", confirmation: `CLOSE_SESSION:${cancelled.sessionId}:${cancelled.sessionDigest}` });
  assert.equal(closed.status, "CLOSED");
  assert.equal(closed.schema, "evopilot-harness-agent-operation-session/v2");
});

test("AC22 explicit v2-to-v3 Session migration is idempotent and fabricates no historical views or receipts", () => {
  const home = temporary("v2-migration");
  initializeWorkspace(home);
  const current = createAgentSession({ home, intent: "Migrate a legacy Harness Session", adapterId: "legacy-host", hostInteraction: governedHostInteraction("legacy-host", "1.0.0") });
  const legacyReceipt = { schema: "evopilot-harness-interaction-presentation-receipt/v1", frameDigest: digest("legacy-frame"), receiptDigest: digest("legacy-receipt") };
  const legacy = legacyV2(home, current, { receipts: [legacyReceipt] });
  const migrated = migrateOperationSessionToV3({ home, sessionId: legacy.sessionId, expectedSessionDigest: legacy.sessionDigest, adapterId: "generic-v3", hostInteraction: governedHostInteraction("generic-v3", "1.0.0") });
  assert.equal(migrated.schema, "evopilot-harness-agent-operation-session/v3");
  assert.equal(migrated.interaction.currentFrame, null);
  assert.deepEqual(migrated.interaction.presentationReceipts, []);
  assert.equal(migrated.migrationHistory.at(-1).historicalBusinessViewsFabricated, false);
  assert.equal(migrated.migrationHistory.at(-1).historicalPresentationReceiptsFabricated, false);
  assert.equal(migrated.migrationHistory.at(-1).preservedLegacyInteractionEvidenceDigest, digest(legacy.interaction));
  const replay = migrateOperationSessionToV3({ home, sessionId: migrated.sessionId, expectedSessionDigest: migrated.sessionDigest, adapterId: "generic-v3", hostInteraction: governedHostInteraction("generic-v3", "1.0.0") });
  assert.deepEqual(replay, migrated);
});

test("revision 8 reads integrity-valid Protocol v3 Sessions created before frameArchive, reevaluation lineage, and Evolution Context without rewriting them", () => {
  const home = temporary("v3-frame-archive");
  initializeWorkspace(home);
  const created = createAgentSession({ home, intent: "Read a pre-revision-7 Harness Session", adapterId: "workbuddy", hostInteraction: governedHostInteraction("workbuddy", "5.3.14") });
  const planned = createSessionPlan({ home, sessionId: created.sessionId, expectedSessionDigest: created.sessionDigest, goal: created.intent.text, sources: { notes: ["immutable evidence"], advisor: "off" } });
  const legacy = persistedJson(planned);
  delete legacy.interaction.frameArchive;
  delete legacy.reevaluation;
  delete legacy.evolutionContext;
  const persistedLegacy = writeSession(home, legacy);
  const before = fs.readFileSync(sessionFile(home, legacy.sessionId), "utf8");
  const inspected = inspectAgentSession(home, legacy.sessionId);
  assert.equal(inspected.interaction.frameArchive.length, 1);
  assert.equal(inspected.reevaluation, null);
  assert.equal(inspected.evolutionContext, null);
  assert.equal(inspected.interaction.frameArchive[0].frameDigest, inspected.interaction.currentFrame.frameDigest);
  assert.notEqual(inspected.sessionDigest, persistedLegacy.sessionDigest);
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
