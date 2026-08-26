import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import Ajv2020 from "ajv/dist/2020.js";
import { digest } from "../src/v3/utils.mjs";
import { createBusinessInteractionProjection, verifyBusinessViewDelivery } from "../src/v4/interaction/business-projection.mjs";
import { createBusinessViewDeliveryReceipt, createInteractionFrame } from "../src/v4/interaction/controller.mjs";
import { verifyCompleteLifecycleReplays } from "../src/v4/interaction/lifecycle-replay.mjs";
import { REQUIRED_GOVERNED_HOST_CAPABILITIES } from "../src/v4/interaction/professional-reasoning.mjs";
import { toolResult } from "../src/v4/operation-server/server.mjs";
import { TestMcpClient, structured } from "./helpers/mcp-client.mjs";

const root = path.resolve(import.meta.dirname, "..");

test("managed WorkBuddy runtime identity is MCP-authoritative and forbids host CLI discovery", () => {
  const core = fs.readFileSync(path.join(root, "digital-expert/core/instructions.md"), "utf8");
  const adapter = fs.readFileSync(path.join(root, "digital-expert/adapters/workbuddy/WORKBUDDY.md"), "utf8");
  const packagedSkill = fs.readFileSync(path.join(root, "digital-expert/installers/workbuddy/expert/skills/evopilot-harness-digital-expert/SKILL.md"), "utf8");
  for (const text of [core, adapter]) {
    assert.match(text, /sole runtime authority/);
    assert.match(text, /inspect_capabilities/);
    assert.match(text, /global npm/);
    assert.match(text, /Host-LLM reasoning/);
  }
  assert.match(core, /opaque Evidence Source at the Agent-host boundary/);
  assert.match(core, /never open, unzip, parse, search, summarize, classify, quote, or reason over its contents/);
  assert.match(adapter, /WorkBuddy is attachment transport, exact Engine rendering, MCP invocation, and explicit decision transport only/);
  for (const text of [core, adapter, packagedSkill]) {
    assert.match(text, /records the canonical delivery receipt inside the same canonical-response path/);
    assert.match(text, /must not require a second user prompt or an extra assistant turn/);
    assert.match(text, /idempotent compatibility\/recovery fallback only/);
  }
});

