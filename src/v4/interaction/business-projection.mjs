import { digest, persistedJson, safeId } from "../../v3/utils.mjs";
import {
  CANONICAL_PRESENTATION_DELIVERY_RECEIPT_SCHEMA,
  createAgentHostBoundaryContract,
  createProfessionalReasoning,
  deriveBoundLocale
} from "./professional-reasoning.mjs";

export const BUSINESS_DECISION_VIEW_SCHEMA = "evopilot-harness-business-decision-view/v1";
export const COMPLIANCE_AUDIT_ENVELOPE_SCHEMA = "evopilot-harness-compliance-audit-envelope/v1";
export const SOURCE_REASONING_MAP_SCHEMA = "evopilot-harness-source-to-harness-reasoning-map/v1";
export const DECISION_DEFINITION_SCHEMA = "evopilot-harness-decision-definition/v1";
export const BUSINESS_PRESENTATION_TEMPLATE_VERSION = "evopilot-harness-business-presentation/v2";
export { CANONICAL_PRESENTATION_DELIVERY_RECEIPT_SCHEMA };

export const BUSINESS_PRESENTATION_TEMPLATES = Object.freeze({
  PLAN_PRESENTATION: "operation-plan",
  OPERATION_AUTHORIZATION_PRESENTATION: "operation-authorization",
  EVIDENCE_REPORT_PRESENTATION: "evidence-result",
  PROPOSAL_REVIEW_PRESENTATION: "proposal-review",
  PROPOSAL_APPROVAL_DECISION: "proposal-decision",
  PUBLICATION_PRESENTATION: "publication-decision",
  RECOVERY_PRESENTATION: "recovery",
  BLOCKED_RETRY_PRESENTATION: "blocked-retry",
  CANCELLATION_PRESENTATION: "cancellation",
  CLOSE_PRESENTATION: "session-close",
  CLEANUP_PRESENTATION: "session-cleanup",
  BLOCKER_PRESENTATION: "business-blocker"
});

const STAGE_ORDER = ["PLAN_PRESENTATION", "OPERATION_AUTHORIZATION_PRESENTATION", "EVIDENCE_REPORT_PRESENTATION", "PROPOSAL_REVIEW_PRESENTATION", "PROPOSAL_APPROVAL_DECISION", "PUBLICATION_PRESENTATION", "CATALOG_VALIDATION_PRESENTATION", "CLOSE_PRESENTATION", "CLEANUP_PRESENTATION"];

const NATURAL_OPTIONS_ZH = {
  APPROVE: "批准", REQUEST_REVISION: "要求修改", REJECT: "驳回", PRESERVE_FOR_LATER: "保留待办",
  AUTHORIZE: "授权执行", PUBLISH: "发布", DO_NOT_PUBLISH: "暂不发布", ACCEPT_RECEIPT: "接受已有结果",
  RETRY_IF_UNCHANGED: "在工作区未变化时重试", CANCEL: "取消", CLOSE: "关闭会话", CLEANUP: "清理会话元数据",
  ACKNOWLEDGE_REVIEW: "确认已审阅", REQUEST_MORE_EVIDENCE: "补充证据", CONTINUE_TO_PROPOSAL_DECISION: "进入提案决策",
  REVIEW_REMEDIATION: "查看修复方案"
};

const DECISIONS = {
  PLAN_PRESENTATION: ["APPROVE", "REQUEST_REVISION", "REJECT", "PRESERVE_FOR_LATER"],
  OPERATION_AUTHORIZATION_PRESENTATION: ["AUTHORIZE", "REJECT", "PRESERVE_FOR_LATER"],
  PROPOSAL_APPROVAL_DECISION: ["APPROVE", "REQUEST_REVISION", "REJECT", "PRESERVE_FOR_LATER"],
  PUBLICATION_PRESENTATION: ["PUBLISH", "DO_NOT_PUBLISH", "PRESERVE_FOR_LATER"],
  RECOVERY_PRESENTATION: ["ACCEPT_RECEIPT", "RETRY_IF_UNCHANGED", "CANCEL", "PRESERVE_FOR_LATER"],
  BLOCKED_RETRY_PRESENTATION: ["RETRY_IF_UNCHANGED", "CANCEL", "PRESERVE_FOR_LATER"],
  CANCELLATION_PRESENTATION: ["CANCEL", "PRESERVE_FOR_LATER"],
  CLOSE_PRESENTATION: ["CLOSE", "PRESERVE_FOR_LATER"],
  CLEANUP_PRESENTATION: ["CLEANUP", "PRESERVE_FOR_LATER"],
  EVIDENCE_REPORT_PRESENTATION: ["ACKNOWLEDGE_REVIEW", "REQUEST_MORE_EVIDENCE", "PRESERVE_FOR_LATER"],
  PROPOSAL_REVIEW_PRESENTATION: ["CONTINUE_TO_PROPOSAL_DECISION", "REQUEST_REVISION", "PRESERVE_FOR_LATER"],
  BLOCKER_PRESENTATION: ["REVIEW_REMEDIATION", "CANCEL", "PRESERVE_FOR_LATER"]
};

const TITLES = {
  PLAN_PRESENTATION: "Review the Harness operation plan",
  OPERATION_AUTHORIZATION_PRESENTATION: "Review the governed operation impact",
  EVIDENCE_REPORT_PRESENTATION: "Review the Harness evidence result",
  PROPOSAL_REVIEW_PRESENTATION: "Review the Harness proposal and its evidence",
  PROPOSAL_APPROVAL_DECISION: "Decide whether to approve the Harness proposal",
  PUBLICATION_PRESENTATION: "Decide whether to publish the approved Harness proposal",
  RECOVERY_PRESENTATION: "Resolve the interrupted Harness operation",
  BLOCKED_RETRY_PRESENTATION: "Decide whether to retry the blocked Harness operation",
  CANCELLATION_PRESENTATION: "Decide whether to cancel this Harness session",
  CLOSE_PRESENTATION: "Decide whether to close this Harness session",
  CLEANUP_PRESENTATION: "Decide whether to remove owned session metadata",
  BLOCKER_PRESENTATION: "Review why the Harness process stopped",
  CATALOG_VALIDATION_PRESENTATION: "Review the published Harness Catalog result",
  EXECUTION_BRIEF: "Review the Harness execution brief"
};

const TITLES_ZH = {
  PLAN_PRESENTATION: "审阅 Harness 操作计划",
  OPERATION_AUTHORIZATION_PRESENTATION: "审阅受控 Harness 操作影响",
  EVIDENCE_REPORT_PRESENTATION: "审阅 Harness 证据分析结果",
  PROPOSAL_REVIEW_PRESENTATION: "审阅 Harness 演进方案与 Source 依据",
  PROPOSAL_APPROVAL_DECISION: "决定是否批准 Harness Proposal",
  PUBLICATION_PRESENTATION: "决定是否发布已批准的 Harness Proposal",
  RECOVERY_PRESENTATION: "处理被中断的 Harness 操作",
  BLOCKED_RETRY_PRESENTATION: "决定是否重试被阻塞的 Harness 操作",
  CANCELLATION_PRESENTATION: "决定是否取消当前 Harness 会话",
  CLOSE_PRESENTATION: "决定是否关闭当前 Harness 会话",
  CLEANUP_PRESENTATION: "决定是否清理会话元数据",
  BLOCKER_PRESENTATION: "查看 Harness 流程安全停止原因",
  CATALOG_VALIDATION_PRESENTATION: "审阅 Harness Catalog 验证结果",
  EXECUTION_BRIEF: "审阅 Harness 执行摘要"
};

