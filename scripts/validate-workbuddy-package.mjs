#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "evopilot-harness-workbuddy-"));
const packageDir = path.join(temporary, "package");
const app = path.join(temporary, "app");
const workspace = path.join(temporary, "workspace");
const evidenceDir = path.resolve(option("evidence-dir") ?? path.join(os.tmpdir(), `evopilot-harness-workbuddy-evidence-${Date.now()}`));
const packageSpec = option("package-spec");
const exerciseLlmInitialization = process.argv.includes("--exercise-llm-initialization");
const workbuddy = resolveWorkBuddyBinary();
const keepTemporary = process.argv.includes("--keep-temp");
let passed = false;
let modelService = null;

fs.mkdirSync(packageDir, { recursive: true });
fs.mkdirSync(app, { recursive: true });
fs.mkdirSync(evidenceDir, { recursive: true });

try {
  fs.writeFileSync(path.join(app, "package.json"), `${JSON.stringify({ name: "evopilot-harness-workbuddy-acceptance", private: true })}\n`);
  let installSpec = packageSpec;
  if (!installSpec) {
    const packed = JSON.parse(run("npm", ["pack", "--json", "--pack-destination", packageDir], root))[0];
    installSpec = path.join(packageDir, packed.filename);
  }
  run("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund", installSpec], app);

  const packageRoot = fs.realpathSync(path.join(app, "node_modules", "@evopilot", "harness"));
  const cli = fs.realpathSync(path.join(app, "node_modules", ".bin", "evopilot-harness"));
  const adapter = fs.realpathSync(path.join(packageRoot, "digital-expert", "adapters", "workbuddy", "WORKBUDDY.md"));
  for (const runtimePath of [packageRoot, cli, adapter, workspace, app]) {
    assert.equal(inside(root, runtimePath), false, `WorkBuddy acceptance path resolved into the source checkout: ${runtimePath}`);
  }

  const bootstrap = JSON.parse(run(cli, ["agent", "bootstrap", "--host", "workbuddy", "--workspace", workspace, "--json"], app));
  assert.equal(bootstrap.package.distributionMode, "installed-package");
  assert.equal(bootstrap.package.sourceCheckoutRequired, false);
  assert.equal(bootstrap.host.validation, "actual-workbuddy-host-plus-installed-package-protocol-conformance");
  const canonicalWorkspace = bootstrap.workspace.path;

  const mcpConfig = path.join(app, ".mcp.json");
  fs.writeFileSync(mcpConfig, `${JSON.stringify({
    mcpServers: {
      "evopilot-harness": {
        type: "stdio",
        command: cli,
        args: ["mcp", "serve", "--transport", "stdio", "--workspace", canonicalWorkspace]
      }
    }
  }, null, 2)}\n`);

  let modelsFile = null;
  let modelsBefore = null;
  const testSecret = "workbuddy-acceptance-secret-never-output";
  if (exerciseLlmInitialization) {
    modelService = await startModelService();
    fs.mkdirSync(workspace, { recursive: true });
    modelsFile = path.join(workspace, "models.json");
    fs.writeFileSync(modelsFile, `${JSON.stringify({ models: [{ id: "glm-workbuddy-acceptance", name: "WorkBuddy Acceptance GLM", vendor: "zhipu", apiKey: testSecret, url: modelService.url }] }, null, 2)}\n`, { mode: 0o600 });
    modelsBefore = digestBytes(fs.readFileSync(modelsFile));
  }
  const prompt = exerciseLlmInitialization ? [
    "Operate as the packaged EvoPilot Harness Digital Expert.",
    "Use only the evopilot-harness MCP server and call inspect_capabilities exactly once before any mutation.",
    "I confirm that the human-maintained local model configuration is complete and authorize the minimal live model doctor; this is not Plan approval or publication authorization.",
    "Call prepare_workspace with initialize true, then call initialize_model_configuration with the configured Workspace default and model glm-workbuddy-acceptance, then call run_engine_diagnostic for llm.readiness with an empty input.",
    "Do not run shell commands, read models.json, start a Session, approve, or publish.",
    "Return the exact final LLM readiness status, initializationStatus, connectionVerified, model id, and nextAction."
  ].join(" ") : [
    "Operate as the packaged EvoPilot Harness Digital Expert.",
    "Use only the evopilot-harness MCP server and call inspect_capabilities exactly once.",
    "This is a read-only startup check: do not prepare a Workspace, start a Session, run shell commands, or read project files.",
    "Return the exact Engine status, productVersion, expertVersion, engineApiVersion, supported MCP protocols, and nextAction from the tool result."
  ].join(" ");
  const allowedTools = exerciseLlmInitialization
    ? ["DeferExecuteTool", "mcp__evopilot-harness__inspect_capabilities", "mcp__evopilot-harness__prepare_workspace", "mcp__evopilot-harness__initialize_model_configuration", "mcp__evopilot-harness__run_engine_diagnostic"]
    : ["DeferExecuteTool", "mcp__evopilot-harness__inspect_capabilities"];
  const completed = await runWorkBuddy(workbuddy, [
    "--print",
    "--output-format", "stream-json",
    "--include-partial-messages",
    "--setting-sources", "project",
    "--settings", JSON.stringify({
      enableAllProjectMcpServers: true,
      enabledMcpjsonServers: ["evopilot-harness"],
      permissions: { allow: allowedTools }
    }),
    "--system-prompt-file", adapter,
    "--disallowedTools", "Bash", "Read", "Edit", "Write", "Glob", "Grep", "WebFetch", "WebSearch",
    "--max-turns", exerciseLlmInitialization ? "10" : "4",
    prompt
  ], app, 240_000);

  fs.writeFileSync(path.join(evidenceDir, "workbuddy-transcript.ndjson"), completed.stdout ?? "");
  fs.writeFileSync(path.join(evidenceDir, "workbuddy-stderr.log"), completed.stderr ?? "");
  fs.writeFileSync(path.join(evidenceDir, "bootstrap.json"), `${JSON.stringify(bootstrap, null, 2)}\n`);
  assert.equal(completed.status, 0, `WorkBuddy exited ${completed.status}: ${completed.stderr || completed.stdout}`);

  const transcript = String(completed.stdout ?? "");
  const initialized = findWorkBuddyInit(transcript);
  assert.ok(initialized?.mcp_servers?.some((server) => server.name === "evopilot-harness" && server.status === "connected"), "WorkBuddy did not connect the packaged MCP server");
  assert.ok(initialized?.tools?.includes("mcp__evopilot-harness__inspect_capabilities"), "WorkBuddy did not load inspect_capabilities");
  const capabilityCalls = collectCapabilityResults(transcript);
  assert.equal(capabilityCalls.length, 1, "WorkBuddy must complete exactly one inspect_capabilities call");
  const capabilityCall = capabilityCalls[0];
  assert.equal(capabilityCall.result.schema, "evopilot-harness-operation-server-capabilities/v1");
  assert.equal(capabilityCall.result.status, "READY");
  assert.equal(capabilityCall.result.productVersion, packageJson.version);
  assert.equal(capabilityCall.result.compatibility?.expertVersion, packageJson.version);
  assert.equal(capabilityCall.result.compatibility?.engineApiVersion, "harness.evopilot.io/v3");
  assert.ok(capabilityCall.result.mcp?.supportedProtocolVersions?.includes("2025-11-25"));
  const learningOperations = capabilityCall.result.operations?.filter((item) => item.id.startsWith("learning.")).map((item) => item.id).sort();
  assert.deepEqual(learningOperations, ["learning.artifact", "learning.ingest", "learning.inspect", "learning.rescore", "learning.run-manifest", "learning.score", "learning.snapshot", "learning.validate"]);
  assert.equal(capabilityCall.result.nextAction, "prepare-workspace");

  let llmInitialization = null;
  if (exerciseLlmInitialization) {
    const results = collectStructuredResults(transcript);
    const initializedModel = results.find((result) => result.schema === "evopilot-harness-model-readiness/v1" && result.status === "CONFIGURED_AND_VERIFIED" && result.doctor?.connectionVerified === true);
    const finalReadiness = results.filter((result) => result.schema === "evopilot-harness-model-readiness/v1" && result.status === "CONFIGURED_AND_VERIFIED").at(-1);
    assert.ok(initializedModel, "WorkBuddy did not complete initialize_model_configuration with live doctor evidence");
    assert.ok(finalReadiness, "WorkBuddy did not return CONFIGURED_AND_VERIFIED readiness");
    assert.equal(finalReadiness.initializationStatus, "READY");
    assert.equal(finalReadiness.connectionVerified, true);
    assert.equal(finalReadiness.verification?.model?.id, "glm-workbuddy-acceptance");
    assert.equal(digestBytes(fs.readFileSync(modelsFile)), modelsBefore, "WorkBuddy initialization rewrote models.json");
    assert.equal(fs.statSync(path.join(canonicalWorkspace, "model-readiness.json")).mode & 0o777, 0o600);
    assert.equal(transcript.includes(testSecret), false, "WorkBuddy transcript exposed the model credential");
    llmInitialization = {
      status: finalReadiness.status,
      initializationStatus: finalReadiness.initializationStatus,
      connectionVerified: finalReadiness.connectionVerified,
      configurationDigest: finalReadiness.configurationDigest,
      model: finalReadiness.verification.model,
      receiptMode: "0600",
      modelsFilePreserved: true,
      credentialExposed: false
    };
  }

  const hostVersion = run(workbuddy, ["--version"], app);
  const report = {
    schema: "evopilot-harness-workbuddy-installed-package-acceptance/v1",
    status: "PASSED",
    host: { id: "workbuddy", version: hostVersion, binary: workbuddy },
    package: {
      spec: packageSpec ?? `${packageJson.name}@${packageJson.version}`,
      distributionMode: packageSpec ? "public-registry" : "local-package-candidate",
      root: packageRoot,
      sourceCheckoutUsed: false
    },
    adapter: { id: bootstrap.adapter.id, path: adapter, coreDigest: bootstrap.digitalExpert.compatibility.coreDigest },
    mcp: {
      transport: "stdio",
      toolUseId: capabilityCall.toolUseId,
      hostRequestId: capabilityCall.hostRequestId,
      engineVersion: capabilityCall.result.productVersion,
      protocols: capabilityCall.result.mcp.supportedProtocolVersions
      ,professionalLearningOperations: learningOperations
    },
    workspace: { path: canonicalWorkspace, mutated: fs.existsSync(canonicalWorkspace) },
    operation: exerciseLlmInitialization ? "inspect_capabilities-prepare_workspace-initialize_model_configuration-llm_readiness" : "inspect_capabilities",
    ...(llmInitialization ? { llmInitialization } : {}),
    evidence: {
      transcript: path.join(evidenceDir, "workbuddy-transcript.ndjson"),
      bootstrap: path.join(evidenceDir, "bootstrap.json")
    }
  };
  assert.equal(report.workspace.mutated, exerciseLlmInitialization, exerciseLlmInitialization ? "LLM initialization did not prepare its isolated Workspace" : "read-only WorkBuddy startup check mutated the Workspace");
  fs.writeFileSync(path.join(evidenceDir, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  passed = true;
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} finally {
  if (modelService) await modelService.close();
  if (!keepTemporary || passed) fs.rmSync(temporary, { recursive: true, force: true });
  else process.stderr.write(`WorkBuddy acceptance temporary directory preserved: ${temporary}\n`);
}

function option(name) {
  const flag = `--${name}`;
  const index = process.argv.indexOf(flag);
  if (index === -1) return null;
  if (!process.argv[index + 1] || process.argv[index + 1].startsWith("--")) throw new Error(`${flag} requires a value`);
  return process.argv[index + 1];
}

function resolveWorkBuddyBinary() {
  const candidates = [
    process.env.WORKBUDDY_BIN,
    "/Applications/WorkBuddy.app/Contents/Resources/app.asar.unpacked/cli/bin/codebuddy",
    path.join(os.homedir(), ".codebuddy", "bin", "workbuddy")
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      const resolved = fs.realpathSync(candidate);
      if (fs.statSync(resolved).isFile()) return resolved;
    } catch { /* try the next installed host path */ }
  }
  throw new Error("A real WorkBuddy CLI host is required. Set WORKBUDDY_BIN to its executable path.");
}

