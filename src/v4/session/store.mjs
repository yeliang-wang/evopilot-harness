import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import { PACKAGE_ROOT } from "../../v3/constants.mjs";
import { digest, persistedJson, safeId } from "../../v3/utils.mjs";
import { inspectProposal } from "../../v3/lifecycle.mjs";
import { inspectProposalReview, reviewInputDigest } from "../../v3/review.mjs";
import { readComparisonReport } from "../../v3/comparison.mjs";
import { readCalibrationReport } from "../../v3/calibration.mjs";
import { readLearningArtifact } from "../../v3/learning.mjs";
import { requireWorkspace } from "../../v3/workspace.mjs";
import { engineOperationDefinition, inspectEngineOperationReceipt, invokeEngineOperation, validateEngineOperationRequest } from "../engine-adapter.mjs";
import { AGENT_SESSION_SCHEMA, OPERATION_PLAN_SCHEMA, assertExternalWorkspace, assertOperationCompatibility, assertWorkspaceTreeConfined, operationCompatibility, resolveWorkspacePath } from "../constants.mjs";
import { assertNoSensitiveMaterial } from "../security/sensitive.mjs";
import { createBusinessViewDeliveryReceipt, createInteractionFrame, createPresentationReceipt, requirePresentedFrame } from "../interaction/controller.mjs";
import { compositeDecisionBinding } from "../interaction/business-projection.mjs";
import { createEvolutionContextBinding, createHostConformanceProfile, REQUIRED_GOVERNED_HOST_CAPABILITIES } from "../interaction/professional-reasoning.mjs";
import { createLifecycleFrameManifest } from "../interaction/lifecycle-replay.mjs";

const sessionSchema = JSON.parse(fs.readFileSync(path.join(PACKAGE_ROOT, "schemas/agent-operation-session-v3.schema.json"), "utf8"));
const legacySessionSchema = JSON.parse(fs.readFileSync(path.join(PACKAGE_ROOT, "schemas/agent-operation-session-v2.schema.json"), "utf8"));
const planSchema = JSON.parse(fs.readFileSync(path.join(PACKAGE_ROOT, "schemas/operation-plan-v1.schema.json"), "utf8"));
const ajv = new Ajv2020({ allErrors: true, strict: true });
const validateSessionSchema = ajv.compile(sessionSchema);
const validateLegacySessionSchema = ajv.compile(legacySessionSchema);
const validatePlanSchema = ajv.compile(planSchema);

const TERMINAL = new Set(["COMPLETED", "BLOCKED", "CANCELLED", "CLOSED"]);

export function createAgentSession({ home, intent, adapterId, hostInteraction, compatibility = operationCompatibility(), reevaluation = null, now = new Date().toISOString() }) {
  const workspace = assertExternalWorkspace(home);
  requireWorkspace(workspace);
  assertWorkspaceTreeConfined(workspace);
  const text = String(intent ?? "").trim();
  if (!text) throw sessionError("INTENT_REQUIRED", "A non-empty human intent is required.", "collect-intent");
  assertNoSensitiveMaterial(text, "intent");
  const adapter = safeAdapter(adapterId);
  const compatibilityBinding = assertOperationCompatibility(compatibility);
  const host = normalizeHostInteraction(hostInteraction, adapter);
  const sessionId = safeId(`session-${Date.now().toString(36)}-${randomId()}`);
  const session = {
    schema: AGENT_SESSION_SCHEMA,
    sessionId,
    status: "CREATED",
    createdAt: now,
    updatedAt: now,
    workspace: { home: workspace, mode: "external-read-write" },
    compatibility: compatibilityBinding,
    engine: { apiVersion: "harness.evopilot.io/v3", sourceExecutionAllowed: false, authority: "deterministic-engine" },
    adapter: { current: adapter, history: [adapter] },
    intent: { text, digest: digest(text) },
    reevaluation: reevaluation ? persistedJson(reevaluation) : null,
    evolutionContext: null,
    plan: null,
    planDigest: null,
    humanDecisions: [],
    operations: [],
    inFlightOperation: null,
    operationAuthorizations: [],
    pendingOperationAuthorization: null,
    proposals: [],
    evidenceReports: [],
    interaction: { protocolVersion: compatibilityBinding.agentProtocolVersion, host, currentFrame: null, frameArchive: [], presentationReceipts: [] },
    sequence: 0,
    nextAction: "create-operation-plan"
  };
  return persist(session, { event: "SESSION_CREATED", actor: adapter, details: { intentDigest: session.intent.digest } });
}

export function reevaluateAgentSession({ home, sessionId, expectedSessionDigest, adapterId, intent, scenario, goal, sources, locale, now = new Date().toISOString() }) {
  const prior = inspectAgentSession(home, sessionId);
  if (prior.sessionDigest !== expectedSessionDigest) throw sessionError("SESSION_DIGEST_MISMATCH", "The Session changed before explicit Evolution Context reevaluation.", "reload-session-and-request-reevaluation");
  if (!prior.plan || !prior.evolutionContext) throw sessionError("REEVALUATION_CONTEXT_REQUIRED", "Explicit reevaluation requires a prior planned Session with a bound Evolution Context.", "create-and-review-operation-plan");
  const priorContext = persistedJson(prior.evolutionContext);
  const requestedLocale = locale ?? priorContext.locale;
  const host = {
    id: prior.interaction.host.id,
    version: prior.interaction.host.version,
    level: prior.interaction.host.level,
    capabilities: [...prior.interaction.host.capabilities],
    locale: requestedLocale,
    supportsOperationJobs: prior.interaction.host.supportsOperationJobs,
    maxSynchronousMcpRequestMs: prior.interaction.host.maxSynchronousMcpRequestMs
  };
  const created = createAgentSession({
    home,
    intent: intent ?? prior.intent.text,
    adapterId: adapterId ?? prior.adapter.current,
    hostInteraction: host,
    reevaluation: {
      schema: "evopilot-harness-evolution-context-reevaluation-lineage/v1",
      priorSessionId: prior.sessionId,
      priorSessionDigest: prior.sessionDigest,
      priorEvolutionContextDigest: priorContext.evolutionContextDigest,
      priorSessionPreserved: true,
      requestedAt: now
    },
    now
  });
  const planned = createSessionPlan({
    home,
    sessionId: created.sessionId,
    expectedSessionDigest: created.sessionDigest,
    scenario: scenario ?? prior.plan.scenario,
    goal: goal ?? prior.plan.goal,
    sources: sources ?? prior.plan.sources,
    now
  });
  const contextFields = ["sourceSnapshotDigest", "catalogBinding", "ontologyBinding", "matchPolicyBinding", "advisorPolicyBinding", "advisorProfile", "operationIntentDigest", "locale", "presentationTemplateVersion"];
  const changedFields = contextFields.filter((field) => digest(priorContext[field]) !== digest(planned.evolutionContext[field]));
  const result = {
    schema: "evopilot-harness-evolution-context-reevaluation/v1",
    status: "PLAN_REVIEW_REQUIRED",
    prior: { sessionId: prior.sessionId, sessionDigest: prior.sessionDigest, evolutionContextDigest: priorContext.evolutionContextDigest, preserved: true },
    current: { sessionId: planned.sessionId, sessionDigest: planned.sessionDigest, evolutionContextDigest: planned.evolutionContext.evolutionContextDigest, planDigest: planned.planDigest },
    changedFields,
    authoritativeDifference: {
      changed: priorContext.evolutionContextDigest !== planned.evolutionContext.evolutionContextDigest,
      oldContextDigest: priorContext.evolutionContextDigest,
      newContextDigest: planned.evolutionContext.evolutionContextDigest,
      changedFields
    },
    session: planned,
    authority: { planConfirmed: false, proposalApproved: false, publicationAuthorized: false, priorSessionMutated: false }
  };
  result.reevaluationDigest = digest({ ...result, session: { sessionId: planned.sessionId, sessionDigest: planned.sessionDigest } });
  return result;
}

export function createSessionPlan({ home, sessionId, expectedSessionDigest, scenario = "evolve", goal, sources = {}, operations = [], now = new Date().toISOString() }) {
  const session = loadForMutation(home, sessionId, expectedSessionDigest, ["CREATED", "PLAN_REVIEW_REQUIRED"]);
  const plan = buildPlan({ home: session.workspace.home, scenario, goal: goal ?? session.intent.text, sources, operations, now });
  validatePlan(plan);
  session.plan = plan;
  session.planDigest = digest(plan);
  session.evolutionContext = createEvolutionContextBinding({ session, plan });
  session.operations = [];
  session.inFlightOperation = null;
  session.operationAuthorizations = [];
  session.pendingOperationAuthorization = null;
  session.proposals = [];
  session.evidenceReports = [];
  setCurrentInteractionFrame(session, createInteractionFrame({
    session,
    stage: "PLAN_PRESENTATION",
    subject: { type: "OPERATION_PLAN", id: session.sessionId, digest: session.planDigest, bindings: { sessionDigest: expectedSessionDigest } },
    renderModel: { ...plan, planDigest: session.planDigest },
    decision: { kind: "PLAN_CONFIRMATION", question: "Do you approve this exact Operation Plan?" },
    allowedNextOperations: ["record_business_view_delivery"]
  }));
  session.status = "PLAN_REVIEW_REQUIRED";
  session.nextAction = "present-plan-and-request-explicit-confirmation";
  return persist(session, { event: "PLAN_CREATED", actor: session.adapter.current, details: { planDigest: session.planDigest, scenario } });
}

export function confirmSessionPlan({ home, sessionId, expectedSessionDigest, expectedPlanDigest, confirmedBy, confirmation, now = new Date().toISOString() }) {
  const session = loadForMutation(home, sessionId, expectedSessionDigest, ["PLAN_REVIEW_REQUIRED"]);
  requirePresentedFrame(session, "PLAN_PRESENTATION");
  if (session.planDigest !== expectedPlanDigest) throw sessionError("PLAN_DIGEST_MISMATCH", "The reviewed Operation Plan is stale.", "reload-and-review-operation-plan");
  const expected = `CONFIRM_OPERATION_PLAN:${session.planDigest}`;
  if (confirmation !== expected || !String(confirmedBy ?? "").trim()) {
    throw sessionError("EXPLICIT_PLAN_CONFIRMATION_REQUIRED", `Plan confirmation must equal ${expected} and include confirmedBy.`, "request-explicit-plan-confirmation");
  }
  session.humanDecisions.push(decision("PLAN_CONFIRMED", confirmedBy, confirmation, { planDigest: session.planDigest, compositeDecisionBindingDigest: currentCompositeDecisionBinding(session, "PLAN_PRESENTATION") }, now));
  session.status = "READY_TO_EXECUTE";
  session.nextAction = "execute-confirmed-plan";
  return persist(session, { event: "PLAN_CONFIRMED", actor: confirmedBy, details: { planDigest: session.planDigest } });
}

export async function executeSessionPlan({ home, sessionId, expectedSessionDigest, expectedPlanDigest, retryConfirmation, now = new Date().toISOString() }) {
  const session = loadForMutation(home, sessionId, expectedSessionDigest, ["READY_TO_EXECUTE", "INTERRUPTED"]);
  if (session.planDigest !== expectedPlanDigest) throw sessionError("PLAN_DIGEST_MISMATCH", "The confirmed Operation Plan is stale.", "reload-and-review-operation-plan");
  if (session.status === "INTERRUPTED") {
    if (session.inFlightOperation) {
      throw sessionError("INTERRUPTED_OPERATION_RECONCILIATION_REQUIRED", "The interrupted Engine operation has an unknown outcome and cannot be retried until its receipt or unchanged Workspace state is reconciled.", session.nextAction);
    }
    const expected = `RETRY_INTERRUPTED_PLAN:${session.sessionId}:${session.planDigest}`;
    if (retryConfirmation !== expected) throw sessionError("RETRY_CONFIRMATION_REQUIRED", `Interrupted execution requires ${expected}.`, "request-explicit-retry-confirmation");
  }
  session.status = "RUNNING";
  session.nextAction = "wait-for-engine-results";

  for (let index = nextPlanOperationIndex(session); index < session.plan.operations.length; index += 1) {
    const planned = session.plan.operations[index];
    const definition = engineOperationDefinition(planned.operation);
    const operationDigest = plannedOperationDigest(session.planDigest, index, planned);
    if (definition?.access === "publication" && !hasOperationAuthorization(session, index, operationDigest)) {
      session.pendingOperationAuthorization = { operationIndex: index, operation: planned.operation, operationDigest, inputDigest: digest(planned.input), planDigest: session.planDigest };
      session.status = "OPERATION_AUTHORIZATION_REQUIRED";
      session.nextAction = "present-publication-operation-and-request-explicit-authorization";
      setCurrentInteractionFrame(session, createInteractionFrame({
        session,
        stage: "OPERATION_AUTHORIZATION_PRESENTATION",
        subject: { type: "MAINTENANCE_PUBLICATION_OPERATION", id: `${session.sessionId}:${index}`, digest: operationDigest, bindings: { planDigest: session.planDigest } },
        renderModel: { ...session.pendingOperationAuthorization, impact: "This authorized maintenance operation may publish or mutate governed Harness lifecycle state." },
        decision: { kind: "MAINTENANCE_PUBLICATION_AUTHORIZATION", question: "Do you authorize this exact publication operation?" },
        allowedNextOperations: ["record_business_view_delivery"]
      }));
      return persist(session, { event: "PLAN_PUBLICATION_AUTHORIZATION_REQUIRED", actor: "operation-server", details: session.pendingOperationAuthorization });
    }

    const idempotencyKey = operationIdempotencyKey(session.sessionId, session.planDigest, index, planned);
    const workspaceDigestBefore = workspaceStateDigest(session.workspace.home);
    const attempt = {
      operationIndex: index,
      operation: planned.operation,
      operationDigest,
      inputDigest: digest(planned.input),
      idempotencyKey,
      workspaceDigestBefore,
      status: "RUNNING",
      startedAt: now
    };
    attempt.attemptDigest = digest(attempt);
    session.inFlightOperation = attempt;
    persist(session, { event: "ENGINE_OPERATION_STARTED", actor: "operation-server", details: { operationIndex: index, operation: planned.operation, attemptDigest: attempt.attemptDigest, idempotencyKey } });

    let result;
    try {
      result = await invokeEngineOperation({
        home: session.workspace.home,
        operation: planned.operation,
        input: planned.input,
        authority: definition?.access === "publication" ? "publication" : "planned",
        idempotencyKey
      });
    } catch (error) {
      session.inFlightOperation.status = "OUTCOME_UNKNOWN";
      session.inFlightOperation.interruptedAt = new Date().toISOString();
      session.status = "INTERRUPTED";
      session.blockers = ["engine-operation-outcome-unknown", message(error)];
      session.nextAction = "reconcile-interrupted-operation";
      persist(session, { event: "PLAN_EXECUTION_INTERRUPTED", actor: "operation-server", details: { operation: planned.operation, attemptDigest: attempt.attemptDigest, error: message(error) } });
      throw error;
    }

    const workspaceDigestAfter = workspaceStateDigest(session.workspace.home);
    session.operations.push(operationRecord(planned, result, now, { phase: "plan", planOperationIndex: index, planCompleted: true, attemptDigest: attempt.attemptDigest, idempotencyKey, workspaceDigestBefore, workspaceDigestAfter }));
    session.inFlightOperation = null;
    if (planned.operation === "evidence.produce") await bindProposalReferences(session, result);
    bindEvidenceReport(session, planned.operation, result);
    persist(session, { event: "ENGINE_OPERATION_COMPLETED", actor: "deterministic-engine", details: { operationIndex: index, operation: planned.operation, resultDigest: digest(result), status: result.status, idempotencyKey } });
    if (result.exitCode !== 0 || ["FAILED", "BLOCKED", "NEED_MORE_EVIDENCE"].includes(result.status)) {
      session.status = "BLOCKED";
      session.blockers = result.result?.blockers ?? [result.result?.error ?? `operation-status:${result.status}`];
      session.nextAction = result.nextAction;
      bindBlockerFrame(session, { reasons: result.result?.reasons ?? session.blockers, evidenceRefs: result.result?.evidenceRefs ?? [], now });
      return persist(session, { event: "PLAN_EXECUTION_BLOCKED", actor: "deterministic-engine", details: { operation: planned.operation, nextAction: result.nextAction } });
    }
  }
  if (session.evidenceReports?.some((item) => item.reviewed !== true)) {
    session.status = "EVIDENCE_REVIEW_REQUIRED";
    session.nextAction = nextEvidenceReviewAction(session);
    bindCurrentEvidenceFrame(session, now);
  } else if (session.proposals.length) {
    session.status = "PROPOSAL_REVIEW_REQUIRED";
    session.nextAction = "run-engine-proposal-review";
  } else {
    session.status = "COMPLETED";
    session.nextAction = "close-session";
  }
  return persist(session, { event: "PLAN_EXECUTION_COMPLETED", actor: "deterministic-engine", details: { proposalCount: session.proposals.length } });
}