export function createBusinessInteractionProjection({ session, stage, subject, renderModel, decision, requiredFields, allowedNextOperations, forbiddenOperations }) {
  const authoritative = persistedJson(renderModel ?? {});
  const locale = businessLocale(session, authoritative);
  const reasoningMap = createSourceToHarnessReasoningMap({ session, stage, subject, authoritative });
  const professional = createProfessionalReasoning({ session, stage, subject, authoritative, reasoningMap, locale, templateVersion: BUSINESS_PRESENTATION_TEMPLATE_VERSION });
  const decisionDefinition = createDecisionDefinition({ stage, decision, subject, locale });
  const sections = businessSections(stage, authoritative, reasoningMap, professional, locale);
  const decisionRelevantFields = decisionFields(stage, requiredFields, authoritative);
  const templateCore = {
    schema: BUSINESS_PRESENTATION_TEMPLATE_VERSION,
    id: BUSINESS_PRESENTATION_TEMPLATES[stage] ?? "generic-business-stage",
    version: 2,
    locale,
    sectionOrder: sections.map((item) => item.id)
  };
  templateCore.templateDigest = digest(templateCore);
  const hostBoundaryContract = createAgentHostBoundaryContract();
  const core = {
    schema: BUSINESS_DECISION_VIEW_SCHEMA,
    template: templateCore,
    informationArchitecture: { primary: "business", secondary: "professional-detail", audit: "compliance-audit-envelope" },
    stage,
    sessionId: session.sessionId,
    sessionDigest: session.sessionDigest,
    subject: persistedJson(subject),
    title: businessTitle(stage, locale),
    summary: businessSummary(stage, authoritative, locale),
    taskNavigation: taskNavigation(stage, authoritative, locale),
    risk: riskSummary(stage, locale),
    sections,
    sourceReasoningMap: reasoningMap,
    professionalAnalysis: professional.professionalAnalysis,
    architectureAssessment: professional.architectureAssessment,
    sourceOutcomeExplanation: professional.sourceOutcomeExplanation,
    evolutionContext: professional.evolutionContext,
    hostBoundaryContract,
    decisionRelevantFields,
    decision: decisionDefinition,
    allowedNextOperations: [...new Set(allowedNextOperations ?? [])],
    authority: {
      generatedBy: "evopilot-harness-deterministic-business-renderer",
      hostAuthored: false,
      hostMayRewrite: false,
      businessViewIsApproval: false,
      engineAuthoritative: true,
      soleVisibleBusinessContent: true,
      hostMayAddProse: false
    }
  };
  core.businessViewDigest = digest(core);
  core.viewId = safeId(`business-${core.businessViewDigest.slice(7, 23)}`);
  core.canonicalMarkdown = renderBusinessDecisionView(core);
  core.renderedBusinessViewDigest = digest(core.canonicalMarkdown);

  const envelopeCore = {
    schema: COMPLIANCE_AUDIT_ENVELOPE_SCHEMA,
    stage,
    sessionId: session.sessionId,
    sessionDigest: session.sessionDigest,
    subject: persistedJson(subject),
    authoritativeRenderModel: authoritative,
    requiredFields: [...requiredFields],
    decisionDefinition,
    sourceReasoningMapDigest: reasoningMap.reasoningMapDigest,
    professionalAnalysisDigest: professional.professionalAnalysis?.professionalAnalysisDigest ?? null,
    architectureAssessmentDigest: professional.architectureAssessment?.architectureAssessmentDigest ?? null,
    sourceOutcomeExplanationDigest: professional.sourceOutcomeExplanation?.outcomeExplanationDigest ?? null,
    evolutionContextDigest: professional.evolutionContext.evolutionContextDigest,
    hostBoundaryContractDigest: hostBoundaryContract.boundaryContractDigest,
    businessViewDigest: core.businessViewDigest,
    allowedNextOperations: [...new Set(allowedNextOperations ?? [])],
    forbiddenOperations: [...new Set(forbiddenOperations ?? [])],
    compatibility: persistedJson(session.compatibility),
    authority: { engineAuthoritative: true, hostMayMutate: false, auditEnvelopeIsApproval: false },
    redaction: "SECRET_FREE"
  };
  envelopeCore.auditEnvelopeDigest = digest(envelopeCore);
  envelopeCore.envelopeId = safeId(`audit-${envelopeCore.auditEnvelopeDigest.slice(7, 23)}`);
  return { businessView: core, auditEnvelope: envelopeCore, decisionDefinition, sourceReasoningMap: reasoningMap, ...professional, hostBoundaryContract };
}

export function renderBusinessDecisionView(view) {
  const chinese = view.template?.locale === "zh-CN" || view.decision?.locale === "zh-CN";
  const lines = [`# ${view.title}`, "", view.summary, "", `> ${view.taskNavigation.summary}`, "", `${chinese ? "风险级别" : "Risk level"}: **${view.risk.label}** — ${view.risk.reason}`, ""];
  for (const section of view.sections) {
    lines.push(`## ${section.title}`, "", renderBusinessContent(section.content, 0, chinese), "");
  }
  if (view.decision) {
    const transport = JSON.stringify({
      tool: "submit_business_decision",
      decisionHandle: view.decision.decisionHandle,
      choices: view.decision.options,
      rule: "Map the explicit human choice to exactly one declared choice and call this tool with decisionHandle, choice, and decidedBy only. Never call digest-bound compatibility tools or discover, infer, request, or expose session identifiers or digests."
    });
    lines.push(chinese ? "## 需要你的决定" : "## Your decision", "", `**${view.decision.question}**`, "", view.decision.businessReason ? `${chinese ? "为什么需要决定" : "Why this decision is needed"}: ${view.decision.businessReason}` : "", view.decision.effect ? `${chinese ? "批准后" : "If approved"}: ${view.decision.effect}` : "", view.decision.nonEffect ? `${chinese ? "本次决定不会" : "This decision will not"}: ${view.decision.nonEffect}` : "", `${chinese ? "可选操作" : "Available choices"}:`, ...view.decision.options.map((item) => `- **${decisionOptionLabel(item, chinese)}**`), "", `<!-- evopilot-harness-decision-transport ${transport} -->`, "");
  }
  return hostSafeCanonicalMarkdown(lines.filter((line, index, all) => line !== "" || all[index - 1] !== "").join("\n").trimEnd());
}

