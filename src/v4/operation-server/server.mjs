import fs from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { defaultHarnessHome, PACKAGE_ROOT } from "../../v3/constants.mjs";
import { parseCli } from "../../v3/utils.mjs";
import { initializeWorkspace, workspaceStatus } from "../../v3/workspace.mjs";
import { executeV3Operation } from "../../v3/cli.mjs";
import { engineCapabilities, invokeEngineOperation, isReadOnlyOperation } from "../engine-adapter.mjs";
import { AGENT_PROTOCOL_VERSION, DEFAULT_MCP_PROTOCOL_VERSION, DIGITAL_EXPERT_SCHEMA, ENGINE_PROTOCOL_RANGE, MCP_PROTOCOL_VERSIONS, assertExternalWorkspace, assertOperationCompatibility, assertWorkspaceTreeConfined, operationCompatibility } from "../constants.mjs";
import { StdioMcpServer } from "../mcp/stdio-server.mjs";
import { TOOL_DEFINITIONS } from "../protocol/tools.mjs";
import { inspectOperationJob, listOperationJobs, recoverInterruptedOperationJobs, startOperationJob } from "../operation-job/store.mjs";
import { REQUIRED_GOVERNED_HOST_CAPABILITIES } from "../interaction/professional-reasoning.mjs";
import { closeClassificationSession, continueClassificationToHarness, inspectClassificationSession, listClassificationSessions, reanalyzeClassificationSession, recordClassificationPresentationDelivery, resumeClassificationSession, startClassificationSession } from "../classification/session-store.mjs";
import {
  acknowledgeSessionEvidenceReview,
  acknowledgeInteractionFramePresentation,
  approveSessionProposal,
  authorizePlanPublicationOperation,
  authorizeBlockedOperationRetry,
  authorizeSessionPublication,
  cancelAgentSession,
  cleanupAgentSession,
  closeAgentSession,
  confirmSessionPlan,
  createAgentSession,
  createSessionPlan,
  executeSessionPlan,
  inspectAgentSession,
  inspectLifecyclePresentationArchive,
  listAgentSessions,
  migrateOperationSessionCoreCompatibility,
  publishSessionProposal,
  prepareSessionLifecycleInteraction,
  recoverInterruptedSessions,
  recordBusinessViewDelivery,
  reevaluateAgentSession,
  resolveInterruptedOperation,
  resumeAgentSession,
  reviewSessionProposals,
  submitSessionBusinessDecision
} from "../session/store.mjs";

const AUTOMATIC_PRESENTATION_DELIVERY_TOOLS = new Set([
  "plan_operation_session",
  "reevaluate_operation_session",
  "execute_operation_plan",
  "acknowledge_evidence_report_review",
  "start_operation_job",
  "inspect_operation_job",
  "review_session_proposals",
  "approve_session_proposal",
  "submit_business_decision",
  "advance_operation_session",
  "publish_session_proposal",
  "resume_operation_session",
  "migrate_operation_session_core_compatibility",
  "prepare_session_lifecycle_interaction"
]);

export async function serveOperationServer(argv = [], io = {}) {
  const args = parseCli(argv);
  const transport = option(args, "transport", "stdio");
  if (transport !== "stdio") throw usage("v4 supports only --transport stdio.");
  const home = assertExternalWorkspace(option(args, "workspace", defaultHarnessHome()));
  const version = packageVersion();
  const server = new StdioMcpServer({
    name: "evopilot-harness-operation-server",
    version,
    capabilities: { tools: { listChanged: false }, resources: { subscribe: false, listChanged: false }, logging: {} },
    tools: TOOL_DEFINITIONS,
    listResources: () => listResources(home),
    readResource: (uri) => readResource(home, uri, version),
    callTool: (name, input) => callTool(home, name, input, version),
    validateInitialize: (params) => {
      const compatibility = params.clientInfo?.compatibility;
      if (compatibility !== undefined) assertOperationCompatibility(compatibility);
    },
    onInitialized: () => {
      if (workspaceStatus(home).status === "READY") {
        recoverInterruptedSessions(home);
        recoverInterruptedOperationJobs(home);
      }
    },
    input: io.input ?? process.stdin,
    output: io.output ?? process.stdout,
    error: io.error ?? process.stderr
  });
  await server.start();
  return 0;
}

