import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import { PACKAGE_ROOT } from "../../v3/constants.mjs";
import { digest, persistedJson, writeJson } from "../../v3/utils.mjs";
import { requireWorkspace } from "../../v3/workspace.mjs";
import { assertExternalWorkspace, assertWorkspaceTreeConfined, resolveWorkspacePath } from "../constants.mjs";
import { createAgentSession, inspectAgentSession, resumeAgentSession, updateAgentSessionClassification } from "../session/store.mjs";
import { advisorModelBinding } from "./advisor.mjs";
import { analyzePreparedSourceTaxonomy, createClassificationHandoff, prepareResolvedSourceTaxonomyAnalysis } from "./engine.mjs";
import { resolveSourceDescriptor } from "./source-descriptor.mjs";
import { canonicalCompare, resolveTaxonomy } from "./taxonomy.mjs";

export const CLASSIFICATION_SESSION_SCHEMA = "evopilot-harness-classification-session/v1";
const schema = JSON.parse(fs.readFileSync(path.join(PACKAGE_ROOT, "schemas/classification-session-v1.schema.json"), "utf8"));
const receiptSchema = JSON.parse(fs.readFileSync(path.join(PACKAGE_ROOT, "schemas/classification-analysis-receipt-v1.schema.json"), "utf8"));
const ajv = new Ajv2020({ allErrors: true, strict: true });
ajv.addSchema(receiptSchema);
const validate = ajv.compile(schema);

export async function startClassificationSession({ home, sourceDescriptor, source, taxonomy, intent, locale, modelsFile, model, advisorTimeoutMs, advisorProvider, adapterId = "digital-expert", hostInteraction, now = new Date().toISOString() }) {
  const workspace = assertExternalWorkspace(home);
  requireWorkspace(workspace);
  assertWorkspaceTreeConfined(workspace);
  const execution = await runClassificationAnalysis({ home: workspace, sourceDescriptor: sourceDescriptor ?? source, taxonomy, intent, locale, modelsFile, model, advisorTimeoutMs, advisorProvider, now });
  const result = execution.result;
  const attempt = attemptRecord(result, now, execution);
  const sessionId = `classification-${Date.now().toString(36)}-${crypto.randomBytes(6).toString("hex")}`;
  const createdOperationSession = createAgentSession({ home: workspace, intent, adapterId, hostInteraction, now });
  const operationSession = updateAgentSessionClassification({ home: workspace, sessionId: createdOperationSession.sessionId, expectedSessionDigest: createdOperationSession.sessionDigest, classificationSessionId: sessionId, status: classificationStatus(result), resultDigest: result.analysisResultDigest ?? result.advisor.blockerDigest, classificationContextDigest: result.evolutionContext?.classificationContextDigest ?? null, analysisAttemptDigest: result.advisor.analysisAttemptDigest, analysisReceiptDigest: attempt.analysisReceipt.receiptDigest, now });
  const session = {
    schema: CLASSIFICATION_SESSION_SCHEMA,
    sessionId,
    status: classificationStatus(result),
    createdAt: now,
    updatedAt: now,
    workspace: { home: workspace, mode: "external-read-write" },
    agentOperationSessionId: operationSession.sessionId,
    agentOperationSessionDigest: operationSession.sessionDigest,
    source: classificationSourceRecord(execution.resolvedSource, result),
    taxonomy: { ref: typeof taxonomy === "string" ? path.resolve(taxonomy) : "inline", document: typeof taxonomy === "string" ? null : persistedJson(taxonomy), digest: result.taxonomyDigest ?? result.taxonomy.taxonomyDigest },
    attempts: [attempt],
    currentResult: persistedJson(result),
    presentation: classificationPresentation(result, sessionId),
    currentDecision: classificationDecision(result, sessionId),
    presentationReceipts: [],
    humanDecisions: [],
    handoff: null,
    operationSessionId: null,
    nextOperations: result.nextOperations
  };
  return persist(session);
}