export function authorizePlanPublicationOperation({ home, sessionId, expectedSessionDigest, expectedPlanDigest, operationIndex, expectedOperationDigest, confirmedBy, confirmation, now = new Date().toISOString() }) {
  const session = loadForMutation(home, sessionId, expectedSessionDigest, ["OPERATION_AUTHORIZATION_REQUIRED"]);
  requirePresentedFrame(session, "OPERATION_AUTHORIZATION_PRESENTATION");
  if (session.planDigest !== expectedPlanDigest) throw sessionError("PLAN_DIGEST_MISMATCH", "The confirmed Operation Plan is stale.", "reload-and-review-operation-plan");
  const pending = session.pendingOperationAuthorization;
  if (!pending || pending.operationIndex !== operationIndex || pending.operationDigest !== expectedOperationDigest || pending.planDigest !== expectedPlanDigest) {
    throw sessionError("PLANNED_OPERATION_DIGEST_MISMATCH", "The publication operation changed after it was presented.", "reload-publication-operation");
  }
  const expected = `AUTHORIZE_PLAN_PUBLICATION:${sessionId}:${expectedPlanDigest}:${operationIndex}:${expectedOperationDigest}`;
  if (confirmation !== expected || !String(confirmedBy ?? "").trim()) {
    throw sessionError("EXPLICIT_OPERATION_PUBLICATION_AUTHORIZATION_REQUIRED", `Publication operation authorization must equal ${expected} and include confirmedBy.`, "request-explicit-publication-operation-authorization");
  }
  const authorization = { operationIndex, operation: pending.operation, operationDigest: expectedOperationDigest, planDigest: expectedPlanDigest, confirmedBy, confirmation, authorizedAt: now };
  authorization.authorizationDigest = digest(authorization);
  session.operationAuthorizations.push(authorization);
  session.pendingOperationAuthorization = null;
  session.humanDecisions.push(decision("PLAN_PUBLICATION_AUTHORIZED", confirmedBy, confirmation, { operationIndex, operationDigest: expectedOperationDigest, planDigest: expectedPlanDigest, authorizationDigest: authorization.authorizationDigest, compositeDecisionBindingDigest: currentCompositeDecisionBinding(session, "OPERATION_AUTHORIZATION_PRESENTATION") }, now));
  session.status = "READY_TO_EXECUTE";
  session.nextAction = "execute-authorized-publication-operation";
  return persist(session, { event: "PLAN_PUBLICATION_AUTHORIZED", actor: confirmedBy, details: { operationIndex, operation: authorization.operation, authorizationDigest: authorization.authorizationDigest } });
}

export async function resolveInterruptedOperation({ home, sessionId, expectedSessionDigest, expectedAttemptDigest, confirmedBy, confirmation, now = new Date().toISOString() }) {
  const session = loadForMutation(home, sessionId, expectedSessionDigest, ["INTERRUPTED"]);
  requirePresentedFrame(session, "RECOVERY_PRESENTATION");
  const attempt = session.inFlightOperation;
  if (!attempt || attempt.attemptDigest !== expectedAttemptDigest) {
    throw sessionError("INTERRUPTED_ATTEMPT_DIGEST_MISMATCH", "The interrupted operation attempt is missing or stale.", "reload-interrupted-session");
  }
  const receipt = inspectEngineOperationReceipt(session.workspace.home, attempt.idempotencyKey);
  if (receipt) {
    if (receipt.operation !== attempt.operation || receipt.inputDigest !== attempt.inputDigest) {
      throw sessionError("INTERRUPTED_OPERATION_RECEIPT_MISMATCH", "The durable Engine receipt is not bound to the interrupted operation input.", "stop-and-inspect-operation-receipt");
    }
    const expected = `ACCEPT_OPERATION_RECEIPT:${sessionId}:${expectedAttemptDigest}:${receipt.receiptDigest}`;
    if (confirmation !== expected || !String(confirmedBy ?? "").trim()) {
      throw sessionError("EXPLICIT_RECEIPT_ACCEPTANCE_REQUIRED", `Recorded operation reconciliation must equal ${expected} and include confirmedBy.`, "request-explicit-operation-receipt-acceptance");
    }
    session.operations.push(operationRecord(session.plan.operations[attempt.operationIndex], receipt.result, now, {
      phase: "plan",
      planOperationIndex: attempt.operationIndex,
      planCompleted: true,
      attemptDigest: attempt.attemptDigest,
      idempotencyKey: attempt.idempotencyKey,
      workspaceDigestBefore: attempt.workspaceDigestBefore,
      workspaceDigestAfter: workspaceStateDigest(session.workspace.home),
      reconciledFromReceipt: true
    }));
    if (attempt.operation === "evidence.produce") await bindProposalReferences(session, receipt.result);
    bindEvidenceReport(session, attempt.operation, receipt.result);
    session.humanDecisions.push(decision("INTERRUPTED_OPERATION_RECEIPT_ACCEPTED", confirmedBy, confirmation, { attemptDigest: expectedAttemptDigest, receiptDigest: receipt.receiptDigest, compositeDecisionBindingDigest: currentCompositeDecisionBinding(session, "RECOVERY_PRESENTATION") }, now));
  } else {
    const currentWorkspaceDigest = workspaceStateDigest(session.workspace.home);
    if (currentWorkspaceDigest !== attempt.workspaceDigestBefore) {
      throw sessionError("INTERRUPTED_OPERATION_OUTCOME_UNCERTAIN", "The Engine Workspace changed without a durable operation receipt. Retrying could duplicate a mutation, so this session must be cancelled or preserved for manual inspection.", "cancel-session-preserve-workspace-and-inspect-engine-artifacts");
    }
    const expected = `CONFIRM_RETRY_UNCHANGED_OPERATION:${sessionId}:${expectedAttemptDigest}:${currentWorkspaceDigest}`;
    if (confirmation !== expected || !String(confirmedBy ?? "").trim()) {
      throw sessionError("EXPLICIT_UNCHANGED_RETRY_REQUIRED", `Safe retry confirmation must equal ${expected} and include confirmedBy.`, "request-explicit-unchanged-operation-retry");
    }
    session.operations.push({
      phase: "plan",
      planOperationIndex: attempt.operationIndex,
      planCompleted: false,
      operation: attempt.operation,
      inputDigest: attempt.inputDigest,
      attemptDigest: attempt.attemptDigest,
      idempotencyKey: attempt.idempotencyKey,
      status: "RETRY_AUTHORIZED_NO_WORKSPACE_EFFECT",
      exitCode: null,
      completedAt: now,
      nextAction: "retry-confirmed-plan-operation"
    });
    session.humanDecisions.push(decision("INTERRUPTED_OPERATION_RETRY_AUTHORIZED", confirmedBy, confirmation, { attemptDigest: expectedAttemptDigest, workspaceDigest: currentWorkspaceDigest, compositeDecisionBindingDigest: currentCompositeDecisionBinding(session, "RECOVERY_PRESENTATION") }, now));
  }
  session.inFlightOperation = null;
  session.blockers = [];
  session.status = "READY_TO_EXECUTE";
  session.nextAction = "execute-confirmed-plan";
  return persist(session, { event: "INTERRUPTED_OPERATION_RECONCILED", actor: confirmedBy, details: { attemptDigest: expectedAttemptDigest, resolution: receipt ? "RECEIPT_ACCEPTED" : "UNCHANGED_RETRY_AUTHORIZED" } });
}

export function authorizeBlockedOperationRetry({ home, sessionId, expectedSessionDigest, expectedFailedResultDigest, expectedWorkspaceDigest, confirmedBy, confirmation, now = new Date().toISOString() }) {
  const session = loadForMutation(home, sessionId, expectedSessionDigest, ["BLOCKED"]);
  const { frame } = requirePresentedFrame(session, "BLOCKED_RETRY_PRESENTATION");
  const failed = session.operations.at(-1);
  if (!failed || failed.operation !== "proposal.review" || failed.status !== "BLOCKED" || failed.resultDigest !== expectedFailedResultDigest) {
    throw sessionError("BLOCKED_OPERATION_DIGEST_MISMATCH", "The blocked Proposal Review result is missing or stale.", "reload-blocked-session");
  }
  if (frame.renderModel.failedResultDigest !== expectedFailedResultDigest || frame.renderModel.workspaceDigest !== expectedWorkspaceDigest) {
    throw sessionError("BLOCKED_RETRY_FRAME_MISMATCH", "The presented blocked retry frame no longer matches the requested retry.", "reload-blocked-retry-frame");
  }
  const currentWorkspaceDigest = workspaceStateDigest(session.workspace.home);
  if (currentWorkspaceDigest !== expectedWorkspaceDigest) {
    throw sessionError("BLOCKED_RETRY_WORKSPACE_CHANGED", "The external Workspace changed after the retry frame was prepared.", "inspect-workspace-and-prepare-new-retry-frame");
  }
  const expected = `AUTHORIZE_BLOCKED_OPERATION_RETRY:${sessionId}:${expectedFailedResultDigest}:${expectedWorkspaceDigest}`;
  if (confirmation !== expected || !String(confirmedBy ?? "").trim()) {
    throw sessionError("EXPLICIT_BLOCKED_RETRY_REQUIRED", `Blocked operation retry authorization must equal ${expected} and include confirmedBy.`, "request-explicit-blocked-operation-retry");
  }
  session.humanDecisions.push(decision("BLOCKED_OPERATION_RETRY_AUTHORIZED", confirmedBy, confirmation, { operation: failed.operation, failedResultDigest: expectedFailedResultDigest, workspaceDigest: expectedWorkspaceDigest, compositeDecisionBindingDigest: currentCompositeDecisionBinding(session, "BLOCKED_RETRY_PRESENTATION") }, now));
  session.status = "PROPOSAL_REVIEW_REQUIRED";
  session.blockers = [];
  session.nextAction = "run-engine-proposal-review";
  return persist(session, { event: "BLOCKED_OPERATION_RETRY_AUTHORIZED", actor: confirmedBy, details: { operation: failed.operation, failedResultDigest: expectedFailedResultDigest, workspaceDigest: expectedWorkspaceDigest } });
}