export function operationServerCapabilities(home, version = packageVersion()) {
  return {
    schema: "evopilot-harness-operation-server-capabilities/v1",
    status: "READY",
    productVersion: version,
    compatibility: operationCompatibility(),
    agentProtocolVersion: AGENT_PROTOCOL_VERSION,
    engineProtocolRange: ENGINE_PROTOCOL_RANGE,
    mcp: { transport: "stdio", defaultProtocolVersion: DEFAULT_MCP_PROTOCOL_VERSION, supportedProtocolVersions: MCP_PROTOCOL_VERSIONS, networkListening: false },
    digitalExpert: { schema: DIGITAL_EXPERT_SCHEMA, root: path.join(PACKAGE_ROOT, "digital-expert"), ordinaryHumanEntry: true },
    interaction: {
      schema: "evopilot-harness-interaction-frame/v2",
      protocolVersion: AGENT_PROTOCOL_VERSION,
      hostLevels: ["TRANSPORT_ONLY", "CONVERSATIONAL_COMPATIBLE", "OBSERVABLE_INTERACTION_COMPATIBLE", "GOVERNED_HUMAN_GATE_COMPATIBLE"],
      governedGateCapabilities: [...REQUIRED_GOVERNED_HOST_CAPABILITIES],
      unsupportedHostPolicy: "fail-closed-before-governed-human-gate",
      collapsedContentSubstituteAllowed: false,
      auditEnvelopeCollapsible: true,
      businessViewMustBeExact: true,
      auditEnvelopeMustRemainAvailable: true,
      hostMayAuthorBusinessSemantics: false,
      mcpPresentationContentMode: "exact-canonical-markdown-only",
      hostAssistantTurnPolicy: "replace-with-tool-content-without-prefix-or-suffix",
      businessPresentationTemplateVersion: "evopilot-harness-business-presentation/v2",
      professionalReasoningSchema: "evopilot-harness-professional-analysis/v1",
      sourceOutcomeSchema: "evopilot-harness-source-outcome-explanation/v1",
      evolutionContextSchema: "evopilot-harness-evolution-context-binding/v1",
      deliveryReceiptSchema: "evopilot-harness-canonical-presentation-delivery-receipt/v1",
      automaticPresentationDelivery: {
        mode: "operation-server-canonical-response-path",
        hostPromptRequired: false,
        explicitToolFallbackIdempotent: true,
        authority: "delivery-evidence-only"
      },
      sameContextReplayPolicy: "three-fresh-production-lifecycles-with-normalized-engine-frame-conformance",
      hostReasoningPolicy: "forbidden-fail-closed"
    },
    classification: {
      schema: "evopilot-harness-taxonomy-analysis-result/v1",
      sourceDescriptorSchema: "evopilot-harness-source-descriptor/v1",
      sourceTypes: ["LOCAL_FILE", "LOCAL_DIRECTORY", "LOCAL_GIT_REPOSITORY", "GITHUB_REPOSITORY", "CONTROLLED_FIXTURE", "ORDERED_ATTACHMENT_SET"],
      sourceResolver: { policy: "evopilot-harness-source-resolver/v1", githubAcquisition: "BOUNDED_READ_ONLY_GIT", fullCommitRequired: true, postHandoffRefetchAllowed: false, submodulesAllowed: false, gitLfsAllowed: false, embeddedCredentialsAllowed: false, sourceExecutionAllowed: false },
      ordinaryHumanTerms: ["业务分类方案", "业务领域", "产品或系统类型", "项目分类分析", "分类覆盖情况"],
      outcomes: ["TAXONOMY_MATCHED", "TAXONOMY_EXTENSION_SUGGESTED", "TAXONOMY_EVIDENCE_INSUFFICIENT", "TAXONOMY_AMBIGUOUS"],
      advisorPolicy: "REQUIRED_ON_NEW_ANALYSIS_EXACTLY_ONE_CALL",
      finalAuthority: "deterministic-engine",
      handoffPolicy: "TAXONOMY_MATCHED_PLUS_EXPLICIT_HUMAN_CONTINUE",
      provesHarnessEligibility: false
    },
    longRunningOperations: {
      schema: "evopilot-harness-long-running-operation-capabilities/v1",
      supported: true,
      operations: ["proposal.review"],
      boundedSynchronousTool: "review_session_proposals",
      asynchronousTools: { start: "start_operation_job", inspect: "inspect_operation_job", list: "list_operation_jobs" },
      identityBinding: ["sessionId", "expectedSessionDigest", "operation", "inputDigest"],
      repeatedStartPolicy: "return-same-durable-job",
      disconnectPolicy: "inspect-same-job-without-reexecution",
      processRestartPolicy: "fail-closed-as-interrupted-uncertain",
      resultAuthority: "same-engine-operation-as-synchronous-path"
    },
    workspace: workspaceStatus(home),
    operations: engineCapabilities(),
    authority: { engineAuthoritative: true, digitalExpertMayApprove: false, adapterMayApprove: false, automaticPublication: false, sourceExecutionAllowed: false },
    nextAction: workspaceStatus(home).status === "READY" ? "start-or-resume-operation-session" : "prepare-workspace"
  };
}

