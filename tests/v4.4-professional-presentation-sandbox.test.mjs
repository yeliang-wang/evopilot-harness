import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import Ajv2020 from "ajv/dist/2020.js";
import { initializeWorkspace } from "../src/v3/workspace.mjs";
import { digest } from "../src/v3/utils.mjs";
import { createBusinessInteractionProjection } from "../src/v4/interaction/business-projection.mjs";
import { createBusinessViewDeliveryReceipt, createInteractionFrame } from "../src/v4/interaction/controller.mjs";
import {
  PROFESSIONAL_OUTCOMES,
  REQUIRED_GOVERNED_HOST_CAPABILITIES,
  createAgentHostBoundaryContract,
  createHostConformanceProfile,
  createSourceOutcomeExplanation,
  inspectEvolutionContextBinding
} from "../src/v4/interaction/professional-reasoning.mjs";
import { createAgentSession, createSessionPlan, inspectAgentSession, reevaluateAgentSession } from "../src/v4/session/store.mjs";

const root = path.resolve(import.meta.dirname, "..");
const fixedNow = "2026-08-24T08:00:00.000Z";

function temporary(label) { return fs.mkdtempSync(path.join(os.tmpdir(), `evopilot-v44-r8-${label}-`)); }
function governedHost(id = "workbuddy", version = "5.3.14") {
  return { id, version, level: "GOVERNED_HUMAN_GATE_COMPATIBLE", capabilities: [...REQUIRED_GOVERNED_HOST_CAPABILITIES] };
}
function governedSessionFixture() {
  const home = temporary("workspace");
  const source = path.join(temporary("source"), "代码生成提示词整理.docx");
  fs.writeFileSync(source, "static prompt evidence\n", "utf8");
  initializeWorkspace(home);
  const created = createAgentSession({ home, intent: "分析《代码生成提示词整理.docx》，专业判断可沉淀的 Harness 能力及演进方案", adapterId: "workbuddy", hostInteraction: governedHost(), now: fixedNow });
  const planned = createSessionPlan({ home, sessionId: created.sessionId, expectedSessionDigest: created.sessionDigest, goal: created.intent.text, sources: { attachments: [source], advisor: "off" }, now: fixedNow });
  return { home, source, planned };
}

test("AC57-AC58 and AC68-AC70 schemas validate the Engine-owned professional sandbox objects", () => {
  const { planned } = governedSessionFixture();
  const frame = proposalReviewFrame(planned);
  const receipt = createBusinessViewDeliveryReceipt({
    session: planned,
    frame,
    host: planned.interaction.host,
    deliveredBusinessViewDigest: frame.businessView.businessViewDigest,
    renderedBusinessViewDigest: digest(frame.businessView.canonicalMarkdown),
    now: fixedNow
  });
  const values = [
    ["harness-professional-analysis-v1.schema.json", frame.businessView.professionalAnalysis],
    ["harness-architecture-assessment-v1.schema.json", frame.businessView.architectureAssessment],
    ["source-outcome-explanation-v1.schema.json", frame.businessView.sourceOutcomeExplanation],
    ["evolution-context-binding-v1.schema.json", frame.businessView.evolutionContext],
    ["agent-host-boundary-contract-v1.schema.json", frame.businessView.hostBoundaryContract],
    ["host-conformance-profile-v1.schema.json", planned.interaction.host.conformanceProfile],
    ["canonical-presentation-delivery-receipt-v1.schema.json", receipt],
    ["business-decision-view-v1.schema.json", frame.businessView],
    ["compliance-audit-envelope-v1.schema.json", frame.auditEnvelope]
  ];
  for (const [file, value] of values) {
    const validate = new Ajv2020({ allErrors: true, strict: false }).compile(JSON.parse(fs.readFileSync(path.join(root, "schemas", file), "utf8")));
    assert.equal(validate(value), true, `${file}: ${JSON.stringify(validate.errors)}`);
  }
  assert.equal(receipt.wholeTurnDelivered, true);
  assert.equal(receipt.hostAuthoredGovernedProseCount, 0);
  assert.equal(receipt.locale, "zh-CN");
});