function hostSafeCanonicalMarkdown(markdown) {
  return markdown
    .replace(/[“”"]/g, "")
    .replace(/：\s*/g, " — ")
    .replace(/:\s+/g, " — ")
    .trimEnd();
}

export function verifyBusinessViewDelivery({ businessView, renderedBusinessViewDigest, deliveredBusinessViewDigest }) {
  const expectedRendered = digest(businessView.canonicalMarkdown);
  if (deliveredBusinessViewDigest !== businessView.businessViewDigest) throw projectionError("BUSINESS_VIEW_DIGEST_MISMATCH", "The Host did not deliver the current authoritative Business Decision View.");
  if (renderedBusinessViewDigest !== expectedRendered) throw projectionError("BUSINESS_VIEW_RENDERING_MISMATCH", "The Host-visible business rendering was omitted, rewritten, summarized, or reordered.");
  return { expectedRendered, businessViewDigest: businessView.businessViewDigest };
}

export function compositeDecisionBinding({ session, frame, receipt }) {
  const value = {
    schema: "evopilot-harness-composite-decision-binding/v1",
    sessionId: session.sessionId,
    sessionDigest: session.sessionDigest,
    authoritativeObjectDigest: frame.subject.digest,
    businessViewDigest: frame.businessView.businessViewDigest,
    complianceAuditEnvelopeDigest: frame.auditEnvelope.auditEnvelopeDigest,
    decisionDefinitionDigest: frame.decisionDefinition?.decisionDefinitionDigest ?? null,
    hostPresentationReceiptDigest: receipt.receiptDigest
  };
  value.compositeDecisionBindingDigest = digest(value);
  return value;
}

function createDecisionDefinition({ stage, decision, subject, locale }) {
  if (!decision && !DECISIONS[stage]) return null;
  const decisionId = `${stage.toLowerCase().replaceAll("_", "-")}:${subject.id}`;
  const decisionHandle = safeId(`decision-${digest({ decisionId, kind: decision?.kind ?? stage, subjectDigest: subject.digest }).slice(7, 31)}`);
  const core = {
    schema: DECISION_DEFINITION_SCHEMA,
    decisionId,
    decisionHandle,
    kind: decision?.kind ?? stage,
    question: localizedQuestion(stage, decision?.question, locale),
    options: DECISIONS[stage] ?? ["ACKNOWLEDGE_REVIEW", "PRESERVE_FOR_LATER"],
    businessReason: decisionBusinessReason(stage, locale),
    effect: decisionEffect(stage, locale),
    nonEffect: decisionNonEffect(stage, locale),
    ambiguousLanguagePolicy: "FAIL_CLOSED_REQUEST_CLARIFICATION",
    genericContinuationAuthorizesDecision: false,
    locale,
    subjectDigest: subject.digest
  };
  core.decisionDefinitionDigest = digest(core);
  return core;
}

function createSourceToHarnessReasoningMap({ session, stage, subject, authoritative }) {
  const sources = sourceEntries(authoritative);
  const proposal = authoritative.proposal ?? authoritative.report?.proposal ?? null;
  const outcome = reasoningOutcome(authoritative, proposal);
  const entries = sources.map((source, index) => ({
    sourceId: source.id ?? `source-${index + 1}`,
    sourceType: source.type ?? "evidence-source",
    sourceRef: source.ref ?? source.uri ?? source.path ?? source.name ?? `source-${index + 1}`,
    sourceDigest: validDigest(source.digest) ? source.digest : digest(source),
    evidenceIds: unique(source.evidenceIds ?? source.evidenceRefs ?? []),
    observedFacts: unique(source.observedFacts ?? source.facts ?? source.signals ?? []),
    harnessOutcome: source.outcome ?? outcome,
    harnessCapability: source.harnessCapability ?? proposal?.id ?? proposal?.proposalId ?? subject.id,
    rationale: source.rationale ?? source.reason ?? reasoningRationale(stage, authoritative),
    alternatives: unique(source.alternatives ?? candidateAlternatives(authoritative)),
    uncertainty: source.uncertainty ?? authoritative.review?.evaluationSufficiency ?? authoritative.evaluation?.status ?? "NOT_REPORTED",
    nonAdoptionReason: ["REJECT", "NEED_MORE_EVIDENCE"].includes(source.outcome ?? outcome) ? (source.nonAdoptionReason ?? businessSummary(stage, authoritative)) : null,
    catalogRelationship: source.catalogRelationship ?? catalogRelationship(authoritative)
  }));
  const core = {
    schema: SOURCE_REASONING_MAP_SCHEMA,
    sessionId: session.sessionId,
    stage,
    subject: persistedJson(subject),
    entries,
    sourceCount: entries.length,
    authority: { engineNormalized: true, llmAdvisoryOnly: true, hostAuthored: false }
  };
  core.reasoningMapDigest = digest(core);
  return core;
}

function businessSections(stage, model, reasoningMap, professional, locale) {
  const zh = locale === "zh-CN";
  if (stage === "PLAN_PRESENTATION") return compact([
    section("goal", zh ? "本次要解决的问题" : "Goal", cleanBusinessValue(model.goal)),
    section("read-only-sources", zh ? "只读素材" : "Read-only Source material", sourceBusinessSummary(model.sources, zh)),
    section("analysis-scope", zh ? "Harness 分析范围" : "Harness analysis scope", operationBusinessSummary(model.operations, zh)),
    section("expected-outcomes", zh ? "预计产出" : "Expected outcomes", expectedOutcomeSummary(model, zh)),
    section("protected-boundary", zh ? "明确不会发生" : "What will not happen", nonEffectSummary(model, zh))
  ]);
  if (stage === "PROPOSAL_REVIEW_PRESENTATION") return compact([
    section("professional-conclusion", zh ? "专业分析结论" : "Professional conclusion", sourceOutcomeBusinessSummary(professional.sourceOutcomeExplanation, zh)),
    section("harness-evolution", zh ? "Harness 演进方案" : "Harness evolution proposal", proposalBusinessChange(model.proposal, zh)),
    section("source-basis-and-method", zh ? "为什么这样提取" : "Source basis and extraction method", professionalReasoningBusinessSummary(professional.professionalAnalysis, reasoningMap, zh)),
    section("architecture-assessment", zh ? "架构定位与影响" : "Architecture position and impact", architectureBusinessSummary(professional.architectureAssessment, zh)),
    section("evaluation-and-limits", zh ? "证据可信度、评估与限制" : "Evidence confidence, evaluation, and limits", professionalEvaluationSummary(professional.professionalAnalysis, model, zh)),
    section("review-risk", zh ? "审查结论与风险" : "Review conclusion and risks", reviewBusinessSummary(model.review, zh)),
    section("decision-boundary", zh ? "本次决定的边界" : "Decision boundary", decisionBoundarySummary(model, zh))
  ]);
  if (stage === "PUBLICATION_PRESENTATION") return compact([
    section("approved-assets", zh ? "将发布的 Harness 资产" : "Approved Harness assets", cleanBusinessValue(model.assets)),
    section("destination", zh ? "发布位置与可见范围" : "Destination and visibility", publicationDestination(model, zh)),
    section("publication-impact", zh ? "影响与不受影响范围" : "Affected and unaffected scope", publicationImpact(model, zh)),
    section("rollback", zh ? "不发布与恢复方式" : "Non-publication and rollback", publicationRecovery(model, zh))
  ]);
  if (stage === "BLOCKER_PRESENTATION" || stage === "BLOCKED_RETRY_PRESENTATION") return compact([
    section("stop-reason", zh ? "为什么安全停止" : "Why the process stopped", blockerBusinessReason(model, zh)),
    section("protected-state", zh ? "当前受到保护的内容" : "Protected state", zh ? "现有工作区与已生成证据保持不变。" : "The current Workspace and produced evidence remain unchanged."),
    section("safe-next-actions", zh ? "可安全采取的下一步" : "Safe next actions", blockerNextAction(model.nextAction, zh))
  ]);
  if (stage === "EVIDENCE_REPORT_PRESENTATION") return compact([
    section("evidence-conclusion", zh ? "证据分析结论" : "Evidence conclusion", cleanBusinessValue(model.report?.recommendation ?? model.report?.summary ?? model.report)),
    section("evidence-findings", zh ? "证据与发现" : "Evidence and findings", cleanBusinessValue(model.report?.findings ?? model.report?.cases ?? model.report?.dimensions ?? model.report)),
    section("evidence-limits", zh ? "可信度与不足" : "Confidence and limits", cleanBusinessValue(model.report?.uncertainty ?? model.report?.blockers ?? model.nextAction))
  ]);
  if (stage === "PROPOSAL_APPROVAL_DECISION") return compact([
    section("proposal-subject", zh ? "待决定的 Harness Proposal" : "Harness Proposal under decision", cleanBusinessValue({ proposalId: model.proposalId, evaluationReviewed: model.evaluationReviewed })),
    section("approval-boundary", zh ? "批准边界" : "Approval boundary", zh ? "批准只改变 Proposal 状态；不会自动发布、关闭或清理。" : "Approval changes only Proposal state; it does not publish, close, or clean up.")
  ]);
  if (stage === "CATALOG_VALIDATION_PRESENTATION") return compact([
    section("catalog-result", zh ? "Catalog 验证结果" : "Catalog validation result", cleanBusinessValue({ status: model.catalogStatus, publication: model.publication })),
    section("catalog-next-action", zh ? "后续处理" : "Next action", cleanBusinessValue(model.nextAction))
  ]);
  if (stage === "CLOSE_PRESENTATION") return compact([
    section("current-state", zh ? "当前状态" : "Current state", zh ? lifecycleStateLabel(model.status, true) : cleanBusinessValue(model.status)),
    section("preserved-state", zh ? "受到保护的内容" : "Preserved state", zh ? ["会话审计状态", "Harness 资产", "Engine 产物", "Evidence Source"] : cleanBusinessValue(model.preserved)),
    section("next-action", zh ? "可选处理" : "Available action", zh ? "关闭当前会话并完整保留其状态" : cleanBusinessValue(model.question))
  ]);
  if (["RECOVERY_PRESENTATION", "CANCELLATION_PRESENTATION", "CLOSE_PRESENTATION", "CLEANUP_PRESENTATION", "OPERATION_AUTHORIZATION_PRESENTATION"].includes(stage)) return compact([
    section("current-state", zh ? "当前状态" : "Current state", cleanBusinessValue(model.status ?? model.effect ?? model.impact ?? model.risk)),
    section("preserved-state", zh ? "受到保护的内容" : "Preserved state", cleanBusinessValue(model.preserved ?? model.receipt ?? model.workspaceDigest ?? (zh ? "现有证据、资产和审计记录保持不变。" : "Existing evidence, assets, and audit records remain unchanged."))),
    section("next-action", zh ? "可选处理" : "Available action", cleanBusinessValue(model.nextAction ?? model.question))
  ]);
  return [section("current-result", zh ? "当前业务结果" : "Current business result", cleanBusinessValue(Object.fromEntries(Object.entries(model).filter(([key]) => !technicalKey(key)))) )];
}

function decisionFields(stage, requiredFields, model) {
  const manifest = {
    PLAN_PRESENTATION: ["goal", "sources", "operations", "stopPoints", "authority", "planDigest"],
    PROPOSAL_REVIEW_PRESENTATION: ["proposal", "proposalDigest", "review", "reviewDigest", "evaluation", "comparisonAssessment", "authority", "nextAction"],
    PUBLICATION_PRESENTATION: ["proposalId", "approvedProposalDigest", "assets", "catalog", "impact", "nonPublicationOutcome", "authority"],
    BLOCKER_PRESENTATION: ["status", "blockers", "reasons", "evidenceRefs", "nextAction"]
  };
  return (manifest[stage] ?? requiredFields).filter((field) => model[field] !== undefined && model[field] !== null);
}

function businessSummary(stage, model, locale = "en") {
  const zh = locale === "zh-CN";
  if (stage === "PLAN_PRESENTATION") return zh
    ? `Harness 将围绕 ${cleanBusinessText(model.goal ?? "当前目标")} 分析只读素材，形成可审阅的证据与演进建议，并在真正需要你决定时停下。`
    : `Harness will analyze read-only material for ${cleanBusinessText(model.goal ?? "the current goal")}, prepare reviewable evidence and an evolution recommendation, and stop at every real human decision.`;
  if (stage === "PROPOSAL_REVIEW_PRESENTATION") {
    const verdict = model.review?.verdict ?? model.review?.status ?? model.review?.result?.verdict ?? "REVIEW_AVAILABLE";
    const findings = model.review?.findings?.length ?? model.review?.result?.findings?.length ?? 0;
    return zh
      ? `Engine 建议${proposalDecisionLabel(model.proposal?.decision, true)}；${reviewVerdictLabel(verdict, true)}${findings ? `，包含 ${findings} 项发现` : ""}。请根据 Harness 调整内容、Source 依据、评估覆盖和已知限制作出决定。`
      : `The Engine recommends ${proposalDecisionLabel(model.proposal?.decision, false)}; the review verdict is ${verdict}${findings ? ` with ${findings} recorded finding(s)` : ""}. Decide from the Harness change, Source basis, evaluation coverage, and known limits.`;
  }
  if (stage === "PUBLICATION_PRESENTATION") return zh ? "发布是独立决定。发布会将已批准且不可变的 Harness 资产写入指定组织目录；暂不发布会保留当前审阅状态。" : "Publication is a separate decision. Publishing writes approved immutable Harness assets to the declared Organization Catalog; declining preserves the reviewed Workspace state.";
  if (stage.includes("BLOCK")) return zh
    ? `Harness 已安全停止：${renderInline(blockerBusinessReason(model, true))}。现有状态保持不变。`
    : `The Harness process stopped safely: ${renderInline(model.reasons ?? model.blockers ?? model.risk ?? model.status)}. Existing state remains unchanged.`;
  return zh
    ? "Harness 已根据 Engine 与 Session 的权威状态生成当前业务视图。"
    : `Harness has prepared the current ${humanize(stage).toLowerCase()} from authoritative Engine and Session state.`;
}

function blockerBusinessReason(model, chinese) {
  if (!chinese) return cleanBusinessValue(model.reasons ?? model.risk);
  const text = JSON.stringify(model.reasons ?? model.blockers ?? model.risk ?? model.status ?? "").toLowerCase();
  if (text.includes("misclass") || text.includes("boundary") || text.includes("reclassif") || text.includes("概念") || text.includes("边界")) {
    return ["当前 Harness Proposal 的领域、角色或能力边界与 Source 证据不一致，必须先修订分类与边界后才能进入批准。"];
  }
  if (text.includes("evaluation") || text.includes("insufficient") || text.includes("评估") || text.includes("证据不足")) {
    return ["当前评估证据不足或尚未完成审阅，必须先补齐评估闭环。"];
  }
  return ["当前流程未满足继续推进所需的 Engine 门禁条件；详细技术原文已保留在 Compliance Audit Envelope 中。"];
}

function blockerNextAction(value, chinese) {
  if (!chinese) return cleanBusinessValue(value);
  const actions = {
    "revise-proposal": "审阅并修订 Harness 演进方案",
    "collect-more-evidence": "补充并重新审阅 Source 证据",
    "repair-reviewer-and-rerun": "修复审查能力后重新执行审查"
  };
  return actions[String(value ?? "")] ?? "查看 Engine 提供的安全修复方案";
}

function sourceEntries(model) {
  const values = [model.sources, model.proposal?.sources, model.proposal?.sourceReferences, model.review?.sourceMemberships, model.evaluation?.sources].flatMap((value) => Array.isArray(value) ? value : value && typeof value === "object" ? Object.entries(value).flatMap(([type, items]) => Array.isArray(items) ? items.map((item) => typeof item === "string" ? { type, ref: item } : item) : []) : []);
  return values.length ? values.map((item) => typeof item === "string" ? { ref: item } : item) : [];
}

function reasoningOutcome(model, proposal) {
  const value = String(model.decision ?? proposal?.decision ?? model.review?.verdict ?? "CREATE").toUpperCase();
  if (value.includes("NOT_HARNESS_ELIGIBLE") || value.includes("INELIGIBLE") || value.includes("NOT_SUITABLE")) return "NOT_HARNESS_ELIGIBLE";
  if (value.includes("NO_CHANGE") || value.includes("ALREADY_COVERED")) return "NO_CHANGE";
  if (value.includes("REUSE")) return "REUSE_EXISTING";
  if (value.includes("COMPOS")) return "COMPOSE_NEW_BUNDLE";
  if (value.includes("EVOLV") || value.includes("REVISE")) return "EVOLVE_EXISTING";
  if (value.includes("REJECT")) return "REJECT";
  if (value.includes("MORE_EVIDENCE") || value.includes("INSUFFICIENT")) return "NEED_MORE_EVIDENCE";
  return "PROPOSE_NEW_PROFILE";
}

function reasoningRationale(stage, model) { return model.reasons?.[0] ?? model.review?.summary ?? model.review?.rationale ?? `Authoritative ${humanize(stage).toLowerCase()} binds this Source to the current Harness subject.`; }
function candidateAlternatives(model) { return (model.candidates ?? model.review?.alternatives ?? []).map((item) => typeof item === "string" ? item : item.id ?? item.name).filter(Boolean); }
function catalogRelationship(model) { return model.catalog?.relationship ?? model.proposal?.catalogRelationship ?? model.comparisonAssessment?.decision ?? "NOT_REPORTED"; }
function defaultQuestion(stage) { return `Choose one declared option for ${humanize(stage).toLowerCase()}.`; }
function localizedQuestion(stage, supplied, locale) {
  if (locale !== "zh-CN") return supplied ?? defaultQuestion(stage);
  const questions = {
    PLAN_PRESENTATION: "是否批准这份 Harness 操作计划？",
    PROPOSAL_REVIEW_PRESENTATION: "是否已审阅这份 Harness 调整建议、Source 依据、评估覆盖与限制，并进入 Proposal 决策？",
    PROPOSAL_APPROVAL_DECISION: "是否批准这份 Harness Proposal？",
    PUBLICATION_PRESENTATION: "是否将这份已批准的 Harness Proposal 发布到 Organization Catalog？"
    ,CLOSE_PRESENTATION: "是否关闭当前 Harness 会话并完整保留其状态？"
    ,CANCELLATION_PRESENTATION: "是否取消当前 Harness 会话并保留已生成的状态？"
    ,CLEANUP_PRESENTATION: "是否删除仅属于当前 Session 的状态？"
  };
  return questions[stage] ?? supplied ?? "请选择一个 Engine 声明的选项。";
}
function lifecycleStateLabel(status, zh) {
  if (!zh) return status;
  return ({ COMPLETED: "已完成", BLOCKED: "已阻塞", CANCELLED: "已取消", CLOSED: "已关闭" })[status] ?? status;
}
function decisionBusinessReason(stage, locale) {
  const zh = locale === "zh-CN";
  const values = {
    PLAN_PRESENTATION: zh ? "这会确定 Harness 可以执行哪些已列明的分析步骤。" : "This determines which declared analysis steps Harness may execute.",
    PROPOSAL_APPROVAL_DECISION: zh ? "这会决定当前演进建议是否成为已批准 Proposal。" : "This determines whether the evolution recommendation becomes an approved Proposal.",
    PUBLICATION_PRESENTATION: zh ? "发布会让组织内其他使用者可以发现并消费该 Harness。" : "Publication makes the Harness discoverable and consumable by the organization."
  };
  return values[stage] ?? (zh ? "当前流程到达了一个需要人工判断的业务边界。" : "The lifecycle reached a business boundary that requires human judgment.");
}
function decisionEffect(stage, locale) {
  const zh = locale === "zh-CN";
  if (stage === "PLAN_PRESENTATION") return zh ? "只执行计划中已经列出的 Harness 分析操作。" : "Only the Harness analysis operations listed in the Plan may run.";
  if (stage === "PUBLICATION_PRESENTATION") return zh ? "已批准资产将写入指定组织目录并保持不可变。" : "Approved assets are written immutably to the declared Organization Catalog.";
  return zh ? "仅推进当前明确列出的业务阶段。" : "Only the currently declared business stage advances.";
}
function decisionNonEffect(stage, locale) {
  const zh = locale === "zh-CN";
  if (stage === "PLAN_PRESENTATION") return zh ? "不会批准 Proposal、发布资产、执行素材中的命令或清理会话。" : "approve a Proposal, publish assets, execute Source commands, or clean up the Session.";
  if (stage === "PROPOSAL_APPROVAL_DECISION") return zh ? "不会自动发布、关闭或清理。" : "publish, close, or clean up automatically.";
  return zh ? "不会授权后续独立门禁中的任何操作。" : "authorize any later independent gate.";
}
function taskNavigation(stage, model, locale) {
  const zh = locale === "zh-CN";
  const current = Math.max(0, STAGE_ORDER.indexOf(stage));
  const stageNames = zh
    ? ["审阅计划", "授权受控操作", "查看证据结果", "审阅演进建议", "决定是否批准", "决定是否发布", "验证 Catalog 结果", "关闭会话", "清理元数据"]
    : ["Review Plan", "Authorize governed operation", "Review evidence", "Review Proposal", "Decide approval", "Decide publication", "Validate Catalog result", "Close Session", "Clean metadata"];
  return {
    completed: stageNames.slice(0, current),
    current: stageNames[current] ?? humanize(stage),
    remaining: stageNames.slice(current + 1),
    stopReason: zh ? "等待当前业务步骤完成或得到明确决定" : "Waiting for the current business step or an explicit decision",
    summary: zh ? `当前：${stageNames[current] ?? humanize(stage)} · 已完成 ${current} 个阶段 · 后续 ${Math.max(0, stageNames.length - current - 1)} 个阶段` : `Current: ${stageNames[current] ?? humanize(stage)} · ${current} completed · ${Math.max(0, stageNames.length - current - 1)} remaining`
  };
}
function riskSummary(stage, locale) {
  const zh = locale === "zh-CN";
  const r3 = ["PUBLICATION_PRESENTATION", "CLEANUP_PRESENTATION"];
  const r2 = ["PLAN_PRESENTATION", "PROPOSAL_APPROVAL_DECISION", "CANCELLATION_PRESENTATION", "CLOSE_PRESENTATION"];
  const tier = r3.includes(stage) ? "R3" : r2.includes(stage) ? "R2" : "R1";
  const label = zh ? ({ R1: "受计划约束", R2: "需要业务决定", R3: "影响外部或不可逆状态" })[tier] : ({ R1: "Plan-bound", R2: "Business decision", R3: "External or irreversible impact" })[tier];
  return { tier, label, reason: zh ? (tier === "R3" ? "必须单独明确授权。" : tier === "R2" ? "不会根据对话自动继续。" : "仅按已确认计划推进。") : (tier === "R3" ? "Separate explicit authorization is mandatory." : tier === "R2" ? "Conversation cannot advance it automatically." : "Execution remains bound to the confirmed Plan.") };
}
function businessTitle(stage, locale) {
  if (locale !== "zh-CN") return TITLES[stage] ?? humanize(stage);
  return TITLES_ZH[stage] ?? humanize(stage);
}
function businessLocale(session, model) {
  return deriveBoundLocale(session, model);
}
function proposalBusinessChange(proposal = {}, zh) {
  const assets = (proposal.proposedAssets ?? []).slice(0, 3).map((asset) => ({
    kind: asset.kind,
    id: asset.metadata?.id,
    proposedVersion: asset.metadata?.version,
    change: asset.metadata?.description,
    inScope: asset.spec?.boundary?.inScope ?? [],
    outOfScope: asset.spec?.boundary?.outOfScope ?? [],
    positiveConcepts: asset.spec?.match?.positiveConcepts ?? [],
    requiredEvidence: asset.spec?.acceptance?.requiredEvidence ?? []
  }));
  return { recommendation: proposalDecisionLabel(proposal.decision, zh), targetCount: assets.length, targets: assets };
}
function sourceOutcomeBusinessSummary(explanation, zh) {
  if (!explanation) return zh ? "当前阶段尚未形成 Harness 适用性结论。" : "No Harness suitability conclusion is available at this stage.";
  return {
    [zh ? "结论" : "Outcome"]: proposalDecisionLabel(explanation.outcome, zh),
    [zh ? "是否适合进入演进" : "Suitable for Harness evolution"]: explanation.suitableForHarnessEvolution,
    [zh ? "主要理由" : "Reasons"]: (explanation.reasons ?? []).slice(0, 3),
    [zh ? "不满足条件" : "Failed criteria"]: explanation.failedCriteria,
    [zh ? "缺失证据" : "Missing evidence"]: explanation.missingEvidence,
    [zh ? "反向证据" : "Counter-evidence"]: explanation.counterEvidence,
    [zh ? "可选路径" : "Alternatives"]: explanation.alternatives,
    [zh ? "建议下一步" : "Recommended next action"]: explanation.nextAction
  };
}
function professionalReasoningBusinessSummary(analysis, reasoningMap, zh) {
  if (!analysis) return reasoningBusinessSummary(reasoningMap, zh);
  return {
    [zh ? "提取算法" : "Extraction algorithm"]: analysis.extractionAlgorithm,
    [zh ? "能力判断" : "Capability reasoning"]: analysis.capabilities.slice(0, 3).map((item) => ({
      [zh ? "能力" : "Capability"]: item.capabilityId,
      [zh ? "Source 证据" : "Source evidence"]: item.sourceEvidence.slice(0, 3).map((evidence) => ({ source: sourceLabel(evidence.sourceRef ?? evidence.sourceId), facts: (evidence.observedFacts ?? []).slice(0, 3) })),
      [zh ? "为什么这样判断" : "Why this conclusion"]: item.rationale,
      [zh ? "置信度" : "Confidence"]: item.confidence,
      [zh ? "Catalog 关系" : "Catalog relationship"]: item.catalogRelationship,
      [zh ? "替代方案" : "Alternatives"]: item.alternatives
    })),
    [zh ? "Catalog 比较结论" : "Catalog comparison"]: analysis.catalogComparison
  };
}
function architectureBusinessSummary(assessment, zh) {
  if (!assessment) return zh ? "当前结论不涉及 Harness 资产架构变更。" : "The current outcome does not introduce a Harness asset architecture change.";
  return {
    [zh ? "资产定位" : "Asset position"]: assessment.assets,
    [zh ? "模块边界" : "Module boundaries"]: assessment.moduleBoundaries,
    [zh ? "依赖" : "Dependencies"]: assessment.dependencies,
    [zh ? "质量属性" : "Quality attributes"]: assessment.qualityAttributes,
    [zh ? "兼容性影响" : "Compatibility impact"]: assessment.compatibilityImpact,
    [zh ? "影响范围" : "Blast radius"]: assessment.blastRadius,
    [zh ? "迁移" : "Migration"]: assessment.migration,
    [zh ? "恢复策略" : "Recovery strategy"]: assessment.rollback
  };
}
function professionalEvaluationSummary(analysis, model, zh) {
  const evaluation = evaluationBusinessSummary(model, zh);
  if (!analysis) return evaluation;
  return {
    [zh ? "综合置信度" : "Aggregate confidence"]: analysis.confidence,
    [zh ? "评估覆盖" : "Evaluation coverage"]: analysis.evaluationCoverage,
    [zh ? "已知限制" : "Known limits"]: analysis.knownLimits,
    [zh ? "反向证据" : "Counter-evidence"]: analysis.counterEvidence,
    [zh ? "EvaluationPack" : "EvaluationPack"]: evaluation
  };
}
function reasoningBusinessSummary(map, zh) {
  return map.entries.map((entry) => ({
    source: sourceLabel(entry.sourceRef),
    outcome: proposalDecisionLabel(entry.harnessOutcome, zh),
    observedFacts: entry.observedFacts,
    rationale: entry.rationale,
    alternatives: entry.alternatives,
    uncertainty: entry.uncertainty,
    nonAdoptionReason: entry.nonAdoptionReason
  }));
}
function reviewBusinessSummary(review = {}, zh) {
  const gates = review.deterministicGates ?? [];
  return {
    verdict: reviewVerdictLabel(review.verdict ?? review.status, zh),
    summary: review.summary ?? review.rationale,
    findings: (review.findings ?? []).slice(0, 3).map((item) => ({ severity: item.severity, dimension: item.dimension, conclusion: item.conclusion, reasons: (item.reasons ?? []).slice(0, 2) })),
    deterministicSafety: gates.some((gate) => gate.blocking && gate.status !== "PASS") ? (zh ? "存在阻塞项" : "Blocking failure present") : (zh ? "全部阻塞门禁通过" : "All blocking gates passed"),
    remainingBlockers: review.remainingBlockers ?? []
  };
}
function evaluationBusinessSummary(model, zh) {
  const pack = model.proposal?.evaluationPack ?? model.evaluation?.evaluationPack ?? model.evaluation ?? {};
  const cases = pack.spec?.cases ?? [];
  return {
    status: pack.spec?.status ?? pack.status ?? model.review?.evaluationSufficiency?.status ?? "NOT_REPORTED",
    totalCases: cases.length,
    positiveCases: cases.filter((item) => item.polarity === "positive").length,
    negativeCases: cases.filter((item) => item.polarity === "negative").length,
    reviewedCases: cases.filter((item) => item.reviewStatus === "reviewed").length,
    humanReviewRequired: cases.some((item) => item.reviewStatus !== "reviewed"),
    comparison: model.comparisonAssessment?.status ?? "NOT_PROVIDED",
    explanation: zh ? "评估用例未完成人工审阅时，Proposal 不会被自动批准。" : "The Proposal cannot be automatically approved while evaluation cases remain unreviewed."
  };
}
function decisionBoundarySummary(model, zh) {
  return {
    proposalApproval: zh ? "需要后续独立人工决定" : "Requires a separate later human decision",
    publication: zh ? "不会由本次决定授权" : "Not authorized by this decision",
    sourceExecution: zh ? "禁止执行 Source 中的命令" : "Commands from Source material remain forbidden",
    nextAction: model.nextAction
  };
}
function proposalDecisionLabel(value, zh) {
  const labels = zh ? { EVOLVE_EXISTING: "进化现有 Harness", PROPOSE_NEW_PROFILE: "提出新的 Harness Profile", CREATE_NEW: "创建新 Harness", CREATE: "创建 Harness", REUSE_EXISTING: "复用现有 Harness", REUSE: "复用现有 Harness", COMPOSE_NEW_BUNDLE: "组合新的 Harness Bundle", COMPOSE: "组合 Harness", NOT_HARNESS_ELIGIBLE: "不适合沉淀为 Harness", NO_CHANGE: "无需演进", REJECT: "拒绝演进", NEED_MORE_EVIDENCE: "需要更多证据", READY_FOR_HUMAN_APPROVAL: "进入人工审阅" } : {};
  return labels[String(value ?? "").toUpperCase()] ?? String(value ?? (zh ? "待确认" : "pending confirmation"));
}
function reviewVerdictLabel(value, zh) {
  if (!zh) return String(value ?? "Review available");
  const labels = {
    READY_FOR_HUMAN_APPROVAL: "专业审查已完成，可进入人工审阅",
    REVISE: "需要修订后重新审查",
    SPLIT: "建议拆分方案后重新审查",
    REJECT: "不建议采用当前方案",
    NEED_MORE_EVIDENCE: "需要补充证据",
    REVIEWED: "专业审查已完成",
    ACTION_REQUIRED: "需要处理审查发现"
  };
  return labels[String(value ?? "").toUpperCase()] ?? "专业审查结果已生成";
}
function sourceLabel(value) { const text = String(value ?? "Source"); return text.split(/[\\/]/).pop() || text; }
function section(id, title, content) { return content === undefined || content === null ? null : { id, title, content: persistedJson(content) }; }
function compact(items) { return items.filter(Boolean); }
function renderBusinessContent(value, depth = 0, chinese = true) {
  if (value === null || value === undefined || value === "") return chinese ? "- 暂无需要展示的信息" : "- No information to display";
  if (["string", "number", "boolean"].includes(typeof value)) return chinese ? localizedBusinessText(value) : cleanBusinessText(String(value));
  const indent = "    ".repeat(depth);
  if (Array.isArray(value)) return value.length ? value.map((item) => {
    if (item && typeof item === "object") return renderBusinessContent(item, depth, chinese);
    return `${indent}- ${renderBusinessContent(item, depth + 1, chinese)}`;
  }).join("\n") : `${indent}- ${chinese ? "无" : "None"}`;
  return Object.entries(value).filter(([key]) => !technicalKey(key)).map(([key, item]) => {
    const label = businessFieldLabel(key, chinese);
    if (item && typeof item === "object") return `${indent}- **${label}**\n${renderBusinessContent(item, depth + 1, chinese)}`;
    return `${indent}- **${label}** — ${renderBusinessContent(item, depth + 1, chinese)}`;
  }).join("\n") || `${indent}- ${chinese ? "详细技术记录已保存在审计层" : "Detailed technical records are preserved in the audit layer"}`;
}
function renderInline(value) { return typeof value === "string" ? cleanBusinessText(value) : renderBusinessContent(value).replaceAll("\n", "；"); }
function cleanBusinessText(value) { return String(value ?? "").replace(/\bsha256:[a-f0-9]{16,64}\b/gi, "已绑定记录").replace(/(?:\/[\w.@+~-]+)+\/([^/\s]+\.[A-Za-z0-9]+)\b/g, "$1").replace(/\b(?:inspect_capabilities|approve_session_proposal|publish_session_proposal|acknowledge_interaction_frame)\b/g, "受控操作"); }
function localizedBusinessText(value) {
  if (typeof value === "boolean") return value ? "是" : "否";
  const raw = cleanBusinessText(String(value));
  const exact = {
    READY_FOR_HUMAN_APPROVAL: "专业审查已完成，可进入人工审阅",
    REVIEW_PROFESSIONAL_ANALYSIS_AND_PROPOSAL: "审阅专业分析与 Harness 演进方案",
    PROPOSE_NEW_PROFILE: "提出新的 Harness Profile",
    EVOLVE_EXISTING: "进化现有 Harness",
    NOT_REPORTED: "当前无需展示",
    NOT_PROVIDED: "未提供比较证据",
    STATIC_SOURCE_INGESTION: "静态读取 Source",
    SNAPSHOT_AND_REDACTION: "生成快照并执行脱敏",
    EVIDENCE_GRAPH: "构建可追溯证据关系",
    ELIGIBILITY_GATE: "判断是否适合沉淀为 Harness",
    ONTOLOGY_MAPPING: "映射 Harness 领域与能力边界",
    CATALOG_CANDIDATE_SCORING: "比较现有 Catalog 候选能力",
    DECISION_AGGREGATION: "汇总证据并形成建议",
    PROPOSAL_AND_EVALUATION_DESIGN: "设计演进方案与评估用例",
    INSUFFICIENT_EVAL_EVIDENCE: "评估证据尚未充分",
    PROPOSED_ASSETS_ONLY: "仅影响本次建议的新资产",
    NOT_REQUIRED_OR_NOT_REPORTED: "当前无需迁移",
    PRESERVE_PRIOR_IMMUTABLE_ASSET_AND_SUPERSEDE_WITH_A_LATER_VERSION: "保留既有不可变资产，必要时发布后续替代版本",
    "request-explicit-proposal-business-decision": "进入独立的 Proposal 人工决策",
    info: "提示",
    boundary: "能力边界",
    "Boundary is supported.": "Source 证据支持当前能力边界。",
    "Cited Source evidence": "已引用的 Source 证据",
    "evaluation-review-required": "评估用例需要人工审阅"
  };
  if (exact[raw]) return exact[raw];
  if (/^run-\d/i.test(raw)) return "本次候选 Harness 能力";
  if (/^Review-stage language-service Harness Profile/i.test(raw)) return "面向 language-service 领域的可重复工程工作流 Harness Profile。";
  if (/^Validate repeatable service-engineering workflows/i.test(raw)) return "验证 language-service 领域中可重复执行的工程工作流。";
  if (/^Discover project-specific build, test, release/i.test(raw)) return "仅从引用证据识别项目特定的构建、测试、发布与诊断约束，不执行其中命令。";
  if (/^Produce traceable evidence/i.test(raw)) return "形成可追溯的素材索引、目标说明、受控操作清单与验证结果。";
  if (/^Exclude projects outside/i.test(raw)) return "排除缺少 language-service 证据或超出演进边界的内容。";
  if (/^Do not infer unsupported capabilities/i.test(raw)) return "不得从未引用素材推断能力或生产就绪结论。";
  if (/^Do not execute project-provided commands/i.test(raw)) return "未经隔离环境与操作人明确授权，不得执行 Source 中的任何命令。";
  const latinLetters = (raw.match(/[A-Za-z]/g) ?? []).length;
  if (latinLetters / Math.max(1, raw.length) > 0.55 && /\bproposal\b|\bevidence-backed\b|\bboundary\b|\bevaluation pack\b/i.test(raw)) {
    return "Source 证据支持该 Harness 能力边界；演进方案、限制条件与评估门禁完整，仍须由人工独立审阅。";
  }
  return raw;
}
function cleanBusinessValue(value) {
  if (typeof value === "string") return cleanBusinessText(value);
  if (Array.isArray(value)) return value.map(cleanBusinessValue);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).filter(([key]) => !technicalKey(key)).map(([key, item]) => [key, cleanBusinessValue(item)]));
  return value;
}
function technicalKey(key) { return /(?:digest|sessionId|viewId|frameId|protocol|schema|mcp|model|usage|token|operationId|receipt|allowedNextOperations|forbiddenOperations)/i.test(String(key)); }
function businessFieldLabel(key, chinese = true) {
  if (!chinese) return humanize(key);
  const labels = { attachments: "素材", operation: "处理步骤", input: "输入范围", attachmentCount: "素材数量", engineAuthoritative: "由 Harness 负责", sourceExecutionAllowed: "是否执行素材", recommendation: "建议", targetCount: "建议数量", targets: "具体变化", status: "状态", findings: "发现", remainingBlockers: "待解决事项", totalCases: "评估用例", positiveCases: "正向用例", negativeCases: "负向用例", reviewedCases: "已审阅用例", humanReviewRequired: "是否需要人工审阅", comparison: "比较结果", explanation: "说明", verdict: "审查结论", summary: "摘要", severity: "严重程度", dimension: "维度", conclusion: "结论", reasons: "理由", deterministicSafety: "确定性安全门禁", kind: "资产类型", id: "资产标识", version: "版本", proposedVersion: "建议版本", change: "变化", inScope: "范围内", outOfScope: "范围外", positiveConcepts: "正向概念", requiredEvidence: "所需证据", proposalApproval: "Proposal 批准", publication: "发布", sourceExecution: "Source 执行", nextAction: "下一步", capabilityId: "能力标识", sourceEvidence: "Source 证据", extractionMethod: "提取方法", rationale: "判断理由", confidence: "置信度", counterEvidence: "反向证据", alternatives: "替代方案", catalogRelationship: "Catalog 关系", evaluationCoverage: "评估覆盖", knownLimits: "已知限制", existingRelationship: "现有关系", rejectedAlternatives: "未采用方案", alternative: "替代方案", reason: "原因", dependencies: "依赖", qualityAttributes: "质量属性", compatibilityImpact: "兼容性影响", blastRadius: "影响范围", migration: "迁移", rollback: "恢复策略" };
  return labels[key] ?? humanize(key);
}
function decisionOptionLabel(value, zh) { return zh ? (NATURAL_OPTIONS_ZH[value] ?? humanize(value)) : humanize(value); }
function sourceBusinessSummary(sources, zh) { const entries = sourceEntries({ sources }); return entries.length ? entries.map((item) => ({ [zh ? "素材" : "Source"]: sourceLabel(item.ref ?? item.path ?? item.name ?? item) })) : (zh ? "未声明素材" : "No Source declared"); }
function operationBusinessSummary(operations = [], zh) { const values = Array.isArray(operations) ? operations : operations && typeof operations === "object" ? Object.values(operations).flat() : operations ? [operations] : []; return values.map((item, index) => ({ [zh ? `步骤 ${index + 1}` : `Step ${index + 1}`]: operationLabel(item?.operation ?? item?.kind ?? item, zh) })); }
function operationLabel(value, zh) { const text = String(value ?? ""); if (/evidence\.produce|produce/i.test(text)) return zh ? "从只读素材提取并结构化 Harness 证据" : "Extract and structure Harness evidence from read-only material"; if (/review/i.test(text)) return zh ? "审阅证据并形成演进建议" : "Review evidence and form an evolution recommendation"; return zh ? "执行计划中声明的 Harness 分析步骤" : "Run the Harness analysis step declared in the Plan"; }
function expectedOutcomeSummary(model, zh) { return zh ? ["可追溯的 Source 证据", "Source 到 Harness 能力的判断依据", "可供后续审阅的演进建议"] : ["Traceable Source evidence", "Source-to-Harness reasoning", "A reviewable evolution recommendation"]; }
function nonEffectSummary(model, zh) { return zh ? ["不会执行附件或 Source 中的任何命令", "不会自动批准或发布 Proposal", "不会修改来源文件"] : ["No command in an attachment or Source is executed", "No Proposal is approved or published automatically", "Source files remain unchanged"]; }
function publicationDestination(model, zh) { return { [zh ? "目标" : "Destination"]: cleanBusinessValue(model.catalog ?? "Organization Catalog"), [zh ? "可见范围" : "Visibility"]: cleanBusinessValue(model.visibility ?? (zh ? "组织内可发现" : "Discoverable within the organization")) }; }
function publicationImpact(model, zh) { return { [zh ? "会变化" : "Affected"]: cleanBusinessValue(model.impact ?? model.assets), [zh ? "不会变化" : "Unaffected"]: cleanBusinessValue(model.unaffected ?? (zh ? "来源素材、现有已发布版本和本地模型配置" : "Source material, existing published versions, and local model configuration")) }; }
function publicationRecovery(model, zh) { return { [zh ? "暂不发布" : "If not published"]: cleanBusinessValue(model.nonPublicationOutcome), [zh ? "恢复方式" : "Rollback"]: cleanBusinessValue(model.rollback ?? (zh ? "保留当前审阅状态；已发布版本保持不可变，可另发替代版本" : "Preserve review state; published versions remain immutable and can be superseded by a later version")) }; }
function humanize(value) { return String(value).replaceAll("_", " ").replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase().replace(/^./, (char) => char.toUpperCase()); }
function unique(value) { return [...new Set((Array.isArray(value) ? value : value ? [value] : []).map(String).filter(Boolean))]; }
function validDigest(value) { return /^sha256:[a-f0-9]{64}$/.test(String(value ?? "")); }
function projectionError(code, message) { const error = new Error(message); error.name = "BusinessInteractionProjectionError"; error.code = code; error.nextAction = "render-current-business-decision-view-exactly"; return error; }
