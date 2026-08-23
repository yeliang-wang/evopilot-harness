import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { AGENT_HOST_INSTALLER_OPERATIONS } from "../src/v4/agent-host-installer.mjs";

const root = path.resolve(import.meta.dirname, "..");
const cli = path.join(root, "src", "index.mjs");
const manager = "/Applications/WorkBuddy.app/Contents/Resources/app.asar.unpacked/resources/builtin-skills/expert-manager";

function run(args, expected = 0) {
  const result = spawnSync(process.execPath, [cli, ...args, "--json"], { encoding: "utf8" });
  assert.equal(result.status, expected, result.stdout + result.stderr);
  return JSON.parse(result.stdout);
}

test("host-neutral lifecycle contract stays free of WorkBuddy-private operations", () => {
  assert.deepEqual(AGENT_HOST_INSTALLER_OPERATIONS, ["discover", "preview", "install", "status", "upgrade", "repair", "uninstall"]);
});

test("unsupported WorkBuddy versions fail closed with a manual import path", { skip: !fs.existsSync(manager) }, () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "evopilot-host-version-"));
  const common = ["--host", "workbuddy", "--host-home", temp, "--manager-root", manager, "--host-version", "6.0.0"];
  const preview = run(["agent", "install", ...common], 2);
  const failed = run(["agent", "install", ...common, "--confirm", preview.planDigest], 1);
  assert.equal(failed.error.code, "UNSUPPORTED_WORKBUDDY_VERSION");
  assert.match(failed.error.nextAction, /manual-import-from-/);
});

test("WorkBuddy installer is preview-bound, idempotent, repairable, and ownership-safe", { skip: !fs.existsSync(manager) }, () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "evopilot-host-installer-"));
  const hostHome = path.join(temp, "workbuddy");
  const workspace = path.join(temp, "workspace");
  const runtimeRoot = path.join(hostHome, "binaries", "node", "workspace");
  fs.mkdirSync(hostHome, { recursive: true });
  fs.mkdirSync(runtimeRoot, { recursive: true });
  fs.writeFileSync(path.join(runtimeRoot, "package.json"), JSON.stringify({ private: true }));
  fs.writeFileSync(path.join(hostHome, "mcp.json"), JSON.stringify({ mcpServers: { unrelated: { type: "stdio", command: "true" } } }));
  const common = ["--host", "workbuddy", "--host-home", hostHome, "--workspace", workspace, "--manager-root", manager, "--runtime-root", runtimeRoot, "--runtime-package-spec", root];
  const preview = run(["agent", "install", ...common], 2);
  assert.equal(preview.status, "CONFIRMATION_REQUIRED");
  const mismatch = run(["agent", "install", ...common, "--confirm", "sha256:wrong"], 1);
  assert.equal(mismatch.error.code, "CONFIRMATION_MISMATCH");
  const installed = run(["agent", "install", ...common, "--confirm", preview.planDigest]);
  assert.equal(installed.status, "INSTALLED");
  fs.mkdirSync(workspace, { recursive: true });
  fs.writeFileSync(path.join(workspace, "preserved.txt"), "state");
  assert.equal(run(["agent", "status", ...common]).status, "INSTALLED");
  const config = JSON.parse(fs.readFileSync(path.join(hostHome, "mcp.json"), "utf8"));
  assert.ok(config.mcpServers.unrelated);
  assert.equal(config.mcpServers["evopilot-harness"].managedBy, "@evopilot/harness");
  assert.equal(JSON.parse(fs.readFileSync(path.join(runtimeRoot, "node_modules", "@evopilot", "harness", "package.json"), "utf8")).version, "4.3.0");
  assert.equal(run(["agent", "status", ...common]).verification.mcpWorkspaceMatch, true);
  const upgradePreview = run(["agent", "upgrade", ...common], 2);
  assert.equal(run(["agent", "upgrade", ...common, "--confirm", upgradePreview.planDigest]).status, "INSTALLED");
  const skill = path.join(hostHome, "plugins", "marketplaces", "my-experts", "plugins", "evopilot-harness-digital-expert", "skills", "evopilot-harness-digital-expert", "SKILL.md");
  fs.appendFileSync(skill, "\ntampered\n");
  const drift = run(["agent", "status", ...common]);
  assert.equal(drift.status, "DRIFTED");
  assert.equal(drift.verification.ownedFilesMatch, false);
  const contentRepairPreview = run(["agent", "repair", ...common], 2);
  assert.equal(run(["agent", "repair", ...common, "--confirm", contentRepairPreview.planDigest]).status, "INSTALLED");
  fs.unlinkSync(path.join(hostHome, "plugins", "marketplaces", "my-experts", "plugins", "evopilot-harness-digital-expert", ".evopilot-harness-owner.json"));
  assert.equal(run(["agent", "status", ...common]).status, "DRIFTED");
  const repairPreview = run(["agent", "repair", ...common], 2);
  const unsafeRepair = run(["agent", "repair", ...common, "--confirm", repairPreview.planDigest], 1);
  assert.equal(unsafeRepair.error.code, "UNOWNED_EXPERT_CONFLICT");
  fs.writeFileSync(path.join(hostHome, "plugins", "marketplaces", "my-experts", "plugins", "evopilot-harness-digital-expert", ".evopilot-harness-owner.json"), JSON.stringify({ owner: "@evopilot/harness" }));
  assert.equal(run(["agent", "repair", ...common, "--confirm", repairPreview.planDigest]).status, "INSTALLED");
  const uninstallPreview = run(["agent", "uninstall", ...common], 2);
  const uninstalled = run(["agent", "uninstall", ...common, "--confirm", uninstallPreview.planDigest]);
  assert.equal(uninstalled.status, "UNINSTALLED");
  assert.ok(config.mcpServers.unrelated);
  assert.equal(fs.readFileSync(path.join(workspace, "preserved.txt"), "utf8"), "state");
});