test("AC59 and RC09-RC12 cover every positive, unsuitable, insufficient, no-change, and rejected Source outcome", () => {
  for (const outcome of PROFESSIONAL_OUTCOMES) {
    const explanation = createSourceOutcomeExplanation({
      stage: "PROPOSAL_REVIEW_PRESENTATION",
      authoritative: { decision: outcome, reasons: [`reason:${outcome}`], missingEvidence: outcome === "NEED_MORE_EVIDENCE" ? ["bounded-input-output-contract"] : [] },
      reasoningMap: { entries: [] }
    });
    assert.equal(explanation.outcome, outcome);
    assert.equal(explanation.proposalAllowed, ["REUSE_EXISTING", "EVOLVE_EXISTING", "COMPOSE_NEW_BUNDLE", "PROPOSE_NEW_PROFILE"].includes(outcome));
    assert.ok(explanation.reasons.length > 0);
    if (!explanation.proposalAllowed) assert.equal(explanation.suitableForHarnessEvolution, false);
  }
});

test("AC60-AC64 professional reasoning is Engine-owned, advisory-only, traceable, and domain-neutral", () => {
  const { planned } = governedSessionFixture();
  const frame = proposalReviewFrame(planned, { assetId: "observability-runbook-profile", sourceRef: "生产运维手册.pdf" });
  const analysis = frame.businessView.professionalAnalysis;
  assert.equal(analysis.authority.engineDerived, true);
  assert.equal(analysis.authority.advisorAdvisoryOnly, true);
  assert.equal(analysis.authority.hostAuthored, false);
  assert.equal(analysis.authority.sourceExecution, false);
  assert.ok(analysis.extractionAlgorithm.length >= 8);
  assert.match(frame.businessView.canonicalMarkdown, /observability-runbook-profile/);
  assert.match(frame.businessView.canonicalMarkdown, /生产运维手册\.pdf/);
  assert.doesNotMatch(JSON.stringify(analysis), /api-gateway|Java DDD|代码生成提示词/);
});

test("AC65-AC69 fixed templates preserve concise information architecture and one bound locale", () => {
  const { planned } = governedSessionFixture();
  const frame = proposalReviewFrame(planned);
  const view = frame.businessView;
  assert.equal(view.template.schema, "evopilot-harness-business-presentation/v2");
  assert.equal(view.template.locale, "zh-CN");
  assert.deepEqual(view.template.sectionOrder, ["professional-conclusion", "harness-evolution", "source-basis-and-method", "architecture-assessment", "evaluation-and-limits", "review-risk", "decision-boundary"]);
  assert.deepEqual(view.informationArchitecture, { primary: "business", secondary: "professional-detail", audit: "compliance-audit-envelope" });
  assert.match(view.canonicalMarkdown, /专业分析结论/);
  assert.match(view.canonicalMarkdown, /Harness 演进方案/);
  assert.match(view.canonicalMarkdown, /为什么这样提取/);
  assert.match(view.canonicalMarkdown, /架构定位与影响/);
  assert.match(view.canonicalMarkdown, /证据可信度、评估与限制/);
  assert.doesNotMatch(view.canonicalMarkdown, /Stage \d|Review the Harness proposal|Your decision|Risk level/);
  assert.ok(view.canonicalMarkdown.length < 16_000);
});

