import { engineCapabilities } from "../engine-adapter.mjs";

const digest = { type: "string", pattern: "^sha256:[a-f0-9]{64}$" };
const sessionId = { type: "string", minLength: 6 };
const sourceDescriptor = {
  type: "object",
  additionalProperties: false,
  required: ["type"],
  properties: {
    schema: { const: "evopilot-harness-source-descriptor/v1" },
    sourceId: { type: "string", minLength: 3, maxLength: 96 },
    safeLabel: { type: "string", minLength: 1, maxLength: 160 },
    type: { enum: ["LOCAL_FILE", "LOCAL_DIRECTORY", "LOCAL_GIT_REPOSITORY", "GITHUB_REPOSITORY", "CONTROLLED_FIXTURE", "ORDERED_ATTACHMENT_SET"] },
    path: { type: "string", minLength: 1 },
    repository: { type: "string", minLength: 3 },
    url: { type: "string", minLength: 3 },
    requestedRef: { type: "string", minLength: 1, maxLength: 256 },
    ref: { type: "string", minLength: 1, maxLength: 256 },
    privateRepository: { type: "boolean" },
    locator: {
      type: "object", additionalProperties: false,
      properties: {
        class: { enum: ["LOCAL_PATH", "GITHUB_REPOSITORY", "ORDERED_MEMBERS"] },
        path: { type: "string", minLength: 1 },
        repository: { type: "string", minLength: 3 },
        transport: { enum: ["HTTPS", "SSH"] }
      }
    },
    members: {
      type: "array", minItems: 1, maxItems: 128,
      items: {
        type: "object", additionalProperties: false, required: ["path"],
        properties: { sourceId: { type: "string", minLength: 3, maxLength: 96 }, safeLabel: { type: "string", minLength: 1, maxLength: 160 }, path: { type: "string", minLength: 1 } }
      }
    }
  }
};
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
  tool("inspect_capabilities", "Silently inspect Agent, MCP, Engine, Digital Expert, lifecycle, and safety capabilities. Do not narrate or tabulate a successful result; continue silently until the first Engine-owned canonical presentation.", {}),
  tool("prepare_workspace", "Silently initialize or inspect the explicit external Harness Workspace. This never writes the Release or a source project. Do not narrate a successful result; continue silently until the first Engine-owned canonical presentation.", {
    initialize: { type: "boolean", default: true }
  }),
  tool("initialize_model_configuration", "Verify the human-maintained Harness model configuration with a minimal live doctor and persist only a secret-free Workspace readiness receipt. Never include credentials in tool arguments.", {
    modelsFile: { type: "string" },
    model: { type: "string" },
    timeoutMs: { type: "integer", minimum: 1 }
  }),
  tool("start_project_classification", "Analyze an unknown static Source against one user-owned business classification scheme. The Engine extracts taxonomy-blind concepts, records deterministic retrieval signals, makes exactly one required Harness Advisor call, and returns an Engine-owned 项目分类分析 result without entering Harness Eligibility.", {
    sourceDescriptor,
    sourcePath: { type: "string", minLength: 1 },
    taxonomyPath: { type: "string", minLength: 1 },
    intent: { type: "string", minLength: 1 },
    locale: { enum: ["zh-CN", "en"], default: "zh-CN" },
    modelsFile: { type: "string" },
    model: { type: "string" },
    advisorTimeoutMs: { type: "integer", minimum: 1 },
    adapterId: { type: "string", minLength: 2 },
    hostInteraction: {
      type: "object", additionalProperties: false, required: ["id", "version", "level", "capabilities"],
      properties: {
        id: { type: "string", minLength: 1 }, version: { type: "string", minLength: 1 }, level: { const: "GOVERNED_HUMAN_GATE_COMPATIBLE" },
        capabilities: { type: "array", minItems: 10, uniqueItems: true, items: { type: "string", minLength: 1 } },
        locale: { enum: ["zh-CN", "en"] }, supportsOperationJobs: { type: "boolean" }, maxSynchronousMcpRequestMs: { type: "integer", minimum: 1 }
      }
    }
  }, ["taxonomyPath", "intent", "adapterId", "hostInteraction"]),
  tool("reanalyze_project_classification", "Create a new immutable classification attempt after the user supplies revised Source evidence, a revised valid business classification scheme, or an explicitly changed model or prompt binding. The prior attempt remains unchanged.", {
    classificationSessionId: { type: "string", minLength: 8 },
    expectedSessionDigest: digest,
    sourceDescriptor,
    sourcePath: { type: "string" },
    taxonomyPath: { type: "string" },
    intent: { type: "string" },
    locale: { enum: ["zh-CN", "en"] },
    modelsFile: { type: "string" },
    model: { type: "string" },
    advisorTimeoutMs: { type: "integer", minimum: 1 }
  }, ["classificationSessionId", "expectedSessionDigest"]),
  tool("continue_classification_to_harness", "After a complete TAXONOMY_MATCHED result and an explicit human continue choice, bind the exact classification result into the same generic Agent Operation Session and continue with independent Harness Eligibility. This does not prove Harness Eligibility, create a Proposal, approve, or publish.", {
    classificationSessionId: { type: "string", minLength: 8 },
    expectedSessionDigest: digest,
    decisionToken: { type: "string", minLength: 1 },
    decidedBy: { type: "string", minLength: 1 }
  }, ["classificationSessionId", "expectedSessionDigest", "decisionToken", "decidedBy"]),
  tool("inspect_project_classification", "Inspect and integrity-check one persistent Engine-owned Classification Session.", { classificationSessionId: { type: "string", minLength: 8 } }, ["classificationSessionId"]),
  tool("resume_project_classification", "Resume the generic AgentOperationSession carrying one unfinished classification lifecycle from another compatible Adapter without trusting conversation memory.", {
    classificationSessionId: { type: "string", minLength: 8 }, expectedSessionDigest: digest, adapterId: { type: "string", minLength: 2 }
  }, ["classificationSessionId", "expectedSessionDigest", "adapterId"]),
  tool("list_project_classifications", "List persistent Classification Sessions in the current external Workspace.", {}),
  tool("close_project_classification", "After an explicit human close or cancel choice, close or cancel a Classification Session without entering Harness Eligibility or mutating Taxonomy or Catalog state. The Engine resolves and records the current Session digest when expectedSessionDigest is omitted because the Host cannot observe MCP structuredContent; when supplied, a stale digest still fails closed.", {
    classificationSessionId: { type: "string", minLength: 8 }, expectedSessionDigest: digest, decidedBy: { type: "string", minLength: 1 }, decision: { enum: ["CLOSE", "CANCEL"] }
  }, ["classificationSessionId", "decidedBy", "decision"]),
  tool("start_operation_session", "Silently start a persistent Agent Operation Session from a human intent. Do not narrate a successful result; continue to Plan construction.", {
    intent: { type: "string", minLength: 1 },
    adapterId: { type: "string", minLength: 2 },
    hostInteraction: {
      type: "object",
      additionalProperties: false,
      required: ["id", "version", "level", "capabilities"],
      properties: {
        id: { type: "string", minLength: 1 },
        version: { type: "string", minLength: 1 },
        level: { const: "GOVERNED_HUMAN_GATE_COMPATIBLE" },
        capabilities: { type: "array", minItems: 10, uniqueItems: true, items: { type: "string", minLength: 1 } },
        locale: { enum: ["zh-CN", "en"] },
        supportsOperationJobs: { type: "boolean" },
        maxSynchronousMcpRequestMs: { type: "integer", minimum: 1 }
      }
    }
  }, ["intent", "adapterId", "hostInteraction"]),
  tool("plan_operation_session", "Create a digest-bound evolve, feedback, comparison, calibration, professional-learning, or maintenance plan. When the result carries EXACT_CANONICAL_MARKDOWN_ONLY, the entire assistant turn MUST equal content[0].text byte-for-byte. It already contains the decision question and choices; append nothing.", {
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
  tool("reevaluate_operation_session", "Explicitly evaluate the current Source and governed environment in a new append-only Session. The prior Session and Evolution Context remain unchanged; the new Plan still requires independent human review and confirmation.", {
    sessionId,
    expectedSessionDigest: digest,
    adapterId: { type: "string", minLength: 2 },
    intent: { type: "string", minLength: 1 },
    scenario: { enum: ["evolve", "feedback", "comparison", "calibration", "learning", "maintenance"] },
    goal: { type: "string", minLength: 1 },
    sources: planSources,
    locale: { enum: ["zh-CN", "en"] }
  }, ["sessionId", "expectedSessionDigest"]),
  tool("confirm_operation_plan", "Low-level compatibility/CI tool only. Third-party Agent Hosts MUST NOT call this tool or discover digests; after an Engine-owned business view they MUST use submit_business_decision with the hidden transport binding. Record explicit human confirmation of the exact plan digest. General continuation language is not confirmation.", {
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
  tool("authorize_blocked_operation_retry", "Authorize retry of an explicitly repairable blocked Engine operation only after the exact blocker and retry frames were presented and the external Workspace remains unchanged.", {
    sessionId,
    expectedSessionDigest: digest,
    expectedFailedResultDigest: digest,
    expectedWorkspaceDigest: digest,
    confirmedBy: { type: "string", minLength: 1 },
    confirmation: { type: "string", minLength: 1 }
  }, ["sessionId", "expectedSessionDigest", "expectedFailedResultDigest", "expectedWorkspaceDigest", "confirmedBy", "confirmation"]),
  tool("acknowledge_evidence_report_review", "Record that the human reviewed the exact deterministic comparison, calibration, or professional completeness report. This is not Proposal approval, policy activation, rollback, or publication authorization.", {
    sessionId,
    expectedSessionDigest: digest,
    reportType: { enum: ["COMPARISON", "CALIBRATION", "COMPLETENESS"] },
    reportId: { type: "string", minLength: 1 },
    expectedReportDigest: digest,
    confirmedBy: { type: "string", minLength: 1 },
    confirmation: { type: "string", minLength: 1 }
  }, ["sessionId", "expectedSessionDigest", "reportType", "reportId", "expectedReportDigest", "confirmedBy", "confirmation"]),
  tool("acknowledge_interaction_frame", "Record complete visible canonical presentation of the current immutable Interaction Frame. This presentation evidence is never Plan confirmation, evidence acknowledgement, Proposal approval, publication authorization, retry authorization, cancellation, close, or cleanup.", {
    sessionId,
    expectedSessionDigest: digest,
    expectedFrameDigest: digest,
    presentedFields: { type: "array", minItems: 1, uniqueItems: true, items: { type: "string", minLength: 1 } },
    visibleTranscriptDigest: digest,
    confirmedBy: { type: "string", minLength: 1 },
    confirmation: { type: "string", minLength: 1 }
  }, ["sessionId", "expectedSessionDigest", "expectedFrameDigest", "presentedFields", "visibleTranscriptDigest", "confirmedBy", "confirmation"]),
  tool("record_business_view_delivery", "Idempotently record exact Host delivery of the current Engine-owned Business Decision View as the sole visible prose in the governed assistant turn. Canonical presentation-producing MCP response paths perform this automatically without a Host prompt; this explicit tool remains a compatibility and recovery fallback. renderedBusinessViewDigest MUST cover the entire visible prose and therefore MUST equal the canonical Business View digest; any Host preface, translation, summary, status, or next-step prose makes delivery non-compliant. This receipt is never a human decision or authorization.", {
    sessionId,
    expectedSessionDigest: digest,
    expectedFrameDigest: digest,
    deliveredBusinessViewDigest: digest,
    renderedBusinessViewDigest: digest
  }, ["sessionId", "expectedSessionDigest", "expectedFrameDigest", "deliveredBusinessViewDigest", "renderedBusinessViewDigest"]),
  tool("submit_business_decision", "MANDATORY third-party Agent Host decision transport. After the human answers the current Engine-owned Business Decision View, call this tool directly with only its hidden decisionHandle, one declared finite choice, and the human identity. Do NOT call confirm_operation_plan or any digest-bound compatibility tool. The Engine uniquely resolves the current Session and validates all immutable digests and internal confirmation tokens. Generic continuation, stale or ambiguous handles, Host-authored choices, and undeclared options fail closed. Do not narrate success. If the result carries EXACT_CANONICAL_MARKDOWN_ONLY, the entire assistant turn MUST equal content[0].text byte-for-byte and append nothing.", {
    sessionId,
    decisionHandle: { type: "string", pattern: "^decision-[a-f0-9]{24}$" },
    choice: { enum: ["APPROVE", "REQUEST_REVISION", "REJECT", "PRESERVE_FOR_LATER", "AUTHORIZE", "PUBLISH", "DO_NOT_PUBLISH", "ACCEPT_RECEIPT", "RETRY_IF_UNCHANGED", "CANCEL", "CLOSE", "CLEANUP", "ACKNOWLEDGE_REVIEW", "REQUEST_MORE_EVIDENCE", "CONTINUE_TO_PROPOSAL_DECISION", "REVIEW_REMEDIATION"] },
    decidedBy: { type: "string", minLength: 1 }
  }, ["decisionHandle", "choice", "decidedBy"]),
  tool("advance_operation_session", "Advance only the next already-authorized non-human Harness operation from authoritative Session state. Repeat only while responses are non-presentation operation progress or a running OperationJob. The instant any response carries EXACT_CANONICAL_MARKDOWN_ONLY, stop all tool calls, emit content[0].text byte-for-byte as the entire assistant turn, and end the turn even when the Frame is informational and has no human decision. Never advance from Catalog validation to Close in the same assistant turn. It never grants Plan, Proposal, publication, retry, close, or cleanup authority.", {
    sessionId,
    modelsFile: { type: "string" },
    model: { type: "string" },
    advisorTimeoutMs: { type: "integer", minimum: 1 },
    reviewTimeoutMs: { type: "integer", minimum: 1 }
  }, ["sessionId"]),
  tool("review_session_proposals", "Run the authoritative Engine Proposal Review for every Proposal in the session.", {
    sessionId,
    expectedSessionDigest: digest,
    modelsFile: { type: "string" },
    model: { type: "string" },
    advisorTimeoutMs: { type: "integer", minimum: 1 },
    reviewTimeoutMs: { type: "integer", minimum: 1 }
  }, ["sessionId", "expectedSessionDigest"]),
  tool("start_operation_job", "Start or recover the same durable Engine-owned long-running operation. Repeating an identical request returns the same job and never re-executes it.", {
    sessionId,
    expectedSessionDigest: digest,
    operation: { enum: ["proposal.review"] },
    input: {
      type: "object",
      additionalProperties: false,
      properties: {
        modelsFile: { type: "string" },
        model: { type: "string" },
        advisorTimeoutMs: { type: "integer", minimum: 1 },
        reviewTimeoutMs: { type: "integer", minimum: 1 }
      }
    }
  }, ["sessionId", "expectedSessionDigest", "operation"]),
  tool("inspect_operation_job", "Inspect the durable status or authoritative result of one Engine-owned OperationJob without re-executing it.", {
    jobId: { type: "string", minLength: 8 },
    expectedJobDigest: digest
  }, ["jobId"]),
  tool("list_operation_jobs", "List durable Engine-owned OperationJobs in the current external Workspace.", {}),
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
  tool("inspect_lifecycle_presentation_archive", "Read the complete Engine-owned lifecycle business presentation reconstructed from immutable Session, Proposal, approval, publication, and Catalog bindings. This performs no governed mutation and grants no authority.", { sessionId }, ["sessionId"]),
  tool("inspect_operation_session_recovery", "Read the compact authoritative recovery state and current canonical Business Decision View without transferring the full Session Audit Envelope.", { sessionId }, ["sessionId"]),
  tool("list_operation_sessions", "List resumable Agent Operation Sessions in the current external Workspace.", {}),
  tool("resume_operation_session", "Resume a digest-validated session from another compatible Agent adapter without trusting conversation memory.", {
    sessionId,
    expectedSessionDigest: digest,
    adapterId: { type: "string", minLength: 2 }
  }, ["sessionId", "expectedSessionDigest", "adapterId"]),
  tool("migrate_operation_session_core_compatibility", "Explicitly rebind a stopped Protocol v3 Session to a compatible replacement Core while preserving business state and authority boundaries.", {
    sessionId,
    expectedSessionDigest: digest,
    expectedPriorCoreDigest: digest,
    adapterId: { type: "string", minLength: 2 }
  }, ["sessionId", "expectedSessionDigest", "expectedPriorCoreDigest", "adapterId"]),
  tool("prepare_session_lifecycle_interaction", "Construct the complete immutable recovery, cancellation, close, or cleanup frame before asking for the independent human decision.", {
    sessionId,
    expectedSessionDigest: digest,
    action: { enum: ["RECOVERY", "BLOCKED_RETRY", "CANCEL", "CLOSE", "CLEANUP"] }
  }, ["sessionId", "expectedSessionDigest", "action"]),
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
    annotations: { destructiveHint: ["cleanup_operation_session"].includes(name), readOnlyHint: ["inspect_capabilities", "inspect_operation_session", "inspect_lifecycle_presentation_archive", "inspect_operation_job", "list_operation_sessions", "list_operation_jobs", "run_engine_diagnostic"].includes(name), idempotentHint: name.startsWith("inspect_") || name.startsWith("list_") || name === "start_operation_job" }
  };
}

function stringArray() {
  return { type: "array", items: { type: "string" } };
}
