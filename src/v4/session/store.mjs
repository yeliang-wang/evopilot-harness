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
import { requireWorkspace } from "../../v3/workspace.mjs";
import { engineOperationDefinition, inspectEngineOperationReceipt, invokeEngineOperation, validateEngineOperationRequest } from "../engine-adapter.mjs";
import { AGENT_SESSION_SCHEMA, OPERATION_PLAN_SCHEMA, assertExternalWorkspace, assertOperationCompatibility, assertWorkspaceTreeConfined, operationCompatibility, resolveWorkspacePath } from "../constants.mjs";
import { assertNoSensitiveMaterial } from "../security/sensitive.mjs";

const sessionSchema = JSON.parse(fs.readFileSync(path.join(PACKAGE_ROOT, "schemas/agent-operation-session-v1.schema.json"), "utf8"));
const planSchema = JSON.parse(fs.readFileSync(path.join(PACKAGE_ROOT, "schemas/operation-plan-v1.schema.json"), "utf8"));
const ajv = new Ajv2020({ allErrors: true, strict: true });
const validateSessionSchema = ajv.compile(sessionSchema);
const validatePlanSchema = ajv.compile(planSchema);

const TERMINAL = new Set(["COMPLETED", "BLOCKED", "CANCELLED", "CLOSED"]);

export function createAgentSession({ home, intent, adapterId, compatibility = operationCompatibility(), now = new Date().toISOString() }) {
  const workspace = assertExternalWorkspace(home);
  requireWorkspace(workspace);
  assertWorkspaceTreeConfined(workspace);
  const text = String(intent ?? "").trim();
  if (!text) throw sessionError("INTENT_REQUIRED", "A non-empty human intent is required.", "collect-intent");
  assertNoSensitiveMaterial(text, "intent");
  const adapter = safeAdapter(adapterId);
  const compatibilityBinding = assertOperationCompatibility(compatibility);
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
    plan: null,
    planDigest: null,
    humanDecisions: [],
    operations: [],
    inFlightOperation: null,
    operationAuthorizations: [],
    pendingOperationAuthorization: null,
    proposals: [],
    evidenceReports: [],
    sequence: 0,
    nextAction: "create-operation-plan"
  };
  return persist(session, { event: "SESSION_CREATED", actor: adapter, details: { intentDigest: session.intent.digest } });
}

export function createSessionPlan({ home, sessionId, expectedSessionDigest, scenario = "evolve", goal, sources = {}, operations = [], now = new Date().toISOString() }) {
  const session = loadForMutation(home, sessionId, expectedSessionDigest, ["CREATED", "PLAN_REVIEW_REQUIRED"]);
  const plan = buildPlan({ home: session.workspace.home, scenario, goal: goal ?? session.intent.text, sources, operations, now });
  validatePlan(plan);
  session.plan = plan;
  session.planDigest = digest(plan);
  session.operations = [];
  session.inFlightOperation = null;
  session.operationAuthorizations = [];
  session.pendingOperationAuthorization = null;
  session.proposals = [];
  session.evidenceReports = [];
  session.status = "PLAN_REVIEW_REQUIRED";
  session.nextAction = "present-plan-and-request-explicit-confirmation";
  return persist(session, { event: "PLAN_CREATED", actor: session.adapter.current, details: { planDigest: session.planDigest, scenario } });
}

export function confirmSessionPlan({ home, sessionId, expectedSessionDigest, expectedPlanDigest, confirmedBy, confirmation, now = new Date().toISOString() }) {
  const session = loadForMutation(home, sessionId, expectedSessionDigest, ["PLAN_REVIEW_REQUIRED"]);
  if (session.planDigest !== expectedPlanDigest) throw sessionError("PLAN_DIGEST_MISMATCH", "The reviewed Operation Plan is stale.", "reload-and-review-operation-plan");
  const expected = `CONFIRM_OPERATION_PLAN:${session.planDigest}`;
  if (confirmation !== expected || !String(confirmedBy ?? "").trim()) {
    throw sessionError("EXPLICIT_PLAN_CONFIRMATION_REQUIRED", `Plan confirmation must equal ${expected} and include confirmedBy.`, "request-explicit-plan-confirmation");
  }
  session.humanDecisions.push(decision("PLAN_CONFIRMED", confirmedBy, confirmation, { planDigest: session.planDigest }, now));
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
      return persist(session, { event: "PLAN_EXECUTION_BLOCKED", actor: "deterministic-engine", details: { operation: planned.operation, nextAction: result.nextAction } });
    }
  }
  if (session.evidenceReports?.some((item) => item.reviewed !== true)) {
    session.status = "EVIDENCE_REVIEW_REQUIRED";
    session.nextAction = nextEvidenceReviewAction(session);
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
  session.humanDecisions.push(decision("PLAN_PUBLICATION_AUTHORIZED", confirmedBy, confirmation, { operationIndex, operationDigest: expectedOperationDigest, planDigest: expectedPlanDigest, authorizationDigest: authorization.authorizationDigest }, now));
  session.status = "READY_TO_EXECUTE";
  session.nextAction = "execute-authorized-publication-operation";
  return persist(session, { event: "PLAN_PUBLICATION_AUTHORIZED", actor: confirmedBy, details: { operationIndex, operation: authorization.operation, authorizationDigest: authorization.authorizationDigest } });
}