test("AC70-AC74 Evolution Context is immutable and Source or policy mutation forces explicit re-evaluation", () => {
  const { home, source, planned } = governedSessionFixture();
  assert.equal(inspectEvolutionContextBinding({ session: planned }).status, "UNCHANGED");
  fs.appendFileSync(source, "changed evidence\n", "utf8");
  const sourceDrift = inspectEvolutionContextBinding({ session: planned });
  assert.equal(sourceDrift.status, "REEVALUATION_REQUIRED");
  assert.ok(sourceDrift.changedFields.includes("sourceSnapshotDigest"));
  assert.throws(() => proposalReviewFrame(planned), (error) => error.code === "EVOLUTION_CONTEXT_CHANGED_REEVALUATION_REQUIRED");

  const reevaluated = reevaluateAgentSession({ home, sessionId: planned.sessionId, expectedSessionDigest: planned.sessionDigest, adapterId: "workbuddy", now: "2026-08-24T08:01:00.000Z" });
  assert.equal(reevaluated.status, "PLAN_REVIEW_REQUIRED");
  assert.equal(reevaluated.prior.preserved, true);
  assert.notEqual(reevaluated.current.sessionId, planned.sessionId);
  assert.notEqual(reevaluated.current.evolutionContextDigest, planned.evolutionContext.evolutionContextDigest);
  assert.ok(reevaluated.changedFields.includes("sourceSnapshotDigest"));
  assert.equal(reevaluated.authority.planConfirmed, false);
  assert.equal(reevaluated.authority.priorSessionMutated, false);
  assert.equal(inspectAgentSession(home, planned.sessionId).sessionDigest, planned.sessionDigest);
  assert.equal(inspectAgentSession(home, reevaluated.current.sessionId).reevaluation.priorSessionId, planned.sessionId);

  const fresh = governedSessionFixture();
  const policyDir = path.join(fresh.home, "policies", "matcher");
  fs.mkdirSync(policyDir, { recursive: true });
  fs.writeFileSync(path.join(policyDir, "candidate.json"), "{}\n", "utf8");
  const policyDrift = inspectEvolutionContextBinding({ session: fresh.planned });
  assert.equal(policyDrift.status, "REEVALUATION_REQUIRED");
  assert.ok(policyDrift.changedFields.includes("matchPolicyBinding"));

  const mutations = [
    ["catalogBinding", ({ home: targetHome }) => { fs.mkdirSync(path.join(targetHome, "catalogs", "organization"), { recursive: true }); fs.writeFileSync(path.join(targetHome, "catalogs", "organization", "CATALOG.yaml"), "assets: []\n"); }, {}],
    ["ontologyBinding", ({ home: targetHome }) => { fs.mkdirSync(path.join(targetHome, "ontology"), { recursive: true }); fs.writeFileSync(path.join(targetHome, "ontology", "custom.yaml"), "terms: []\n"); }, {}],
    ["advisorPolicyBinding", ({ home: targetHome }) => { fs.mkdirSync(path.join(targetHome, "policies", "advisor"), { recursive: true }); fs.writeFileSync(path.join(targetHome, "policies", "advisor", "custom.yaml"), "mode: advisory\n"); }, {}],
    ["advisorProfile", () => {}, { plan: (session) => ({ ...session.plan, sources: { ...session.plan.sources, advisor: "required", model: "reviewed-profile" } }) }],
    ["operationIntentDigest", () => {}, { session: (session) => ({ ...session, intent: { text: "changed intent", digest: digest("changed intent") } }) }],
    ["locale", () => {}, { locale: "en" }],
    ["presentationTemplateVersion", () => {}, { templateVersion: "evopilot-harness-business-presentation/v3" }]
  ];
  for (const [field, mutate, options] of mutations) {
    const fixture = governedSessionFixture();
    mutate(fixture);
    const candidateSession = options.session ? options.session(fixture.planned) : fixture.planned;
    const candidatePlan = options.plan ? options.plan(candidateSession) : candidateSession.plan;
    const inspection = inspectEvolutionContextBinding({ session: candidateSession, plan: candidatePlan, locale: options.locale, templateVersion: options.templateVersion });
    assert.equal(inspection.status, "REEVALUATION_REQUIRED", field);
    assert.ok(inspection.changedFields.includes(field), `${field}: ${inspection.changedFields.join(",")}`);
  }
});