function run(command, args, cwd) {
  return execFileSync(command, args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, npm_config_update_notifier: "false" },
    stdio: ["ignore", "pipe", "pipe"]
  }).trim();
}

function inside(rootPath, targetPath) {
  const normalizedRoot = path.resolve(rootPath);
  const normalizedTarget = path.resolve(targetPath);
  return normalizedTarget === normalizedRoot || normalizedTarget.startsWith(`${normalizedRoot}${path.sep}`);
}

function parseTranscript(transcript) {
  const values = [];
  for (const line of transcript.split(/\r?\n/).filter(Boolean)) {
    try { values.push(JSON.parse(line)); } catch { /* ignore non-JSON host diagnostics */ }
  }
  return values;
}

function findWorkBuddyInit(transcript) {
  return parseTranscript(transcript).find((value) => value.type === "system" && value.subtype === "init");
}

function collectCapabilityResults(transcript) {
  const calls = [];
  for (const value of parseTranscript(transcript)) {
    if (value.type !== "user" || !Array.isArray(value.message?.content)) continue;
    for (const item of value.message.content) {
      if (item.type !== "tool_result" || !Array.isArray(item.content)) continue;
      for (const content of item.content) {
        if (content.type !== "text") continue;
        let result;
        try { result = JSON.parse(content.text); } catch { continue; }
        if (result?.schema !== "evopilot-harness-operation-server-capabilities/v1") continue;
        calls.push({ result, toolUseId: item.tool_use_id, hostRequestId: value._requestId ?? null });
      }
    }
  }
  return calls;
}