export async function reanalyzeClassificationSession({ home, sessionId, expectedSessionDigest, sourceDescriptor, source, taxonomy, intent, locale, modelsFile, model, advisorTimeoutMs, advisorProvider, now = new Date().toISOString() }) {
  const session = loadForMutation(home, sessionId, expectedSessionDigest);
  if (["HANDED_OFF", "CLOSED", "CANCELLED"].includes(session.status)) throw classificationError("CLASSIFICATION_SESSION_TERMINAL", "A handed-off, closed, or cancelled classification Session cannot be re-analyzed.", "start-new-classification-session");
  const taxonomyInput = taxonomy ?? (session.taxonomy.ref === "inline" ? session.taxonomy.document : session.taxonomy.ref);
  const replacementSource = sourceDescriptor ?? source;
  const execution = await runClassificationAnalysis({ home: session.workspace.home, sourceDescriptor: replacementSource, resolvedSource: replacementSource == null ? session.source.resolution : null, taxonomy: taxonomyInput, intent, locale, modelsFile, model, advisorTimeoutMs, advisorProvider, now });
  const result = execution.result;
  const attempt = attemptRecord(result, now, execution);
  session.status = classificationStatus(result);
  session.updatedAt = now;
  session.source = classificationSourceRecord(execution.resolvedSource, result);
  session.taxonomy = { ref: typeof taxonomyInput === "string" ? path.resolve(taxonomyInput) : "inline", document: typeof taxonomyInput === "string" ? null : persistedJson(taxonomyInput), digest: result.taxonomyDigest ?? result.taxonomy.taxonomyDigest };
  session.attempts.push(attempt);
  session.currentResult = persistedJson(result);
  session.presentation = classificationPresentation(result, session.sessionId);
  session.currentDecision = classificationDecision(result, session.sessionId);
  session.nextOperations = result.nextOperations;
  const operationSession = updateAgentSessionClassification({ home: session.workspace.home, sessionId: session.agentOperationSessionId, expectedSessionDigest: session.agentOperationSessionDigest, classificationSessionId: session.sessionId, status: classificationStatus(result), resultDigest: result.analysisResultDigest ?? result.advisor.blockerDigest, classificationContextDigest: result.evolutionContext?.classificationContextDigest ?? null, analysisAttemptDigest: result.advisor.analysisAttemptDigest, analysisReceiptDigest: attempt.analysisReceipt.receiptDigest, now });
  session.agentOperationSessionDigest = operationSession.sessionDigest;
  return persist(session);
}

export function continueClassificationToHarness({ home, sessionId, expectedSessionDigest, decidedBy, decisionToken, intent, adapterId, hostInteraction, now = new Date().toISOString() }) {
  const session = loadForMutation(home, sessionId, expectedSessionDigest);
  if (session.status !== "TAXONOMY_MATCHED") throw classificationError("CLASSIFICATION_MATCH_REQUIRED", "Only TAXONOMY_MATCHED can continue to Harness Eligibility.", session.nextOperations[0]);
  const handoff = createClassificationHandoff({ classificationSessionId: session.sessionId, result: session.currentResult, decidedBy, decisionToken });
  const operationSession = updateAgentSessionClassification({ home: session.workspace.home, sessionId: session.agentOperationSessionId, expectedSessionDigest: session.agentOperationSessionDigest, classificationSessionId: session.sessionId, status: "HANDED_OFF", resultDigest: session.currentResult.analysisResultDigest, classificationContextDigest: session.currentResult.evolutionContext.classificationContextDigest, analysisAttemptDigest: session.currentResult.analysisAttemptDigest, analysisReceiptDigest: session.attempts.at(-1).analysisReceipt.receiptDigest, handoff, decidedBy, now });
  session.status = "HANDED_OFF";
  session.updatedAt = now;
  session.handoff = handoff;
  session.currentDecision = null;
  session.operationSessionId = operationSession.sessionId;
  session.agentOperationSessionDigest = operationSession.sessionDigest;
  session.humanDecisions.push({ kind: "CONTINUE_TO_HARNESS", decidedBy, decisionDigest: digest({ decisionToken, handoffDigest: handoff.handoffDigest }), decidedAt: now });
  session.nextOperations = ["INSPECT_OPERATION_SESSION", "CLOSE"];
  const persisted = persist(session);
  return { schema: "evopilot-harness-classification-handoff-result/v1", status: "HANDED_OFF", classificationSession: persisted, operationSession, authority: handoff.authority };
}