export function acknowledgeSessionEvidenceReview({ home, sessionId, expectedSessionDigest, reportType, reportId, expectedReportDigest, confirmedBy, confirmation, now = new Date().toISOString() }) {
  const session = loadForMutation(home, sessionId, expectedSessionDigest, ["EVIDENCE_REVIEW_REQUIRED"]);
  requirePresentedFrame(session, "EVIDENCE_REPORT_PRESENTATION");
  const type = String(reportType ?? "").toUpperCase();
  if (!["COMPARISON", "CALIBRATION", "COMPLETENESS"].includes(type)) throw sessionError("EVIDENCE_REPORT_TYPE_REQUIRED", "Report review type must be COMPARISON, CALIBRATION, or COMPLETENESS.", "choose-evidence-report-type");
  const report = session.evidenceReports.find((item) => item.type === type && item.reportId === reportId);
  if (!report) throw sessionError("EVIDENCE_REPORT_NOT_IN_SESSION", `Report ${reportId} is not bound to this Session.`, "reload-session-evidence-reports");
  if (report.reportDigest !== expectedReportDigest) throw sessionError("EVIDENCE_REPORT_DIGEST_MISMATCH", "The presented evidence report digest is stale.", "reload-evidence-report");
  const current = type === "COMPARISON" ? readComparisonReport({ home: session.workspace.home, reportId })
    : type === "CALIBRATION" ? readCalibrationReport({ home: session.workspace.home, reportId })
    : readLearningArtifact({ home: session.workspace.home, area: "report", id: reportId });
  const currentDocument = current.report ?? current.document;
  const currentDigest = currentDocument?.metadata?.reportDigest ?? currentDocument?.metadata?.documentDigest;
  if (current.status !== "FOUND" || currentDigest !== expectedReportDigest) {
    throw sessionError("EVIDENCE_REPORT_INTEGRITY_FAILURE", "The persisted evidence report no longer matches the presented digest.", "stop-and-inspect-evidence-report");
  }
  const expected = `ACKNOWLEDGE_${type}_REVIEW:${reportId}:${expectedReportDigest}`;
  if (confirmation !== expected || !String(confirmedBy ?? "").trim()) {
    throw sessionError("EXPLICIT_EVIDENCE_REVIEW_REQUIRED", `Evidence review acknowledgement must equal ${expected} and include confirmedBy.`, "request-explicit-evidence-review-acknowledgement");
  }
  report.reviewed = true;
  report.reviewedAt = now;
  report.reviewedBy = String(confirmedBy).trim();
  session.humanDecisions.push(decision(`${type}_REPORT_REVIEWED`, confirmedBy, confirmation, { reportId, reportDigest: expectedReportDigest, compositeDecisionBindingDigest: currentCompositeDecisionBinding(session, "EVIDENCE_REPORT_PRESENTATION") }, now));
  if (session.evidenceReports.some((item) => item.reviewed !== true)) {
    session.status = "EVIDENCE_REVIEW_REQUIRED";
    session.nextAction = nextEvidenceReviewAction(session);
    bindCurrentEvidenceFrame(session, now);
  } else if (session.proposals.length) {
    session.status = "PROPOSAL_REVIEW_REQUIRED";
    session.nextAction = "run-engine-proposal-review";
  } else {
    session.status = "COMPLETED";
    session.nextAction = "close-session";
  }
  return persist(session, { event: `${type}_REPORT_REVIEWED`, actor: confirmedBy, details: { reportId, reportDigest: expectedReportDigest } });
}

export function acknowledgeInteractionFramePresentation({ home, sessionId, expectedSessionDigest, expectedFrameDigest, presentedFields, visibleTranscriptDigest, confirmedBy, confirmation, now = new Date().toISOString() }) {
  const session = loadForMutation(home, sessionId, expectedSessionDigest);
  const frame = session.interaction?.currentFrame;
  if (!frame || frame.frameDigest !== expectedFrameDigest) throw sessionError("INTERACTION_FRAME_DIGEST_MISMATCH", "The visible Interaction Frame is missing or stale.", "reload-current-interaction-frame");
  const expected = `ACKNOWLEDGE_INTERACTION_FRAME:${frame.frameId}:${frame.frameDigest}`;
  if (confirmation !== expected || !String(confirmedBy ?? "").trim()) throw sessionError("EXPLICIT_INTERACTION_PRESENTATION_ACKNOWLEDGEMENT_REQUIRED", `Interaction acknowledgement must equal ${expected} and include confirmedBy.`, "request-exact-interaction-frame-acknowledgement");
  const receipt = createPresentationReceipt({ frame, host: session.interaction.host, presentedFields, visibleTranscriptDigest, now });
  session.interaction.presentationReceipts.push(receipt);
  session.humanDecisions.push(decision("INTERACTION_FRAME_PRESENTED", confirmedBy, confirmation, { frameId: frame.frameId, frameDigest: frame.frameDigest, receiptDigest: receipt.receiptDigest, stage: frame.stage }, now));
  if (frame.stage === "PROPOSAL_REVIEW_PRESENTATION") {
    session.status = "HUMAN_APPROVAL_REQUIRED";
    session.nextAction = "request-explicit-proposal-approval";
  } else if (frame.stage === "PUBLICATION_PRESENTATION") {
    session.status = "PUBLICATION_DECISION_REQUIRED";
    session.nextAction = "request-separate-publication-authorization";
  }
  return persist(session, { event: "INTERACTION_FRAME_PRESENTED", actor: confirmedBy, details: { frameId: frame.frameId, frameDigest: frame.frameDigest, receiptDigest: receipt.receiptDigest, stage: frame.stage } });
}

export function recordBusinessViewDelivery({ home, sessionId, expectedSessionDigest, expectedFrameDigest, deliveredBusinessViewDigest, renderedBusinessViewDigest, now = new Date().toISOString() }) {
  const session = loadForMutation(home, sessionId, expectedSessionDigest);
  const frame = session.interaction?.currentFrame;
  if (!frame || frame.frameDigest !== expectedFrameDigest) throw sessionError("INTERACTION_FRAME_DIGEST_MISMATCH", "The Business Decision View frame is missing or stale.", "reload-current-business-decision-view");
  const receipt = createBusinessViewDeliveryReceipt({ session, frame, host: session.interaction.host, deliveredBusinessViewDigest, renderedBusinessViewDigest, now });
  const existing = session.interaction.presentationReceipts.find((item) =>
    item.frameDigest === frame.frameDigest
    && item.businessViewDigest === receipt.businessViewDigest
    && item.canonicalMarkdownDigest === receipt.canonicalMarkdownDigest
    && item.renderedBusinessViewDigest === receipt.renderedBusinessViewDigest
    && item.host?.id === receipt.host?.id
    && item.host?.version === receipt.host?.version
    && item.hostConformanceDigest === receipt.hostConformanceDigest
    && item.wholeTurnDelivered === true
    && item.automatic === true
  );
  if (existing) return session;
  session.interaction.presentationReceipts = session.interaction.presentationReceipts.filter((item) => item.frameDigest !== frame.frameDigest);
  session.interaction.presentationReceipts.push(receipt);
  if (frame.stage === "PLAN_PRESENTATION") session.nextAction = "request-explicit-plan-business-decision";
  else if (frame.stage === "PROPOSAL_REVIEW_PRESENTATION") { session.status = "HUMAN_APPROVAL_REQUIRED"; session.nextAction = "request-explicit-proposal-business-decision"; }
  else if (frame.stage === "PUBLICATION_PRESENTATION") { session.status = "PUBLICATION_DECISION_REQUIRED"; session.nextAction = "request-explicit-publication-business-decision"; }
  else if (frame.stage === "BLOCKER_PRESENTATION") session.nextAction = frame.renderModel.nextAction;
  else session.nextAction = frame.decisionDefinition ? "request-declared-business-decision" : session.nextAction;
  return persist(session, { event: "BUSINESS_VIEW_DELIVERED", actor: "interaction-controller", details: { frameId: frame.frameId, frameDigest: frame.frameDigest, businessViewDigest: frame.businessView.businessViewDigest, auditEnvelopeDigest: frame.auditEnvelope.auditEnvelopeDigest, receiptDigest: receipt.receiptDigest, automatic: true } });
}

export async function reviewSessionProposals({ home, sessionId, expectedSessionDigest, modelsFile, model, advisorTimeoutMs, reviewTimeoutMs, operationJobId, now = new Date().toISOString() }) {
  const session = loadForMutation(home, sessionId, expectedSessionDigest, ["PROPOSAL_REVIEW_REQUIRED"]);
  const synchronousWindow = Number(session.interaction?.host?.maxSynchronousMcpRequestMs);
  const workBuddyHost = /workbuddy|codebuddy/i.test(session.interaction?.host?.id ?? session.adapter?.current ?? "");
  const exceedsDeclaredWindow = Number.isFinite(synchronousWindow) && synchronousWindow > 0 && Number(reviewTimeoutMs ?? 180000) >= synchronousWindow;
  if ((workBuddyHost || exceedsDeclaredWindow) && !operationJobId) {
    throw sessionError("ASYNC_OPERATION_JOB_REQUIRED", "This Host cannot safely sustain the Proposal Review synchronous window; use the Engine-owned OperationJob path.", "start-proposal-review-operation-job");
  }
  for (const reference of session.proposals) {
    const result = await invokeEngineOperation({
      home: session.workspace.home,
      operation: "proposal.review",
      input: compact({ proposalId: reference.proposalId, modelsFile, model, advisorTimeoutMs, reviewTimeoutMs }),
      authority: "session"
    });
    reference.review = result.result ? persistedJson(result.result) : null;
    if (reference.review?.proposalDigest) reference.proposalDigest = reference.review.proposalDigest;
    session.operations.push(operationRecord({ operation: "proposal.review", input: compact({ proposalId: reference.proposalId, operationJobId }) }, result, now));
    persist(session, { event: "PROPOSAL_REVIEW_COMPLETED", actor: "deterministic-engine", details: { proposalId: reference.proposalId, reportDigest: reference.review?.reportDigest, verdict: reference.review?.verdict } });
  }
  const ready = session.proposals.every((item) => item.review?.status === "REVIEWED" && item.review?.verdict === "READY_FOR_HUMAN_APPROVAL");
  const noChange = session.proposals.every((item) => item.decision === "NO_CHANGE");
  const needMoreEvidence = session.proposals.some((item) => item.decision === "NEED_MORE_EVIDENCE");
  session.status = noChange ? "COMPLETED" : needMoreEvidence ? "BLOCKED" : ready ? "PROPOSAL_REVIEW_PRESENTATION_REQUIRED" : "BLOCKED";
  session.nextAction = noChange ? "close-session" : needMoreEvidence ? "collect-more-evidence" : ready ? "present-complete-engine-review" : firstReviewNextAction(session.proposals);
  if (!ready) session.blockers = session.proposals.flatMap((item) => item.review?.verdict === "READY_FOR_HUMAN_APPROVAL" ? [] : [`proposal-review:${item.proposalId}:${item.review?.verdict ?? "unavailable"}`]);
  if (ready) bindProposalReviewFrame(session, session.proposals[0], now);
  else if (session.status === "BLOCKED") bindBlockerFrame(session, { reasons: session.proposals.map((item) => item.review?.summary ?? item.review?.verdict ?? item.decision), evidenceRefs: session.proposals.flatMap((item) => item.review?.evidenceRefs ?? []), now });
  return persist(session, { event: ready ? "PROPOSAL_REVIEW_PRESENTATION_REQUIRED" : "PROPOSAL_REVIEW_BLOCKED", actor: "deterministic-engine", details: { proposalCount: session.proposals.length } });
}

export async function approveSessionProposal({ home, sessionId, proposalId, expectedSessionDigest, expectedProposalDigest, expectedReviewDigest, confirmedBy, confirmation, evaluationReviewed, now = new Date().toISOString() }) {
  const session = loadForMutation(home, sessionId, expectedSessionDigest, ["HUMAN_APPROVAL_REQUIRED"]);
  requirePresentedFrame(session, "PROPOSAL_APPROVAL_DECISION");
  const reference = requireProposalReference(session, proposalId);
  const current = inspectProposal(session.workspace.home, proposalId);
  const review = inspectProposalReview(session.workspace.home, proposalId);
  const currentProposalDigest = reviewInputDigest(current);
  if (reference.proposalDigest !== expectedProposalDigest || currentProposalDigest !== expectedProposalDigest) throw sessionError("PROPOSAL_DIGEST_MISMATCH", "The Proposal changed after review.", "reload-proposal-and-review");
  if (reference.review?.reportDigest !== expectedReviewDigest || review.reportDigest !== expectedReviewDigest) throw sessionError("REVIEW_DIGEST_MISMATCH", "The Proposal Review changed after presentation.", "reload-proposal-review");
  const expected = `APPROVE_PROPOSAL:${proposalId}:${expectedProposalDigest}:${expectedReviewDigest}`;
  if (confirmation !== expected || !String(confirmedBy ?? "").trim() || evaluationReviewed !== true) {
    throw sessionError("EXPLICIT_PROPOSAL_APPROVAL_REQUIRED", `Proposal approval must equal ${expected}, include confirmedBy, and confirm Evaluation review.`, "request-explicit-proposal-approval");
  }
  const result = await invokeEngineOperation({
    home: session.workspace.home,
    operation: "proposal.approve",
    input: { proposalId, confirmedBy, confirmation, evaluationReviewed: true },
    authority: "session"
  });
  session.operations.push(operationRecord({ operation: "proposal.approve", input: { proposalId } }, result, now));
  if (result.status !== "APPROVED") {
    session.status = "BLOCKED";
    session.blockers = result.result?.blockers ?? ["proposal-approval-blocked"];
    session.nextAction = result.nextAction;
    return persist(session, { event: "PROPOSAL_APPROVAL_BLOCKED", actor: "deterministic-engine", details: { proposalId, resultDigest: digest(result) } });
  }
  const approved = inspectProposal(session.workspace.home, proposalId);
  reference.status = "APPROVED";
  reference.approvedProposalDigest = digest(approved);
  reference.approval = result.result.approval;
  session.humanDecisions.push(decision("PROPOSAL_APPROVED", confirmedBy, confirmation, { proposalId, proposalDigest: expectedProposalDigest, reviewDigest: expectedReviewDigest, compositeDecisionBindingDigest: currentCompositeDecisionBinding(session, "PROPOSAL_APPROVAL_DECISION") }, now));
  const allApproved = session.proposals.every((item) => item.status === "APPROVED");
  session.status = allApproved ? "PUBLICATION_PRESENTATION_REQUIRED" : "PROPOSAL_REVIEW_PRESENTATION_REQUIRED";
  session.nextAction = allApproved ? "present-publication-impact" : "present-next-proposal-review";
  if (allApproved) bindPublicationFrame(session, reference, approved, now);
  else bindProposalReviewFrame(session, session.proposals.find((item) => item.status !== "APPROVED"), now);
  return persist(session, { event: "PROPOSAL_APPROVED", actor: confirmedBy, details: { proposalId, approvedProposalDigest: reference.approvedProposalDigest } });
}