function collectStructuredResults(transcript) {
  const results = [];
  for (const value of parseTranscript(transcript)) {
    if (value.type !== "user" || !Array.isArray(value.message?.content)) continue;
    for (const item of value.message.content) {
      if (item.type !== "tool_result" || !Array.isArray(item.content)) continue;
      for (const content of item.content) {
        if (content.type !== "text") continue;
        try {
          const result = JSON.parse(content.text);
          if (result?.schema) results.push(result);
        } catch { /* ignore host prose */ }
      }
    }
  }
  return results;
}

function runWorkBuddy(binary, args, cwd, timeoutMs) {
  return new Promise((resolve) => {
    const child = spawn(binary, args, { cwd, env: { ...process.env, npm_config_update_notifier: "false" }, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => child.kill("SIGTERM"), timeoutMs);
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("close", (status) => { clearTimeout(timer); resolve({ status, stdout, stderr }); });
  });
}

function startModelService() {
  const server = http.createServer((request, response) => {
    request.resume();
    request.on("end", () => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ status: "ok" }) } }], usage: { prompt_tokens: 2, completion_tokens: 1, total_tokens: 3 } }));
    });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({
    url: `http://127.0.0.1:${server.address().port}/v4`,
    close: () => new Promise((done) => server.close(done))
  })));
}

function digestBytes(value) {
  return `sha256:${crypto.createHash("sha256").update(value).digest("hex")}`;
}