export function inspectClassificationSession(home, sessionId) {
  const file = sessionFile(home, sessionId);
  if (!fs.existsSync(file)) throw classificationError("CLASSIFICATION_SESSION_NOT_FOUND", `Classification Session does not exist: ${sessionId}`, "list-classification-sessions");
  const session = JSON.parse(fs.readFileSync(file, "utf8"));
  const expected = sessionDigest(session);
  if (session.sessionDigest !== expected) throw classificationError("CLASSIFICATION_SESSION_INTEGRITY_FAILED", "Classification Session digest does not match persisted content.", "preserve-and-inspect-workspace");
  validateSession(session);
  const operationSession = inspectAgentSession(home, session.agentOperationSessionId);
  if (operationSession.classificationLifecycle?.classificationSessionId !== session.sessionId) throw classificationError("CLASSIFICATION_AGENT_SESSION_BINDING_FAILED", "The generic AgentOperationSession does not bind this classification lifecycle.", "preserve-and-inspect-workspace");
  if (session.status !== "HANDED_OFF" && operationSession.sessionDigest !== session.agentOperationSessionDigest) throw classificationError("CLASSIFICATION_AGENT_SESSION_DIGEST_MISMATCH", "The generic AgentOperationSession changed before the classification transition.", "resume-project-classification");
  if (session.status === "HANDED_OFF" && operationSession.classificationHandoff?.handoffDigest !== session.handoff?.handoffDigest) throw classificationError("CLASSIFICATION_HANDOFF_BINDING_FAILED", "The generic AgentOperationSession no longer binds the exact classification handoff.", "preserve-and-inspect-workspace");
  return session;
}

export function resumeClassificationSession({ home, sessionId, expectedSessionDigest, adapterId, now = new Date().toISOString() }) {
  const session = loadForMutation(home, sessionId, expectedSessionDigest);
  if (["HANDED_OFF", "CLOSED", "CANCELLED"].includes(session.status)) throw classificationError("CLASSIFICATION_SESSION_TERMINAL", "A handed-off, closed, or cancelled classification lifecycle cannot be resumed through classification.", "inspect-operation-session");
  const operationSession = resumeAgentSession({ home: session.workspace.home, sessionId: session.agentOperationSessionId, expectedSessionDigest: session.agentOperationSessionDigest, adapterId, now });
  session.agentOperationSessionDigest = operationSession.sessionDigest;
  session.updatedAt = now;
  session.nextOperations = session.currentResult.nextOperations;
  return persist(session);
}

export function listClassificationSessions(home) {
  const root = resolveWorkspacePath(home, "classification-sessions");
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => {
    try { const session = inspectClassificationSession(home, entry.name); return { sessionId: session.sessionId, status: session.status, updatedAt: session.updatedAt, aggregate: session.currentResult.aggregate ?? session.currentResult.status, sessionDigest: session.sessionDigest, operationSessionId: session.operationSessionId }; } catch { return null; }
  }).filter(Boolean).sort((left, right) => canonicalCompare(left.sessionId, right.sessionId));
}

export function recordClassificationPresentationDelivery({ home, sessionId, expectedPresentationDigest, now = new Date().toISOString() }) {
  const session = inspectClassificationSession(home, sessionId);
  if (session.presentation.presentationDigest !== expectedPresentationDigest) throw classificationError("CLASSIFICATION_PRESENTATION_DIGEST_MISMATCH", "The classification presentation changed before automatic delivery was recorded.", "reload-classification-session");
  const existing = session.presentationReceipts.find((item) => item.presentationDigest === expectedPresentationDigest && item.automatic === true);
  if (existing) return session;
  const receipt = { schema: "evopilot-harness-classification-presentation-receipt/v1", presentationDigest: expectedPresentationDigest, automatic: true, wholeTurnDelivered: true, hostAuthoredGovernedProseCount: 0, authority: { deliveryEvidenceOnly: true, humanDecision: false }, recordedAt: now };
  receipt.receiptDigest = digest(receipt);
  session.presentationReceipts.push(receipt);
  session.updatedAt = now;
  return persist(session);
}

