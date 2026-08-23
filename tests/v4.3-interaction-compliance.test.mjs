import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { createInteractionFrame, createPresentationReceipt, FRAME_FIELDS, HOST_INTERACTION_LEVELS, requirePresentedFrame } from "../src/v4/interaction/controller.mjs";

const sha = (value) => `sha256:${crypto.createHash("sha256").update(String(value)).digest("hex")}`;
const governedHost = {
  id: "conformance-host",
  version: "1.0.0",
  level: "GOVERNED_HUMAN_GATE_COMPATIBLE",
  capabilities: ["deterministic-rendering", "governed-operation-interception", "ordered-visible-transcript-evidence", "interaction-frame-binding"]
};
const session = {
  sessionId: "session-interaction-conformance",
  sessionDigest: sha("session"),
  compatibility: {
    productVersion: "4.3.0",
    expertVersion: "4.3.0",
    coreDigest: sha("core"),
    agentProtocolVersion: "evopilot-harness-agent-operations/v2",
    engineApiVersion: "harness.evopilot.io/v3"
  }
};

test("Protocol v2 inventories and schema-validates every canonical interaction frame", () => {
  assert.deepEqual(HOST_INTERACTION_LEVELS, ["TRANSPORT_ONLY", "CONVERSATIONAL_COMPATIBLE", "OBSERVABLE_INTERACTION_COMPATIBLE", "GOVERNED_HUMAN_GATE_COMPATIBLE"]);
  for (const [stage, requiredFields] of Object.entries(FRAME_FIELDS)) {
    const renderModel = Object.fromEntries(requiredFields.map((field) => [field, field === "destructive" ? true : `${stage}:${field}`]));
    const frame = createInteractionFrame({
      session,
      stage,
      subject: { type: "CONFORMANCE_SUBJECT", id: stage.toLowerCase(), digest: sha(stage), bindings: { fixture: "v4.3" } },
      renderModel,
      decision: { kind: `${stage}_DECISION`, question: `Review ${stage}?` },
      allowedNextOperations: ["acknowledge_interaction_frame"],
      now: "2026-08-22T00:00:00.000Z"
    });
    assert.deepEqual(frame.requiredFields, requiredFields);
    assert.equal(frame.subject.bindings.fixture, "v4.3");
    assert.match(frame.frameDigest, /^sha256:[a-f0-9]{64}$/);
    assert.ok(frame.forbiddenOperations.includes("approve_session_proposal"));
    let prior = -1;
    for (const field of requiredFields) {
      const position = frame.canonicalMarkdown.indexOf(`## ${field}\n`);
      assert.ok(position > prior, `${stage}:${field} must be visibly rendered in declared order`);
      prior = position;
    }
    assert.ok(frame.canonicalMarkdown.indexOf("## Human decision") > prior, `${stage} decision must follow complete content`);
  }
});

test("Canonical frames reject missing authority-bearing fields and non-canonical transcript substitutes", () => {
  assert.throws(() => createInteractionFrame({
    session,
    stage: "PLAN_PRESENTATION",
    subject: { type: "OPERATION_PLAN", id: "plan", digest: sha("plan"), bindings: {} },
    renderModel: { schema: "plan" },
    allowedNextOperations: []
  }), (error) => error.code === "INTERACTION_REQUIRED_FIELDS_MISSING" && error.missingFields.includes("planDigest"));

  const fields = FRAME_FIELDS.PLAN_PRESENTATION;
  const frame = createInteractionFrame({
    session,
    stage: "PLAN_PRESENTATION",
    subject: { type: "OPERATION_PLAN", id: "plan", digest: sha("plan"), bindings: { planDigest: sha("plan") } },
    renderModel: Object.fromEntries(fields.map((field) => [field, field])),
    decision: { kind: "PLAN_CONFIRMATION", question: "Approve this exact Plan?" },
    allowedNextOperations: ["acknowledge_interaction_frame"]
  });
  assert.throws(() => createPresentationReceipt({ frame, host: governedHost, presentedFields: ["schema"], visibleTranscriptDigest: sha(frame.canonicalMarkdown) }), (error) => error.code === "INTERACTION_PRESENTATION_INCOMPLETE");
  assert.throws(() => createPresentationReceipt({ frame, host: governedHost, presentedFields: [...fields, "collapsed-summary"], visibleTranscriptDigest: sha(frame.canonicalMarkdown) }), (error) => error.code === "INTERACTION_PRESENTATION_INCOMPLETE");
  assert.throws(() => createPresentationReceipt({ frame, host: governedHost, presentedFields: fields, visibleTranscriptDigest: sha("view changes") }), (error) => error.code === "VISIBLE_TRANSCRIPT_MISMATCH");
  for (const level of HOST_INTERACTION_LEVELS.slice(0, -1)) {
    assert.throws(() => createPresentationReceipt({ frame, host: { ...governedHost, level }, presentedFields: fields, visibleTranscriptDigest: sha(frame.canonicalMarkdown) }), (error) => error.code === "HOST_INTERACTION_COMPLIANCE_UNAVAILABLE");
  }
});

test("Presentation receipts remain distinct from governed decisions and stale frames fail closed", () => {
  const fields = FRAME_FIELDS.PROPOSAL_REVIEW_PRESENTATION;
  const frame = createInteractionFrame({
    session,
    stage: "PROPOSAL_REVIEW_PRESENTATION",
    subject: { type: "PROPOSAL_REVIEW", id: "proposal-1", digest: sha("review"), bindings: { proposalDigest: sha("proposal"), reviewDigest: sha("review") } },
    renderModel: Object.fromEntries(fields.map((field) => [field, field])),
    decision: { kind: "PROPOSAL_REVIEW_COMPLETION", question: "Have you reviewed the complete immutable objects?" },
    allowedNextOperations: ["acknowledge_interaction_frame"]
  });
  const receipt = createPresentationReceipt({ frame, host: governedHost, presentedFields: fields, visibleTranscriptDigest: sha(frame.canonicalMarkdown) });
  assert.equal(receipt.schema, "evopilot-harness-interaction-presentation-receipt/v1");
  assert.equal(receipt.approval, undefined);
  assert.throws(() => requirePresentedFrame({ interaction: { currentFrame: frame, presentationReceipts: [] } }, frame.stage), (error) => error.code === "INTERACTION_PRESENTATION_REQUIRED");
  assert.deepEqual(requirePresentedFrame({ interaction: { currentFrame: frame, presentationReceipts: [receipt] } }, frame.stage), { frame, receipt });
  const changed = { ...frame, frameDigest: sha("changed-frame") };
  assert.throws(() => requirePresentedFrame({ interaction: { currentFrame: changed, presentationReceipts: [receipt] } }, frame.stage), (error) => error.code === "INTERACTION_PRESENTATION_REQUIRED");
});
