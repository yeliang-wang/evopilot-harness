import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import { PACKAGE_ROOT } from "../../v3/constants.mjs";
import { digest, persistedJson, safeId } from "../../v3/utils.mjs";
import { INTERACTION_FRAME_SCHEMA, INTERACTION_PRESENTATION_RECEIPT_SCHEMA } from "../constants.mjs";

const schema = JSON.parse(fs.readFileSync(path.join(PACKAGE_ROOT, "schemas/interaction-frame-v1.schema.json"), "utf8"));
const validate = new Ajv2020({ allErrors: true, strict: true }).compile(schema);

export const HOST_INTERACTION_LEVELS = [
  "TRANSPORT_ONLY",
  "CONVERSATIONAL_COMPATIBLE",
  "OBSERVABLE_INTERACTION_COMPATIBLE",
  "GOVERNED_HUMAN_GATE_COMPATIBLE"
];

const GOVERNED_OPERATIONS = [
  "confirm_operation_plan",
  "authorize_plan_publication_operation",
  "resolve_interrupted_operation",
  "authorize_blocked_operation_retry",
  "acknowledge_evidence_report_review",
  "approve_session_proposal",
  "authorize_proposal_publication",
  "cancel_operation_session",
  "close_operation_session",
  "cleanup_operation_session"
];

export const FRAME_FIELDS = {
  EXECUTION_BRIEF: ["release", "capabilities", "goal", "evidenceSources", "workspace", "modelReadiness", "operations", "stopPoints", "forbiddenOperations"],
  PLAN_PRESENTATION: ["schema", "scenario", "goal", "sources", "operations", "stopPoints", "authority", "planDigest"],
  OPERATION_AUTHORIZATION_PRESENTATION: ["operationIndex", "operation", "operationDigest", "inputDigest", "planDigest", "impact"],
  EVIDENCE_REPORT_PRESENTATION: ["type", "reportId", "reportDigest", "report", "authority", "nextAction"],
  PROPOSAL_REVIEW_PRESENTATION: ["proposal", "proposalDigest", "review", "reviewDigest", "evaluation", "comparisonAssessment", "authority", "nextAction"],
  PROPOSAL_APPROVAL_DECISION: ["proposalId", "proposalDigest", "reviewDigest", "evaluationReviewed", "question"],
  PUBLICATION_PRESENTATION: ["proposalId", "approvedProposalDigest", "assets", "catalog", "impact", "nonPublicationOutcome", "authority"],
  RECOVERY_PRESENTATION: ["sessionId", "attempt", "receipt", "workspaceDigest", "risk", "nextAction"],
  BLOCKED_RETRY_PRESENTATION: ["sessionId", "blockedOperation", "failedResultDigest", "workspaceDigest", "risk", "nextAction"],
  CANCELLATION_PRESENTATION: ["sessionId", "sessionDigest", "preserved", "effect", "question"],
  CLOSE_PRESENTATION: ["sessionId", "sessionDigest", "status", "preserved", "question"],
  CLEANUP_PRESENTATION: ["sessionId", "sessionDigest", "ownedState", "preserved", "destructive", "question"],
  BLOCKER_PRESENTATION: ["status", "blockers", "reasons", "evidenceRefs", "nextAction"],
  CATALOG_VALIDATION_PRESENTATION: ["proposalId", "publication", "catalogStatus", "catalogDigest", "nextAction"]
};

export function createInteractionFrame({ session, stage, subject, renderModel, decision = null, allowedNextOperations = [], now = new Date().toISOString() }) {
  const requiredFields = FRAME_FIELDS[stage];
  if (!requiredFields) throw interactionError("UNKNOWN_INTERACTION_STAGE", `Unknown interaction stage ${stage}.`);
  const model = persistedJson(renderModel ?? {});
  const missing = requiredFields.filter((field) => model[field] === undefined || model[field] === null);
  if (missing.length) throw interactionError("INTERACTION_REQUIRED_FIELDS_MISSING", `Interaction frame ${stage} is missing: ${missing.join(", ")}.`, { missingFields: missing });
  const frame = {
    schema: INTERACTION_FRAME_SCHEMA,
    frameId: safeId(`frame-${Date.now().toString(36)}-${crypto.randomBytes(5).toString("hex")}`),
    stage,
    createdAt: now,
    sessionId: session.sessionId,
    sessionDigest: session.sessionDigest,
    compatibility: persistedJson(session.compatibility),
    subject: persistedJson(subject),
    requiredFields,
    renderModel: model,
    decision: decision ? persistedJson(decision) : null,
    allowedNextOperations: [...new Set(allowedNextOperations)],
    forbiddenOperations: GOVERNED_OPERATIONS.filter((operation) => !allowedNextOperations.includes(operation)),
    authority: { engineAuthoritative: true, presentationIsApproval: false, automaticPublication: false },
    redaction: "SECRET_FREE"
  };
  frame.canonicalMarkdown = renderInteractionFrame(frame);
  frame.frameDigest = digest(frame);
  if (!validate(frame)) throw interactionError("INTERACTION_FRAME_INVALID", "Interaction frame failed schema validation.", { errors: validate.errors });
  return frame;
}

