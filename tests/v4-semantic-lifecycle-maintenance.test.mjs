import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { digest } from "../src/v3/utils.mjs";
import { initializeWorkspace } from "../src/v3/workspace.mjs";
import { createProfessionalPack, createPackLifecycleRecord, transitionPackLifecycle } from "../src/v4/semantics/professional-packs.mjs";
import { createProjectOntologyProposal, transitionProjectOntologyProposal, resolveProjectOntologySnapshot, publishProjectOntologyArtifactSet } from "../src/v4/semantics/project-ontology.mjs";
import { resolveOntologyFoundation } from "../src/v4/semantics/ontology-grounding.mjs";
import { TestMcpClient, structured, governedHostInteraction } from "./helpers/mcp-client.mjs";

test("MCP maintenance routes semantic lifecycle operations with separate authority and durable receipts", async (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "semantic-maintenance-"));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  initializeWorkspace(home);
  const files = new Map();
  const file = (name, value) => { const p = path.join(home, name + ".json"); const bytes = JSON.stringify(value); fs.writeFileSync(p, bytes); files.set(p, bytes); return p; };
  const project = { id: "isolated", workspaceId: "isolated", tenantId: "isolated", sourceSnapshotDigest: digest("synthetic") };
  const pack = createProfessionalPack({ kind: "DomainOntologyPack", metadata: { id: "synthetic", version: "1.0.0", namespace: "synthetic", root: "DOMAIN_TEAM", visibility: "DOMAIN", owner: "fixture", provenance: { author: "author", reviewers: ["reviewer"], approvers: ["approver"], publishers: ["publisher"], sourceRefs: ["source://fixture"] } }, spec: { concepts: [{ conceptId: "synthetic:root", label: "Synthetic", metaType: "CAPABILITY", definition: "A declared test capability", evidenceRefs: ["source://fixture"] }] } });
  const packFile = file("pack", pack), init = { targetRoot: "DOMAIN_TEAM", project, dependencyClosure: { digest: digest("dependencies") }, conflictPreview: { digest: digest("no-conflict") } };
  let record = createPackLifecycleRecord({ ...init, pack });
  const initialFile = file("draft", record);
  for (const action of ["APPLY", "REQUEST_REVIEW", "APPROVE", "PUBLISH"]) record = transitionPackLifecycle({ record, action, actor: "fixture-" + action, expectedRecordDigest: record.recordDigest });
  const publishedFile = file("published-pack-record", record);
  let proposal = createProjectOntologyProposal({ project, packs: [pack], targetRoot: "DOMAIN_TEAM", createdBy: "author" });
  const proposalFile = file("proposal", proposal);
  for (const action of ["APPLY", "REQUEST_REVIEW", "APPROVE"]) proposal = transitionProjectOntologyProposal({ proposal, action, actor: "fixture-" + action, expectedProposalDigest: proposal.proposalDigest });
  const snapshot = resolveProjectOntologySnapshot({ proposal, expectedProposalDigest: proposal.proposalDigest, foundationDigest: resolveOntologyFoundation().foundationDigest });
  const artifact = publishProjectOntologyArtifactSet({ snapshot, publication: { decision: "AUTHORIZED", actor: "publisher", authorizationDigest: digest("fixture-authorization"), version: "1.0.0", at: "2026-09-29T00:00:00.000Z" } });
  const artifactFile = file("artifact", artifact);
  const start = () => new TestMcpClient({ command: process.execPath, args: ["src/index.mjs", "mcp", "serve", "--workspace", home], cwd: path.resolve(import.meta.dirname, "..") });
  let client = start();
  const raw = async (name, args) => structured(await client.rawTool(name, args));
  const inspect = sessionId => raw("inspect_operation_session", { sessionId });
  const decide = (s, choice) => raw("submit_business_decision", { decisionHandle: s.interaction.currentFrame.decisionDefinition.decisionHandle, choice, decidedBy: "delegated-fixture-operator" });
  async function plan(operation, input) {
    let s = await raw("start_operation_session", { intent: "Verify isolated semantic lifecycle", adapterId: "codex", hostInteraction: governedHostInteraction() });
    s = await raw("plan_operation_session", { sessionId: s.sessionId, expectedSessionDigest: s.sessionDigest, scenario: "maintenance", goal: s.intent.text, operations: [{ operation, input }] });
    assert.equal(s.status, "PLAN_REVIEW_REQUIRED");
    await decide(s, "APPROVE");
    await raw("advance_operation_session", { sessionId: s.sessionId });
    return inspect(s.sessionId);
  }
  try {
    await client.initialize();
    for (const [operation, input, stage] of [
      ["pack.lifecycle.create", { file: file("init", init), pack: packFile }, "DRAFT"],
      ["pack.lifecycle.transition", { record: initialFile, transition: "APPLY", actor: "author", actorRole: "AUTHOR", expectedRecordDigest: files.has(initialFile) ? JSON.parse(files.get(initialFile)).recordDigest : "" }, "APPLIED"],
      ["project-ontology.proposal.transition", { proposal: proposalFile, transition: "APPLY", actor: "author", expectedProposalDigest: JSON.parse(files.get(proposalFile)).proposalDigest }, "APPLIED"]
    ]) {
      await t.test(operation + " remains Plan-bound without a redundant authorization", async () => {
        const s = await plan(operation, input);
        assert.equal(s.status, "COMPLETED");
        assert.equal(s.operationAuthorizations.length, 0);
        const receipt = JSON.parse(fs.readFileSync(path.join(home, "agent-operation-receipts", s.operations[0].idempotencyKey + ".json")));
        assert.equal(receipt.result.result.stage ?? receipt.result.result.status, stage);
      });
    }
    for (const [operation, input] of [
      ["pack.lifecycle.transition", { record: publishedFile, transition: "INSTALL", actor: "installer", actorRole: "INSTALLER", expectedRecordDigest: record.recordDigest }],
      ["project-ontology.artifact.transition", { artifactSet: artifactFile, transition: "INSTALL", actor: "installer", actorRole: "INSTALLER" }]
    ]) {
      await t.test(operation + " requires exact authorization, replays after restart and rejects duplicate choice", async () => {
        let s = await plan(operation, input);
        assert.equal(s.status, "OPERATION_AUTHORIZATION_REQUIRED");
        assert.equal(s.interaction.currentFrame.businessView.risk.tier, "R3");
        assert.equal(s.operations.length, 0);
        const handle = s.interaction.currentFrame.decisionDefinition.decisionHandle;
        await decide(s, "AUTHORIZE");
        s = await inspect(s.sessionId);
        assert.equal(s.operations.length, 0);
        assert.equal(s.operationAuthorizations.length, 1);
        const duplicate = await client.rawTool("submit_business_decision", { decisionHandle: handle, choice: "AUTHORIZE", decidedBy: "installer" });
        assert.equal(duplicate.isError, true);
        await client.close(); client = start(); await client.initialize();
        await raw("advance_operation_session", { sessionId: s.sessionId });
        s = await inspect(s.sessionId);
        assert.equal(s.status, "COMPLETED");
        assert.equal(s.operations.length, 1);
        const receipt = JSON.parse(fs.readFileSync(path.join(home, "agent-operation-receipts", s.operations[0].idempotencyKey + ".json")));
        assert.equal(receipt.result.result.stage, "INSTALLED");
        assert.equal(digest(receipt.result), s.operations[0].resultDigest);
        await raw("advance_operation_session", { sessionId: s.sessionId });
        assert.equal((await inspect(s.sessionId)).operations.length, 1);
      });
    }
    for (const [name, overrides] of [["wrong-role", { actorRole: "AUTHOR" }], ["stale-record", { expectedRecordDigest: digest("stale") }]]) {
      await t.test(name + " remains refused after Plan and separate authorization", async () => {
        let s = await plan("pack.lifecycle.transition", { record: publishedFile, transition: "INSTALL", actor: "installer", actorRole: "INSTALLER", expectedRecordDigest: record.recordDigest, ...overrides });
        assert.equal(s.status, "OPERATION_AUTHORIZATION_REQUIRED"); await decide(s, "AUTHORIZE");
        await raw("advance_operation_session", { sessionId: s.sessionId }); s = await inspect(s.sessionId);
        assert.equal(s.status, "BLOCKED"); assert.equal(s.operations[0].exitCode, 1);
      });
    }
    await t.test("diagnostics and unrelated session operations cannot bypass their dedicated gates", async () => {
      await assert.rejects(() => raw("run_engine_diagnostic", { operation: "pack.lifecycle.transition", input: { record: publishedFile, transition: "INSTALL", actor: "installer" } }), /arguments.operation must be one of/);
      for (const operation of ["proposal.approve", "proposal.publish"]) {
        const s = await raw("start_operation_session", { intent: "Forbidden generic bypass", adapterId: "codex", hostInteraction: governedHostInteraction() });
        const failed = await raw("plan_operation_session", { sessionId: s.sessionId, expectedSessionDigest: s.sessionDigest, scenario: "maintenance", goal: s.intent.text, operations: [{ operation, input: { proposalId: "never-created" } }] });
        assert.equal(failed.code, "OPERATION_NOT_PLAN_ELIGIBLE");
      }
    });
    await t.test("changed immutable input cannot execute after separate authorization", async () => {
      let s = await plan("project-ontology.artifact.transition", { artifactSet: artifactFile, transition: "INSTALL", actor: "installer", actorRole: "INSTALLER" });
      assert.equal(s.status, "OPERATION_AUTHORIZATION_REQUIRED");
      await decide(s, "AUTHORIZE");
      fs.appendFileSync(artifactFile, "\n");
      const refused = await raw("advance_operation_session", { sessionId: s.sessionId });
      assert.equal(refused.code, "SEMANTIC_LIFECYCLE_INPUT_CHANGED");
      s = await inspect(s.sessionId);
      assert.equal(s.operations.length, 0);
      fs.writeFileSync(artifactFile, files.get(artifactFile));
    });
    for (const [p, bytes] of files) assert.equal(fs.readFileSync(p, "utf8"), bytes);
  } finally { await client.close(); }
});
