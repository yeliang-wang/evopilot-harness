#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "evopilot-harness-npm-smoke-"));
const packageDir = path.join(temporary, "package");
const app = path.join(temporary, "app");
const workspace = path.join(temporary, "workspace");
fs.mkdirSync(packageDir, { recursive: true });
fs.mkdirSync(app, { recursive: true });

try {
  const pack = JSON.parse(run("npm", ["pack", "--json", "--pack-destination", packageDir], root))[0];
  const tarball = path.join(packageDir, pack.filename);
  fs.writeFileSync(path.join(app, "package.json"), `${JSON.stringify({ name: "evopilot-harness-package-smoke", private: true })}\n`);
  run("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund", tarball], app);

  const packageRoot = fs.realpathSync(path.join(app, "node_modules", "@evopilot", "harness"));
  const cli = path.join(app, "node_modules", ".bin", "evopilot-harness");
  assert.ok(fs.existsSync(cli), "installed evopilot-harness binary is missing");
  const version = JSON.parse(run(cli, ["--version", "--json"], app));
  assert.equal(version.version, "4.0.2");

  const bootstrap = JSON.parse(run(cli, ["agent", "bootstrap", "--host", "workbuddy", "--workspace", workspace, "--json"], app));
  assert.equal(bootstrap.status, "READY");
  assert.equal(bootstrap.package.name, "@evopilot/harness");
  assert.equal(bootstrap.package.version, "4.0.2");
  assert.equal(bootstrap.package.distributionMode, "installed-package");
  assert.equal(bootstrap.package.sourceCheckoutRequired, false);
  assert.ok(fs.realpathSync(bootstrap.package.root).startsWith(packageRoot));
  assert.ok(fs.realpathSync(bootstrap.adapter.path).startsWith(packageRoot));
  assert.deepEqual(bootstrap.mcp.exactNpxCommand, {
    command: "npx",
    args: ["--yes", "--package", "@evopilot/harness@4.0.2", "evopilot-harness", "mcp", "serve", "--transport", "stdio", "--workspace", bootstrap.workspace.path]
  });
  assert.equal(bootstrap.workspace.externalToRelease, true);

  const conformance = JSON.parse(run(process.execPath, [
    path.join(packageRoot, "digital-expert", "conformance", "generic-host.mjs"),
    "--workspace", workspace,
    "--adapter-id", "workbuddy"
  ], app));
  assert.equal(conformance.status, "PASSED");
  assert.equal(conformance.adapterId, "workbuddy");
  assert.equal(conformance.server.version, "4.0.2");

  console.log(JSON.stringify({
    schema: "evopilot-harness-npm-package-smoke/v1",
    status: "PASSED",
    package: "@evopilot/harness@4.0.2",
    cli,
    packageRoot,
    sourceCheckoutUsed: false,
    bootstrap: { host: bootstrap.host.id, adapter: bootstrap.adapter.packageRelativePath },
    mcp: { protocolVersion: conformance.protocolVersion, toolCount: conformance.toolCount, networkListening: conformance.networkListening }
  }, null, 2));
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}

function run(command, args, cwd) {
  return execFileSync(command, args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, npm_config_update_notifier: "false" },
    stdio: ["ignore", "pipe", "pipe"]
  }).trim();
}