export function renderInteractionFrame(frame) {
  const lines = [`# ${label(frame.stage)}`, "", `- Frame: \`${frame.frameId}\``, `- Subject: \`${frame.subject.type}:${frame.subject.id}\``, `- Digest: \`${frame.subject.digest}\``, ""];
  for (const field of frame.requiredFields) {
    lines.push(`## ${field}`, "", renderValue(frame.renderModel[field]), "");
  }
  if (frame.decision) lines.push("## Human decision", "", frame.decision.question, "");
  lines.push("Presentation is not approval. Engine values and digests are authoritative.");
  return lines.join("\n");
}

export function createPresentationReceipt({ frame, host, presentedFields, visibleTranscriptDigest, now = new Date().toISOString() }) {
  if (host?.level !== "GOVERNED_HUMAN_GATE_COMPATIBLE") throw interactionError("HOST_INTERACTION_COMPLIANCE_UNAVAILABLE", "The current host is not certified for governed human gates.", { host });
  const actual = [...new Set(presentedFields ?? [])];
  const missing = frame.requiredFields.filter((field) => !actual.includes(field));
  const extra = actual.filter((field) => !frame.requiredFields.includes(field));
  if (missing.length || extra.length) throw interactionError("INTERACTION_PRESENTATION_INCOMPLETE", "Visible presentation fields do not exactly match the immutable frame.", { missingFields: missing, unexpectedFields: extra });
  const canonicalMarkdownDigest = digest(frame.canonicalMarkdown);
  if (!/^sha256:[a-f0-9]{64}$/.test(String(visibleTranscriptDigest ?? ""))) throw interactionError("VISIBLE_TRANSCRIPT_DIGEST_REQUIRED", "A digest of the visible canonical transcript is required.");
  if (visibleTranscriptDigest !== canonicalMarkdownDigest) throw interactionError("VISIBLE_TRANSCRIPT_MISMATCH", "The visible transcript does not exactly match the canonical Interaction Frame rendering.");
  const receipt = {
    schema: INTERACTION_PRESENTATION_RECEIPT_SCHEMA,
    frameId: frame.frameId,
    frameDigest: frame.frameDigest,
    stage: frame.stage,
    host: persistedJson(host),
    presentedFields: actual,
    canonicalMarkdownDigest,
    visibleTranscriptDigest,
    presentedAt: now
  };
  receipt.receiptDigest = digest(receipt);
  return receipt;
}

export function requirePresentedFrame(session, stage) {
  const frame = session.interaction?.currentFrame;
  if (!frame || frame.stage !== stage) throw interactionError("INTERACTION_FRAME_REQUIRED", `Current ${stage} frame is missing or stale.`);
  const receipt = session.interaction.presentationReceipts.find((item) => item.frameDigest === frame.frameDigest);
  if (!receipt) throw interactionError("INTERACTION_PRESENTATION_REQUIRED", `Complete visible ${stage} presentation is required before this operation.`);
  return { frame, receipt };
}

function renderValue(value) {
  if (typeof value === "string") return value;
  return `\`\`\`json\n${JSON.stringify(value, null, 2)}\n\`\`\``;
}

function label(value) {
  return value.toLowerCase().split("_").map((item) => item[0].toUpperCase() + item.slice(1)).join(" ");
}

function interactionError(code, message, details = {}) {
  const error = new Error(message);
  error.name = "InteractionComplianceError";
  error.code = code;
  error.nextAction = code === "HOST_INTERACTION_COMPLIANCE_UNAVAILABLE" ? "use-certified-host-or-enable-supported-integration" : "render-current-interaction-frame-completely";
  Object.assign(error, details);
  return error;
}
