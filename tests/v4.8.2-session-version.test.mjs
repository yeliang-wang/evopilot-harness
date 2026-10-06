import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { initializeWorkspace } from "../src/v3/workspace.mjs";
import { digest, persistedJson } from "../src/v3/utils.mjs";
import { operationCompatibility } from "../src/v4/constants.mjs";
import { createAgentSession, inspectAgentSession, migrateOperationSessionCoreCompatibility, resumeAgentSession } from "../src/v4/session/store.mjs";
import { governedHostInteraction } from "./helpers/mcp-client.mjs";

function fixture(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "evopilot-version-session-"));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  initializeWorkspace(home);
  const session = createAgentSession({ home, intent: "Check Session version compatibility without model or publication", adapterId: "codex", hostInteraction: governedHostInteraction("codex", "test-fixture") });
  return { home, session, file: path.join(home, "agent-sessions", session.sessionId, "session.json") };
}

function persistFixture(file, session, version) {
  const value = persistedJson(session);
  value.compatibility.productVersion = version;
  value.compatibility.expertVersion = version;
  delete value.sessionDigest;
  value.sessionDigest = digest(value);
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
  return value;
}

test("current installed version projection permits Session inspect and same-version resume", (t) => {
  const { home, session } = fixture(t);
  assert.equal(session.compatibility.productVersion, operationCompatibility().productVersion);
  assert.equal(inspectAgentSession(home, session.sessionId).sessionDigest, session.sessionDigest);
  const resumed = resumeAgentSession({ home, sessionId: session.sessionId, expectedSessionDigest: session.sessionDigest, adapterId: "codex" });
  assert.equal(resumed.compatibility.productVersion, operationCompatibility().productVersion);
  assert.equal(inspectAgentSession(home, session.sessionId).sessionDigest, resumed.sessionDigest);
});

test("all previously recognized Session versions remain readable without rewriting bytes", (t) => {
  const { home, session, file } = fixture(t);
  for (const version of ["4.5.0", "4.6.0", "4.7.0", "4.8.0", "4.8.1"]) {
    const prior = persistFixture(file, session, version);
    const before = fs.readFileSync(file);
    assert.equal(inspectAgentSession(home, prior.sessionId).compatibility.productVersion, version);
    assert.deepEqual(fs.readFileSync(file), before);
  }
});

test("4.8.1 Session cannot resume or migrate across the product-version boundary", (t) => {
  const { home, session, file } = fixture(t);
  const prior = persistFixture(file, session, "4.8.1");
  const before = fs.readFileSync(file);
  assert.throws(() => resumeAgentSession({ home, sessionId: prior.sessionId, expectedSessionDigest: prior.sessionDigest, adapterId: "codex" }), (error) => error.code === "SESSION_COMPATIBILITY_BINDING_MISMATCH");
  assert.throws(() => migrateOperationSessionCoreCompatibility({ home, sessionId: prior.sessionId, expectedSessionDigest: prior.sessionDigest, expectedPriorCoreDigest: prior.compatibility.coreDigest, adapterId: "codex" }), (error) => error.code === "SESSION_CORE_MIGRATION_BOUNDARY_CHANGE");
  assert.deepEqual(fs.readFileSync(file), before);
});

test("unknown Session version still rejects without rewriting bytes", (t) => {
  const { home, session, file } = fixture(t);
  const unknown = persistFixture(file, session, "99.0.0");
  const before = fs.readFileSync(file);
  assert.throws(() => inspectAgentSession(home, unknown.sessionId), (error) => error.code === "PRE_V45_SESSION_UNSUPPORTED");
  assert.deepEqual(fs.readFileSync(file), before);
});

test("Session version acceptance never bypasses persisted integrity", (t) => {
  const { home, session, file } = fixture(t);
  const altered = JSON.parse(fs.readFileSync(file, "utf8"));
  altered.intent.text = "Altered after persistence";
  fs.writeFileSync(file, `${JSON.stringify(altered, null, 2)}\n`);
  const before = fs.readFileSync(file);
  assert.throws(() => inspectAgentSession(home, session.sessionId), (error) => error.code === "SESSION_INTEGRITY_FAILURE");
  assert.deepEqual(fs.readFileSync(file), before);
});
