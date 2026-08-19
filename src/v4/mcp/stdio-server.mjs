import readline from "node:readline";
import { DEFAULT_MCP_PROTOCOL_VERSION, MCP_PROTOCOL_VERSIONS } from "../constants.mjs";

export class StdioMcpServer {
  constructor({ name, version, capabilities, tools, listResources, readResource, callTool, validateInitialize, onInitialized, input = process.stdin, output = process.stdout, error = process.stderr }) {
    this.serverInfo = { name, version };
    this.capabilities = capabilities;
    this.tools = tools;
    this.listResources = listResources;
    this.readResource = readResource;
    this.callTool = callTool;
    this.validateInitialize = validateInitialize;
    this.onInitialized = onInitialized;
    this.input = input;
    this.output = output;
    this.error = error;
    this.initialized = false;
    this.protocolVersion = null;
    this.tail = Promise.resolve();
  }

  async start() {
    const lines = readline.createInterface({ input: this.input, crlfDelay: Infinity, terminal: false });
    let signal;
    const onSignal = (value) => {
      signal = value;
      lines.close();
    };
    const onTerm = () => onSignal("SIGTERM");
    const onInterrupt = () => onSignal("SIGINT");
    process.once("SIGTERM", onTerm);
    process.once("SIGINT", onInterrupt);
    try {
      for await (const line of lines) {
        if (!line.trim()) continue;
        this.tail = this.tail.then(() => this.processLine(line));
      }
      await this.tail;
      if (signal) this.error.write(`${JSON.stringify({ schema: "evopilot-harness-operation-server-shutdown/v1", signal, status: "GRACEFUL" })}\n`);
    } finally {
      process.removeListener("SIGTERM", onTerm);
      process.removeListener("SIGINT", onInterrupt);
    }
  }

  async processLine(line) {
    let message;
    try {
      message = JSON.parse(line);
    } catch (error) {
      return this.writeError(null, -32700, "Parse error", { detail: error.message, nextAction: "send-one-json-rpc-message-per-line" });
    }
    if (!message || message.jsonrpc !== "2.0" || typeof message.method !== "string") {
      return this.writeError(message?.id ?? null, -32600, "Invalid Request", { nextAction: "repair-json-rpc-envelope" });
    }
    const notification = message.id === undefined;
    try {
      const result = await this.dispatch(message.method, message.params ?? {});
      if (!notification) this.write({ jsonrpc: "2.0", id: message.id, result });
    } catch (error) {
      if (!notification) this.writeError(message.id, error.rpcCode ?? -32603, error.message, { code: error.code ?? error.name, nextAction: error.nextAction ?? "inspect-operation-server-error" });
    }
  }

  async dispatch(method, params) {
    if (method === "initialize") {
      const requested = String(params.protocolVersion ?? "");
      if (!MCP_PROTOCOL_VERSIONS.includes(requested)) throw rpcError(-32602, "MCP_PROTOCOL_VERSION_INCOMPATIBLE", `Unsupported MCP protocol version ${requested || "missing"}.`, `retry-with-${DEFAULT_MCP_PROTOCOL_VERSION}`);
      if (this.validateInitialize) this.validateInitialize(params);
      if (this.onInitialized) await this.onInitialized(params);
      this.protocolVersion = requested;
      return { protocolVersion: requested, capabilities: this.capabilities, serverInfo: this.serverInfo, instructions: "Load the evopilot-harness Digital Expert Core. Engine results are authoritative; approval and publication are separate explicit human decisions." };
    }
    if (method === "notifications/initialized") {
      if (!this.protocolVersion) throw rpcError(-32002, "MCP_NOT_INITIALIZED", "initialize must complete first.", "initialize-mcp-session");
      this.initialized = true;
      return null;
    }
    if (method === "ping") return {};
    if (!this.initialized) throw rpcError(-32002, "MCP_NOT_INITIALIZED", "MCP client has not sent notifications/initialized.", "complete-mcp-initialization");
    if (method === "tools/list") return { tools: this.tools };
    if (method === "tools/call") {
      const tool = this.tools.find((item) => item.name === params.name);
      if (!tool) throw rpcError(-32602, "MCP_TOOL_NOT_FOUND", `Unknown tool ${String(params.name)}.`, "call-tools-list");
      validateToolInput(tool, params.arguments ?? {});
      return this.callTool(params.name, params.arguments ?? {});
    }
    if (method === "resources/list") return { resources: await this.listResources() };
    if (method === "resources/read") return this.readResource(String(params.uri ?? ""));
    if (method === "resources/templates/list") return { resourceTemplates: [{ uriTemplate: "evopilot-harness://sessions/{sessionId}", name: "Agent Operation Session", description: "Digest-validated persistent session state", mimeType: "application/json" }] };
    if (method === "logging/setLevel") return {};
    throw rpcError(-32601, "MCP_METHOD_NOT_FOUND", `Method not found: ${method}`, "use-declared-mcp-method");
  }