export function closeClassificationSession({ home, sessionId, expectedSessionDigest, decidedBy, decision = "CLOSE", now = new Date().toISOString() }) {
  const current = inspectClassificationSession(home, sessionId);
  const resolvedSessionDigest = expectedSessionDigest ?? current.sessionDigest;
  const session = loadForMutation(home, sessionId, resolvedSessionDigest);
  if (session.status === "CLOSED") return session;
  if (session.status === "HANDED_OFF") throw classificationError("CLASSIFICATION_ALREADY_HANDED_OFF", "The classification lifecycle has already handed control to the retained Harness lifecycle; close the Agent Operation Session through its governed close flow.", "inspect-operation-session");
  session.status = decision === "CANCEL" ? "CANCELLED" : "CLOSED";
  session.updatedAt = now;
  session.closedAt = now;
  session.humanDecisions.push({ kind: session.status, decidedBy, decisionDigest: digest({ decision, priorSessionDigest: resolvedSessionDigest }), decidedAt: now });
  session.nextOperations = ["INSPECT"];
  session.currentDecision = null;
  session.presentation = classificationTerminalPresentation(session.currentResult, session.sessionId, session.status);
  const operationSession = updateAgentSessionClassification({ home: session.workspace.home, sessionId: session.agentOperationSessionId, expectedSessionDigest: session.agentOperationSessionDigest, classificationSessionId: session.sessionId, status: session.status, resultDigest: session.currentResult.analysisResultDigest ?? session.currentResult.advisor?.blockerDigest, classificationContextDigest: session.currentResult.evolutionContext?.classificationContextDigest ?? null, analysisAttemptDigest: session.currentResult.advisor.analysisAttemptDigest, analysisReceiptDigest: session.attempts.at(-1).analysisReceipt.receiptDigest, decidedBy, close: true, now });
  session.agentOperationSessionDigest = operationSession.sessionDigest;
  return persist(session);
}

function loadForMutation(home, sessionId, expectedSessionDigest) {
  const session = inspectClassificationSession(home, sessionId);
  if (session.sessionDigest !== expectedSessionDigest) throw classificationError("CLASSIFICATION_SESSION_DIGEST_MISMATCH", "Classification Session changed before the requested mutation.", "reload-classification-session");
  return persistedJson(session);
}

function persist(session) {
  session.sessionDigest = sessionDigest(session);
  validateSession(session);
  writeJson(sessionFile(session.workspace.home, session.sessionId), session);
  return persistedJson(session);
}

function validateSession(session) {
  if (!validate(session)) throw classificationError("CLASSIFICATION_SESSION_SCHEMA_INVALID", ajv.errorsText(validate.errors), "inspect-classification-session");
}

