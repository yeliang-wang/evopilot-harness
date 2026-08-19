#!/usr/bin/env node

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";

const root = path.resolve(import.meta.dirname, "../..");
const args = parseArgs(process.argv.slice(2));
const workspace = path.resolve(args.workspace ?? path.join(process.env.HOME ?? ".", ".evopilot-harness"));
const command = process.execPath;
const compatibility = clientCompatibility();
const child = spawn(command, [path.join(root, "src/index.mjs"), "mcp", "serve", "--transport", "stdio", "--workspace", workspace], { cwd: root, stdio: ["pipe", "pipe", "pipe"] });
const pending = new Map();
let nextId = 1;
let stderr = "";
child.stderr.setEncoding("utf8");
child.stderr.on("data", (chunk) => { stderr += chunk; });
readline.createInterface({ input: child.stdout, crlfDelay: Infinity }).on("line", (line) => {
  const message = JSON.parse(line);
  const request = pending.get(message.id);
  if (!request) return;
  pending.delete(message.id);
  if (message.error) request.reject(new Error(`${message.error.message}: ${JSON.stringify(message.error.data ?? {})}`));
  else request.resolve(message.result);
});

try {
  const initialized = await request("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "evopilot-harness-generic-agent-host", version: "1.0.0", compatibility } });
  notify("notifications/initialized");
  const listed = await request("tools/list");
  const capabilities = structured(await request("tools/call", { name: "inspect_capabilities", arguments: {} }));
  const manifest = await request("resources/read", { uri: "evopilot-harness://digital-expert/manifest" });
  let resumed = null;
  let workflow = null;
  if (args.session && args["session-digest"]) {
    resumed = structured(await request("tools/call", { name: "resume_operation_session", arguments: { sessionId: args.session, expectedSessionDigest: args["session-digest"], adapterId: args["adapter-id"] ?? "generic-agent-host" } }));
    if (resumed.status === "FAILED") throw new Error(`${resumed.code}: ${resumed.message}`);
  }
  if (args.source) {
    const prepared = structured(await request("tools/call", { name: "prepare_workspace", arguments: { initialize: true } }));
    const adapterId = args["adapter-id"] ?? "generic-agent-host";
    const intent = args.goal ?? "Produce or evolve a reusable Harness from static evidence";
    const started = structured(await request("tools/call", { name: "start_operation_session", arguments: { intent, adapterId } }));
    const planned = structured(await request("tools/call", { name: "plan_operation_session", arguments: { sessionId: started.sessionId, expectedSessionDigest: started.sessionDigest, scenario: "evolve", goal: intent, sources: { sourceProjects: [path.resolve(args.source)], advisor: "off" } } }));
    const confirmed = structured(await request("tools/call", { name: "confirm_operation_plan", arguments: { sessionId: planned.sessionId, expectedSessionDigest: planned.sessionDigest, expectedPlanDigest: planned.planDigest, confirmedBy: "generic-host-conformance", confirmation: `CONFIRM_OPERATION_PLAN:${planned.planDigest}` } }));
    const produced = structured(await request("tools/call", { name: "execute_operation_plan", arguments: { sessionId: confirmed.sessionId, expectedSessionDigest: confirmed.sessionDigest, expectedPlanDigest: confirmed.planDigest } }));
    workflow = {
      statuses: [prepared.status, started.status, planned.status, confirmed.status, produced.status],
      plan: { scenario: planned.plan.scenario, operations: planned.plan.operations.map((item) => item.operation), stopPoints: planned.plan.stopPoints },
      engineCalls: produced.operations.filter((item) => item.phase === "plan" && item.planCompleted === true).map((item) => item.operation),
      renderedDecision: { status: produced.status, nextAction: produced.nextAction, proposalCount: produced.proposals.length },
      session: { sessionId: produced.sessionId, sessionDigest: produced.sessionDigest }
    };
  }
  const requiredTools = ["start_operation_session", "plan_operation_session", "confirm_operation_plan", "execute_operation_plan", "authorize_plan_publication_operation", "resolve_interrupted_operation", "review_session_proposals", "approve_session_proposal", "authorize_proposal_publication", "publish_session_proposal"];
  const missingTools = requiredTools.filter((name) => !listed.tools.some((tool) => tool.name === name));
  const workflowPassed = !workflow || workflow.renderedDecision.status === "PROPOSAL_REVIEW_REQUIRED";
  const report = {
    schema: "evopilot-harness-generic-agent-host-conformance/v1",
    status: initialized.protocolVersion === "2025-06-18" && capabilities.status === "READY" && missingTools.length === 0 && manifest.contents?.length === 1 && workflowPassed ? "PASSED" : "FAILED",
    adapterId: "generic",
    protocolVersion: initialized.protocolVersion,
    server: initialized.serverInfo,
    toolCount: listed.tools.length,
    missingTools,
    networkListening: capabilities.mcp.networkListening,
    engineProtocolRange: capabilities.engineProtocolRange,
    compatibility: capabilities.compatibility,
    digitalExpertSchema: JSON.parse(manifest.contents[0].text).schema,
    resumedSession: resumed ? { sessionId: resumed.sessionId, status: resumed.status, sessionDigest: resumed.sessionDigest, adapter: resumed.adapter.current } : null,
    workflow
  };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (report.status !== "PASSED") process.exitCode = 2;
} catch (error) {
  process.stderr.write(`${JSON.stringify({ schema: "evopilot-harness-generic-agent-host-conformance/v1", status: "FAILED", error: error.message, serverStderr: stderr })}\n`);
  process.exitCode = 1;
} finally {
  child.stdin.end();
  await new Promise((resolve) => child.once("exit", resolve));
}

function request(method, params = {}) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
  });
}

function notify(method, params = {}) {
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`);
}

function structured(result) {
  if (result.isError) throw new Error(`${result.structuredContent?.code}: ${result.structuredContent?.message}`);
  return result.structuredContent;
}

function parseArgs(values) {
  const result = {};
  for (let index = 0; index < values.length; index += 1) {
    if (!values[index].startsWith("--")) continue;
    result[values[index].slice(2)] = values[index + 1]?.startsWith("--") ? true : values[++index];
  }
  return result;
}

function clientCompatibility() {
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  const lock = JSON.parse(fs.readFileSync(path.join(root, "digital-expert/manifest.lock.json"), "utf8"));
  return {
    productVersion: packageJson.version,
    expertVersion: lock.expertVersion,
    coreDigest: lock.coreDigest,
    agentProtocolVersion: "evopilot-harness-agent-operations/v1",
    engineApiVersion: "harness.evopilot.io/v3"
  };
}