export async function resolveInterruptedOperation({ home, sessionId, expectedSessionDigest, expectedAttemptDigest, confirmedBy, confirmation, now = new Date().toISOString() }) {
  const session = loadForMutation(home, sessionId, expectedSessionDigest, ["INTERRUPTED"]);
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
    session.humanDecisions.push(decision("INTERRUPTED_OPERATION_RECEIPT_ACCEPTED", confirmedBy, confirmation, { attemptDigest: expectedAttemptDigest, receiptDigest: receipt.receiptDigest }, now));
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
    session.humanDecisions.push(decision("INTERRUPTED_OPERATION_RETRY_AUTHORIZED", confirmedBy, confirmation, { attemptDigest: expectedAttemptDigest, workspaceDigest: currentWorkspaceDigest }, now));
  }
  session.inFlightOperation = null;
  session.blockers = [];
  session.status = "READY_TO_EXECUTE";
  session.nextAction = "execute-confirmed-plan";
  return persist(session, { event: "INTERRUPTED_OPERATION_RECONCILED", actor: confirmedBy, details: { attemptDigest: expectedAttemptDigest, resolution: receipt ? "RECEIPT_ACCEPTED" : "UNCHANGED_RETRY_AUTHORIZED" } });
}

export function acknowledgeSessionEvidenceReview({ home, sessionId, expectedSessionDigest, reportType, reportId, expectedReportDigest, confirmedBy, confirmation, now = new Date().toISOString() }) {
  const session = loadForMutation(home, sessionId, expectedSessionDigest, ["EVIDENCE_REVIEW_REQUIRED"]);
  const type = String(reportType ?? "").toUpperCase();
  if (!["COMPARISON", "CALIBRATION"].includes(type)) throw sessionError("EVIDENCE_REPORT_TYPE_REQUIRED", "Report review type must be COMPARISON or CALIBRATION.", "choose-evidence-report-type");
  const report = session.evidenceReports.find((item) => item.type === type && item.reportId === reportId);
  if (!report) throw sessionError("EVIDENCE_REPORT_NOT_IN_SESSION", `Report ${reportId} is not bound to this Session.`, "reload-session-evidence-reports");
  if (report.reportDigest !== expectedReportDigest) throw sessionError("EVIDENCE_REPORT_DIGEST_MISMATCH", "The presented evidence report digest is stale.", "reload-evidence-report");
  const current = type === "COMPARISON"
    ? readComparisonReport({ home: session.workspace.home, reportId })
    : readCalibrationReport({ home: session.workspace.home, reportId });
  if (current.status !== "FOUND" || current.report.metadata.reportDigest !== expectedReportDigest) {
    throw sessionError("EVIDENCE_REPORT_INTEGRITY_FAILURE", "The persisted evidence report no longer matches the presented digest.", "stop-and-inspect-evidence-report");
  }
  const expected = `ACKNOWLEDGE_${type}_REVIEW:${reportId}:${expectedReportDigest}`;
  if (confirmation !== expected || !String(confirmedBy ?? "").trim()) {
    throw sessionError("EXPLICIT_EVIDENCE_REVIEW_REQUIRED", `Evidence review acknowledgement must equal ${expected} and include confirmedBy.`, "request-explicit-evidence-review-acknowledgement");
  }
  report.reviewed = true;
  report.reviewedAt = now;
  report.reviewedBy = String(confirmedBy).trim();
  session.humanDecisions.push(decision(`${type}_REPORT_REVIEWED`, confirmedBy, confirmation, { reportId, reportDigest: expectedReportDigest }, now));
  if (session.evidenceReports.some((item) => item.reviewed !== true)) {
    session.status = "EVIDENCE_REVIEW_REQUIRED";
    session.nextAction = nextEvidenceReviewAction(session);
  } else if (session.proposals.length) {
    session.status = "PROPOSAL_REVIEW_REQUIRED";
    session.nextAction = "run-engine-proposal-review";
  } else {
    session.status = "COMPLETED";
    session.nextAction = "close-session";
  }
  return persist(session, { event: `${type}_REPORT_REVIEWED`, actor: confirmedBy, details: { reportId, reportDigest: expectedReportDigest } });
}