function sessionDigest(session) { const copy = persistedJson(session); delete copy.sessionDigest; return digest(copy); }
function sessionFile(home, sessionId) { if (!/^classification-[a-z0-9-]{8,96}$/.test(sessionId)) throw classificationError("CLASSIFICATION_SESSION_ID_INVALID", "Invalid classification Session id.", "list-classification-sessions"); return resolveWorkspacePath(home, "classification-sessions", sessionId, "session.json"); }
function classificationStatus(result) { return result.status === "ANALYSIS_BLOCKED_ADVISOR" ? result.status : result.aggregate; }
async function runClassificationAnalysis({ home, sourceDescriptor, resolvedSource, taxonomy, intent, locale, modelsFile, model, advisorTimeoutMs, advisorProvider, now }) {
  const resolvedTaxonomy = resolveTaxonomy(taxonomy);
  const resolution = resolvedSource ?? resolveSourceDescriptor({ descriptor: sourceDescriptor, workspace: home, now });
  const prepared = prepareResolvedSourceTaxonomyAnalysis({ resolvedSource: resolution, resolvedTaxonomy });
  const request = {
    sourceSnapshotDigest: prepared.hypothesis.sourceSnapshotDigest,
    taxonomyDigest: prepared.taxonomy.taxonomyDigest,
    hypothesisDigest: prepared.hypothesis.hypothesisDigest,
    retrievalDigest: prepared.retrieval.retrievalDigest,
    modelBinding: advisorModelBinding(modelsFile, model, advisorProvider),
    providerBinding: advisorProvider ? advisorProvider.name || "anonymous-injected-provider" : null,
    intent: intent ?? "analyze-source-business-classification",
    locale: locale ?? "zh-CN",
    presentationTemplateVersion: "evopilot-harness-taxonomy-presentation/v1"
  };
  const requestDigest = digest(request);
  const cacheFile = resolveWorkspacePath(home, "classification-results", `${requestDigest.slice(7)}.json`);
  if (fs.existsSync(cacheFile)) {
    const result = JSON.parse(fs.readFileSync(cacheFile, "utf8"));
    const copy = persistedJson(result);
    const recordedDigest = copy.analysisResultDigest;
    delete copy.analysisResultDigest;
    if (recordedDigest !== digest(copy)) throw classificationError("CLASSIFICATION_REPLAY_INTEGRITY_FAILED", "The completed classification replay result failed its immutable digest check.", "preserve-and-inspect-workspace");
    return { result, executionMode: "REPLAY", physicalAdvisorInvocationCount: 0, requestDigest, resolvedSource: resolution };
  }
  const result = await analyzePreparedSourceTaxonomy({ prepared, modelsFile, model, advisorTimeoutMs, advisorProvider, analysisAttemptId: `attempt-${crypto.randomUUID()}`, intent, locale });
  if (result.schema === "evopilot-harness-taxonomy-analysis-result/v1") writeJson(cacheFile, result);
  return { result, executionMode: "NEW_ANALYSIS", physicalAdvisorInvocationCount: result.advisor.invocationCount, requestDigest, resolvedSource: resolution };
}

function classificationSourceRecord(resolution, result) {
  return {
    sourceId: resolution.sourceId,
    type: resolution.type,
    ref: resolution.path ?? resolution.files?.[0]?.path ?? null,
    descriptor: persistedJson(resolution.sourceDescriptor),
    descriptorDigest: resolution.sourceDescriptorDigest,
    resolution: persistedJson(resolution),
    resolutionDigest: resolution.sourceResolutionDigest,
    snapshotDigest: result.sourceSnapshotDigest ?? result.hypothesis.sourceSnapshotDigest
  };
}

function attemptRecord(result, now, execution) {
  const resultDigest = result.analysisResultDigest ?? result.advisor.blockerDigest;
  const receipt = {
    schema: "evopilot-harness-classification-analysis-receipt/v1",
    analysisRequestDigest: execution.requestDigest,
    analysisAttemptDigest: result.advisor.analysisAttemptDigest,
    resultDigest,
    executionMode: execution.executionMode,
    physicalAdvisorInvocationCount: execution.physicalAdvisorInvocationCount,
    advisorReceiptDigest: result.advisor.advisorReceiptDigest ?? result.advisor.blockerDigest,
    completedAt: now,
    authority: { executionEvidenceOnly: true, humanDecision: false, mayApprove: false, mayPublish: false }
  };
  receipt.receiptDigest = digest(receipt);
  return {
    attemptedAt: now,
    analysisAttemptDigest: result.advisor.analysisAttemptDigest,
    analysisRequestDigest: execution.requestDigest,
    executionMode: execution.executionMode,
    status: classificationStatus(result),
    resultDigest,
    advisorInvocationCount: result.advisor.invocationCount,
    physicalAdvisorInvocationCount: execution.physicalAdvisorInvocationCount,
    analysisReceipt: receipt
  };
}
function classificationError(code, message, nextAction) { const error = new Error(message); error.name = "ClassificationSessionError"; error.code = code; error.nextAction = nextAction; return error; }

function classificationDecision(result, sessionId) {
  if (result.aggregate !== "TAXONOMY_MATCHED") return null;
  const token = `CONTINUE_TO_HARNESS:${sessionId}:${result.analysisResultDigest}`;
  return { schema: "evopilot-harness-classification-decision/v1", decisionHandle: `classification-decision-${digest(token).slice(7, 31)}`, options: ["CONTINUE_TO_HARNESS", "CLOSE"], internalDecisionToken: token, humanMustNotTranscribeToken: true, authority: { explicitChoiceRequired: true, provesEligibility: false } };
}

