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
  listAgentSessions,
  publishSessionProposal,
  prepareSessionLifecycleInteraction,
  recoverInterruptedSessions,
  resolveInterruptedOperation,
  resumeAgentSession,
  reviewSessionProposals
} from "../session/store.mjs";

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
      if (workspaceStatus(home).status === "READY") recoverInterruptedSessions(home);
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
      schema: "evopilot-harness-interaction-frame/v1",
      protocolVersion: AGENT_PROTOCOL_VERSION,
      hostLevels: ["TRANSPORT_ONLY", "CONVERSATIONAL_COMPATIBLE", "OBSERVABLE_INTERACTION_COMPATIBLE", "GOVERNED_HUMAN_GATE_COMPATIBLE"],
      governedGateCapabilities: ["deterministic-rendering", "governed-operation-interception", "ordered-visible-transcript-evidence", "interaction-frame-binding"],
      unsupportedHostPolicy: "fail-closed-before-governed-human-gate",
      collapsedContentSubstituteAllowed: false
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
    else if (name === "start_operation_session") result = createAgentSession({ home, ...input });
    else if (name === "plan_operation_session") result = createSessionPlan({ home, ...input });
    else if (name === "confirm_operation_plan") result = confirmSessionPlan({ home, ...input });
    else if (name === "execute_operation_plan") result = await executeSessionPlan({ home, ...input });
    else if (name === "authorize_plan_publication_operation") result = authorizePlanPublicationOperation({ home, ...input });
    else if (name === "resolve_interrupted_operation") result = await resolveInterruptedOperation({ home, ...input });
    else if (name === "authorize_blocked_operation_retry") result = authorizeBlockedOperationRetry({ home, ...input });
    else if (name === "acknowledge_evidence_report_review") result = acknowledgeSessionEvidenceReview({ home, ...input });
    else if (name === "acknowledge_interaction_frame") result = acknowledgeInteractionFramePresentation({ home, ...input });
    else if (name === "review_session_proposals") result = await reviewSessionProposals({ home, ...input });
    else if (name === "approve_session_proposal") result = await approveSessionProposal({ home, ...input });
    else if (name === "authorize_proposal_publication") result = authorizeSessionPublication({ home, ...input });
    else if (name === "publish_session_proposal") result = await publishSessionProposal({ home, ...input });
    else if (name === "inspect_operation_session") result = inspectAgentSession(home, input.sessionId);
    else if (name === "list_operation_sessions") result = { schema: "evopilot-harness-agent-session-list/v1", status: "READY", sessions: listAgentSessions(home) };
    else if (name === "resume_operation_session") result = resumeAgentSession({ home, ...input });
    else if (name === "prepare_session_lifecycle_interaction") result = prepareSessionLifecycleInteraction({ home, ...input });
    else if (name === "cancel_operation_session") result = cancelAgentSession({ home, ...input });
    else if (name === "close_operation_session") result = closeAgentSession({ home, ...input });
    else if (name === "cleanup_operation_session") result = cleanupAgentSession({ home, ...input });
    else if (name === "run_engine_diagnostic") {
      if (!isReadOnlyOperation(input.operation)) throw toolError("READ_ONLY_OPERATION_REQUIRED", `${input.operation} is not a direct read-only diagnostic.`, "create-and-confirm-operation-plan");
      result = await invokeEngineOperation({ home, operation: input.operation, input: input.input ?? {}, authority: "direct" });
    } else throw toolError("UNKNOWN_TOOL", `Unknown tool ${name}.`, "call-tools-list");
    return toolResult(result, false);
  } catch (error) {
    return toolResult({ schema: "evopilot-harness-agent-operation-error/v1", status: "FAILED", errorType: error.name ?? "Error", code: error.code ?? "OPERATION_FAILED", message: error.message, nextAction: error.nextAction ?? "inspect-operation-failure" }, true);
  }
}

function listResources(home) {
  const resources = [
    resource("evopilot-harness://capabilities", "Operation Server Capabilities", "Version, protocol, Engine operations, authority, and Workspace state"),
    resource("evopilot-harness://workspace/status", "Workspace Status", "External Workspace readiness and write boundary"),
    resource("evopilot-harness://digital-expert/manifest", "Digital Expert Manifest", "Portable Digital Expert compatibility and adapter manifest"),
    resource("evopilot-harness://sessions", "Agent Operation Sessions", "Persistent resumable session summaries")
  ];
  for (const session of listAgentSessions(home)) resources.push(resource(`evopilot-harness://sessions/${session.sessionId}`, `Session ${session.sessionId}`, `${session.status}: ${session.nextAction}`));
  return resources;
}

function readResource(home, uri, version) {
  let value;
  if (uri === "evopilot-harness://capabilities") value = operationServerCapabilities(home, version);
  else if (uri === "evopilot-harness://workspace/status") value = workspaceStatus(home);
  else if (uri === "evopilot-harness://sessions") value = { schema: "evopilot-harness-agent-session-list/v1", sessions: listAgentSessions(home) };
  else if (uri === "evopilot-harness://digital-expert/manifest") value = parseYaml(fs.readFileSync(path.join(PACKAGE_ROOT, "digital-expert/expert-manifest.yaml"), "utf8"));
  else if (uri.startsWith("evopilot-harness://sessions/")) value = inspectAgentSession(home, uri.slice("evopilot-harness://sessions/".length));
  else throw toolError("RESOURCE_NOT_FOUND", `Unknown resource ${uri}.`, "call-resources-list");
  return { contents: [{ uri, mimeType: "application/json", text: `${JSON.stringify(value, null, 2)}\n` }] };
}

function toolResult(value, isError) {
  return { content: [{ type: "text", text: JSON.stringify(value) }], structuredContent: value, ...(isError ? { isError: true } : {}) };
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