export async function reviewSessionProposals({ home, sessionId, expectedSessionDigest, modelsFile, model, advisorTimeoutMs, reviewTimeoutMs, now = new Date().toISOString() }) {
  const session = loadForMutation(home, sessionId, expectedSessionDigest, ["PROPOSAL_REVIEW_REQUIRED"]);
  for (const reference of session.proposals) {
    const result = await invokeEngineOperation({
      home: session.workspace.home,
      operation: "proposal.review",
      input: compact({ proposalId: reference.proposalId, modelsFile, model, advisorTimeoutMs, reviewTimeoutMs }),
      authority: "session"
    });
    reference.review = result.result ? {
      reviewId: result.result.reviewId,
      status: result.result.status,
      verdict: result.result.verdict,
      reportDigest: result.result.reportDigest,
      proposalDigest: result.result.proposalDigest,
      nextAction: result.result.nextAction
    } : null;
    if (reference.review?.proposalDigest) reference.proposalDigest = reference.review.proposalDigest;
    session.operations.push(operationRecord({ operation: "proposal.review", input: { proposalId: reference.proposalId } }, result, now));
    persist(session, { event: "PROPOSAL_REVIEW_COMPLETED", actor: "deterministic-engine", details: { proposalId: reference.proposalId, reportDigest: reference.review?.reportDigest, verdict: reference.review?.verdict } });
  }
  const ready = session.proposals.every((item) => item.review?.status === "REVIEWED" && item.review?.verdict === "READY_FOR_HUMAN_APPROVAL");
  const noChange = session.proposals.every((item) => item.decision === "NO_CHANGE");
  const needMoreEvidence = session.proposals.some((item) => item.decision === "NEED_MORE_EVIDENCE");
  session.status = noChange ? "COMPLETED" : needMoreEvidence ? "BLOCKED" : ready ? "HUMAN_APPROVAL_REQUIRED" : "BLOCKED";
  session.nextAction = noChange ? "close-session" : needMoreEvidence ? "collect-more-evidence" : ready ? "present-engine-review-and-request-explicit-approval" : firstReviewNextAction(session.proposals);
  if (!ready) session.blockers = session.proposals.flatMap((item) => item.review?.verdict === "READY_FOR_HUMAN_APPROVAL" ? [] : [`proposal-review:${item.proposalId}:${item.review?.verdict ?? "unavailable"}`]);
  return persist(session, { event: ready ? "HUMAN_APPROVAL_REQUIRED" : "PROPOSAL_REVIEW_BLOCKED", actor: "deterministic-engine", details: { proposalCount: session.proposals.length } });
}

export async function approveSessionProposal({ home, sessionId, proposalId, expectedSessionDigest, expectedProposalDigest, expectedReviewDigest, confirmedBy, confirmation, evaluationReviewed, now = new Date().toISOString() }) {
  const session = loadForMutation(home, sessionId, expectedSessionDigest, ["HUMAN_APPROVAL_REQUIRED"]);
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
  session.humanDecisions.push(decision("PROPOSAL_APPROVED", confirmedBy, confirmation, { proposalId, proposalDigest: expectedProposalDigest, reviewDigest: expectedReviewDigest }, now));
  const allApproved = session.proposals.every((item) => item.status === "APPROVED");
  session.status = allApproved ? "PUBLICATION_DECISION_REQUIRED" : "HUMAN_APPROVAL_REQUIRED";
  session.nextAction = allApproved ? "request-separate-publication-authorization" : "request-next-proposal-approval";
  return persist(session, { event: "PROPOSAL_APPROVED", actor: confirmedBy, details: { proposalId, approvedProposalDigest: reference.approvedProposalDigest } });
}

