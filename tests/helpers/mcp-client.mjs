import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { REQUIRED_GOVERNED_HOST_CAPABILITIES } from "../../src/v4/interaction/professional-reasoning.mjs";
import readline from "node:readline";
import crypto from "node:crypto";

export class TestMcpClient {
  constructor({ command, args, cwd, env = process.env }) {
    this.child = spawn(command, args, { cwd, env, stdio: ["pipe", "pipe", "pipe"] });
    this.nextId = 1;
    this.pending = new Map();
    this.stderr = "";
    this.child.stderr.setEncoding("utf8");
    this.child.stderr.on("data", (chunk) => { this.stderr += chunk; });
    this.child.on("exit", (code, signal) => {
      for (const { reject } of this.pending.values()) reject(new Error(`MCP process exited code=${code} signal=${signal}`));
      this.pending.clear();
    });
    const lines = readline.createInterface({ input: this.child.stdout, crlfDelay: Infinity });
    lines.on("line", (line) => {
      const message = JSON.parse(line);
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(Object.assign(new Error(message.error.message), { response: message }));
      else pending.resolve(message.result);
    });
  }

  request(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    });
  }

  notify(method, params = {}) {
    this.child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`);
  }

  async initialize(protocolVersion = "2025-06-18", compatibility = defaultCompatibility(this.child.spawnargs)) {
    const result = await this.request("initialize", { protocolVersion, capabilities: {}, clientInfo: { name: "evopilot-harness-test-client", version: "1.0.0", compatibility } });
    this.notify("notifications/initialized");
    return result;
  }

  async initializeStandard(protocolVersion = "2025-06-18") {
    const result = await this.request("initialize", { protocolVersion, capabilities: {}, clientInfo: { name: "standard-mcp-test-client", version: "1.0.0" } });
    this.notify("notifications/initialized");
    return result;
  }

  async tool(name, args = {}) {
    const input = { ...args };
    if (name === "start_operation_session" && input.hostInteraction === undefined) input.hostInteraction = governedHostInteraction();
    if (name === "approve_session_proposal" && input.sessionId && input.expectedSessionDigest) {
      const inspectedResult = await this.request("tools/call", { name: "inspect_operation_session", arguments: { sessionId: input.sessionId } });
      const inspected = inspectedResult.structuredContent;
      const frame = inspected?.interaction?.currentFrame;
      if (frame?.stage === "PROPOSAL_REVIEW_PRESENTATION") {
        const transitioned = await this.request("tools/call", { name: "submit_business_decision", arguments: {
          sessionId: input.sessionId,
          decisionHandle: frame.decisionDefinition.decisionHandle,
          choice: "CONTINUE_TO_PROPOSAL_DECISION",
          decidedBy: input.confirmedBy
        } });
        if (!transitioned.isError) input.expectedSessionDigest = transitioned.structuredContent.sessionDigest;
      }
    }
    const lifecycleAction = { resolve_interrupted_operation: "RECOVERY", authorize_blocked_operation_retry: "BLOCKED_RETRY", cancel_operation_session: "CANCEL", close_operation_session: "CLOSE", cleanup_operation_session: "CLEANUP" }[name];
    if (lifecycleAction && input.sessionId && input.expectedSessionDigest) {
      const prepared = await this.request("tools/call", { name: "prepare_session_lifecycle_interaction", arguments: { sessionId: input.sessionId, expectedSessionDigest: input.expectedSessionDigest, action: lifecycleAction } });
      if (!prepared.isError) input.expectedSessionDigest = prepared.structuredContent.sessionDigest;
    }
    if (input.sessionId && input.expectedSessionDigest && ["confirm_operation_plan", "authorize_plan_publication_operation", "resolve_interrupted_operation", "authorize_blocked_operation_retry", "acknowledge_evidence_report_review", "approve_session_proposal", "authorize_proposal_publication", "cancel_operation_session", "close_operation_session", "cleanup_operation_session"].includes(name)) {
      const inspectedResult = await this.request("tools/call", { name: "inspect_operation_session", arguments: { sessionId: input.sessionId } });
      const inspected = inspectedResult.structuredContent;
      const frame = inspected?.interaction?.currentFrame;
      const alreadyPresented = frame && inspected.interaction.presentationReceipts.some((item) => item.frameDigest === frame.frameDigest);
      if (frame && !alreadyPresented && inspected.sessionDigest === input.expectedSessionDigest) {
        const businessViewDigest = frame.businessView.businessViewDigest;
        const presented = await this.request("tools/call", { name: "record_business_view_delivery", arguments: {
          sessionId: input.sessionId,
          expectedSessionDigest: inspected.sessionDigest,
          expectedFrameDigest: frame.frameDigest,
          deliveredBusinessViewDigest: businessViewDigest,
          renderedBusinessViewDigest: `sha256:${crypto.createHash("sha256").update(frame.businessView.canonicalMarkdown).digest("hex")}`
        } });
        if (!presented.isError) input.expectedSessionDigest = presented.structuredContent.sessionDigest;
      }
    }
    if (name === "cancel_operation_session" && input.sessionId && input.expectedSessionDigest) input.confirmation = `CANCEL_SESSION:${input.sessionId}:${input.expectedSessionDigest}`;
    if (name === "close_operation_session" && input.sessionId && input.expectedSessionDigest) input.confirmation = `CLOSE_SESSION:${input.sessionId}:${input.expectedSessionDigest}`;
    if (name === "cleanup_operation_session" && input.sessionId && input.expectedSessionDigest) input.confirmation = `DELETE_SESSION_STATE:${input.sessionId}:${input.expectedSessionDigest}`;
    return this.request("tools/call", { name, arguments: input });
  }

  async rawTool(name, args = {}) {
    return this.request("tools/call", { name, arguments: args });
  }

  async close() {
    this.child.stdin.end();
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.child.kill("SIGKILL");
        reject(new Error(`MCP process did not close after stdin EOF. stderr=${this.stderr}`));
      }, 5000);
      this.child.once("exit", (code, signal) => {
        clearTimeout(timeout);
        resolve({ code, signal, stderr: this.stderr });
      });
    });
  }

  kill(signal = "SIGKILL") {
    this.child.kill(signal);
  }

  waitForExit() {
    if (this.child.exitCode !== null || this.child.signalCode !== null) return Promise.resolve({ code: this.child.exitCode, signal: this.child.signalCode, stderr: this.stderr });
    return new Promise((resolve) => this.child.once("exit", (code, signal) => resolve({ code, signal, stderr: this.stderr })));
  }
}

export function structured(result) {
  return result.structuredContent;
}

function defaultCompatibility(spawnargs) {
  const entry = spawnargs.find((value) => String(value).endsWith("src/index.mjs"));
  const root = entry ? path.resolve(path.dirname(entry), "..") : process.cwd();
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  const lock = JSON.parse(fs.readFileSync(path.join(root, "digital-expert/manifest.lock.json"), "utf8"));
  return {
    productVersion: packageJson.version,
    expertVersion: lock.expertVersion,
    coreDigest: lock.coreDigest,
    agentProtocolVersion: "evopilot-harness-agent-operations/v3",
    engineApiVersion: "harness.evopilot.io/v3"
  };
}

export function governedHostInteraction(id = "test-governed-host", version = "1.0.0") {
  return {
    id,
    version,
    level: "GOVERNED_HUMAN_GATE_COMPATIBLE",
    capabilities: [...REQUIRED_GOVERNED_HOST_CAPABILITIES]
  };
}