export async function submitSessionBusinessDecision({ home, sessionId, decisionHandle, choice, decidedBy, now = new Date().toISOString() }) {
  if (!sessionId) {
    const matches = listAgentSessions(home).flatMap((summary) => {
      try {
        const candidate = inspectAgentSession(home, summary.sessionId);
        return candidate.interaction?.currentFrame?.decisionDefinition?.decisionHandle === decisionHandle ? [candidate.sessionId] : [];
      } catch {
        return [];
      }
    });
    if (matches.length !== 1) throw sessionError("BUSINESS_DECISION_SESSION_UNRESOLVED", "The supplied business decision handle does not resolve to exactly one current Session.", "reload-current-business-decision-view");
    [sessionId] = matches;
  }
  const current = inspectAgentSession(home, sessionId);
  const frame = current.interaction?.currentFrame;
  const definition = frame?.decisionDefinition;
  if (!frame || !definition) throw sessionError("BUSINESS_DECISION_NOT_AVAILABLE", "The current Session has no Engine-declared business decision.", "reload-current-business-decision-view");
  requirePresentedFrame(current, frame.stage);
  if (definition.decisionHandle !== decisionHandle) throw sessionError("BUSINESS_DECISION_HANDLE_MISMATCH", "The supplied business decision handle is stale or belongs to another immutable view.", "reload-current-business-decision-view");
  if (!definition.options.includes(choice)) throw sessionError("BUSINESS_DECISION_CHOICE_INVALID", `Choice ${choice} is not declared for the current business decision.`, "choose-one-current-engine-declared-option");
  const actor = String(decidedBy ?? "").trim();
  if (!actor) throw sessionError("BUSINESS_DECISION_ACTOR_REQUIRED", "A human decision actor is required.", "identify-current-human-decision-maker");

  if (choice === "PRESERVE_FOR_LATER") return businessDecisionProgress(current, choice, "preserve-current-session");

  if (frame.stage === "PLAN_PRESENTATION" && choice === "APPROVE") {
    const confirmed = confirmSessionPlan({
      home,
      sessionId,
      expectedSessionDigest: current.sessionDigest,
      expectedPlanDigest: current.planDigest,
      confirmedBy: actor,
      confirmation: `CONFIRM_OPERATION_PLAN:${current.planDigest}`,
      now
    });
    return businessDecisionProgress(confirmed, choice, "advance-confirmed-session-operation");
  }

  if (frame.stage === "PROPOSAL_REVIEW_PRESENTATION" && choice === "CONTINUE_TO_PROPOSAL_DECISION") {
    return prepareProposalApprovalDecision({ home, sessionId, expectedSessionDigest: current.sessionDigest, confirmedBy: actor, now });
  }

  if (frame.stage === "PROPOSAL_APPROVAL_DECISION" && choice === "APPROVE") {
    const reference = current.proposals.find((item) => item.status !== "APPROVED") ?? current.proposals[0];
    if (!reference?.proposalId || !reference?.proposalDigest || !reference?.review?.reportDigest) throw sessionError("PROPOSAL_DECISION_BINDING_INCOMPLETE", "The current Proposal decision is missing immutable Proposal or Review bindings.", "reload-current-proposal-decision");
    return approveSessionProposal({
      home,
      sessionId,
      proposalId: reference.proposalId,
      expectedSessionDigest: current.sessionDigest,
      expectedProposalDigest: reference.proposalDigest,
      expectedReviewDigest: reference.review.reportDigest,
      confirmedBy: actor,
      confirmation: `APPROVE_PROPOSAL:${reference.proposalId}:${reference.proposalDigest}:${reference.review.reportDigest}`,
      evaluationReviewed: true,
      now
    });
  }

  if (frame.stage === "PUBLICATION_PRESENTATION" && choice === "PUBLISH") {
    const reference = current.proposals.find((item) => !item.publicationAuthorization) ?? current.proposals[0];
    if (!reference?.proposalId || !reference?.approvedProposalDigest) throw sessionError("PUBLICATION_DECISION_BINDING_INCOMPLETE", "The current publication decision is missing the approved Proposal binding.", "reload-current-publication-decision");
    const authorized = authorizeSessionPublication({
      home,
      sessionId,
      proposalId: reference.proposalId,
      expectedSessionDigest: current.sessionDigest,
      expectedProposalDigest: reference.approvedProposalDigest,
      confirmedBy: actor,
      confirmation: `AUTHORIZE_PUBLICATION:${reference.proposalId}:${reference.approvedProposalDigest}`,
      now
    });
    return businessDecisionProgress(authorized, choice, "advance-authorized-session-operation");
  }

  if (frame.stage === "CLOSE_PRESENTATION" && choice === "CLOSE") {
    const closed = closeAgentSession({ home, sessionId, expectedSessionDigest: current.sessionDigest, confirmedBy: actor, confirmation: `CLOSE_SESSION:${sessionId}:${current.sessionDigest}`, now });
    return businessDecisionProgress(closed, choice, "session-closed");
  }

  throw sessionError("BUSINESS_DECISION_CHOICE_UNSUPPORTED", `Choice ${choice} cannot advance ${frame.stage} through the deterministic decision transport.`, "choose-a-supported-current-business-option");
}

export function prepareProposalApprovalDecision({ home, sessionId, expectedSessionDigest, confirmedBy, now = new Date().toISOString() }) {
  const session = loadForMutation(home, sessionId, expectedSessionDigest, ["HUMAN_APPROVAL_REQUIRED"]);
  requirePresentedFrame(session, "PROPOSAL_REVIEW_PRESENTATION");
  const reference = session.proposals.find((item) => item.status !== "APPROVED") ?? session.proposals[0];
  if (!reference?.proposalId || !reference?.proposalDigest || !reference?.review?.reportDigest) throw sessionError("PROPOSAL_REVIEW_BINDING_INCOMPLETE", "The reviewed Proposal is missing immutable Proposal or Review bindings.", "reload-current-proposal-review");
  const reviewBinding = currentCompositeDecisionBinding(session, "PROPOSAL_REVIEW_PRESENTATION");
  session.humanDecisions.push(decision("PROPOSAL_REVIEW_COMPLETED", confirmedBy, `CONTINUE_TO_PROPOSAL_DECISION:${reference.proposalId}:${reference.review.reportDigest}`, { proposalId: reference.proposalId, proposalDigest: reference.proposalDigest, reviewDigest: reference.review.reportDigest, compositeDecisionBindingDigest: reviewBinding }, now));
  setCurrentInteractionFrame(session, createInteractionFrame({
    session,
    stage: "PROPOSAL_APPROVAL_DECISION",
    subject: { type: "PROPOSAL_APPROVAL", id: reference.proposalId, digest: reference.proposalDigest, bindings: { reviewDigest: reference.review.reportDigest } },
    renderModel: { proposalId: reference.proposalId, proposalDigest: reference.proposalDigest, reviewDigest: reference.review.reportDigest, evaluationReviewed: true, question: "Do you approve this exact reviewed Harness Proposal?" },
    decision: { kind: "PROPOSAL_APPROVAL", question: "Do you approve this exact reviewed Harness Proposal?" },
    allowedNextOperations: ["record_business_view_delivery"],
    now
  }));
  session.status = "HUMAN_APPROVAL_REQUIRED";
  session.nextAction = "present-proposal-approval-decision";
  return persist(session, { event: "PROPOSAL_REVIEW_COMPLETED", actor: confirmedBy, details: { proposalId: reference.proposalId, proposalDigest: reference.proposalDigest, reviewDigest: reference.review.reportDigest } });
}

export function authorizeSessionPublication({ home, sessionId, proposalId, expectedSessionDigest, expectedProposalDigest, confirmedBy, confirmation, now = new Date().toISOString() }) {
  const session = loadForMutation(home, sessionId, expectedSessionDigest, ["PUBLICATION_DECISION_REQUIRED", "PUBLICATION_AUTHORIZED"]);
  requirePresentedFrame(session, "PUBLICATION_PRESENTATION");
  const reference = requireProposalReference(session, proposalId);
  const currentDigest = digest(inspectProposal(session.workspace.home, proposalId));
  if (reference.status !== "APPROVED" || reference.approvedProposalDigest !== expectedProposalDigest || currentDigest !== expectedProposalDigest) {
    throw sessionError("APPROVED_PROPOSAL_DIGEST_MISMATCH", "The approved Proposal is stale or no longer approved.", "reload-approved-proposal");
  }
  const expected = `AUTHORIZE_PUBLICATION:${proposalId}:${expectedProposalDigest}`;
  if (confirmation !== expected || !String(confirmedBy ?? "").trim()) {
    throw sessionError("EXPLICIT_PUBLICATION_AUTHORIZATION_REQUIRED", `Publication authorization must equal ${expected} and include confirmedBy.`, "request-separate-publication-authorization");
  }
  const authorization = { proposalId, proposalDigest: expectedProposalDigest, confirmedBy, confirmation, authorizedAt: now };
  authorization.authorizationDigest = digest(authorization);
  reference.publicationAuthorization = authorization;
  session.humanDecisions.push(decision("PUBLICATION_AUTHORIZED", confirmedBy, confirmation, { proposalId, proposalDigest: expectedProposalDigest, authorizationDigest: authorization.authorizationDigest, compositeDecisionBindingDigest: currentCompositeDecisionBinding(session, "PUBLICATION_PRESENTATION") }, now));
  session.status = session.proposals.every((item) => item.publicationAuthorization) ? "PUBLICATION_AUTHORIZED" : "PUBLICATION_DECISION_REQUIRED";
  session.nextAction = session.status === "PUBLICATION_AUTHORIZED" ? "publish-authorized-proposals" : "request-next-publication-authorization";
  return persist(session, { event: "PUBLICATION_AUTHORIZED", actor: confirmedBy, details: { proposalId, authorizationDigest: authorization.authorizationDigest } });
}

export async function publishSessionProposal({ home, sessionId, proposalId, expectedSessionDigest, expectedAuthorizationDigest, now = new Date().toISOString() }) {
  const session = loadForMutation(home, sessionId, expectedSessionDigest, ["PUBLICATION_AUTHORIZED"]);
  const reference = requireProposalReference(session, proposalId);
  if (reference.publicationAuthorization?.authorizationDigest !== expectedAuthorizationDigest) {
    throw sessionError("PUBLICATION_AUTHORIZATION_DIGEST_MISMATCH", "Publication authorization is missing or stale.", "reload-publication-authorization");
  }
  const currentDigest = digest(inspectProposal(session.workspace.home, proposalId));
  if (currentDigest !== reference.publicationAuthorization.proposalDigest) throw sessionError("APPROVED_PROPOSAL_DIGEST_MISMATCH", "The approved Proposal changed after publication authorization.", "repeat-publication-review");
  const result = await invokeEngineOperation({ home: session.workspace.home, operation: "proposal.publish", input: { proposalId }, authority: "session" });
  session.operations.push(operationRecord({ operation: "proposal.publish", input: { proposalId } }, result, now));
  if (result.status !== "PUBLISHED") {
    session.status = "BLOCKED";
    session.blockers = result.result?.blockers ?? ["proposal-publication-blocked"];
    session.nextAction = result.nextAction;
    bindBlockerFrame(session, { reasons: result.result?.reasons ?? session.blockers, evidenceRefs: result.result?.evidenceRefs ?? [], now });
    return persist(session, { event: "PROPOSAL_PUBLICATION_BLOCKED", actor: "deterministic-engine", details: { proposalId, resultDigest: digest(result) } });
  }
  const catalog = await invokeEngineOperation({ home: session.workspace.home, operation: "catalog.validate", input: {}, authority: "direct" });
  reference.status = "PUBLISHED";
  reference.publication = { resultDigest: digest(result), catalogStatus: catalog.status, catalogDigest: catalog.result?.catalogDigest, publishedAt: now };
  session.operations.push(operationRecord({ operation: "catalog.validate", input: {} }, catalog, now));
  const catalogValid = catalog.status === "VALIDATED";
  const complete = session.proposals.every((item) => item.status === "PUBLISHED") && catalogValid;
  if (!catalogValid) {
    session.status = "BLOCKED";
    session.nextAction = "repair-catalog-validation";
    session.blockers = ["catalog-validation-failed"];
    bindBlockerFrame(session, { reasons: [catalog.result?.error ?? "Catalog validation failed after publication."], evidenceRefs: [], now });
  } else if (complete) {
    session.status = "COMPLETED";
    session.nextAction = "close-session";
    session.blockers = [];
    bindCatalogValidationFrame(session, reference, now);
  } else {
    session.status = "PUBLICATION_AUTHORIZED";
    session.nextAction = "publish-next-authorized-proposal";
    session.blockers = [];
  }
  const event = !catalogValid ? "CATALOG_VALIDATION_BLOCKED" : complete ? "PUBLICATION_COMPLETED" : "PROPOSAL_PUBLISHED_CONTINUE";
  return persist(session, { event, actor: "deterministic-engine", details: { proposalId, catalogStatus: catalog.status, remainingProposalCount: session.proposals.filter((item) => item.status !== "PUBLISHED").length } });
}

export function resumeAgentSession({ home, sessionId, expectedSessionDigest, adapterId, compatibility = operationCompatibility(), now = new Date().toISOString() }) {
  const session = loadForMutation(home, sessionId, expectedSessionDigest);
  if (session.status === "CLOSED") throw sessionError("SESSION_CLOSED", "A closed session cannot be resumed.", "start-new-session");
  const compatibilityBinding = assertOperationCompatibility(compatibility);
  if (!session.compatibility || digest(session.compatibility) !== digest(compatibilityBinding)) {
    throw sessionError("SESSION_COMPATIBILITY_BINDING_MISMATCH", "The Session is not bound to the current Product, Digital Expert Core, Agent protocol, and Engine API.", "start-compatible-session-or-use-matching-release");
  }
  const adapter = safeAdapter(adapterId);
  session.adapter.current = adapter;
  if (!session.adapter.history.includes(adapter)) session.adapter.history.push(adapter);
  if (session.status === "RUNNING") {
    markInterruptedOutcome(session, "previous-operation-server-interrupted");
  }
  return persist(session, { event: "SESSION_RESUMED", actor: adapter, details: { priorStatus: session.status } });
}