async function callTool(home, name, input, version) {
  try {
    let result;
    if (name === "inspect_capabilities") result = operationServerCapabilities(home, version);
    else if (name === "prepare_workspace") {
      assertWorkspaceTreeConfined(home);
      result = input.initialize === false ? workspaceStatus(home) : initializeWorkspace(home);
    }
    else if (name === "initialize_model_configuration") {
      assertWorkspaceTreeConfined(home);
      const response = await executeV3Operation({ positionals: ["llm", "v3-initialize"], options: { workspace: home, "models-file": input.modelsFile, model: input.model, "timeout-ms": input.timeoutMs } });
      result = response.result;
    }
    else if (name === "start_project_classification") result = await startClassificationSession({ home, sourceDescriptor: input.sourceDescriptor ?? input.sourcePath, taxonomy: input.taxonomyPath, ...input });
    else if (name === "reanalyze_project_classification") result = await reanalyzeClassificationSession({ home, sessionId: input.classificationSessionId, sourceDescriptor: input.sourceDescriptor ?? input.sourcePath, taxonomy: input.taxonomyPath, ...input });
    else if (name === "continue_classification_to_harness") result = continueClassificationToHarness({ home, sessionId: input.classificationSessionId, ...input });
    else if (name === "inspect_project_classification") result = inspectClassificationSession(home, input.classificationSessionId);
    else if (name === "resume_project_classification") result = resumeClassificationSession({ home, sessionId: input.classificationSessionId, ...input });
    else if (name === "list_project_classifications") result = { schema: "evopilot-harness-classification-session-list/v1", status: "READY", sessions: listClassificationSessions(home) };
    else if (name === "close_project_classification") result = closeClassificationSession({ home, sessionId: input.classificationSessionId, ...input });
    else if (name === "start_operation_session") result = createAgentSession({ home, ...input });
    else if (name === "plan_operation_session") result = createSessionPlan({ home, ...input });
    else if (name === "reevaluate_operation_session") result = reevaluateAgentSession({ home, ...input });
    else if (name === "confirm_operation_plan") result = confirmSessionPlan({ home, ...input });
    else if (name === "execute_operation_plan") result = await executeSessionPlan({ home, ...input });
    else if (name === "authorize_plan_publication_operation") result = authorizePlanPublicationOperation({ home, ...input });
    else if (name === "resolve_interrupted_operation") result = await resolveInterruptedOperation({ home, ...input });
    else if (name === "authorize_blocked_operation_retry") result = authorizeBlockedOperationRetry({ home, ...input });
    else if (name === "acknowledge_evidence_report_review") result = acknowledgeSessionEvidenceReview({ home, ...input });
    else if (name === "acknowledge_interaction_frame") result = acknowledgeInteractionFramePresentation({ home, ...input });
    else if (name === "record_business_view_delivery") result = recordBusinessViewDelivery({ home, ...input });
    else if (name === "submit_business_decision") result = await submitSessionBusinessDecision({ home, ...input });
    else if (name === "advance_operation_session") result = await advanceOperationSession({ home, ...input });
    else if (name === "start_operation_job") result = startOperationJob({ home, ...input });
    else if (name === "inspect_operation_job") result = inspectOperationJob({ home, ...input });
    else if (name === "list_operation_jobs") result = { schema: "evopilot-harness-operation-job-list/v1", status: "READY", jobs: listOperationJobs(home) };
    else if (name === "review_session_proposals") result = await reviewSessionProposals({ home, ...input });
    else if (name === "approve_session_proposal") result = await approveSessionProposal({ home, ...input });
    else if (name === "authorize_proposal_publication") result = authorizeSessionPublication({ home, ...input });
    else if (name === "publish_session_proposal") result = await publishSessionProposal({ home, ...input });
    else if (name === "inspect_operation_session") result = inspectAgentSession(home, input.sessionId);
    else if (name === "inspect_lifecycle_presentation_archive") result = inspectLifecyclePresentationArchive(home, input.sessionId);
    else if (name === "inspect_operation_session_recovery") result = sessionRecoveryView(inspectAgentSession(home, input.sessionId));
    else if (name === "list_operation_sessions") result = { schema: "evopilot-harness-agent-session-list/v1", status: "READY", sessions: listAgentSessions(home) };
    else if (name === "resume_operation_session") result = resumeAgentSession({ home, ...input });
    else if (name === "migrate_operation_session_core_compatibility") result = sessionRecoveryView(migrateOperationSessionCoreCompatibility({ home, ...input }));
    else if (name === "prepare_session_lifecycle_interaction") result = prepareSessionLifecycleInteraction({ home, ...input });
    else if (name === "cancel_operation_session") result = cancelAgentSession({ home, ...input });
    else if (name === "close_operation_session") result = closeAgentSession({ home, ...input });
    else if (name === "cleanup_operation_session") result = cleanupAgentSession({ home, ...input });
    else if (name === "run_engine_diagnostic") {
      if (!isReadOnlyOperation(input.operation)) throw toolError("READ_ONLY_OPERATION_REQUIRED", `${input.operation} is not a direct read-only diagnostic.`, "create-and-confirm-operation-plan");
      result = await invokeEngineOperation({ home, operation: input.operation, input: input.input ?? {}, authority: "direct" });
    } else throw toolError("UNKNOWN_TOOL", `Unknown tool ${name}.`, "call-tools-list");
    result = automaticallyRecordClassificationPresentation(home, name, result);
    result = automaticallyRecordCanonicalPresentation(home, name, result);
    return toolResult(result, false);
  } catch (error) {
    return toolResult({ schema: "evopilot-harness-agent-operation-error/v1", status: "FAILED", errorType: error.name ?? "Error", code: error.code ?? "OPERATION_FAILED", message: error.message, nextAction: error.nextAction ?? "inspect-operation-failure" }, true);
  }
}

