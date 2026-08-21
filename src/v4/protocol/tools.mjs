import { engineCapabilities } from "../engine-adapter.mjs";

const digest = { type: "string", pattern: "^sha256:[a-f0-9]{64}$" };
const sessionId = { type: "string", minLength: 6 };
const planSources = {
  type: "object",
  additionalProperties: false,
  properties: {
    sourceProjects: stringArray(),
    sourceRoot: { type: "string" },
    githubRepositories: stringArray(),
    githubRef: { type: "string" },
    attachments: stringArray(),
    productionLogs: stringArray(),
    historicalHarnesses: stringArray(),
    notes: stringArray(),
    researchUrls: stringArray(),
    allowInternetResearch: { type: "boolean" },
    includeModules: { type: "boolean" },
    limit: { type: "integer", minimum: 1 },
    advisor: { enum: ["auto", "required", "off"] },
    modelsFile: { type: "string" },
    model: { type: "string" },
    advisorTimeoutMs: { type: "integer", minimum: 1 },
    reviewTimeoutMs: { type: "integer", minimum: 1 },
    now: { type: "string" },
    feedbackFile: { type: "string" },
    comparisonFile: { type: "string" },
    comparisonPolicyFile: { type: "string" },
    calibrationCaseSet: { type: "string" },
    calibrationCaseSetId: { type: "string" },
    baselineMatchPolicy: { type: "string" },
    candidateMatchPolicy: { type: "string" },
    baselineComparisonPolicy: { type: "string" },
    candidateComparisonPolicy: { type: "string" }
  }
};