export function migrateOperationSessionToV3({ home, sessionId, expectedSessionDigest, adapterId, hostInteraction, compatibility = operationCompatibility(), now = new Date().toISOString() }) {
  const session = inspectAgentSession(home, sessionId);
  if (session.sessionDigest !== expectedSessionDigest) throw sessionError("SESSION_DIGEST_MISMATCH", "Agent Operation Session changed since the caller last read it.", "reload-session");
  if (session.schema === AGENT_SESSION_SCHEMA) return session;
  if (session.schema !== "evopilot-harness-agent-operation-session/v2") throw sessionError("SESSION_MIGRATION_UNSUPPORTED", `Session schema ${session.schema} cannot be migrated by the v2-to-v3 migration.`, "inspect-session");
  if (session.status === "RUNNING") throw sessionError("SESSION_MIGRATION_RUNNING_FORBIDDEN", "A running v2 Session must first be diagnosed and safely interrupted before migration.", "diagnose-or-cancel-v2-session");
  const priorInteraction = persistedJson(session.interaction);
  const priorCompatibility = persistedJson(session.compatibility);
  const adapter = safeAdapter(adapterId);
  session.schema = AGENT_SESSION_SCHEMA;
  session.reevaluation = null;
  session.evolutionContext = null;
  session.compatibility = assertOperationCompatibility(compatibility);
  session.adapter.current = adapter;
  if (!session.adapter.history.includes(adapter)) session.adapter.history.push(adapter);
  session.interaction = {
    protocolVersion: session.compatibility.agentProtocolVersion,
    host: normalizeHostInteraction(hostInteraction, adapter),
    currentFrame: null,
    frameArchive: [],
    presentationReceipts: []
  };
  session.migrationHistory = [...(session.migrationHistory ?? []), {
    schema: "evopilot-harness-agent-session-migration-record/v1",
    fromSchema: "evopilot-harness-agent-operation-session/v2",
    toSchema: AGENT_SESSION_SCHEMA,
    priorSessionDigest: expectedSessionDigest,
    priorCompatibility,
    preservedLegacyInteractionEvidenceDigest: digest(priorInteraction),
    historicalBusinessViewsFabricated: false,
    historicalPresentationReceiptsFabricated: false,
    migratedAt: now
  }];
  session.nextAction = "prepare-current-v3-business-interaction-from-authoritative-session-state";
  return persist(session, { event: "SESSION_MIGRATED_V2_TO_V3", actor: adapter, details: { priorSessionDigest: expectedSessionDigest, legacyInteractionEvidenceDigest: digest(priorInteraction), fabricatedEvidence: false } });
}

export function migrateOperationSessionCoreCompatibility({ home, sessionId, expectedSessionDigest, expectedPriorCoreDigest, adapterId, compatibility = operationCompatibility(), now = new Date().toISOString() }) {
  const session = inspectAgentSession(home, sessionId);
  if (session.sessionDigest !== expectedSessionDigest) throw sessionError("SESSION_DIGEST_MISMATCH", "Agent Operation Session changed since the caller last read it.", "reload-session");
  if (session.schema !== AGENT_SESSION_SCHEMA) throw sessionError("SESSION_CORE_MIGRATION_SCHEMA_UNSUPPORTED", "Core compatibility migration requires a Protocol v3 Session.", "migrate-operation-session-to-v3-first");
  if (session.status === "RUNNING") throw sessionError("SESSION_CORE_MIGRATION_RUNNING_FORBIDDEN", "A running Session cannot change its Core compatibility binding.", "diagnose-running-operation-first");
  if (session.compatibility?.coreDigest !== expectedPriorCoreDigest) throw sessionError("SESSION_PRIOR_CORE_DIGEST_MISMATCH", "The supplied prior Core digest does not match the persisted Session binding.", "reload-session");
  const nextCompatibility = assertOperationCompatibility(compatibility);
  const stableFields = ["productVersion", "expertVersion", "agentProtocolVersion", "engineApiVersion"];
  const changed = stableFields.filter((field) => session.compatibility?.[field] !== nextCompatibility[field]);
  if (changed.length > 0) throw sessionError("SESSION_CORE_MIGRATION_BOUNDARY_CHANGE", `Core migration cannot change ${changed.join(", ")}.`, "start-compatible-session-or-use-formal-protocol-migration");
  const adapter = safeAdapter(adapterId);
  const priorCompatibility = persistedJson(session.compatibility);
  session.compatibility = nextCompatibility;
  session.adapter.current = adapter;
  if (!session.adapter.history.includes(adapter)) session.adapter.history.push(adapter);
  session.migrationHistory = [...(session.migrationHistory ?? []), {
    schema: "evopilot-harness-agent-core-compatibility-migration/v1",
    priorSessionDigest: expectedSessionDigest,
    priorCompatibility,
    nextCompatibility: persistedJson(nextCompatibility),
    authorityChanged: false,
    businessStateChanged: false,
    migratedAt: now
  }];
  return persist(session, { event: "SESSION_CORE_COMPATIBILITY_MIGRATED", actor: adapter, details: { priorCoreDigest: expectedPriorCoreDigest, nextCoreDigest: nextCompatibility.coreDigest, authorityChanged: false, businessStateChanged: false } });
}

export function prepareSessionLifecycleInteraction({ home, sessionId, expectedSessionDigest, action, now = new Date().toISOString() }) {
  const session = loadForMutation(home, sessionId, expectedSessionDigest);
  const normalized = String(action ?? "").toUpperCase();
  const configuration = {
    RECOVERY: {
      statuses: ["INTERRUPTED"],
      stage: "RECOVERY_PRESENTATION",
      subjectType: "INTERRUPTED_OPERATION",
      renderModel: () => ({
        sessionId,
        attempt: session.inFlightOperation ?? { status: "MISSING" },
        receipt: session.inFlightOperation ? (inspectEngineOperationReceipt(session.workspace.home, session.inFlightOperation.idempotencyKey) ?? { status: "NOT_FOUND" }) : { status: "NOT_FOUND" },
        workspaceDigest: workspaceStateDigest(session.workspace.home),
        risk: "Accept only a matching durable receipt, or retry only when the Workspace digest is unchanged.",
        nextAction: session.nextAction
      })
    },
    BLOCKED_RETRY: {
      statuses: ["BLOCKED"],
      stage: "BLOCKED_RETRY_PRESENTATION",
      subjectType: "BLOCKED_ENGINE_OPERATION",
      beforePrepare: () => {
        requirePresentedFrame(session, "BLOCKER_PRESENTATION");
        const failed = session.operations.at(-1);
        if (!failed || failed.operation !== "proposal.review" || failed.status !== "BLOCKED" || session.nextAction !== "repair-reviewer-and-rerun") {
          throw sessionError("BLOCKED_OPERATION_NOT_RETRYABLE", "The current blocker is not an explicitly repairable Proposal Review failure.", "inspect-session-and-preserve-blocker");
        }
      },
      renderModel: () => {
        const failed = session.operations.at(-1);
        return {
          sessionId,
          blockedOperation: failed.operation,
          failedResultDigest: failed.resultDigest,
          workspaceDigest: workspaceStateDigest(session.workspace.home),
          risk: "Retry reruns only Proposal Review. It does not approve a Proposal, publish, close, clean up, or change Evidence Sources.",
          nextAction: "request-explicit-blocked-operation-retry"
        };
      }
    },
    CANCEL: {
      statuses: [...new Set(["CREATED", "PLAN_REVIEW_REQUIRED", "READY_TO_EXECUTE", "RUNNING", "INTERRUPTED", "OPERATION_AUTHORIZATION_REQUIRED", "EVIDENCE_REVIEW_REQUIRED", "PROPOSAL_REVIEW_REQUIRED", "PROPOSAL_REVIEW_PRESENTATION_REQUIRED", "HUMAN_APPROVAL_REQUIRED", "PUBLICATION_PRESENTATION_REQUIRED", "PUBLICATION_DECISION_REQUIRED", "PUBLICATION_AUTHORIZED"])],
      stage: "CANCELLATION_PRESENTATION",
      subjectType: "AGENT_OPERATION_SESSION",
      renderModel: () => ({ sessionId, sessionDigest: expectedSessionDigest, preserved: ["Session audit state", "Harness assets", "Evidence Sources", "model configuration"], effect: "Stops this non-terminal Session without deleting owned state or published assets.", question: "Do you want to cancel this exact Session?" })
    },
    CLOSE: {
      statuses: ["COMPLETED", "BLOCKED", "CANCELLED"],
      stage: "CLOSE_PRESENTATION",
      subjectType: "AGENT_OPERATION_SESSION",
      renderModel: () => ({ sessionId, sessionDigest: expectedSessionDigest, status: session.status, preserved: ["SESSION_AUDIT_STATE", "HARNESS_ASSETS", "ENGINE_ARTIFACTS", "EVIDENCE_SOURCES"], question: session.evolutionContext?.locale === "zh-CN" ? "是否关闭当前 Harness 会话并完整保留其状态？" : "Do you want to close this exact Session while preserving its state?" })
    },
    CLEANUP: {
      statuses: ["CLOSED"],
      stage: "CLEANUP_PRESENTATION",
      subjectType: "SESSION_OWNED_STATE",
      renderModel: () => ({ sessionId, sessionDigest: expectedSessionDigest, ownedState: [sessionDirectory(session.workspace.home, sessionId)], preserved: ["Harness assets", "Engine artifacts", "Evidence Sources", "Release", "model configuration"], destructive: true, question: "Do you want to delete only the proven Session-owned state?" })
    }
  }[normalized];
  if (!configuration) throw sessionError("LIFECYCLE_INTERACTION_ACTION_REQUIRED", "Lifecycle interaction action must be RECOVERY, BLOCKED_RETRY, CANCEL, CLOSE, or CLEANUP.", "choose-lifecycle-interaction-action");
  if (!configuration.statuses.includes(session.status)) throw sessionError("INVALID_SESSION_STATE", `${normalized} presentation is not available from ${session.status}.`, "inspect-session");
  configuration.beforePrepare?.();
  setCurrentInteractionFrame(session, createInteractionFrame({
    session,
    stage: configuration.stage,
    subject: { type: configuration.subjectType, id: sessionId, digest: expectedSessionDigest, bindings: { action: normalized, status: session.status } },
    renderModel: configuration.renderModel(),
    decision: { kind: `${normalized}_DECISION`, question: configuration.renderModel().question ?? `Do you authorize ${normalized}?` },
    allowedNextOperations: ["record_business_view_delivery"]
  }));
  session.nextAction = `present-${normalized.toLowerCase()}-interaction`;
  return persist(session, { event: `${normalized}_INTERACTION_PREPARED`, actor: "interaction-controller", details: { frameDigest: session.interaction.currentFrame.frameDigest } });
}

export function cancelAgentSession({ home, sessionId, expectedSessionDigest, confirmedBy, confirmation, now = new Date().toISOString() }) {
  const inspected = inspectAgentSession(home, sessionId);
  const session = inspected.schema === "evopilot-harness-agent-operation-session/v2" ? loadLegacyLifecycleSession(inspected, expectedSessionDigest) : loadForMutation(home, sessionId, expectedSessionDigest);
  if (TERMINAL.has(session.status)) throw sessionError("SESSION_TERMINAL", `Session is already ${session.status}.`, "inspect-session");
  if (session.schema !== "evopilot-harness-agent-operation-session/v2") requirePresentedFrame(session, "CANCELLATION_PRESENTATION");
  const expected = `CANCEL_SESSION:${sessionId}:${expectedSessionDigest}`;
  if (confirmation !== expected || !String(confirmedBy ?? "").trim()) throw sessionError("EXPLICIT_CANCELLATION_REQUIRED", `Cancellation must equal ${expected} and include confirmedBy.`, "request-explicit-cancellation");
  session.humanDecisions.push(decision("SESSION_CANCELLED", confirmedBy, confirmation, { compatibilityPath: session.schema === "evopilot-harness-agent-operation-session/v2" ? "v2-explicit-safe-cancel" : "v3-business-view", ...(session.schema === "evopilot-harness-agent-operation-session/v2" ? {} : { compositeDecisionBindingDigest: currentCompositeDecisionBinding(session, "CANCELLATION_PRESENTATION") }) }, now));
  session.status = "CANCELLED";
  session.nextAction = "close-session";
  return persist(session, { event: "SESSION_CANCELLED", actor: confirmedBy, details: {} });
}

export function closeAgentSession({ home, sessionId, expectedSessionDigest, confirmedBy, confirmation, now = new Date().toISOString() }) {
  const inspected = inspectAgentSession(home, sessionId);
  const session = inspected.schema === "evopilot-harness-agent-operation-session/v2" ? loadLegacyLifecycleSession(inspected, expectedSessionDigest, ["COMPLETED", "BLOCKED", "CANCELLED"]) : loadForMutation(home, sessionId, expectedSessionDigest, ["COMPLETED", "BLOCKED", "CANCELLED"]);
  if (session.schema !== "evopilot-harness-agent-operation-session/v2") requirePresentedFrame(session, "CLOSE_PRESENTATION");
  const expected = `CLOSE_SESSION:${sessionId}:${expectedSessionDigest}`;
  if (confirmation !== expected || !String(confirmedBy ?? "").trim()) throw sessionError("EXPLICIT_CLOSE_REQUIRED", `Close confirmation must equal ${expected} and include confirmedBy.`, "request-explicit-close");
  session.humanDecisions.push(decision("SESSION_CLOSED", confirmedBy, confirmation, { compatibilityPath: session.schema === "evopilot-harness-agent-operation-session/v2" ? "v2-explicit-safe-close" : "v3-business-view", ...(session.schema === "evopilot-harness-agent-operation-session/v2" ? {} : { compositeDecisionBindingDigest: currentCompositeDecisionBinding(session, "CLOSE_PRESENTATION") }) }, now));
  session.status = "CLOSED";
  session.closedAt = now;
  session.nextAction = "session-closed";
  return persist(session, { event: "SESSION_CLOSED", actor: confirmedBy, details: {} });
}

export function cleanupAgentSession({ home, sessionId, expectedSessionDigest, confirmedBy, confirmation }) {
  const session = loadForMutation(home, sessionId, expectedSessionDigest, ["CLOSED"]);
  requirePresentedFrame(session, "CLEANUP_PRESENTATION");
  const expected = `DELETE_SESSION_STATE:${sessionId}:${expectedSessionDigest}`;
  if (confirmation !== expected || !String(confirmedBy ?? "").trim()) throw sessionError("EXPLICIT_CLEANUP_REQUIRED", `Cleanup confirmation must equal ${expected} and include confirmedBy.`, "request-explicit-session-cleanup");
  const directory = sessionDirectory(session.workspace.home, sessionId);
  const ownershipFile = path.join(directory, ".ownership.json");
  const ownership = fs.existsSync(ownershipFile) ? JSON.parse(fs.readFileSync(ownershipFile, "utf8")) : null;
  if (ownership?.owner !== "evopilot-harness-agent-operation-session" || ownership?.sessionId !== sessionId) {
    throw sessionError("CLEANUP_OWNERSHIP_UNCERTAIN", "Session cleanup ownership cannot be proven.", "preserve-session-and-inspect-ownership");
  }
  fs.rmSync(directory, { recursive: true, force: false });
  return { schema: "evopilot-harness-agent-session-cleanup/v1", status: "CLEANED", sessionId, deleted: [directory], preserved: ["source-projects", "release", "models-config", "evolution-runs", "catalogs", "assets"], nextAction: "start-or-resume-another-session" };
}