function automaticallyRecordClassificationPresentation(home, toolName, result) {
  if (!["start_project_classification", "reanalyze_project_classification", "close_project_classification"].includes(toolName) || !result?.presentation?.presentationDigest) return result;
  return recordClassificationPresentationDelivery({ home, sessionId: result.sessionId, expectedPresentationDigest: result.presentation.presentationDigest });
}

async function advanceOperationSession({ home, sessionId, modelsFile, model, advisorTimeoutMs, reviewTimeoutMs }) {
  const session = inspectAgentSession(home, sessionId);
  if (["PROPOSAL_REVIEW_PRESENTATION_REQUIRED", "HUMAN_APPROVAL_REQUIRED", "PUBLICATION_PRESENTATION_REQUIRED", "PUBLICATION_DECISION_REQUIRED"].includes(session.status)) return session;
  if (session.status === "READY_TO_EXECUTE") {
    const executed = await executeSessionPlan({ home, sessionId, expectedSessionDigest: session.sessionDigest, expectedPlanDigest: session.planDigest });
    const frame = executed.interaction?.currentFrame;
    if (frame && frame.stage !== "PLAN_PRESENTATION") return executed;
    return operationProgress(executed, "advance-operation-session");
  }
  if (session.status === "PROPOSAL_REVIEW_REQUIRED") {
    const existing = listOperationJobs(home).filter((item) => item.sessionId === sessionId && item.operation === "proposal.review").sort((left, right) => String(left.createdAt).localeCompare(String(right.createdAt))).at(-1);
    if (existing) return inspectOperationJob({ home, jobId: existing.jobId });
    return startOperationJob({ home, sessionId, expectedSessionDigest: session.sessionDigest, operation: "proposal.review", input: { modelsFile, model, advisorTimeoutMs, reviewTimeoutMs } });
  }
  if (session.status === "PUBLICATION_AUTHORIZED") {
    const reference = session.proposals.find((item) => item.publicationAuthorization && item.status !== "PUBLISHED");
    if (!reference) throw toolError("AUTHORIZED_PROPOSAL_NOT_AVAILABLE", "No authorized unpublished Proposal is bound to the current Session.", "inspect-current-operation-session");
    return publishSessionProposal({ home, sessionId, proposalId: reference.proposalId, expectedSessionDigest: session.sessionDigest, expectedAuthorizationDigest: reference.publicationAuthorization.authorizationDigest });
  }
  if (session.status === "COMPLETED" && session.interaction?.currentFrame?.stage === "CATALOG_VALIDATION_PRESENTATION") {
    return prepareSessionLifecycleInteraction({ home, sessionId, expectedSessionDigest: session.sessionDigest, action: "CLOSE" });
  }
  if (session.status === "CLOSED") return operationProgress(session, "session-closed");
  throw toolError("NO_AUTHORIZED_SESSION_ADVANCE", `Session ${sessionId} cannot advance automatically from ${session.status}.`, session.nextAction ?? "inspect-current-operation-session");
}

