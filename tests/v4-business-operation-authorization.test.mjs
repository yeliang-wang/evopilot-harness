import { installProfessionalFixture } from "./helpers/professional-supply.mjs";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { readYaml, writeYaml, digest } from "../src/v3/utils.mjs";
import { initializeWorkspace } from "../src/v3/workspace.mjs";
import { submitSessionBusinessDecision } from "../src/v4/session/store.mjs";
import { TestMcpClient, structured, governedHostInteraction } from "./helpers/mcp-client.mjs";

const root = path.resolve(import.meta.dirname, "..");

test("declared publication AUTHORIZE binds the current operation without executing it and survives restart", async (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "operation-choice-"));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  initializeWorkspace(home);
  installProfessionalFixture(home);
  const pack = readYaml(path.join(home, "ontology/reviewed-professional-fixture.yaml"));
  Object.assign(pack.metadata, { id: "business-choice-ontology", version: "1.0.0", lifecycle: "approved" });
  const file = path.join(home, "reviewed-pack.yaml");
  writeYaml(file, pack);
  const inputBefore = fs.readFileSync(file, "utf8");
  const destination = path.join(home, "ontology/business-choice-ontology@1.0.0.yaml");
  const startClient = () => new TestMcpClient({ command: process.execPath, args: ["src/index.mjs", "mcp", "serve", "--workspace", home], cwd: root });
  let client = startClient();
  const raw = async (name, args) => structured(await client.rawTool(name, args));
  const present = (s) => {
    const f = s.interaction.currentFrame;
    return raw("record_business_view_delivery", { sessionId: s.sessionId, expectedSessionDigest: s.sessionDigest,
      expectedFrameDigest: f.frameDigest, deliveredBusinessViewDigest: f.businessView.businessViewDigest,
      renderedBusinessViewDigest: f.businessView.renderedBusinessViewDigest });
  };
  try {
    await client.initialize();
    let s = await raw("start_operation_session", { intent: "Publish an exact reviewed fixture through declared business choices", adapterId: "codex", hostInteraction: governedHostInteraction() });
    s = await raw("plan_operation_session", { sessionId: s.sessionId, expectedSessionDigest: s.sessionDigest, scenario: "maintenance", goal: s.intent.text,
      operations: [{ operation: "ontology.publish", input: { file } }] });
    const planHandle = s.interaction.currentFrame.decisionDefinition.decisionHandle;
    s = await present(s);
    await raw("submit_business_decision", { decisionHandle: planHandle, choice: "APPROVE", decidedBy: "fixture-operator" });
    await raw("advance_operation_session", { sessionId: s.sessionId });
    s = await raw("inspect_operation_session", { sessionId: s.sessionId });
    assert.equal(s.status, "OPERATION_AUTHORIZATION_REQUIRED");
    const handle = s.interaction.currentFrame.decisionDefinition.decisionHandle;
    assert.ok(s.interaction.currentFrame.decisionDefinition.options.includes("AUTHORIZE"));
    const sessionFile = path.join(home, "agent-sessions", s.sessionId, "session.json");
    let before = fs.readFileSync(sessionFile, "utf8");
    // Actual MCP delivery records its receipt. A separate persisted fixture
    // exercises the Engine's undelivered-frame guard without a transport read.
    const undelivered = structuredClone(s);
    undelivered.interaction.presentationReceipts = [];
    delete undelivered.sessionDigest;
    undelivered.sessionDigest = digest(undelivered);
    fs.writeFileSync(sessionFile, `${JSON.stringify(undelivered, null, 2)}\n`);
    try {
      await assert.rejects(() => submitSessionBusinessDecision({ home, sessionId: s.sessionId, decisionHandle: handle, choice: "AUTHORIZE", decidedBy: "fixture-operator" }), error => error.code === "INTERACTION_PRESENTATION_REQUIRED");
    } finally { fs.writeFileSync(sessionFile, before); }
    assert.equal(fs.readFileSync(sessionFile, "utf8"), before);
    s = await present(s);
    before = fs.readFileSync(sessionFile, "utf8");
    for (const [args, code] of [
      [{ decisionHandle: planHandle }, "BUSINESS_DECISION_SESSION_UNRESOLVED"],
      [{ decidedBy: " " }, "BUSINESS_DECISION_ACTOR_REQUIRED"],
      [{ choice: "APPROVE" }, "BUSINESS_DECISION_CHOICE_INVALID"],
      [{ choice: "PUBLISH" }, "BUSINESS_DECISION_CHOICE_INVALID"]
    ]) {
      const failed = await raw("submit_business_decision", { decisionHandle: handle, choice: "AUTHORIZE", decidedBy: "fixture-operator", ...args });
      assert.equal(failed.code, code);
      assert.equal(fs.readFileSync(sessionFile, "utf8"), before);
    }
    const preserved = await raw("submit_business_decision", { decisionHandle: handle, choice: "PRESERVE_FOR_LATER", decidedBy: "fixture-operator" });
    assert.equal(preserved.sessionDigest, s.sessionDigest);
    assert.equal(fs.readFileSync(sessionFile, "utf8"), before);
    const pending = s.pendingOperationAuthorization;
    const authorized = await raw("submit_business_decision", { decisionHandle: handle, choice: "AUTHORIZE", decidedBy: "fixture-operator" });
    assert.equal(authorized.status, "READY_TO_EXECUTE");
    assert.equal(authorized.recordedChoice, "AUTHORIZE");
    assert.equal(authorized.authority.furtherHumanAuthorityGranted, false);
    assert.equal(fs.existsSync(destination), false);
    s = await raw("inspect_operation_session", { sessionId: s.sessionId });
    assert.equal(s.operationAuthorizations.length, 1);
    assert.equal(s.operationAuthorizations[0].operationDigest, pending.operationDigest);
    assert.equal(s.operationAuthorizations[0].planDigest, s.planDigest);
    assert.equal(s.operationAuthorizations[0].operationIndex, pending.operationIndex);
    assert.equal(s.pendingOperationAuthorization, null);
    assert.equal(s.humanDecisions.filter(d => d.type === "PLAN_PUBLICATION_AUTHORIZED").length, 1);
    before = fs.readFileSync(sessionFile, "utf8");
    const duplicate = await client.rawTool("submit_business_decision", { decisionHandle: handle, choice: "AUTHORIZE", decidedBy: "fixture-operator" });
    assert.equal(duplicate.isError, true);
    assert.equal(fs.readFileSync(sessionFile, "utf8"), before);
    await client.close();
    client = startClient();
    await client.initialize();
    const resumed = await raw("inspect_operation_session", { sessionId: s.sessionId });
    assert.equal(resumed.sessionDigest, s.sessionDigest);
    await raw("advance_operation_session", { sessionId: s.sessionId });
    const completed = await raw("inspect_operation_session", { sessionId: s.sessionId });
    assert.equal(completed.status, "COMPLETED");
    assert.equal(completed.humanDecisions.filter(d => d.type === "PLAN_PUBLICATION_AUTHORIZED").length, 1);
    assert.ok(fs.existsSync(destination));
    assert.equal(digest(readYaml(destination).spec), digest(pack.spec));
    assert.equal(fs.readFileSync(file, "utf8"), inputBefore);
  } finally { await client.close(); }
});