export function inspectAgentSession(home, sessionId) {
  const workspace = assertExternalWorkspace(home);
  const file = sessionFile(workspace, sessionId);
  if (!fs.existsSync(file)) throw sessionError("SESSION_NOT_FOUND", `Agent Operation Session ${sessionId} was not found.`, "list-or-start-session");
  const session = JSON.parse(fs.readFileSync(file, "utf8"));
  const persistedDigest = calculateSessionDigest(session);
  if (session.sessionDigest !== persistedDigest) throw sessionError("SESSION_INTEGRITY_FAILURE", `Agent Operation Session digest mismatch at ${file}.`, "stop-and-inspect-session-integrity");
  // Revisions 7 and 8 added append-only Frame archives and an immutable
  // Evolution Context binding. Older integrity-valid v3 Sessions remain
  // readable without rewriting their audit files. The deterministic in-memory
  // upgrade is persisted only by a later explicitly authorized mutation.
  if (session.schema === AGENT_SESSION_SCHEMA && (!Array.isArray(session.interaction?.frameArchive) || session.evolutionContext === undefined || session.reevaluation === undefined)) {
    ensureV41SessionFields(session);
    session.sessionDigest = calculateSessionDigest(session);
  }
  validateSession(session, file);
  return session;
}

export function inspectLifecyclePresentationArchive(home, sessionId) {
  const session = inspectAgentSession(home, sessionId);
  if (!session.plan || !session.planDigest) throw sessionError("LIFECYCLE_REPLAY_PLAN_REQUIRED", "Lifecycle replay requires an authoritative Operation Plan.", "inspect-session-plan");
  const reference = session.proposals?.find((item) => item.publication?.catalogStatus === "VALIDATED");
  if (!reference?.proposalId || !reference.proposalDigest || !reference.approvedProposalDigest || !reference.publication) {
    throw sessionError("LIFECYCLE_REPLAY_PUBLICATION_REQUIRED", "Complete lifecycle replay requires an approved and Catalog-validated Proposal binding.", "complete-governed-lifecycle-before-replay");
  }
  const proposal = inspectProposal(session.workspace.home, reference.proposalId);
  const review = inspectProposalReview(session.workspace.home, reference.proposalId);
  const replaySession = { ...persistedJson(session), compatibility: operationCompatibility() };
  const now = reference.publication.publishedAt ?? session.updatedAt;
  const stableFrame = (stage, options) => createInteractionFrame({
    session: replaySession,
    stage,
    ...options,
    now,
    frameId: `frame-replay-${stage.toLowerCase().replaceAll("_", "-")}-${digest({ sessionId, stage, sessionDigest: session.sessionDigest }).slice(7, 19)}`
  });
  const frames = [
    stableFrame("PLAN_PRESENTATION", {
      subject: { type: "OPERATION_PLAN", id: session.sessionId, digest: session.planDigest, bindings: { sessionDigest: session.sessionDigest } },
      renderModel: { ...session.plan, planDigest: session.planDigest },
      decision: { kind: "PLAN_CONFIRMATION", question: "Do you approve this exact Operation Plan?" },
      allowedNextOperations: []
    }),
    stableFrame("PROPOSAL_REVIEW_PRESENTATION", {
      subject: { type: "PROPOSAL_REVIEW", id: reference.proposalId, digest: review.reportDigest, bindings: { proposalDigest: reference.proposalDigest, reviewDigest: review.reportDigest } },
      renderModel: {
        proposal,
        proposalDigest: reference.proposalDigest,
        review,
        reviewDigest: review.reportDigest,
        sources: session.plan.sources ?? {},
        evaluation: proposal.evaluationCoverage ?? proposal.evaluationPack ?? { status: "BOUND_IN_PROPOSAL", proposedAssets: proposal.proposedAssets ?? [] },
        comparisonAssessment: review.comparisonAssessment ?? { status: "NOT_PROVIDED" },
        authority: { engineAuthoritative: true, presentationIsApproval: false },
        nextAction: "acknowledge-complete-review-before-proposal-approval"
      },
      decision: { kind: "PROPOSAL_REVIEW_COMPLETION", question: "Have you completed review of this exact Proposal, Review, Evaluation, and comparison binding?" },
      allowedNextOperations: []
    }),
    stableFrame("PROPOSAL_APPROVAL_DECISION", {
      subject: { type: "PROPOSAL", id: reference.proposalId, digest: reference.proposalDigest, bindings: { proposalDigest: reference.proposalDigest, reviewDigest: review.reportDigest } },
      renderModel: {
        proposalId: reference.proposalId,
        proposalDigest: reference.proposalDigest,
        reviewDigest: review.reportDigest,
        evaluationReviewed: true,
        question: "Do you approve this exact Harness Proposal?"
      },
      decision: { kind: "PROPOSAL_APPROVAL", question: "Do you approve this exact Harness Proposal?" },
      allowedNextOperations: []
    }),
    stableFrame("PUBLICATION_PRESENTATION", {
      subject: { type: "APPROVED_PROPOSAL_PUBLICATION", id: reference.proposalId, digest: reference.approvedProposalDigest, bindings: { approvalDigest: reference.approval?.approvalDigest ?? reference.approval?.approvedContentDigest ?? null } },
      renderModel: {
        proposalId: reference.proposalId,
        approvedProposalDigest: reference.approvedProposalDigest,
        assets: proposal.proposedAssets ?? proposal.assetDelta?.assets ?? [],
        catalog: { destination: "organization-catalog", validationRequired: true },
        impact: "Publishing writes immutable approved Harness assets and Evaluation assets to the Organization Catalog.",
        nonPublicationOutcome: "The approved Proposal remains in the external Workspace review area and may be preserved or closed without publication.",
        authority: { approvalIsPublication: false, separateHumanAuthorizationRequired: true }
      },
      decision: { kind: "PUBLICATION_AUTHORIZATION", question: "Do you authorize publication of this exact approved Proposal to the Organization Catalog?" },
      allowedNextOperations: []
    }),
    stableFrame("CATALOG_VALIDATION_PRESENTATION", {
      subject: { type: "CATALOG_VALIDATION", id: reference.proposalId, digest: reference.publication.catalogDigest ?? reference.publication.resultDigest, bindings: { proposalId: reference.proposalId, publicationResultDigest: reference.publication.resultDigest } },
      renderModel: { proposalId: reference.proposalId, publication: reference.publication, catalogStatus: reference.publication.catalogStatus, catalogDigest: reference.publication.catalogDigest ?? reference.publication.resultDigest, nextAction: "close-session" },
      decision: null,
      allowedNextOperations: []
    }),
    stableFrame("CLOSE_PRESENTATION", {
      subject: { type: "AGENT_OPERATION_SESSION", id: sessionId, digest: session.sessionDigest, bindings: { action: "CLOSE", status: session.status } },
      renderModel: { sessionId, sessionDigest: session.sessionDigest, status: session.status, preserved: ["Session audit state", "Harness assets", "Engine artifacts", "Evidence Sources"], question: "Do you want to close this exact Session while preserving its state?" },
      decision: { kind: "CLOSE_DECISION", question: "Do you want to close this exact Session while preserving its state?" },
      allowedNextOperations: []
    })
  ];
  const manifest = createLifecycleFrameManifest(frames);
  const canonicalMarkdown = [
    "# Complete Harness lifecycle business presentation replay",
    "",
    "Read-only replay reconstructed by the deterministic Engine from immutable Session, Proposal, approval, publication, and Catalog bindings. It executes no governed mutation and grants no authority.",
    "",
    ...frames.flatMap((frame, index) => [
      `## Stage ${index + 1} of ${frames.length} — ${frame.stage}`,
      "",
      frame.businessView.canonicalMarkdown.trim(),
      ""
    ])
  ].join("\n").trimEnd();
  const presentation = {
    schema: "evopilot-harness-complete-lifecycle-presentation/v1",
    stage: "COMPLETE_LIFECYCLE_REPLAY",
    frameId: `lifecycle-${manifest.manifestDigest.slice(7, 23)}`,
    frameDigest: manifest.manifestDigest,
    businessViewDigest: digest({ sessionId, manifestDigest: manifest.manifestDigest, canonicalMarkdown }),
    renderedBusinessViewDigest: digest(canonicalMarkdown),
    canonicalMarkdown
  };
  return {
    schema: "evopilot-harness-lifecycle-presentation-archive/v1",
    status: "READY",
    sessionId,
    sessionDigest: session.sessionDigest,
    reconstruction: "ENGINE_OWNED_FROM_IMMUTABLE_BINDINGS",
    governedMutationCount: 0,
    frames,
    manifest,
    presentation
  };
}

export function listAgentSessions(home) {
  const root = resolveWorkspacePath(home, "agent-sessions");
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true }).filter((item) => item.isDirectory()).flatMap((item) => {
    try {
      const session = inspectAgentSession(home, item.name);
      return [{ sessionId: session.sessionId, status: session.status, updatedAt: session.updatedAt, adapter: session.adapter.current, nextAction: session.nextAction, sessionDigest: session.sessionDigest }];
    } catch {
      return [{ sessionId: item.name, status: "INVALID", nextAction: "inspect-session-integrity" }];
    }
  }).sort((left, right) => String(right.updatedAt ?? "").localeCompare(String(left.updatedAt ?? "")));
}

export function recoverInterruptedSessions(home) {
  const recovered = [];
  for (const summary of listAgentSessions(home)) {
    if (summary.status !== "RUNNING") continue;
    const session = inspectAgentSession(home, summary.sessionId);
    try {
      assertOperationCompatibility(session.compatibility);
    } catch (error) {
      recovered.push({ sessionId: session.sessionId, status: "INCOMPATIBLE_PRESERVED", code: error.code, nextAction: error.nextAction });
      continue;
    }
    markInterruptedOutcome(session, "operation-server-stopped-during-engine-operation");
    recovered.push(persist(session, { event: "SESSION_RECOVERED_AFTER_PROCESS_STOP", actor: "operation-server", details: { priorStatus: "RUNNING" } }));
  }
  return recovered;
}

export function validateAgentSession(session) {
  const validator = session?.schema === "evopilot-harness-agent-operation-session/v2" ? validateLegacySessionSchema : validateSessionSchema;
  const valid = Boolean(validator(session));
  return { schema: "evopilot-harness-agent-session-validation/v1", status: valid ? "VALIDATED" : "FAILED", valid, errors: valid ? [] : ajvErrors(validator.errors) };
}

export function validateOperationPlan(plan) {
  const valid = Boolean(validatePlanSchema(plan));
  return { schema: "evopilot-harness-operation-plan-validation/v1", status: valid ? "VALIDATED" : "FAILED", valid, errors: valid ? [] : ajvErrors(validatePlanSchema.errors) };
}

function buildPlan({ home, scenario, goal, sources, operations, now }) {
  const normalizedScenario = String(scenario ?? "evolve").toLowerCase();
  const normalizedGoal = String(goal ?? "").trim();
  if (!normalizedGoal) throw sessionError("GOAL_REQUIRED", "Operation Plan requires a goal.", "collect-goal");
  assertNoSensitiveMaterial(normalizedGoal, "goal");
  let plannedOperations;
  let persistedSources;
  if (normalizedScenario === "evolve") {
    const input = normalizeEvolutionInput(sources, normalizedGoal);
    if (!hasEvidenceSource(input)) throw sessionError("EVIDENCE_SOURCE_REQUIRED", "Evolution requires a local project, project root, Git repository, attachment, log, historical Harness, note, or research URL.", "collect-evidence-source");
    validateEngineOperationRequest({ home, operation: "evidence.produce", input });
    plannedOperations = [{ operation: "evidence.produce", input }];
    persistedSources = persistedJson(Object.fromEntries(Object.entries(input).filter(([key]) => key !== "goal")));
  } else if (normalizedScenario === "feedback") {
    assertKnownSourceFields(sources, ["feedbackFile", "now"]);
    const file = String(sources.feedbackFile ?? "").trim() ? path.resolve(String(sources.feedbackFile)) : "";
    if (!file) throw sessionError("FEEDBACK_FILE_REQUIRED", "Feedback processing requires feedbackFile.", "collect-feedback-file");
    plannedOperations = [
      { operation: "feedback.ingest", input: compact({ file, now: sources.now }) },
      { operation: "feedback.aggregate", input: compact({ now: sources.now }) }
    ];
    plannedOperations.forEach((planned) => validateEngineOperationRequest({ home, ...planned }));
    persistedSources = compact({ feedbackFile: file, now: sources.now });
  } else if (normalizedScenario === "comparison") {
    assertKnownSourceFields(sources, ["comparisonFile", "comparisonPolicyFile", "now"]);
    const file = String(sources.comparisonFile ?? "").trim() ? path.resolve(String(sources.comparisonFile)) : "";
    if (!file) throw sessionError("COMPARISON_FILE_REQUIRED", "Controlled comparison requires comparisonFile.", "collect-comparison-file");
    const input = compact({ file, policyFile: sources.comparisonPolicyFile ? path.resolve(String(sources.comparisonPolicyFile)) : undefined, now: sources.now });
    plannedOperations = [{ operation: "comparison.process", input }];
    plannedOperations.forEach((planned) => validateEngineOperationRequest({ home, ...planned }));
    persistedSources = compact({ comparisonFile: file, comparisonPolicyFile: input.policyFile, now: sources.now });
  } else if (normalizedScenario === "calibration") {
    assertKnownSourceFields(sources, ["calibrationCaseSet", "calibrationCaseSetId", "baselineMatchPolicy", "candidateMatchPolicy", "baselineComparisonPolicy", "candidateComparisonPolicy", "now"]);
    if (!String(sources.calibrationCaseSet ?? "").trim() && !String(sources.calibrationCaseSetId ?? "").trim()) throw sessionError("CALIBRATION_CASE_SET_REQUIRED", "Calibration requires calibrationCaseSet or calibrationCaseSetId.", "collect-calibration-case-set");
    const input = compact({
      caseSet: sources.calibrationCaseSet ? path.resolve(String(sources.calibrationCaseSet)) : undefined,
      caseSetId: sources.calibrationCaseSetId,
      baselineMatchPolicy: sources.baselineMatchPolicy ? path.resolve(String(sources.baselineMatchPolicy)) : undefined,
      candidateMatchPolicy: sources.candidateMatchPolicy ? path.resolve(String(sources.candidateMatchPolicy)) : undefined,
      baselineComparisonPolicy: sources.baselineComparisonPolicy ? path.resolve(String(sources.baselineComparisonPolicy)) : undefined,
      candidateComparisonPolicy: sources.candidateComparisonPolicy ? path.resolve(String(sources.candidateComparisonPolicy)) : undefined,
      now: sources.now
    });
    plannedOperations = [{ operation: "calibration.run", input }];
    plannedOperations.forEach((planned) => validateEngineOperationRequest({ home, ...planned }));
    persistedSources = compact({
      calibrationCaseSet: input.caseSet,
      calibrationCaseSetId: input.caseSetId,
      baselineMatchPolicy: input.baselineMatchPolicy,
      candidateMatchPolicy: input.candidateMatchPolicy,
      baselineComparisonPolicy: input.baselineComparisonPolicy,
      candidateComparisonPolicy: input.candidateComparisonPolicy,
      now: input.now
    });
  } else if (normalizedScenario === "learning") {
    assertKnownSourceFields(sources, []);
    plannedOperations = normalizeLearningOperations(home, operations);
    persistedSources = {};
  } else if (normalizedScenario === "maintenance") {
    assertKnownSourceFields(sources, []);
    plannedOperations = normalizeMaintenanceOperations(home, operations);
    persistedSources = {};
  } else {
    throw sessionError("UNKNOWN_SCENARIO", `Unsupported scenario: ${scenario}`, "choose-supported-scenario");
  }
  return {
    schema: OPERATION_PLAN_SCHEMA,
    scenario: normalizedScenario,
    goal: normalizedGoal,
    createdAt: now,
    sources: persistedJson(persistedSources),
    operations: plannedOperations,
    stopPoints: ["plan-confirmation", "engine-blocker", "comparison-review", "calibration-review", "completeness-review", "proposal-review", "human-approval", "separate-publication-authorization", "close-or-resume"],
    authority: { engineAuthoritative: true, humanApprovalRequired: true, publicationSeparate: true, sourceExecutionAllowed: false }
  };
}