function classificationPresentation(result, sessionId) {
  const lines = ["# 项目分类分析", ""];
  if (result.status === "ANALYSIS_BLOCKED_ADVISOR") {
    lines.push("分类覆盖情况：分析暂时无法完成。", "", `原因：${result.advisor.message}`, "", "下一步：修复业务分类分析所需的模型配置或连接后，明确发起一次新的分析；也可以取消或关闭。" );
  } else {
    lines.push(`分类覆盖情况：${ordinaryStatus(result.aggregate)}`, "");
    for (const [axis, title] of [["domain", "业务领域"], ["product", "产品或系统类型"]]) {
      const view = result.presentation[axis];
      lines.push(`## ${title}`, "", `结论：${view.conclusion ?? ordinaryStatus(view.status)}`, `说明：${view.reason}`);
      if (view.suggestion) lines.push(`建议新增：${view.suggestion.proposedLabel}`, `建议定义：${view.suggestion.proposedDefinition}`, `建议上级分类：${view.suggestion.proposedParent ?? "由用户指定"}`);
      if (view.evidence.length) lines.push(`依据：${view.evidence.map((item) => typeof item === "string" ? item : `${item.kind}：${item.clue}`).join("；")}`);
      if (view.alternatives.length) lines.push(`其他可能：${view.alternatives.map((item) => item.label).filter(Boolean).join("；") || "无"}`);
      lines.push(`下一步：${view.userAction}`, "");
    }
    lines.push(result.aggregate === "TAXONOMY_MATCHED" ? "是否基于这份分类结论，继续进入独立的 Harness 适用性判断与进化流程？" : "请按上面的具体建议补充业务分类方案、Source 证据或澄清信息，然后明确要求重新分析。" );
  }
  const canonicalMarkdown = lines.join("\n").trimEnd();
  return { schema: "evopilot-harness-taxonomy-presentation/v1", stage: "CLASSIFICATION_PRESENTATION", sessionId, locale: "zh-CN", canonicalMarkdown, presentationDigest: digest(canonicalMarkdown), soleVisibleBusinessContent: true, hostAuthored: false, authority: { presentationOnly: true, humanDecision: false, provesEligibility: false } };
}

function classificationTerminalPresentation(result, sessionId, status) {
  const cancelled = status === "CANCELLED";
  const lines = [
    cancelled ? "# 项目分类会话已取消" : "# 项目分类会话已关闭",
    "",
    cancelled ? "本次分类流程已停止，未进入 Harness 适用性判断与进化流程。" : "本次分类结论已保留，未进入 Harness 适用性判断与进化流程。"
  ];
  if (result.status !== "ANALYSIS_BLOCKED_ADVISOR") {
    lines.push(
      "",
      `业务领域：${result.presentation.domain.conclusion ?? ordinaryStatus(result.presentation.domain.status)}`,
      `产品或系统类型：${result.presentation.product.conclusion ?? ordinaryStatus(result.presentation.product.status)}`
    );
  }
  lines.push("", "当前没有待确认操作。若要重新分析，请开始新的项目分类会话。");
  const canonicalMarkdown = lines.join("\n");
  return { schema: "evopilot-harness-taxonomy-presentation/v1", stage: "CLASSIFICATION_PRESENTATION", sessionId, locale: "zh-CN", canonicalMarkdown, presentationDigest: digest(canonicalMarkdown), soleVisibleBusinessContent: true, hostAuthored: false, authority: { presentationOnly: true, humanDecision: false, provesEligibility: false } };
}

function ordinaryStatus(status) {
  return ({ TAXONOMY_MATCHED: "现有业务分类方案可以覆盖", TAXONOMY_EXTENSION_SUGGESTED: "现有业务分类方案缺少适合的分类", TAXONOMY_EVIDENCE_INSUFFICIENT: "Source 证据不足，暂时无法判断", TAXONOMY_AMBIGUOUS: "存在多个可能分类，需要进一步澄清", ANALYSIS_BLOCKED_ADVISOR: "分析所需模型暂不可用" })[status] ?? status;
}