test("governed MCP results lock the entire Host assistant turn to Engine canonical Markdown", () => {
  const frame = createInteractionFrame({ session: session("workbuddy"), stage: "PLAN_PRESENTATION", subject: subject(), renderModel: plan(), decision: { kind: "PLAN_CONFIRMATION", question: "Do you approve this Harness plan?" }, allowedNextOperations: ["record_business_view_delivery"] });
  const response = toolResult({ schema: "test-session/v1", interaction: { currentFrame: frame } });
  assert.equal(response.content.length, 1);
  assert.equal(response.content[0].text, frame.businessView.canonicalMarkdown);
  assert.equal(response._meta["evopilot/harnessPresentation"].mode, "EXACT_CANONICAL_MARKDOWN_ONLY");
  assert.equal(response._meta["evopilot/harnessPresentation"].soleVisibleBusinessContent, true);
  assert.equal(response._meta["evopilot/harnessPresentation"].hostMayAddProse, false);
  assert.equal(response._meta["evopilot/harnessPresentation"].assistantTurnMustEqualContentText, true);
  assert.deepEqual(response.structuredContent.interaction.currentFrame, frame);
  assert.doesNotMatch(response.content[0].text, /^\{|🎉|发布完成/);

  const jobResponse = toolResult({ result: { presentation: { stage: frame.stage, frameId: frame.frameId, frameDigest: frame.frameDigest, businessViewDigest: frame.businessView.businessViewDigest, canonicalMarkdown: frame.businessView.canonicalMarkdown } } });
  assert.equal(jobResponse.content[0].text, frame.businessView.canonicalMarkdown);

  const ordinary = toolResult({ status: "READY" });
  assert.equal(ordinary.content[0].text, '{"status":"READY"}');
  assert.equal(ordinary._meta, undefined);
});

test("revision 8 records canonical presentation delivery inside the MCP response path without a second Host prompt", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "evopilot-v44-auto-delivery-"));
  const attachment = path.join(home, "代码生成提示词整理.docx");
  fs.writeFileSync(attachment, "read-only test evidence\n", "utf8");
  const client = new TestMcpClient({ command: process.execPath, args: ["src/index.mjs", "mcp", "serve", "--workspace", home], cwd: root });
  try {
    await client.initialize();
    structured(await client.rawTool("prepare_workspace", { initialize: true }));
    const started = structured(await client.rawTool("start_operation_session", {
      intent: "从只读附件提取可复用 Harness 能力",
      adapterId: "evopilot-harness-digital-expert",
      hostInteraction: { ...host, id: "workbuddy", locale: "zh-CN", supportsOperationJobs: true, maxSynchronousMcpRequestMs: 600000 }
    }));
    const response = await client.rawTool("plan_operation_session", {
      sessionId: started.sessionId,
      expectedSessionDigest: started.sessionDigest,
      scenario: "evolve",
      goal: "判断只读附件中哪些内容适合沉淀为 Harness",
      sources: { attachments: [attachment], allowInternetResearch: false, includeModules: false, advisor: "off" },
      operations: [{ operation: "evidence.produce", input: { attachments: [attachment], advisor: "off" } }]
    });
    assert.equal(response.isError, undefined, JSON.stringify(response.structuredContent));
    const planned = structured(response);
    const frame = planned.interaction.currentFrame;
    const receipts = planned.interaction.presentationReceipts.filter((item) => item.frameDigest === frame.frameDigest);
    assert.equal(response.content[0].text, frame.businessView.canonicalMarkdown);
    assert.equal(response._meta["evopilot/harnessPresentation"].mode, "EXACT_CANONICAL_MARKDOWN_ONLY");
    assert.equal(planned.status, "PLAN_REVIEW_REQUIRED");
    assert.equal(planned.nextAction, "request-explicit-plan-business-decision");
    assert.equal(receipts.length, 1);
    assert.equal(receipts[0].automatic, true);
    assert.equal(receipts[0].authority.deliveryEvidenceOnly, true);
    assert.equal(receipts[0].authority.humanApproval, false);
    assert.equal(receipts[0].renderedBusinessViewDigest, frame.businessView.renderedBusinessViewDigest);
    assert.equal(planned.humanDecisions.length, 0);
    assert.match(response.content[0].text, /<!-- evopilot-harness-decision-transport \{/);
    assert.doesNotMatch(response.content[0].text, /sessionId/);
    assert.match(response.content[0].text, new RegExp(`decisionHandle:${frame.decisionDefinition.decisionHandle}`));
    assert.match(response.content[0].text, /tool:submit_business_decision/);
    assert.match(response.content[0].text, /Never call digest-bound compatibility tools/);

    const stale = await client.rawTool("submit_business_decision", {
      sessionId: planned.sessionId,
      decisionHandle: "decision-000000000000000000000000",
      choice: "APPROVE",
      decidedBy: "workbuddy-human"
    });
    assert.equal(stale.isError, true);
    assert.equal(stale.structuredContent.code, "BUSINESS_DECISION_HANDLE_MISMATCH");
    const unchanged = structured(await client.rawTool("inspect_operation_session", { sessionId: planned.sessionId }));
    assert.equal(unchanged.sessionDigest, planned.sessionDigest);

    const confirmed = structured(await client.rawTool("submit_business_decision", {
      decisionHandle: frame.decisionDefinition.decisionHandle,
      choice: "APPROVE",
      decidedBy: "workbuddy-human"
    }));
    assert.equal(confirmed.status, "READY_TO_EXECUTE");
    assert.equal(confirmed.recordedChoice, "APPROVE");
    assert.equal(confirmed.nextAction, "advance-confirmed-session-operation");
    assert.equal(confirmed.authority.hostInferred, false);
    assert.doesNotMatch(JSON.stringify(confirmed), /CONFIRM_OPERATION_PLAN|planDigest/);

    const replayed = structured(await client.rawTool("record_business_view_delivery", {
      sessionId: planned.sessionId,
      expectedSessionDigest: confirmed.sessionDigest,
      expectedFrameDigest: frame.frameDigest,
      deliveredBusinessViewDigest: frame.businessView.businessViewDigest,
      renderedBusinessViewDigest: frame.businessView.renderedBusinessViewDigest
    }));
    assert.equal(replayed.sessionDigest, confirmed.sessionDigest);
    assert.equal(replayed.interaction.presentationReceipts.length, planned.interaction.presentationReceipts.length);
  } finally {
    await client.close();
  }
});

const host = {
  id: "independent-test-host",
  version: "1.0.0",
  level: "GOVERNED_HUMAN_GATE_COMPATIBLE",
  capabilities: [...REQUIRED_GOVERNED_HOST_CAPABILITIES]
};

function session(hostId = host.id) {
  return {
    sessionId: "session-v44-business-test",
    sessionDigest: digest("stable-session-state"),
    compatibility: { productVersion: "4.4.0", expertVersion: "4.4.0", coreDigest: digest("core"), agentProtocolVersion: "evopilot-harness-agent-operations/v3", engineApiVersion: "harness.evopilot.io/v3" },
    interaction: { host: { ...host, id: hostId }, presentationReceipts: [] }
  };
}

function subject() { return { type: "OPERATION_PLAN", id: "session-v44-business-test", digest: digest("plan"), bindings: {} }; }
function plan() {
  return {
    schema: "evopilot-harness-operation-plan/v1",
    scenario: "evolve",
    goal: "Derive reusable Harness capabilities from code-generation prompts",
    sources: { attachments: ["代码生成提示词整理.docx"] },
    operations: [{ operation: "evidence.produce", input: { attachmentCount: 1 } }],
    stopPoints: ["plan-confirmation", "proposal-approval", "publication-decision"],
    authority: { engineAuthoritative: true, sourceExecutionAllowed: false },
    planDigest: digest("plan")
  };
}