function normalizeEvolutionInput(sources, goal) {
  const value = sources && typeof sources === "object" ? sources : {};
  assertKnownSourceFields(value, [
    "sourceProjects", "sourceRoot", "githubRepositories", "githubRef", "attachments", "productionLogs",
    "historicalHarnesses", "notes", "researchUrls", "allowInternetResearch", "includeModules", "limit",
    "advisor", "modelsFile", "model", "advisorTimeoutMs", "reviewTimeoutMs", "now"
  ]);
  return compact({
    sourceProjects: array(value.sourceProjects).map((item) => path.resolve(String(item))),
    sourceRoot: value.sourceRoot ? path.resolve(String(value.sourceRoot)) : undefined,
    githubRepositories: array(value.githubRepositories),
    githubRef: value.githubRef,
    attachments: array(value.attachments).map((item) => path.resolve(String(item))),
    productionLogs: array(value.productionLogs).map((item) => path.resolve(String(item))),
    historicalHarnesses: array(value.historicalHarnesses).map((item) => path.resolve(String(item))),
    notes: array(value.notes),
    researchUrls: array(value.researchUrls),
    allowInternetResearch: value.allowInternetResearch === true,
    includeModules: value.includeModules === true,
    limit: value.limit,
    advisor: value.advisor ?? "auto",
    modelsFile: value.modelsFile ? path.resolve(String(value.modelsFile)) : undefined,
    model: value.model,
    advisorTimeoutMs: value.advisorTimeoutMs,
    goal
  });
}

function normalizeMaintenanceOperations(home, operations) {
  if (!Array.isArray(operations) || !operations.length) throw sessionError("MAINTENANCE_OPERATION_REQUIRED", "Maintenance Plan requires at least one operation.", "select-maintenance-operation");
  return operations.map((item) => {
    const operation = String(item?.operation ?? "");
    const definition = engineOperationDefinition(operation);
    if (!definition || !["planned", "publication"].includes(definition.access)) throw sessionError("OPERATION_NOT_PLAN_ELIGIBLE", `${operation} cannot run in a maintenance Plan.`, "select-plan-eligible-operation");
    const input = persistedJson(item.input ?? {});
    validateEngineOperationRequest({ home, operation, input });
    return { operation, input };
  });
}

function normalizeLearningOperations(home, operations) {
  if (!Array.isArray(operations) || !operations.length) throw sessionError("LEARNING_OPERATION_REQUIRED", "Professional learning Plan requires at least one learning operation.", "select-learning-operation");
  return operations.map((item) => {
    const operation = String(item?.operation ?? "");
    const definition = engineOperationDefinition(operation);
    if (!operation.startsWith("learning.") || !definition || definition.access !== "planned") throw sessionError("OPERATION_NOT_LEARNING_ELIGIBLE", `${operation} cannot run in a professional learning Plan.`, "select-learning-operation");
    const input = persistedJson(item.input ?? {});
    validateEngineOperationRequest({ home, operation, input });
    return { operation, input };
  });
}

function assertKnownSourceFields(value, allowed) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw sessionError("INVALID_SOURCES", "Plan sources must be an object.", "repair-plan-sources");
  const known = new Set(allowed);
  const unknown = Object.keys(value).filter((key) => !known.has(key));
  if (unknown.length) throw sessionError("UNKNOWN_SOURCE_FIELDS", `Plan sources do not accept: ${unknown.join(", ")}.`, "remove-unknown-or-sensitive-source-fields");
}

async function bindProposalReferences(session, operationResult) {
  const result = operationResult.result ?? {};
  const proposalIds = result.proposal?.proposalId ? [result.proposal.proposalId] : Array.isArray(result.proposals) ? result.proposals.map((item) => item.proposalId).filter(Boolean) : [];
  session.proposals = proposalIds.map((proposalId) => {
    const proposal = inspectProposal(session.workspace.home, proposalId);
    return { proposalId, status: proposal.status, decision: proposal.decision, proposalDigest: reviewInputDigest(proposal), review: null };
  });
}

function bindEvidenceReport(session, operation, operationResult) {
  ensureV41SessionFields(session);
  const result = operationResult?.result ?? {};
  let type = null;
  let report = null;
  let nextAction = result.nextAction ?? operationResult?.nextAction;
  if (operation.startsWith("comparison.")) {
    type = "COMPARISON";
    report = result.report ?? result.scoring?.report;
    nextAction = result.scoring?.nextAction ?? nextAction;
  } else if (operation.startsWith("calibration.")) {
    type = "CALIBRATION";
    report = result.report;
  } else if (operation === "learning.score" || operation === "learning.rescore") {
    type = "COMPLETENESS";
    report = result.document ?? result.report?.document;
  }
  const reportId = report?.metadata?.reportId;
  const reportDigest = report?.metadata?.reportDigest ?? report?.metadata?.documentDigest;
  if (!type || !reportId || !reportDigest) return;
  const rendered = type === "COMPARISON"
    ? {
        comparisonId: report.metadata.comparisonId,
        comparability: report.comparability,
        metrics: report.metrics,
        uncertainty: report.uncertainty,
        recommendation: report.recommendation,
        reasons: report.reasons,
        limitations: report.limitations,
        authority: report.authority
      }
    : type === "CALIBRATION" ? {
        caseSetRef: report.caseSetRef,
        policyBindings: report.policyBindings,
        summary: report.summary,
        cases: report.cases,
        uncertainty: report.uncertainty,
        conflicts: report.conflicts,
        ranking: report.ranking,
        recommendation: report.recommendation,
        authority: report.authority
      } : {
        runRef: report.runRef,
        curriculumSnapshotRef: report.curriculumSnapshotRef,
        policyRef: report.policyRef,
        dimensions: report.dimensions,
        accounting: report.accounting,
        blockers: report.blockers,
        recommendation: report.recommendation,
        claims: report.claims,
        authority: report.authority
      };
  const reference = {
    type,
    reportId,
    reportDigest,
    reviewed: false,
    nextAction,
    ...persistedJson(rendered)
  };
  const existing = session.evidenceReports.find((item) => item.type === type && item.reportId === reference.reportId);
  if (existing && existing.reportDigest !== reference.reportDigest) throw sessionError("EVIDENCE_REPORT_BINDING_CONFLICT", `Session report ${reference.reportId} changed digest.`, "stop-and-inspect-evidence-report");
  if (!existing) session.evidenceReports.push(reference);
}

function bindCurrentEvidenceFrame(session, now) {
  const report = session.evidenceReports.find((item) => item.reviewed !== true);
  if (!report) return;
  setCurrentInteractionFrame(session, createInteractionFrame({
    session,
    stage: "EVIDENCE_REPORT_PRESENTATION",
    subject: { type: `${report.type}_REPORT`, id: report.reportId, digest: report.reportDigest, bindings: { sessionId: session.sessionId } },
    renderModel: { type: report.type, reportId: report.reportId, reportDigest: report.reportDigest, report, authority: report.authority ?? { evidenceOnly: true }, nextAction: report.nextAction },
    decision: { kind: `${report.type}_REVIEW_ACKNOWLEDGEMENT`, question: "Have you reviewed this complete immutable evidence report?" },
    allowedNextOperations: ["record_business_view_delivery"] ,
    now
  }));
}

function bindProposalReviewFrame(session, reference, now) {
  if (!reference) return;
  const proposal = inspectProposal(session.workspace.home, reference.proposalId);
  const review = inspectProposalReview(session.workspace.home, reference.proposalId);
  setCurrentInteractionFrame(session, createInteractionFrame({
    session,
    stage: "PROPOSAL_REVIEW_PRESENTATION",
    subject: { type: "PROPOSAL_REVIEW", id: reference.proposalId, digest: review.reportDigest, bindings: { proposalDigest: reference.proposalDigest, reviewDigest: review.reportDigest } },
    renderModel: {
      proposal,
      proposalDigest: reference.proposalDigest,
      review,
      reviewDigest: review.reportDigest,
      sources: session.plan?.sources ?? {},
      evaluation: proposal.evaluationCoverage ?? proposal.evaluationPack ?? { status: "BOUND_IN_PROPOSAL", proposedAssets: proposal.proposedAssets ?? [] },
      comparisonAssessment: review.comparisonAssessment ?? { status: "NOT_PROVIDED" },
      authority: { engineAuthoritative: true, presentationIsApproval: false },
      nextAction: "acknowledge-complete-review-before-proposal-approval"
    },
    decision: { kind: "PROPOSAL_REVIEW_COMPLETION", question: "Have you completed review of this exact Proposal, Review, Evaluation, and comparison binding?" },
    allowedNextOperations: ["record_business_view_delivery"],
    now
  }));
}

function bindPublicationFrame(session, reference, proposal, now) {
  setCurrentInteractionFrame(session, createInteractionFrame({
    session,
    stage: "PUBLICATION_PRESENTATION",
    subject: { type: "APPROVED_PROPOSAL_PUBLICATION", id: reference.proposalId, digest: reference.approvedProposalDigest, bindings: { approvalDigest: reference.approval?.approvalDigest } },
    renderModel: {
      proposalId: reference.proposalId,
      approvedProposalDigest: reference.approvedProposalDigest,
      assets: proposal.proposedAssets ?? proposal.assetDelta?.assets ?? [],
      catalog: { destination: "organization-catalog", validationRequired: true },
      impact: "Publishing writes immutable approved Harness assets and Evaluation assets to the Organization Catalog.",
      nonPublicationOutcome: "The approved Proposal remains in the external Workspace review area and may be preserved or closed without publication.",
      authority: { approvalIsPublication: false, separateHumanAuthorizationRequired: true }
    },
    decision: { kind: "PUBLICATION_AUTHORIZATION", question: "Do you authorize publication of this exact approved Proposal to the Organization Catalog?" },
    allowedNextOperations: ["record_business_view_delivery"],
    now
  }));
}

function bindBlockerFrame(session, { reasons = [], evidenceRefs = [], now }) {
  setCurrentInteractionFrame(session, createInteractionFrame({
    session,
    stage: "BLOCKER_PRESENTATION",
    subject: { type: "SESSION_BLOCKER", id: session.sessionId, digest: digest({ status: session.status, blockers: session.blockers, reasons, evidenceRefs }), bindings: { sessionStatus: session.status } },
    renderModel: { status: session.status, blockers: session.blockers ?? [], reasons, evidenceRefs, nextAction: session.nextAction },
    decision: null,
    allowedNextOperations: ["inspect_operation_session", "prepare_session_lifecycle_interaction"],
    now
  }));
}

function bindCatalogValidationFrame(session, reference, now) {
  setCurrentInteractionFrame(session, createInteractionFrame({
    session,
    stage: "CATALOG_VALIDATION_PRESENTATION",
    subject: { type: "CATALOG_VALIDATION", id: reference.proposalId, digest: reference.publication.catalogDigest ?? reference.publication.resultDigest, bindings: { proposalId: reference.proposalId, publicationResultDigest: reference.publication.resultDigest } },
    renderModel: { proposalId: reference.proposalId, publication: reference.publication, catalogStatus: reference.publication.catalogStatus, catalogDigest: reference.publication.catalogDigest ?? reference.publication.resultDigest, nextAction: "close-session" },
    decision: null,
    allowedNextOperations: ["inspect_operation_session", "prepare_session_lifecycle_interaction"],
    now
  }));
}

function nextEvidenceReviewAction(session) {
  const pending = session.evidenceReports?.find((item) => item.reviewed !== true);
  if (pending?.type === "CALIBRATION") return "present-calibration-report-and-request-review-acknowledgement";
  if (pending?.type === "COMPLETENESS") return "present-completeness-report-and-request-review-acknowledgement";
  return "present-comparison-report-and-request-review-acknowledgement";
}