export const TOOL_DEFINITIONS = [
  tool("inspect_capabilities", "Inspect Agent, MCP, Engine, Digital Expert, lifecycle, and safety capabilities.", {}),
  tool("prepare_workspace", "Initialize or inspect the explicit external Harness Workspace. This never writes the Release or a source project.", {
    initialize: { type: "boolean", default: true }
  }),
  tool("initialize_model_configuration", "Verify the human-maintained Harness model configuration with a minimal live doctor and persist only a secret-free Workspace readiness receipt. Never include credentials in tool arguments.", {
    modelsFile: { type: "string" },
    model: { type: "string" },
    timeoutMs: { type: "integer", minimum: 1 }
  }),
  tool("start_operation_session", "Start a persistent Agent Operation Session from a human intent.", {
    intent: { type: "string", minLength: 1 },
    adapterId: { type: "string", minLength: 2 }
  }, ["intent", "adapterId"]),
  tool("plan_operation_session", "Create a digest-bound evolve, feedback, comparison, calibration, professional-learning, or maintenance plan. Present it to the human before confirmation.", {
    sessionId,
    expectedSessionDigest: digest,
    scenario: { enum: ["evolve", "feedback", "comparison", "calibration", "learning", "maintenance"], default: "evolve" },
    goal: { type: "string", minLength: 1 },
    sources: planSources,
    operations: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["operation", "input"],
        properties: {
          operation: { type: "string", minLength: 1 },
          input: { type: "object", additionalProperties: true }
        }
      }
    }
  }, ["sessionId", "expectedSessionDigest", "goal"]),
  tool("confirm_operation_plan", "Record explicit human confirmation of the exact plan digest. General continuation language is not confirmation.", {
    sessionId,
    expectedSessionDigest: digest,
    expectedPlanDigest: digest,
    confirmedBy: { type: "string", minLength: 1 },
    confirmation: { type: "string", minLength: 1 }
  }, ["sessionId", "expectedSessionDigest", "expectedPlanDigest", "confirmedBy", "confirmation"]),
  tool("execute_operation_plan", "Execute only the confirmed plan through the deterministic Engine. Publication operations and interrupted outcomes stop at separate digest-bound gates.", {
    sessionId,
    expectedSessionDigest: digest,
    expectedPlanDigest: digest,
    retryConfirmation: { type: "string" }
  }, ["sessionId", "expectedSessionDigest", "expectedPlanDigest"]),
  tool("authorize_plan_publication_operation", "Record a separate explicit human authorization for one publication operation in a confirmed maintenance Plan.", {
    sessionId,
    expectedSessionDigest: digest,
    expectedPlanDigest: digest,
    operationIndex: { type: "integer", minimum: 0 },
    expectedOperationDigest: digest,
    confirmedBy: { type: "string", minLength: 1 },
    confirmation: { type: "string", minLength: 1 }
  }, ["sessionId", "expectedSessionDigest", "expectedPlanDigest", "operationIndex", "expectedOperationDigest", "confirmedBy", "confirmation"]),
  tool("resolve_interrupted_operation", "Reconcile an interrupted Engine operation from an immutable receipt or explicitly authorize retry only when the external Workspace is unchanged.", {
    sessionId,
    expectedSessionDigest: digest,
    expectedAttemptDigest: digest,
    confirmedBy: { type: "string", minLength: 1 },
    confirmation: { type: "string", minLength: 1 }
  }, ["sessionId", "expectedSessionDigest", "expectedAttemptDigest", "confirmedBy", "confirmation"]),
  tool("acknowledge_evidence_report_review", "Record that the human reviewed the exact deterministic comparison, calibration, or professional completeness report. This is not Proposal approval, policy activation, rollback, or publication authorization.", {
    sessionId,
    expectedSessionDigest: digest,
    reportType: { enum: ["COMPARISON", "CALIBRATION", "COMPLETENESS"] },
    reportId: { type: "string", minLength: 1 },
    expectedReportDigest: digest,
    confirmedBy: { type: "string", minLength: 1 },
    confirmation: { type: "string", minLength: 1 }
  }, ["sessionId", "expectedSessionDigest", "reportType", "reportId", "expectedReportDigest", "confirmedBy", "confirmation"]),
  tool("review_session_proposals", "Run the authoritative Engine Proposal Review for every Proposal in the session.", {
    sessionId,
    expectedSessionDigest: digest,
    modelsFile: { type: "string" },
    model: { type: "string" },
    advisorTimeoutMs: { type: "integer", minimum: 1 },
    reviewTimeoutMs: { type: "integer", minimum: 1 }
  }, ["sessionId", "expectedSessionDigest"]),
  tool("approve_session_proposal", "Record explicit human approval bound to the current Proposal and Review digests. This does not publish.", {
    sessionId,
    proposalId: { type: "string", minLength: 1 },
    expectedSessionDigest: digest,
    expectedProposalDigest: digest,
    expectedReviewDigest: digest,
    confirmedBy: { type: "string", minLength: 1 },
    confirmation: { type: "string", minLength: 1 },
    evaluationReviewed: { const: true }
  }, ["sessionId", "proposalId", "expectedSessionDigest", "expectedProposalDigest", "expectedReviewDigest", "confirmedBy", "confirmation", "evaluationReviewed"]),
  tool("authorize_proposal_publication", "Record a separate explicit human publication decision for an approved immutable Proposal.", {
    sessionId,
    proposalId: { type: "string", minLength: 1 },
    expectedSessionDigest: digest,
    expectedProposalDigest: digest,
    confirmedBy: { type: "string", minLength: 1 },
    confirmation: { type: "string", minLength: 1 }
  }, ["sessionId", "proposalId", "expectedSessionDigest", "expectedProposalDigest", "confirmedBy", "confirmation"]),
  tool("publish_session_proposal", "Publish only a Proposal with a current separate publication authorization, then validate the Catalog.", {
    sessionId,
    proposalId: { type: "string", minLength: 1 },
    expectedSessionDigest: digest,
    expectedAuthorizationDigest: digest
  }, ["sessionId", "proposalId", "expectedSessionDigest", "expectedAuthorizationDigest"]),
  tool("inspect_operation_session", "Read and integrity-check a persistent Agent Operation Session.", { sessionId }, ["sessionId"]),
  tool("list_operation_sessions", "List resumable Agent Operation Sessions in the current external Workspace.", {}),
  tool("resume_operation_session", "Resume a digest-validated session from another compatible Agent adapter without trusting conversation memory.", {
    sessionId,
    expectedSessionDigest: digest,
    adapterId: { type: "string", minLength: 2 }
  }, ["sessionId", "expectedSessionDigest", "adapterId"]),
  tool("cancel_operation_session", "Explicitly cancel a non-terminal session without deleting its audit state or Harness assets.", {
    sessionId,
    expectedSessionDigest: digest,
    confirmedBy: { type: "string", minLength: 1 },
    confirmation: { type: "string", minLength: 1 }
  }, ["sessionId", "expectedSessionDigest", "confirmedBy", "confirmation"]),
  tool("close_operation_session", "Explicitly close a completed, blocked, or cancelled session while preserving its audit state.", {
    sessionId,
    expectedSessionDigest: digest,
    confirmedBy: { type: "string", minLength: 1 },
    confirmation: { type: "string", minLength: 1 }
  }, ["sessionId", "expectedSessionDigest", "confirmedBy", "confirmation"]),
  tool("cleanup_operation_session", "Delete only closed session metadata whose ownership marker and exact digest are proven. Harness assets and Engine artifacts are preserved.", {
    sessionId,
    expectedSessionDigest: digest,
    confirmedBy: { type: "string", minLength: 1 },
    confirmation: { type: "string", minLength: 1 }
  }, ["sessionId", "expectedSessionDigest", "confirmedBy", "confirmation"]),
  tool("run_engine_diagnostic", "Run one declared read-only Engine diagnostic or validation operation. Mutations, approval, and publication are rejected.", {
    operation: { type: "string", enum: engineCapabilities().filter((item) => item.access === "direct" && item.id !== "workspace.prepare").map((item) => item.id) },
    input: { type: "object", additionalProperties: true }
  }, ["operation"])
];

function tool(name, description, properties, required = []) {
  return {
    name,
    description,
    inputSchema: { type: "object", additionalProperties: false, properties, ...(required.length ? { required } : {}) },
    annotations: { destructiveHint: ["cleanup_operation_session"].includes(name), readOnlyHint: ["inspect_capabilities", "inspect_operation_session", "list_operation_sessions", "run_engine_diagnostic"].includes(name), idempotentHint: name.startsWith("inspect_") || name.startsWith("list_") }
  };
}

function stringArray() {
  return { type: "array", items: { type: "string" } };
}