test("AC01-AC04 schemas validate generated business objects", () => {
  const frame = createInteractionFrame({ session: session(), stage: "PLAN_PRESENTATION", subject: subject(), renderModel: plan(), decision: { kind: "PLAN_CONFIRMATION", question: "Do you approve this Harness plan?" }, allowedNextOperations: ["record_business_view_delivery"] });
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  for (const [file, value] of [
    ["business-decision-view-v1.schema.json", frame.businessView],
    ["compliance-audit-envelope-v1.schema.json", frame.auditEnvelope],
    ["source-to-harness-reasoning-map-v1.schema.json", frame.sourceReasoningMap],
    ["decision-definition-v1.schema.json", frame.decisionDefinition],
    ["interaction-frame-v2.schema.json", frame]
  ]) {
    const validate = ajv.compile(JSON.parse(fs.readFileSync(path.join(root, "schemas", file), "utf8")));
    assert.equal(validate(value), true, `${file}: ${JSON.stringify(validate.errors)}`);
  }
  assert.deepEqual(frame.decisionDefinition.options, ["APPROVE", "REQUEST_REVISION", "REJECT", "PRESERVE_FOR_LATER"]);
});

test("AC05-AC06 and AC24-AC25 business content is deterministic and Host-neutral", () => {
  const input = { stage: "PLAN_PRESENTATION", subject: subject(), renderModel: plan(), decision: { kind: "PLAN_CONFIRMATION", question: "Do you approve this Harness plan?" }, requiredFields: ["goal", "sources", "operations", "stopPoints", "authority", "planDigest"], allowedNextOperations: ["record_business_view_delivery"], forbiddenOperations: ["approve_session_proposal"] };
  const workbuddy = createBusinessInteractionProjection({ session: session("workbuddy"), ...input });
  const independent = createBusinessInteractionProjection({ session: session("independent-host"), ...input });
  assert.equal(workbuddy.businessView.businessViewDigest, independent.businessView.businessViewDigest);
  assert.equal(workbuddy.businessView.canonicalMarkdown, independent.businessView.canonicalMarkdown);
  assert.equal(workbuddy.businessView.authority.hostAuthored, false);
});