test("revision 9 canonical renderer is stable across three equivalent governed inputs", () => {
  const { planned } = governedSessionFixture();
  const baseline = lifecycleCanonicalMarkdown(planned);
  const replays = Array.from({ length: 3 }, () => lifecycleCanonicalMarkdown(planned));
  assert.equal(new Set([baseline, ...replays]).size, 1);
  assert.equal(new Set(replays.map((item) => digest(item))).size, 1);
});

test("AC75-AC85 enforce the third-party Host boundary and preserve byte identity across WorkBuddy and an independent Host", () => {
  const boundary = createAgentHostBoundaryContract();
  assert.ok(boundary.hostForbidden.includes("harness-reasoning"));
  assert.ok(boundary.hostForbidden.includes("translation"));
  assert.ok(boundary.hostForbidden.includes("summarization"));
  assert.ok(boundary.hostForbidden.includes("visible-chain-of-thought"));
  assert.ok(boundary.hostForbidden.includes("host-memory-mutation"));
  assert.ok(boundary.hostForbidden.includes("host-overview-generation"));
  assert.ok(boundary.hostForbidden.includes("host-skill-mutation"));
  assert.ok(boundary.hostForbidden.includes("host-artifact-write"));
  assert.ok(boundary.hostForbidden.includes("post-operation-housekeeping"));
  assert.ok(boundary.engineOwns.includes("professional-reasoning"));
  assert.ok(boundary.engineOwns.includes("templates"));

  const conformant = createHostConformanceProfile(governedHost());
  assert.equal(conformant.status, "CONFORMANT");
  const weak = createHostConformanceProfile({ ...governedHost("weak-host"), capabilities: ["deterministic-rendering"] });
  assert.equal(weak.status, "NONCONFORMANT");
  assert.ok(weak.missingCapabilities.includes("host-prose-suppression"));

  const { planned } = governedSessionFixture();
  const workbuddy = proposalReviewFrame(planned);
  const independent = proposalReviewFrame({ ...planned, interaction: { ...planned.interaction, host: governedHost("independent-host", "1.0.0") } });
  assert.equal(workbuddy.businessView.canonicalMarkdown, independent.businessView.canonicalMarkdown);
  assert.equal(workbuddy.businessView.businessViewDigest, independent.businessView.businessViewDigest);
  assert.throws(() => createBusinessViewDeliveryReceipt({
    session: planned,
    frame: workbuddy,
    host: { ...governedHost("hostile-host"), capabilities: REQUIRED_GOVERNED_HOST_CAPABILITIES.filter((item) => item !== "host-prose-suppression") },
    deliveredBusinessViewDigest: workbuddy.businessView.businessViewDigest,
    renderedBusinessViewDigest: digest(workbuddy.businessView.canonicalMarkdown)
  }), (error) => error.code === "HOST_INTERACTION_COMPLIANCE_UNAVAILABLE" && error.missingCapabilities.includes("host-prose-suppression"));
});