function operationProgress(session, nextAction) {
  return {
    schema: "evopilot-harness-operation-progress/v1",
    status: session.status,
    sessionId: session.sessionId,
    sessionDigest: session.sessionDigest,
    nextAction: nextAction ?? session.nextAction,
    authority: { alreadyAuthorizedOperationOnly: true, newHumanAuthorityGranted: false, hostMayInferDecision: false }
  };
}

function automaticallyRecordCanonicalPresentation(home, toolName, result) {
  if (!AUTOMATIC_PRESENTATION_DELIVERY_TOOLS.has(toolName)) return result;
  const presentation = authoritativePresentation(result);
  if (!presentation) return result;
  const sessionId = result?.sessionId ?? result?.result?.sessionId ?? presentation.sessionId;
  if (!sessionId) throw toolError("AUTOMATIC_PRESENTATION_SESSION_REQUIRED", "The canonical presentation is not bound to an Agent Operation Session.", "inspect-current-operation-session");
  const current = inspectAgentSession(home, sessionId);
  const frame = current.interaction?.currentFrame;
  if (!frame || frame.frameDigest !== presentation.frameDigest || frame.canonicalMarkdown !== presentation.canonicalMarkdown) {
    throw toolError("AUTOMATIC_PRESENTATION_BINDING_MISMATCH", "The canonical MCP presentation does not match the current Engine-owned Interaction Frame.", "reload-current-business-decision-view");
  }
  const existing = current.interaction.presentationReceipts.find((item) =>
    item.frameDigest === frame.frameDigest
    && item.businessViewDigest === frame.businessView.businessViewDigest
    && item.renderedBusinessViewDigest === frame.businessView.renderedBusinessViewDigest
    && item.host?.id === current.interaction.host?.id
    && item.hostConformanceDigest === current.interaction.host?.conformanceProfile?.hostConformanceDigest
    && item.wholeTurnDelivered === true
    && item.automatic === true
  );
  const delivered = existing ? current : recordBusinessViewDelivery({
    home,
    sessionId,
    expectedSessionDigest: current.sessionDigest,
    expectedFrameDigest: frame.frameDigest,
    deliveredBusinessViewDigest: frame.businessView.businessViewDigest,
    renderedBusinessViewDigest: frame.businessView.renderedBusinessViewDigest
  });
  if (result?.sessionId === sessionId && result?.interaction?.currentFrame) return delivered;
  const receipt = delivered.interaction.presentationReceipts.find((item) => item.frameDigest === frame.frameDigest);
  return {
    ...result,
    automaticPresentationDelivery: {
      schema: "evopilot-harness-automatic-presentation-delivery/v1",
      status: "RECORDED",
      sessionId,
      sessionDigest: delivered.sessionDigest,
      frameId: frame.frameId,
      frameDigest: frame.frameDigest,
      receiptDigest: receipt.receiptDigest,
      authority: { deliveryEvidenceOnly: true, humanApproval: false, publicationAuthorization: false }
    }
  };
}

function sessionRecoveryView(session) {
  const frame = session.interaction?.currentFrame ?? null;
  return {
    schema: "evopilot-harness-session-recovery-view/v1",
    sessionId: session.sessionId,
    sessionDigest: session.sessionDigest,
    status: session.status,
    nextAction: session.nextAction,
    compatibility: session.compatibility,
    proposal: session.proposals?.[0] ? {
      proposalId: session.proposals[0].proposalId,
      proposalDigest: session.proposals[0].proposalDigest,
      status: session.proposals[0].status,
      reviewDigest: session.proposals[0].review?.reviewDigest ?? null,
      reviewVerdict: session.proposals[0].review?.verdict ?? null
    } : null,
    presentation: frame ? {
      stage: frame.stage,
      frameId: frame.frameId,
      frameDigest: frame.frameDigest,
      canonicalMarkdown: frame.canonicalMarkdown,
      decisionDefinition: frame.decisionDefinition
    } : null,
    auditResource: `evopilot-harness://sessions/${session.sessionId}`
  };
}