function loadForMutation(home, sessionId, expectedSessionDigest, allowedStatuses) {
  const session = inspectAgentSession(home, sessionId);
  if (session.sessionDigest !== expectedSessionDigest) throw sessionError("SESSION_DIGEST_MISMATCH", "Agent Operation Session changed since the caller last read it.", "reload-session");
  try {
    assertOperationCompatibility(session.compatibility);
  } catch (error) {
    throw sessionError(
      "SESSION_COMPATIBILITY_BINDING_MISMATCH",
      "The Session is not bound to the current Product, Digital Expert Core, Agent protocol, and Engine API.",
      error.nextAction ?? "start-compatible-session-or-use-matching-release"
    );
  }
  if (allowedStatuses && !allowedStatuses.includes(session.status)) throw sessionError("INVALID_SESSION_STATE", `Session ${sessionId} is ${session.status}; expected ${allowedStatuses.join(" or ")}.`, session.nextAction);
  ensureV41SessionFields(session);
  return session;
}

function loadLegacyLifecycleSession(session, expectedSessionDigest, allowedStatuses) {
  if (session.sessionDigest !== expectedSessionDigest) throw sessionError("SESSION_DIGEST_MISMATCH", "Agent Operation Session changed since the caller last read it.", "reload-session");
  if (allowedStatuses && !allowedStatuses.includes(session.status)) throw sessionError("INVALID_SESSION_STATE", `Session ${session.sessionId} is ${session.status}; expected ${allowedStatuses.join(" or ")}.`, session.nextAction);
  return session;
}

function ensureV41SessionFields(session) {
  if (!Array.isArray(session.evidenceReports)) session.evidenceReports = [];
  if (session.reevaluation === undefined) session.reevaluation = null;
  if (session.evolutionContext === undefined) session.evolutionContext = null;
  if (session.interaction && !Array.isArray(session.interaction.frameArchive)) {
    session.interaction.frameArchive = [];
    if (session.interaction.currentFrame) session.interaction.frameArchive.push(persistedJson(session.interaction.currentFrame));
  }
  return session;
}

function setCurrentInteractionFrame(session, frame) {
  if (!session.interaction) throw sessionError("INTERACTION_STATE_REQUIRED", "The Session has no Agent interaction state.", "inspect-session");
  if (!Array.isArray(session.interaction.frameArchive)) session.interaction.frameArchive = [];
  if (!session.interaction.frameArchive.some((item) => item.frameDigest === frame.frameDigest)) session.interaction.frameArchive.push(persistedJson(frame));
  session.interaction.currentFrame = frame;
  return frame;
}

function normalizeHostInteraction(value, adapterId = "unknown-host") {
  const host = value && typeof value === "object" && !Array.isArray(value) ? persistedJson(value) : {};
  if (!Object.keys(host).length) {
    const unverified = { id: adapterId, version: "unverified", level: "TRANSPORT_ONLY", capabilities: [], locale: null };
    return { ...unverified, conformanceProfile: createHostConformanceProfile(unverified) };
  }
  if (!String(host.id ?? "").trim() || !String(host.version ?? "").trim()) throw sessionError("HOST_INTERACTION_CAPABILITIES_REQUIRED", "Agent Operations Protocol v3 requires an exact host id and version.", "inspect-and-bind-host-interaction-capabilities");
  if (!["TRANSPORT_ONLY", "CONVERSATIONAL_COMPATIBLE", "OBSERVABLE_INTERACTION_COMPATIBLE", "GOVERNED_HUMAN_GATE_COMPATIBLE"].includes(host.level)) throw sessionError("HOST_INTERACTION_LEVEL_INVALID", "Unknown host interaction compatibility level.", "inspect-and-bind-host-interaction-capabilities");
  const capabilities = [...new Set(Array.isArray(host.capabilities) ? host.capabilities.map(String) : [])];
  const missing = host.level === "GOVERNED_HUMAN_GATE_COMPATIBLE" ? REQUIRED_GOVERNED_HOST_CAPABILITIES.filter((item) => !capabilities.includes(item)) : [];
  if (missing.length) throw sessionError("HOST_INTERACTION_CAPABILITIES_REQUIRED", `Host interaction capabilities are missing: ${missing.join(", ")}.`, "use-certified-host-or-enable-supported-integration");
  const maxSynchronousMcpRequestMs = host.maxSynchronousMcpRequestMs == null ? null : Number(host.maxSynchronousMcpRequestMs);
  if (maxSynchronousMcpRequestMs != null && (!Number.isInteger(maxSynchronousMcpRequestMs) || maxSynchronousMcpRequestMs < 1)) throw sessionError("HOST_INTERACTION_CAPABILITIES_REQUIRED", "maxSynchronousMcpRequestMs must be a positive integer when declared.", "inspect-and-bind-host-interaction-capabilities");
  const normalized = {
    id: String(host.id).trim(),
    version: String(host.version).trim(),
    level: host.level,
    capabilities,
    locale: ["zh-CN", "en"].includes(host.locale) ? host.locale : null,
    ...(host.supportsOperationJobs !== undefined ? { supportsOperationJobs: host.supportsOperationJobs === true } : {}),
    ...(host.maxSynchronousMcpRequestMs !== undefined ? { maxSynchronousMcpRequestMs } : {})
  };
  return { ...normalized, conformanceProfile: createHostConformanceProfile(normalized) };
}

function persist(session, journal) {
  assertWorkspaceTreeConfined(session.workspace.home);
  session.sequence += 1;
  session.updatedAt = new Date().toISOString();
  session.sessionDigest = calculateSessionDigest(session);
  validateSession(session, sessionFile(session.workspace.home, session.sessionId));
  assertNoSensitiveMaterial(session, "session");
  const directory = sessionDirectory(session.workspace.home, session.sessionId);
  fs.mkdirSync(directory, { recursive: true });
  const ownershipFile = path.join(directory, ".ownership.json");
  if (!fs.existsSync(ownershipFile)) fs.writeFileSync(ownershipFile, `${JSON.stringify({ owner: "evopilot-harness-agent-operation-session", sessionId: session.sessionId }, null, 2)}\n`, "utf8");
  const file = sessionFile(session.workspace.home, session.sessionId);
  const temporary = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(temporary, `${JSON.stringify(session, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  fs.renameSync(temporary, file);
  const entry = { sequence: session.sequence, at: session.updatedAt, sessionId: session.sessionId, sessionDigest: session.sessionDigest, ...journal };
  fs.appendFileSync(path.join(directory, "journal.jsonl"), `${JSON.stringify(entry)}\n`, { encoding: "utf8", mode: 0o600 });
  return persistedJson(session);
}

function calculateSessionDigest(session) {
  const value = persistedJson(session);
  delete value.sessionDigest;
  return digest(value);
}

function validateSession(session, file) {
  const validator = session?.schema === "evopilot-harness-agent-operation-session/v2" ? validateLegacySessionSchema : validateSessionSchema;
  if (!validator(session)) throw sessionError("SESSION_SCHEMA_INVALID", `Agent Operation Session is invalid at ${file}: ${formatErrors(validator.errors)}`, "stop-and-repair-session");
}

function validatePlan(plan) {
  if (!validatePlanSchema(plan)) throw sessionError("PLAN_SCHEMA_INVALID", `Operation Plan is invalid: ${formatErrors(validatePlanSchema.errors)}`, "repair-operation-plan");
}

function sessionDirectory(home, sessionId) {
  return resolveWorkspacePath(home, "agent-sessions", safeId(sessionId));
}

function sessionFile(home, sessionId) {
  return path.join(sessionDirectory(home, sessionId), "session.json");
}

function operationRecord(planned, result, now, extra = {}) {
  return { sequence: null, operation: planned.operation, inputDigest: digest(planned.input), resultDigest: digest(result), status: result.status, exitCode: result.exitCode, completedAt: now, nextAction: result.nextAction, ...extra };
}

function plannedOperationDigest(planDigest, operationIndex, planned) {
  return digest({ planDigest, operationIndex, operation: planned.operation, inputDigest: digest(planned.input) });
}

function operationIdempotencyKey(sessionId, planDigest, operationIndex, planned) {
  return digest({ sessionId, planDigest, operationIndex, operation: planned.operation, inputDigest: digest(planned.input) }).slice("sha256:".length);
}

function hasOperationAuthorization(session, operationIndex, operationDigest) {
  return session.operationAuthorizations.some((item) => item.operationIndex === operationIndex && item.operationDigest === operationDigest && item.planDigest === session.planDigest);
}

function nextPlanOperationIndex(session) {
  const completed = new Set(session.operations.filter((item) => item.phase === "plan" && item.planCompleted === true).map((item) => item.planOperationIndex));
  for (let index = 0; index < session.plan.operations.length; index += 1) if (!completed.has(index)) return index;
  return session.plan.operations.length;
}

function markInterruptedOutcome(session, blocker) {
  if (session.inFlightOperation) {
    session.inFlightOperation.status = "OUTCOME_UNKNOWN";
    session.inFlightOperation.interruptedAt = new Date().toISOString();
  }
  session.status = "INTERRUPTED";
  session.blockers = [blocker, ...(session.inFlightOperation ? ["engine-operation-outcome-unknown"] : [])];
  session.nextAction = session.inFlightOperation ? "reconcile-interrupted-operation" : "request-explicit-plan-resume-confirmation";
}

function workspaceStateDigest(home) {
  const root = assertExternalWorkspace(home);
  const hash = cryptoHash();
  for (const entry of walkWorkspace(root, root)) {
    hash.update(entry.relative).update("\0").update(entry.type).update("\0");
    if (entry.type === "file") hash.update(fs.readFileSync(entry.absolute));
    else if (entry.type === "symlink") hash.update(fs.readlinkSync(entry.absolute));
    hash.update("\0");
  }
  return `sha256:${hash.digest("hex")}`;
}

function walkWorkspace(root, directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name)).flatMap((entry) => {
    if (directory === root && entry.name === "agent-sessions") return [];
    const absolute = path.join(directory, entry.name);
    const relative = path.relative(root, absolute);
    if (entry.isSymbolicLink()) return [{ absolute, relative, type: "symlink" }];
    if (entry.isDirectory()) return [{ absolute, relative, type: "directory" }, ...walkWorkspace(root, absolute)];
    if (entry.isFile()) return [{ absolute, relative, type: "file" }];
    return [];
  });
}

function cryptoHash() {
  return crypto.createHash("sha256");
}

function decision(type, by, confirmation, bindings, at) {
  return { type, by: String(by), confirmationDigest: digest(String(confirmation)), bindings, at };
}

function businessDecisionProgress(session, choice, nextAction) {
  return {
    schema: "evopilot-harness-business-decision-progress/v1",
    status: session.status,
    sessionId: session.sessionId,
    sessionDigest: session.sessionDigest,
    recordedChoice: choice,
    nextAction: nextAction ?? session.nextAction,
    authority: { humanDecisionRecorded: true, hostInferred: false, furtherHumanAuthorityGranted: false }
  };
}

function currentCompositeDecisionBinding(session, stage) {
  const frame = session.interaction?.currentFrame;
  if (!frame || frame.stage !== stage) throw sessionError("BUSINESS_DECISION_VIEW_REQUIRED", `Current ${stage} Business Decision View is missing or stale.`, "reload-current-business-decision-view");
  const receipt = session.interaction.presentationReceipts.find((item) => item.frameDigest === frame.frameDigest);
  const binding = receipt?.compositeDecisionBinding;
  if (!binding?.compositeDecisionBindingDigest) throw sessionError("COMPOSITE_DECISION_BINDING_REQUIRED", `Current ${stage} delivery is not bound to the authoritative business and audit views.`, "record-current-business-view-delivery");
  const receiptCore = persistedJson(receipt);
  delete receiptCore.receiptDigest;
  delete receiptCore.compositeDecisionBinding;
  if (digest(receiptCore) !== receipt.receiptDigest) throw sessionError("BUSINESS_VIEW_DELIVERY_RECEIPT_DRIFT", `Current ${stage} delivery receipt changed after it was recorded.`, "record-current-business-view-delivery");
  const expected = compositeDecisionBinding({ session: { sessionId: binding.sessionId, sessionDigest: binding.sessionDigest }, frame, receipt });
  if (digest(expected) !== digest(binding)) throw sessionError("COMPOSITE_DECISION_BINDING_DRIFT", `Current ${stage} business, audit, decision, subject, or Host delivery binding changed.`, "record-current-business-view-delivery");
  return binding.compositeDecisionBindingDigest;
}

function requireProposalReference(session, proposalId) {
  const reference = session.proposals.find((item) => item.proposalId === proposalId);
  if (!reference) throw sessionError("PROPOSAL_NOT_IN_SESSION", `Proposal ${proposalId} is not bound to this session.`, "inspect-session-proposals");
  return reference;
}

function hasEvidenceSource(input) {
  return Boolean(input.sourceRoot || input.sourceProjects?.length || input.githubRepositories?.length || input.attachments?.length || input.productionLogs?.length || input.historicalHarnesses?.length || input.notes?.length || input.researchUrls?.length);
}

function firstReviewNextAction(proposals) {
  return proposals.find((item) => item.review?.verdict !== "READY_FOR_HUMAN_APPROVAL")?.review?.nextAction ?? "inspect-proposal-review-blockers";
}

function safeAdapter(value) {
  const adapter = String(value ?? "").trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]{1,63}$/.test(adapter)) throw sessionError("INVALID_ADAPTER_ID", "adapterId must use letters, digits, dot, underscore, or hyphen.", "repair-adapter-id");
  return adapter;
}

function randomId() {
  return Math.random().toString(16).slice(2, 12);
}

function array(value) {
  return Array.isArray(value) ? value.filter((item) => item != null && String(item).trim()) : value == null ? [] : [value];
}

function compact(value) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined && item !== null && (!Array.isArray(item) || item.length > 0)));
}

function message(error) {
  return error instanceof Error ? error.message : String(error);
}

function formatErrors(errors = []) {
  return errors.map((error) => `${error.instancePath || "/"} ${error.message}`).join("; ");
}

function ajvErrors(errors = []) {
  return errors.map((error) => ({ path: error.instancePath || "/", keyword: error.keyword, message: error.message, params: error.params }));
}

function sessionError(code, messageText, nextAction) {
  const error = new Error(messageText);
  error.name = "AgentSessionError";
  error.code = code;
  error.nextAction = nextAction;
  return error;
}