function proposalReviewFrame(session, { assetId = "java-ddd-code-generation-profile", sourceRef = "代码生成提示词整理.docx" } = {}) {
  const proposalId = `proposal-${assetId}`;
  const sourceDigest = digest(sourceRef);
  return createInteractionFrame({
    session,
    stage: "PROPOSAL_REVIEW_PRESENTATION",
    subject: { type: "PROPOSAL_REVIEW", id: proposalId, digest: digest(`review:${proposalId}`), bindings: { proposalDigest: digest(`proposal:${proposalId}`) } },
    renderModel: {
      proposal: {
        proposalId,
        decision: "PROPOSE_NEW_PROFILE",
        sources: [{ id: "source-1", ref: sourceRef, digest: sourceDigest, evidenceIds: ["evidence-1"], observedFacts: ["描述了可重复活动、输入输出契约、边界、规则和验证方法"], rationale: "Source 具有可复用、可验证且边界明确的工程能力。", catalogRelationship: "NO_EQUIVALENT_ASSET" }],
        proposedAssets: [{ kind: "HarnessProfile", metadata: { id: assetId, version: "0.1.0", description: "Evidence-bound reusable Harness capability" }, spec: { boundary: { inScope: ["repeatable-engineering-work"], outOfScope: ["source-command-execution"] }, dependencies: [], acceptance: { requiredEvidence: ["positive-case", "negative-case"] } } }],
        evaluationPack: { spec: { status: "READY_FOR_REVIEW", cases: [{ polarity: "positive", reviewStatus: "reviewed" }, { polarity: "negative", reviewStatus: "reviewed" }] } }
      },
      proposalDigest: digest(`proposal:${proposalId}`),
      review: { verdict: "READY_FOR_HUMAN_APPROVAL", summary: "证据、边界与评估覆盖支持该演进方案。", findings: [], deterministicGates: [{ id: "safety", status: "PASS", blocking: true }], remainingBlockers: [] },
      reviewDigest: digest(`review:${proposalId}`),
      sources: { attachments: [sourceRef] },
      evaluation: { status: "READY_FOR_REVIEW" },
      comparisonAssessment: { status: "NO_EQUIVALENT_ASSET" },
      authority: { engineAuthoritative: true, advisorAdvisoryOnly: true },
      nextAction: "request-explicit-proposal-business-decision"
    },
    decision: { kind: "PROPOSAL_REVIEW_COMPLETION", question: "是否已完成这份 Harness 演进方案的专业审阅？" },
    allowedNextOperations: ["record_business_view_delivery"],
    now: fixedNow,
    frameId: `frame-${assetId}`
  });
}

function lifecycleCanonicalMarkdown(session) {
  const proposal = proposalReviewFrame(session).businessView.canonicalMarkdown;
  const stages = [
    {
      stage: "PLAN_PRESENTATION",
      model: { ...session.plan, planDigest: session.planDigest },
      subject: { type: "OPERATION_PLAN", id: session.sessionId, digest: session.planDigest, bindings: {} },
      decision: { kind: "PLAN_CONFIRMATION", question: "是否批准该计划？" }
    },
    {
      stage: "PUBLICATION_PRESENTATION",
      model: { proposalId: "proposal-java-ddd", approvedProposalDigest: digest("approved"), assets: ["java-ddd-profile@0.1.0"], catalog: "organization", impact: "发布不可变 Harness 资产", nonPublicationOutcome: "保留审阅状态", authority: { publicationSeparate: true } },
      subject: { type: "PUBLICATION", id: "proposal-java-ddd", digest: digest("approved"), bindings: {} },
      decision: { kind: "PUBLICATION", question: "是否发布？" }
    },
    {
      stage: "CATALOG_VALIDATION_PRESENTATION",
      model: { proposalId: "proposal-java-ddd", publication: { status: "PUBLISHED" }, catalogStatus: "VALIDATED", catalogDigest: digest("catalog"), nextAction: "close-session" },
      subject: { type: "CATALOG_VALIDATION", id: "proposal-java-ddd", digest: digest("catalog"), bindings: {} },
      decision: null
    },
    {
      stage: "CLOSE_PRESENTATION",
      model: { sessionId: session.sessionId, sessionDigest: session.sessionDigest, status: "COMPLETED", preserved: ["assets", "audit"], question: "是否关闭？" },
      subject: { type: "SESSION", id: session.sessionId, digest: session.sessionDigest, bindings: {} },
      decision: { kind: "CLOSE", question: "是否关闭？" }
    }
  ];
  const views = stages.map(({ stage, model, subject, decision }) => createBusinessInteractionProjection({ session, stage, subject, renderModel: model, decision, requiredFields: Object.keys(model), allowedNextOperations: [], forbiddenOperations: [] }).businessView.canonicalMarkdown);
  return [views[0], proposal, ...views.slice(1)].join("\n\n---\n\n");
}