function listResources(home) {
  const resources = [
    resource("evopilot-harness://capabilities", "Operation Server Capabilities", "Version, protocol, Engine operations, authority, and Workspace state"),
    resource("evopilot-harness://workspace/status", "Workspace Status", "External Workspace readiness and write boundary"),
    resource("evopilot-harness://digital-expert/manifest", "Digital Expert Manifest", "Portable Digital Expert compatibility and adapter manifest"),
    resource("evopilot-harness://sessions", "Agent Operation Sessions", "Persistent resumable session summaries"),
    resource("evopilot-harness://operation-jobs", "Engine Operation Jobs", "Persistent long-running Engine operation identities and results")
  ];
  for (const session of listAgentSessions(home)) resources.push(resource(`evopilot-harness://sessions/${session.sessionId}`, `Session ${session.sessionId}`, `${session.status}: ${session.nextAction}`));
  return resources;
}

function readResource(home, uri, version) {
  let value;
  if (uri === "evopilot-harness://capabilities") value = operationServerCapabilities(home, version);
  else if (uri === "evopilot-harness://workspace/status") value = workspaceStatus(home);
  else if (uri === "evopilot-harness://sessions") value = { schema: "evopilot-harness-agent-session-list/v1", sessions: listAgentSessions(home) };
  else if (uri === "evopilot-harness://operation-jobs") value = { schema: "evopilot-harness-operation-job-list/v1", jobs: listOperationJobs(home) };
  else if (uri === "evopilot-harness://digital-expert/manifest") value = parseYaml(fs.readFileSync(path.join(PACKAGE_ROOT, "digital-expert/expert-manifest.yaml"), "utf8"));
  else if (uri.startsWith("evopilot-harness://sessions/")) value = inspectAgentSession(home, uri.slice("evopilot-harness://sessions/".length));
  else throw toolError("RESOURCE_NOT_FOUND", `Unknown resource ${uri}.`, "call-resources-list");
  return { contents: [{ uri, mimeType: "application/json", text: `${JSON.stringify(value, null, 2)}\n` }] };
}

export function toolResult(value, isError = false) {
  const presentation = isError ? null : authoritativePresentation(value);
  if (!presentation) return { content: [{ type: "text", text: JSON.stringify(value) }], structuredContent: value, ...(isError ? { isError: true } : {}) };
  return {
    content: [{ type: "text", text: presentation.canonicalMarkdown }],
    structuredContent: value,
    _meta: {
      "evopilot/harnessPresentation": {
        schema: "evopilot-harness-mcp-presentation-contract/v1",
        mode: "EXACT_CANONICAL_MARKDOWN_ONLY",
        stage: presentation.stage ?? null,
        frameId: presentation.frameId ?? null,
        frameDigest: presentation.frameDigest ?? null,
        businessViewDigest: presentation.businessView?.businessViewDigest ?? presentation.businessViewDigest ?? null,
        renderedBusinessViewDigest: presentation.businessView?.renderedBusinessViewDigest ?? null,
        soleVisibleBusinessContent: true,
        hostMayAddProse: false,
        assistantTurnMustEqualContentText: true
      }
    }
  };
}

function authoritativePresentation(value) {
  const candidates = [
    value?.presentation,
    value?.result?.presentation,
    value?.interaction?.currentFrame,
    value?.currentFrame
  ];
  return candidates.find((candidate) => candidate && typeof candidate.canonicalMarkdown === "string" && candidate.canonicalMarkdown.length > 0) ?? null;
}

function resource(uri, name, description) {
  return { uri, name, description, mimeType: "application/json" };
}

function packageVersion() {
  return JSON.parse(fs.readFileSync(path.join(PACKAGE_ROOT, "package.json"), "utf8")).version;
}

function option(args, name, fallback) {
  const value = args.options[name];
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function usage(message) {
  const error = new Error(message);
  error.name = "UsageError";
  return error;
}

function toolError(code, message, nextAction) {
  const error = new Error(message);
  error.name = "AgentOperationError";
  error.code = code;
  error.nextAction = nextAction;
  return error;
}