export function authorizeSessionPublication({ home, sessionId, proposalId, expectedSessionDigest, expectedProposalDigest, confirmedBy, confirmation, now = new Date().toISOString() }) {
  const session = loadForMutation(home, sessionId, expectedSessionDigest, ["PUBLICATION_DECISION_REQUIRED", "PUBLICATION_AUTHORIZED"]);
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
  session.humanDecisions.push(decision("PUBLICATION_AUTHORIZED", confirmedBy, confirmation, { proposalId, proposalDigest: expectedProposalDigest, authorizationDigest: authorization.authorizationDigest }, now));
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
  } else if (complete) {
    session.status = "COMPLETED";
    session.nextAction = "close-session";
    session.blockers = [];
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

export function cancelAgentSession({ home, sessionId, expectedSessionDigest, confirmedBy, confirmation, now = new Date().toISOString() }) {
  const session = loadForMutation(home, sessionId, expectedSessionDigest);
  if (TERMINAL.has(session.status)) throw sessionError("SESSION_TERMINAL", `Session is already ${session.status}.`, "inspect-session");
  const expected = `CANCEL_SESSION:${sessionId}:${expectedSessionDigest}`;
  if (confirmation !== expected || !String(confirmedBy ?? "").trim()) throw sessionError("EXPLICIT_CANCELLATION_REQUIRED", `Cancellation must equal ${expected} and include confirmedBy.`, "request-explicit-cancellation");
  session.humanDecisions.push(decision("SESSION_CANCELLED", confirmedBy, confirmation, {}, now));
  session.status = "CANCELLED";
  session.nextAction = "close-session";
  return persist(session, { event: "SESSION_CANCELLED", actor: confirmedBy, details: {} });
}

export function closeAgentSession({ home, sessionId, expectedSessionDigest, confirmedBy, confirmation, now = new Date().toISOString() }) {
  const session = loadForMutation(home, sessionId, expectedSessionDigest, ["COMPLETED", "BLOCKED", "CANCELLED"]);
  const expected = `CLOSE_SESSION:${sessionId}:${expectedSessionDigest}`;
  if (confirmation !== expected || !String(confirmedBy ?? "").trim()) throw sessionError("EXPLICIT_CLOSE_REQUIRED", `Close confirmation must equal ${expected} and include confirmedBy.`, "request-explicit-close");
  session.humanDecisions.push(decision("SESSION_CLOSED", confirmedBy, confirmation, {}, now));
  session.status = "CLOSED";
  session.closedAt = now;
  session.nextAction = "session-closed";
  return persist(session, { event: "SESSION_CLOSED", actor: confirmedBy, details: {} });
}

export function cleanupAgentSession({ home, sessionId, expectedSessionDigest, confirmedBy, confirmation }) {
  const session = loadForMutation(home, sessionId, expectedSessionDigest, ["CLOSED"]);
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
  validateSession(session, file);
  const expected = calculateSessionDigest(session);
  if (session.sessionDigest !== expected) throw sessionError("SESSION_INTEGRITY_FAILURE", `Agent Operation Session digest mismatch at ${file}.`, "stop-and-inspect-session-integrity");
  return session;
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
  const valid = Boolean(validateSessionSchema(session));
  return { schema: "evopilot-harness-agent-session-validation/v1", status: valid ? "VALIDATED" : "FAILED", valid, errors: valid ? [] : ajvErrors(validateSessionSchema.errors) };
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
    stopPoints: ["plan-confirmation", "engine-blocker", "comparison-review", "calibration-review", "proposal-review", "human-approval", "separate-publication-authorization", "close-or-resume"],
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
  }
  if (!type || !report?.metadata?.reportId || !report?.metadata?.reportDigest) return;
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
    : {
        caseSetRef: report.caseSetRef,
        policyBindings: report.policyBindings,
        summary: report.summary,
        cases: report.cases,
        uncertainty: report.uncertainty,
        conflicts: report.conflicts,
        ranking: report.ranking,
        recommendation: report.recommendation,
        authority: report.authority
      };
  const reference = {
    type,
    reportId: report.metadata.reportId,
    reportDigest: report.metadata.reportDigest,
    reviewed: false,
    nextAction,
    ...persistedJson(rendered)
  };
  const existing = session.evidenceReports.find((item) => item.type === type && item.reportId === reference.reportId);
  if (existing && existing.reportDigest !== reference.reportDigest) throw sessionError("EVIDENCE_REPORT_BINDING_CONFLICT", `Session report ${reference.reportId} changed digest.`, "stop-and-inspect-evidence-report");
  if (!existing) session.evidenceReports.push(reference);
}

function nextEvidenceReviewAction(session) {
  const pending = session.evidenceReports?.find((item) => item.reviewed !== true);
  return pending?.type === "CALIBRATION" ? "present-calibration-report-and-request-review-acknowledgement" : "present-comparison-report-and-request-review-acknowledgement";
}

function loadForMutation(home, sessionId, expectedSessionDigest, allowedStatuses) {
  const session = inspectAgentSession(home, sessionId);
  if (session.sessionDigest !== expectedSessionDigest) throw sessionError("SESSION_DIGEST_MISMATCH", "Agent Operation Session changed since the caller last read it.", "reload-session");
  if (allowedStatuses && !allowedStatuses.includes(session.status)) throw sessionError("INVALID_SESSION_STATE", `Session ${sessionId} is ${session.status}; expected ${allowedStatuses.join(" or ")}.`, session.nextAction);
  ensureV41SessionFields(session);
  return session;
}

function ensureV41SessionFields(session) {
  if (!Array.isArray(session.evidenceReports)) session.evidenceReports = [];
  return session;
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
  if (!validateSessionSchema(session)) throw sessionError("SESSION_SCHEMA_INVALID", `Agent Operation Session is invalid at ${file}: ${formatErrors(validateSessionSchema.errors)}`, "stop-and-repair-session");
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