test("AC33-AC48 professional template is byte-stable and rejects every rendering drift class", () => {
  const current = session("workbuddy");
  current.intent = { goal: "从《代码生成提示词整理.docx》沉淀可复用 Harness 能力" };
  const input = { stage: "PLAN_PRESENTATION", subject: subject(), renderModel: { ...plan(), goal: current.intent.goal, sources: { attachments: ["/Users/example/Desktop/代码生成提示词整理.docx"] } }, decision: { kind: "PLAN_CONFIRMATION", question: "Approve?" }, requiredFields: ["goal", "sources", "operations", "stopPoints", "authority", "planDigest"], allowedNextOperations: ["record_business_view_delivery"], forbiddenOperations: ["approve_session_proposal"] };
  const renders = Array.from({ length: 3 }, () => createBusinessInteractionProjection({ session: current, ...input }).businessView);
  const independent = createBusinessInteractionProjection({ session: session("independent-host"), ...input }).businessView;
  assert.equal(new Set([...renders, independent].map((item) => item.canonicalMarkdown)).size, 1);
  assert.equal(new Set([...renders, independent].map((item) => item.renderedBusinessViewDigest)).size, 1);
  const view = renders[0];
  assert.equal(view.template.schema, "evopilot-harness-business-presentation/v2");
  assert.deepEqual(view.informationArchitecture, { primary: "business", secondary: "professional-detail", audit: "compliance-audit-envelope" });
  assert.match(view.canonicalMarkdown, /本次要解决的问题/);
  assert.match(view.canonicalMarkdown, /Harness 分析范围/);
  assert.match(view.canonicalMarkdown, /风险级别/);
  assert.match(view.canonicalMarkdown, /需要你的决定/);
  assert.match(view.canonicalMarkdown, /批准/);
  assert.doesNotMatch(view.canonicalMarkdown, /[“”‘’"]|[:：]\s/);
  assert.equal(view.canonicalMarkdown.endsWith("\n"), false);
  assert.doesNotMatch(view.canonicalMarkdown.replace(/<!--[^]*?-->/g, ""), /```json|\/Users\/|sha256:|inspect_capabilities|approve_session_proposal|PLAN_CONFIRMATION|APPROVE|PRESERVE_FOR_LATER|sessionId|planDigest|MCP|protocol/i);
  for (const drift of [
    `${view.canonicalMarkdown}\n额外解释`,
    view.canonicalMarkdown.replace("本次要解决的问题", "目标"),
    view.canonicalMarkdown.replace("批准", "同意"),
    view.canonicalMarkdown.split("\n").reverse().join("\n"),
    view.canonicalMarkdown.replace("Harness", "ハーネス")
  ]) {
    assert.throws(() => verifyBusinessViewDelivery({ businessView: view, deliveredBusinessViewDigest: view.businessViewDigest, renderedBusinessViewDigest: digest(drift) }), /omitted, rewritten/);
  }
});

test("revision 9 verifies three fresh complete production lifecycles across the Engine Frame and Host Surface boundary", () => {
  const current = session("workbuddy");
  current.intent = { goal: "从《代码生成提示词整理.docx》沉淀可复用 Harness 能力" };
  const frames = completeLifecycleFrames(current);
  const replay = ({ hostId, modelId, restartOrdinal, observedAt, run }) => ({
    hostId,
    hostVersion: hostId === "workbuddy" ? "5.2.6" : "1.0.0",
    modelId,
    restartOrdinal,
    observedAt,
    workspaceId: `workspace-${hostId}-${run}`,
    sessionId: `session-${hostId}-${run}`,
    taskId: `task-${hostId}-${run}`,
    governedInputDigest: digest({ source: "代码生成提示词整理.docx", version: "4.4.0", configuration: "candidate", locale: "zh-CN", decisions: "approved-production-path" }),
    hostSurface: { loading: `Host loading state ${run}`, modelStatus: modelId },
    frames: frames.map((frame) => ({ frame, visibleText: frame.businessView.canonicalMarkdown, contentBefore: "", contentAfter: "" }))
  });
  const report = verifyCompleteLifecycleReplays({
    baselineFrames: frames,
    replays: [
      replay({ hostId: "workbuddy", modelId: "GLM-5.3", restartOrdinal: 0, observedAt: "2026-08-24T08:00:00Z", run: 1 }),
      replay({ hostId: "workbuddy", modelId: "GLM-5.3", restartOrdinal: 0, observedAt: "2026-08-24T10:00:00Z", run: 2 }),
      replay({ hostId: "workbuddy", modelId: "GLM-5.3", restartOrdinal: 0, observedAt: "2026-08-24T12:00:00Z", run: 3 }),
      replay({ hostId: "generic-independent-host", modelId: "deterministic-fixture", restartOrdinal: 0, observedAt: "2026-08-24T14:00:00Z", run: 1 })
    ]
  });
  assert.equal(report.zeroDrift, true);
  assert.equal(report.workBuddyReplayCount, 3);
  assert.equal(report.independentHostReplayCount, 1);
  assert.equal(report.governedMutationReplayCount, 0);
  assert.deepEqual(report.orderedStages, ["PLAN_PRESENTATION", "PROPOSAL_REVIEW_PRESENTATION", "PROPOSAL_APPROVAL_DECISION", "PUBLICATION_PRESENTATION", "CATALOG_VALIDATION_PRESENTATION", "CLOSE_PRESENTATION"]);
  assert.deepEqual(report.businessPhases, ["OPERATION_PLAN", "PROFESSIONAL_ANALYSIS_AND_PROPOSAL_REVIEW", "PROPOSAL_HUMAN_DECISION", "PUBLICATION_AND_SESSION_LIFECYCLE"]);
  assert.equal(report.hostSurfaceExcluded, true);

  const drifted = replay({ hostId: "workbuddy", modelId: "GLM-5.3", restartOrdinal: 0, observedAt: "2026-08-24T12:00:00Z", run: 3 });
  drifted.frames[4].contentAfter = "🎉 发布完成";
  assert.throws(() => verifyCompleteLifecycleReplays({
    baselineFrames: frames,
    replays: [
      replay({ hostId: "workbuddy", modelId: "GLM-5.3", restartOrdinal: 0, observedAt: "2026-08-24T08:00:00Z", run: 1 }),
      replay({ hostId: "workbuddy", modelId: "GLM-5.3", restartOrdinal: 0, observedAt: "2026-08-24T10:00:00Z", run: 2 }),
      drifted,
      replay({ hostId: "generic-independent-host", modelId: "deterministic-fixture", restartOrdinal: 0, observedAt: "2026-08-24T14:00:00Z", run: 1 })
    ]
  }), (error) => error.code === "LIFECYCLE_RENDERING_DRIFT" && /hostProse/.test(error.message));
});

test("RC06 professional presentation remains domain-neutral across representative Harness evolution cases", () => {
  const cases = [
    { goal: "从代码生成规范沉淀分层代码生成 Harness", source: "代码生成规范.docx" },
    { goal: "从 API 与架构规范沉淀接口设计 Harness", source: "API与架构规范.md" },
    { goal: "从测试与安全规则沉淀质量保障 Harness", source: "测试与安全规则.yaml" },
    { goal: "从运维手册沉淀故障处置 Harness", source: "生产运维手册.pdf" }
  ];
  const views = cases.map(({ goal, source }) => createBusinessInteractionProjection({
    session: { ...session("independent-host"), intent: { goal } },
    stage: "PLAN_PRESENTATION",
    subject: subject(),
    renderModel: { ...plan(), goal, sources: { attachments: [source] } },
    decision: { kind: "PLAN_CONFIRMATION", question: "Approve?" },
    requiredFields: ["goal", "sources", "operations", "stopPoints", "authority", "planDigest"],
    allowedNextOperations: ["record_business_view_delivery"],
    forbiddenOperations: ["approve_session_proposal"]
  }).businessView);
  for (const [index, view] of views.entries()) {
    assert.equal(view.template.schema, "evopilot-harness-business-presentation/v2");
    assert.deepEqual(view.informationArchitecture, { primary: "business", secondary: "professional-detail", audit: "compliance-audit-envelope" });
    assert.match(view.canonicalMarkdown, new RegExp(cases[index].goal));
    assert.match(view.canonicalMarkdown, new RegExp(cases[index].source.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(view.canonicalMarkdown, /本次要解决的问题/);
    assert.match(view.canonicalMarkdown, /Harness 分析范围/);
    assert.match(view.canonicalMarkdown, /需要你的决定/);
    assert.doesNotMatch(view.canonicalMarkdown.replace(/<!--[^]*?-->/g, ""), /```json|sha256:|MCP|protocol|sessionId|planDigest/i);
  }
});

function completeLifecycleFrames(current) {
  const now = "2026-08-24T06:00:00.000Z";
  const proposalId = "proposal-code-generation-profile";
  return [
    createInteractionFrame({ session: current, stage: "PLAN_PRESENTATION", subject: subject(), renderModel: plan(), decision: { kind: "PLAN_CONFIRMATION", question: "Approve?" }, allowedNextOperations: ["record_business_view_delivery"], now }),
    createInteractionFrame({
      session: current,
      stage: "PROPOSAL_REVIEW_PRESENTATION",
      subject: { type: "PROPOSAL_REVIEW", id: proposalId, digest: digest("review"), bindings: { proposalDigest: digest("proposal"), reviewDigest: digest("review") } },
      renderModel: { proposal: { proposalId, outcome: "EVOLVE", proposedAssets: ["api-gateway-profile@0.1.1"] }, proposalDigest: digest("proposal"), review: { verdict: "READY_FOR_HUMAN_APPROVAL", reasons: ["Evidence-backed"] }, reviewDigest: digest("review"), evaluation: { status: "SUFFICIENT" }, comparisonAssessment: { status: "NOT_REQUIRED" }, authority: { engineAuthoritative: true }, nextAction: "request-explicit-proposal-business-decision" },
      decision: { kind: "PROPOSAL_REVIEW_COMPLETION", question: "Review complete?" },
      allowedNextOperations: ["record_business_view_delivery"],
      now
    }),
    createInteractionFrame({
      session: current,
      stage: "PROPOSAL_APPROVAL_DECISION",
      subject: { type: "PROPOSAL", id: proposalId, digest: digest("proposal"), bindings: { proposalDigest: digest("proposal"), reviewDigest: digest("review") } },
      renderModel: { proposalId, proposalDigest: digest("proposal"), reviewDigest: digest("review"), evaluationReviewed: true, question: "Approve?" },
      decision: { kind: "PROPOSAL_APPROVAL", question: "Approve?" },
      allowedNextOperations: ["record_business_view_delivery"],
      now
    }),
    createInteractionFrame({
      session: current,
      stage: "PUBLICATION_PRESENTATION",
      subject: { type: "APPROVED_PROPOSAL_PUBLICATION", id: proposalId, digest: digest("approved-proposal"), bindings: {} },
      renderModel: { proposalId, approvedProposalDigest: digest("approved-proposal"), assets: ["api-gateway-profile@0.1.1"], catalog: { destination: "organization-catalog" }, impact: "Publish immutable assets.", nonPublicationOutcome: "Preserve in review.", authority: { separateHumanAuthorizationRequired: true } },
      decision: { kind: "PUBLICATION_AUTHORIZATION", question: "Publish?" },
      allowedNextOperations: ["record_business_view_delivery"],
      now
    }),
    createInteractionFrame({
      session: current,
      stage: "CATALOG_VALIDATION_PRESENTATION",
      subject: { type: "CATALOG_VALIDATION", id: proposalId, digest: digest("catalog"), bindings: {} },
      renderModel: { proposalId, publication: { status: "PUBLISHED" }, catalogStatus: "VALIDATED", catalogDigest: digest("catalog"), nextAction: "close-session" },
      allowedNextOperations: ["record_business_view_delivery"],
      now
    }),
    createInteractionFrame({
      session: current,
      stage: "CLOSE_PRESENTATION",
      subject: { type: "AGENT_OPERATION_SESSION", id: current.sessionId, digest: current.sessionDigest, bindings: {} },
      renderModel: { sessionId: current.sessionId, sessionDigest: current.sessionDigest, status: "COMPLETED", preserved: ["Harness assets", "Engine artifacts"], question: "Close?" },
      decision: { kind: "CLOSE_DECISION", question: "Close?" },
      allowedNextOperations: ["record_business_view_delivery"],
      now
    })
  ];
}

test("AC07-AC09 exact Business View delivery fails on rewriting or stale content", () => {
  const frame = createInteractionFrame({ session: session(), stage: "PLAN_PRESENTATION", subject: subject(), renderModel: plan(), decision: { kind: "PLAN_CONFIRMATION", question: "Do you approve this Harness plan?" }, allowedNextOperations: ["record_business_view_delivery"] });
  assert.throws(() => verifyBusinessViewDelivery({ businessView: frame.businessView, deliveredBusinessViewDigest: digest("rewritten"), renderedBusinessViewDigest: digest(frame.businessView.canonicalMarkdown) }), /current authoritative/);
  assert.throws(() => verifyBusinessViewDelivery({ businessView: frame.businessView, deliveredBusinessViewDigest: frame.businessView.businessViewDigest, renderedBusinessViewDigest: digest(`${frame.businessView.canonicalMarkdown}\nomitted`) }), /omitted, rewritten/);
});

test("revision 9 keeps the zh-CN Close Frame fully localized", () => {
  const current = session();
  current.interaction.host.locale = "zh-CN";
  const frame = createInteractionFrame({
    session: current,
    stage: "CLOSE_PRESENTATION",
    subject: { type: "AGENT_OPERATION_SESSION", id: current.sessionId, digest: current.sessionDigest, bindings: {} },
    renderModel: { sessionId: current.sessionId, sessionDigest: current.sessionDigest, status: "COMPLETED", preserved: ["SESSION_AUDIT_STATE", "HARNESS_ASSETS", "ENGINE_ARTIFACTS", "EVIDENCE_SOURCES"], question: "Do you want to close this exact Session while preserving its state?" },
    decision: { kind: "CLOSE_DECISION", question: "Do you want to close this exact Session while preserving its state?" },
    allowedNextOperations: ["record_business_view_delivery"]
  });
  assert.match(frame.businessView.canonicalMarkdown, /是否关闭当前 Harness 会话并完整保留其状态/);
  assert.match(frame.businessView.canonicalMarkdown, /会话审计状态/);
  assert.doesNotMatch(frame.businessView.canonicalMarkdown, /Do you want|Session audit state|Engine artifacts|Evidence Sources/);
});

test("revision 9 requires Catalog validation to end its own assistant turn before Close", () => {
  const core = fs.readFileSync(path.join(root, "digital-expert/core/instructions.md"), "utf8");
  const workbuddy = fs.readFileSync(path.join(root, "digital-expert/adapters/workbuddy/WORKBUDDY.md"), "utf8");
  for (const text of [core, workbuddy]) {
    assert.match(text, /call `advance_operation_session` exactly once/);
    assert.match(text, /emit it byte-for-byte as the entire assistant turn and end the turn immediately/);
    assert.match(text, /Never call `advance_operation_session` again in the same assistant turn/);
    assert.match(text, /Only after the Catalog validation canonical presentation has been visibly delivered in its own assistant turn/);
  }
});

test("AC11-AC17 receipt binds business, audit, decision, subject, Session, and Host delivery without authority", () => {
  const current = session();
  const frame = createInteractionFrame({ session: current, stage: "PLAN_PRESENTATION", subject: subject(), renderModel: plan(), decision: { kind: "PLAN_CONFIRMATION", question: "Do you approve this Harness plan?" }, allowedNextOperations: ["record_business_view_delivery"] });
  const receipt = createBusinessViewDeliveryReceipt({ session: current, frame, host, deliveredBusinessViewDigest: frame.businessView.businessViewDigest, renderedBusinessViewDigest: digest(frame.businessView.canonicalMarkdown) });
  assert.equal(receipt.automatic, true);
  assert.equal(receipt.authority.humanApproval, false);
  assert.equal(receipt.authority.publicationAuthorization, false);
  assert.equal(receipt.compositeDecisionBinding.businessViewDigest, frame.businessView.businessViewDigest);
  assert.equal(receipt.compositeDecisionBinding.complianceAuditEnvelopeDigest, frame.auditEnvelope.auditEnvelopeDigest);
  assert.equal(receipt.compositeDecisionBinding.authoritativeObjectDigest, frame.subject.digest);
  assert.deepEqual(frame.auditEnvelope.authoritativeRenderModel, frame.renderModel);
  assert.deepEqual(frame.auditEnvelope.requiredFields, frame.requiredFields);
  assert.equal(frame.auditEnvelope.decisionDefinition.decisionDefinitionDigest, frame.decisionDefinition.decisionDefinitionDigest);
  assert.equal(frame.auditEnvelope.sourceReasoningMapDigest, frame.sourceReasoningMap.reasoningMapDigest);
});

test("AC13-AC15 Source reasoning traces every outcome, alternative, and non-adoption reason", () => {
  const outcomes = ["REUSE", "EVOLVE", "COMPOSE", "CREATE", "REJECT", "NEED_MORE_EVIDENCE"];
  const renderModel = {
    ...plan(),
    sources: {
      attachments: outcomes.map((outcome, index) => ({
        id: `source-${index + 1}`,
        ref: `evidence-${index + 1}.md`,
        digest: digest(`source-${index + 1}`),
        evidenceIds: [`evidence-${index + 1}`],
        observedFacts: [`fact-${index + 1}`],
        outcome,
        harnessCapability: `capability-${index + 1}`,
        rationale: `Evidence supports ${outcome}`,
        alternatives: ["PRESERVE_FOR_LATER"],
        uncertainty: "BOUNDED",
        nonAdoptionReason: ["REJECT", "NEED_MORE_EVIDENCE"].includes(outcome) ? `${outcome} is evidence-bound` : null,
        catalogRelationship: "NEW_OR_EXISTING_AS_DECLARED"
      }))
    }
  };
  const projection = createBusinessInteractionProjection({ session: session(), stage: "PLAN_PRESENTATION", subject: subject(), renderModel, decision: { kind: "PLAN_CONFIRMATION", question: "Approve?" }, requiredFields: ["goal", "sources", "operations", "stopPoints", "authority", "planDigest"], allowedNextOperations: ["record_business_view_delivery"], forbiddenOperations: [] });
  assert.deepEqual(projection.sourceReasoningMap.entries.map((item) => item.harnessOutcome), outcomes);
  for (const entry of projection.sourceReasoningMap.entries) {
    assert.match(entry.sourceDigest, /^sha256:[a-f0-9]{64}$/);
    assert.ok(entry.evidenceIds.length > 0);
    assert.ok(entry.observedFacts.length > 0);
    assert.ok(entry.rationale.length > 0);
    assert.ok(entry.alternatives.length > 0);
    if (["REJECT", "NEED_MORE_EVIDENCE"].includes(entry.harnessOutcome)) assert.ok(entry.nonAdoptionReason);
  }
});

test("AC10 generic continuation is not a declared business decision", () => {
  const frame = createInteractionFrame({ session: session(), stage: "PUBLICATION_PRESENTATION", subject: { type: "PROPOSAL", id: "proposal-1", digest: digest("proposal"), bindings: {} }, renderModel: { proposalId: "proposal-1", approvedProposalDigest: digest("proposal"), assets: ["code-generation"], catalog: "organization", impact: "Publishes an immutable Harness", nonPublicationOutcome: "Preserves review state", authority: { publicationSeparate: true } }, decision: { kind: "PUBLICATION", question: "Publish this approved Harness proposal?" }, allowedNextOperations: ["record_business_view_delivery"] });
  assert.equal(frame.decisionDefinition.options.includes("CONTINUE"), false);
  assert.equal(frame.decisionDefinition.genericContinuationAuthorizesDecision, false);
});

test("real-shaped Proposal Review produces a compact Engine-owned Chinese business view and keeps technical objects in the audit envelope", () => {
  const current = session("workbuddy");
  current.intent = { goal: "将《代码生成提示词整理.docx》作为只读 Harness Evidence Source，生成或进化可复用的 Harness" };
  const proposal = {
    schema: "evopilot-harness-profile-proposal/v1",
    proposalId: "proposal-real-shape",
    decision: "EVOLVE_EXISTING",
    proposedAssets: [{
      kind: "HarnessProfile",
      metadata: { id: "api-gateway-profile", version: "0.1.1", description: "Adds evidence-backed language-service coverage." },
      spec: { boundary: { inScope: ["language-service"], outOfScope: ["http-client"] }, match: { positiveConcepts: ["language-service"] }, acceptance: { requiredEvidence: ["validation-result"] } }
    }],
    evaluationPack: { spec: { status: "INSUFFICIENT_EVAL_EVIDENCE", cases: [{ polarity: "positive", reviewStatus: "unreviewed" }, { polarity: "negative", reviewStatus: "unreviewed" }] } },
    intentionallyLargeTechnicalObject: "x".repeat(100_000)
  };
  const review = {
    verdict: "READY_FOR_HUMAN_APPROVAL",
    summary: "The proposal is evidence-backed.",
    findings: [{ severity: "info", dimension: "boundary", conclusion: "Boundary is supported.", reasons: ["Cited Source evidence"] }],
    deterministicGates: [{ id: "safety", status: "PASS", blocking: true }],
    remainingBlockers: ["evaluation-review-required"]
  };
  const frame = createInteractionFrame({
    session: current,
    stage: "PROPOSAL_REVIEW_PRESENTATION",
    subject: { type: "PROPOSAL_REVIEW", id: proposal.proposalId, digest: digest("review"), bindings: {} },
    renderModel: {
      proposal,
      proposalDigest: digest("proposal"),
      review,
      reviewDigest: digest("review"),
      sources: { attachments: ["/Users/example/Desktop/代码生成提示词整理.docx"] },
      evaluation: proposal.evaluationPack,
      comparisonAssessment: { status: "NOT_PROVIDED" },
      authority: { engineAuthoritative: true, presentationIsApproval: false },
      nextAction: "request-explicit-proposal-business-decision"
    },
    decision: { kind: "PROPOSAL_REVIEW_COMPLETION", question: "Have you completed review?" },
    allowedNextOperations: ["record_business_view_delivery"]
  });
  assert.match(frame.businessView.canonicalMarkdown, /审阅 Harness 演进方案与 Source 依据/);
  assert.match(frame.businessView.canonicalMarkdown, /进化现有 Harness/);
  assert.match(frame.businessView.canonicalMarkdown, /代码生成提示词整理\.docx/);
  assert.match(frame.businessView.canonicalMarkdown, /评估用例未完成人工审阅/);
  assert.match(frame.businessView.canonicalMarkdown, /专业审查已完成，可进入人工审阅/);
  assert.doesNotMatch(frame.businessView.canonicalMarkdown, /READY_FOR_HUMAN_APPROVAL|The proposal is evidence-backed|Boundary is supported|Cited Source evidence/);
  assert.doesNotMatch(frame.businessView.canonicalMarkdown, /intentionallyLargeTechnicalObject/);
  assert.doesNotMatch(frame.businessView.canonicalMarkdown, /x{100}/);
  assert.ok(frame.businessView.canonicalMarkdown.length < 12_000);
  assert.equal(frame.auditEnvelope.authoritativeRenderModel.proposal.intentionallyLargeTechnicalObject.length, 100_000);
  assert.equal(frame.businessView.authority.soleVisibleBusinessContent, true);
  assert.equal(frame.businessView.authority.hostMayAddProse, false);
});

test("Chinese blocker presentation localizes reviewer prose while retaining the authoritative detail only in the audit envelope", () => {
  const reviewerSummary = "The Proposal misclassifies Java DDD code-generation evidence as an API gateway product boundary.";
  const current = session("workbuddy");
  current.interaction.host.locale = "zh-CN";
  const projection = createBusinessInteractionProjection({
    session: current,
    stage: "BLOCKER_PRESENTATION",
    subject: { type: "PROPOSAL_REVIEW", id: "proposal-blocked", digest: digest("proposal-blocked"), bindings: {} },
    renderModel: {
      status: "BLOCKED",
      blockers: ["semantic-proposal-review-required"],
      reasons: [reviewerSummary],
      nextAction: "revise-proposal"
    },
    decision: { kind: "BLOCKER_REMEDIATION", question: "如何处理当前安全停止？" },
    requiredFields: ["status", "blockers", "reasons", "nextAction"],
    allowedNextOperations: ["record_business_view_delivery"],
    forbiddenOperations: ["approve_session_proposal", "publish_session_proposal"]
  });

  assert.match(projection.businessView.canonicalMarkdown, /领域、角色或能力边界与 Source 证据不一致/);
  assert.match(projection.businessView.canonicalMarkdown, /审阅并修订 Harness 演进方案/);
  assert.doesNotMatch(projection.businessView.canonicalMarkdown, /The Proposal misclassifies|API gateway product boundary/);
  assert.equal(projection.auditEnvelope.authoritativeRenderModel.reasons[0], reviewerSummary);
});

test("generated adapters require canonical Business View to be the only visible business prose", () => {
  const core = fs.readFileSync(path.join(root, "digital-expert/core/instructions.md"), "utf8");
  assert.match(core, /sole visible prose/);
  assert.match(core, /Never add a preface, conclusion, translation, explanation, summary/);
  assert.match(core, /HOST_INTERACTION_COMPLIANCE_UNAVAILABLE/);
});

test("WorkBuddy expert main instruction fails closed before host attachment processing", () => {
  const agent = fs.readFileSync(path.join(root, "digital-expert/installers/workbuddy/expert/agents/evopilot-harness-digital-expert.md"), "utf8");
  assert.match(agent, /封闭执行模式（最高优先级）/);
  assert.match(agent, /不得向用户显示“深度思考”/);
  assert.match(agent, /不得再次读取、搜索或解释 Skill\/Agent 文件/);
  assert.match(agent, /不得调用 WorkBuddy 记忆、概览\/报告生成、Skill 管理/);
  assert.match(agent, /Engine 终态返回后立即结束/);
  assert.match(agent, /第一个产品动作必须是.*inspect_capabilities/);
  assert.match(agent, /不得读取、解压、解析、搜索、OCR、概括、分类或推理任何附件/);
  assert.match(agent, /HARNESS_MCP_SESSION_UNAVAILABLE/);
  assert.match(agent, /HOST_INTERACTION_COMPLIANCE_UNAVAILABLE/);
  assert.match(agent, /不得降级生成通用分析报告/);
});
