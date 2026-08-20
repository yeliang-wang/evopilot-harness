import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";

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
    agentProtocolVersion: "evopilot-harness-agent-operations/v1",
    engineApiVersion: "harness.evopilot.io/v3"
  };
}
