#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "evopilot-harness-workbuddy-"));
const packageDir = path.join(temporary, "package");
const app = path.join(temporary, "app");
const workspace = path.join(temporary, "workspace");
const evidenceDir = path.resolve(option("evidence-dir") ?? path.join(os.tmpdir(), `evopilot-harness-workbuddy-evidence-${Date.now()}`));
const workbuddy = resolveWorkBuddyBinary();
const keepTemporary = process.argv.includes("--keep-temp");
let passed = false;

fs.mkdirSync(packageDir, { recursive: true });
fs.mkdirSync(app, { recursive: true });
fs.mkdirSync(evidenceDir, { recursive: true });

try {
  const packed = JSON.parse(run("npm", ["pack", "--json", "--pack-destination", packageDir], root))[0];
  const tarball = path.join(packageDir, packed.filename);
  fs.writeFileSync(path.join(app, "package.json"), `${JSON.stringify({ name: "evopilot-harness-workbuddy-acceptance", private: true })}\n`);
  run("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund", tarball], app);

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

  const prompt = [
    "Operate as the packaged EvoPilot Harness Digital Expert.",
    "Use only the evopilot-harness MCP server and call inspect_capabilities exactly once.",
    "This is a read-only startup check: do not prepare a Workspace, start a Session, run shell commands, or read project files.",
    "Return the exact Engine status, productVersion, expertVersion, engineApiVersion, supported MCP protocols, and nextAction from the tool result."
  ].join(" ");
  const completed = spawnSync(workbuddy, [
    "--print",
    "--output-format", "stream-json",
    "--include-partial-messages",
    "--setting-sources", "project",
    "--settings", JSON.stringify({
      enableAllProjectMcpServers: true,
      enabledMcpjsonServers: ["evopilot-harness"],
      permissions: { allow: ["DeferExecuteTool", "mcp__evopilot-harness__inspect_capabilities"] }
    }),
    "--system-prompt-file", adapter,
    "--disallowedTools", "Bash", "Read", "Edit", "Write", "Glob", "Grep", "WebFetch", "WebSearch",
    "--max-turns", "4",
    prompt
  ], {
    cwd: app,
    encoding: "utf8",
    env: { ...process.env, npm_config_update_notifier: "false" },
    timeout: 240_000,
    maxBuffer: 32 * 1024 * 1024
  });

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

  const hostVersion = run(workbuddy, ["--version"], app);
  const report = {
    schema: "evopilot-harness-workbuddy-installed-package-acceptance/v1",
    status: "PASSED",
    host: { id: "workbuddy", version: hostVersion, binary: workbuddy },
    package: { spec: `${packageJson.name}@${packageJson.version}`, root: packageRoot, sourceCheckoutUsed: false },
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
    operation: "inspect_capabilities",
    evidence: {
      transcript: path.join(evidenceDir, "workbuddy-transcript.ndjson"),
      bootstrap: path.join(evidenceDir, "bootstrap.json")
    }
  };
  assert.equal(report.workspace.mutated, false, "read-only WorkBuddy startup check mutated the Workspace");
  fs.writeFileSync(path.join(evidenceDir, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  passed = true;
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} finally {
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