  write(value) {
    this.output.write(`${JSON.stringify(value)}\n`);
  }

  writeError(id, code, message, data) {
    this.write({ jsonrpc: "2.0", id, error: { code, message, data } });
  }
}

function validateToolInput(tool, input) {
  validateSchemaValue(input, tool.inputSchema, `${tool.name} arguments`);
}

function validateSchemaValue(value, schema, location) {
  if (schema.type === "object") {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw invalid(`${location} must be an object.`);
    const properties = schema.properties ?? {};
    const unknown = Object.keys(value).filter((key) => !Object.hasOwn(properties, key));
    if (schema.additionalProperties === false && unknown.length) throw invalid(`${location} does not accept: ${unknown.join(", ")}.`, "UNKNOWN_TOOL_INPUT");
    const missing = (schema.required ?? []).filter((key) => value[key] === undefined || value[key] === null || value[key] === "");
    if (missing.length) throw invalid(`${location} requires: ${missing.join(", ")}.`, "MISSING_TOOL_INPUT");
    for (const [key, item] of Object.entries(value)) if (properties[key]) validateSchemaValue(item, properties[key], `${location}.${key}`);
  } else if (schema.type === "array") {
    if (!Array.isArray(value)) throw invalid(`${location} must be an array.`);
    if (schema.minItems != null && value.length < schema.minItems) throw invalid(`${location} requires at least ${schema.minItems} item(s).`);
    if (schema.items) value.forEach((item, index) => validateSchemaValue(item, schema.items, `${location}[${index}]`));
  } else if (schema.type === "string" && typeof value !== "string") throw invalid(`${location} must be a string.`);
  else if (schema.type === "boolean" && typeof value !== "boolean") throw invalid(`${location} must be a boolean.`);
  else if (schema.type === "integer" && !Number.isInteger(value)) throw invalid(`${location} must be an integer.`);
  if (schema.minLength != null && String(value).length < schema.minLength) throw invalid(`${location} is too short.`);
  if (schema.minimum != null && Number(value) < schema.minimum) throw invalid(`${location} must be at least ${schema.minimum}.`);
  if (schema.const !== undefined && value !== schema.const) throw invalid(`${location} must equal ${JSON.stringify(schema.const)}.`);
  if (schema.enum && !schema.enum.includes(value)) throw invalid(`${location} must be one of ${schema.enum.join(", ")}.`);
  if (schema.pattern && !new RegExp(schema.pattern).test(String(value))) throw invalid(`${location} does not match the required format.`, "INVALID_TOOL_INPUT", "reload-current-state");
}

function invalid(message, code = "INVALID_TOOL_INPUT", nextAction = "repair-tool-input") {
  return rpcError(-32602, code, message, nextAction);
}

function rpcError(rpcCode, code, message, nextAction) {
  const error = new Error(message);
  error.rpcCode = rpcCode;
  error.code = code;
  error.nextAction = nextAction;
  return error;
}
