import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { AGENT_HOST_INSTALLER_OPERATIONS } from "../src/v4/agent-host-installer.mjs";

const root = path.resolve(import.meta.dirname, "..");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const cli = path.join(root, "src", "index.mjs");
const managerCandidates = [
  "/Applications/WorkBuddy.app/Contents/Resources/app.asar.unpacked/resources/plugins/workbuddy-builtin/skills/expert-manager",
  "/Applications/WorkBuddy.app/Contents/Resources/app.asar.unpacked/resources/builtin-skills/expert-manager"
];
const manager = managerCandidates.find((candidate) => fs.existsSync(candidate)) ?? managerCandidates[0];

function run(args, expected = 0) {
  const result = spawnSync(process.execPath, [cli, ...args, "--json"], { encoding: "utf8" });
  assert.equal(result.status, expected, result.stdout + result.stderr);
  return JSON.parse(result.stdout);
}

test("host-neutral lifecycle contract stays free of WorkBuddy-private operations", () => {
  assert.deepEqual(AGENT_HOST_INSTALLER_OPERATIONS, ["discover", "preview", "install", "status", "upgrade", "repair", "uninstall"]);
});

test("governed host profiles advertise every Engine-required presentation capability before installation", () => {
  const profiles = fs.readFileSync(path.join(root, "digital-expert/conformance/host-profiles.yaml"), "utf8");
  for (const capability of [
    "deterministic-rendering",
    "governed-operation-interception",
    "ordered-visible-transcript-evidence",
    "interaction-frame-binding",
    "business-view-digest-binding",
    "exact-canonical-markdown-rendering",
    "complete-turn-digest-receipt",
    "fixed-locale-rendering",
    "host-prose-suppression",
    "workspace-state-recovery"
  ]) assert.match(profiles, new RegExp(capability));
});

test("generated WorkBuddy expert forbids visible reasoning and Host-owned lifecycle side effects", () => {
  const adapter = fs.readFileSync(path.join(root, "digital-expert/adapters/workbuddy/WORKBUDDY.md"), "utf8");
  for (const invariant of [
    "Mandatory WorkBuddy closed-envelope mode",
    "Never expose deep-thinking text",
    "Never call WorkBuddy memory",
    "Do not create or update `.workbuddy/memory`",
    "After the terminal Engine result, end immediately",
    "HOST_INTERACTION_COMPLIANCE_UNAVAILABLE"
  ]) assert.match(adapter, new RegExp(invariant.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
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
  assert.equal(config.mcpServers["evopilot-harness"], undefined);
  assert.equal(JSON.parse(fs.readFileSync(path.join(runtimeRoot, "node_modules", "@evopilot", "harness", "package.json"), "utf8")).version, manifest.version);
  const installedStatus = run(["agent", "status", ...common]);
  assert.equal(installedStatus.initializationStatus, "ACTION_REQUIRED");
  assert.equal(installedStatus.verification.legacyRootMcpPresent, false);
  assert.equal(installedStatus.verification.pluginMcpDeclared, true);
  assert.equal(installedStatus.verification.pluginMcpRuntimeBindingMatch, true);
  assert.equal(installedStatus.verification.liveSessionVerified, false);
  assert.equal(installedStatus.verification.runtimeCoreDigestMatch, true);
  assert.equal(installedStatus.verification.runtimeIntegrityDigestMatch, true);
  const installedPlugin = JSON.parse(fs.readFileSync(path.join(hostHome, "plugins", "marketplaces", "my-experts", "plugins", "evopilot-harness-digital-expert", ".codebuddy-plugin", "plugin.json"), "utf8"));
  assert.equal(installedPlugin.mcpServers["evopilot-harness"].command, path.join(runtimeRoot, "node_modules", ".bin", "evopilot-harness"));
  assert.equal(installedPlugin.mcpServers["evopilot-harness"].args.includes(workspace), true);
  assert.equal(installedPlugin.mcpServers["evopilot-harness"].args.includes(root), false);
  assert.equal(installedPlugin.mcpServers["evopilot-harness"].timeout, 300000);
  const upgradePreview = run(["agent", "upgrade", ...common], 2);
  assert.equal(run(["agent", "upgrade", ...common, "--confirm", upgradePreview.planDigest]).status, "INSTALLED");
  const installedProjection = path.join(runtimeRoot, "node_modules", "@evopilot", "harness", "src", "v4", "interaction", "business-projection.mjs");
  const installedPackageRoot = path.dirname(path.dirname(path.dirname(path.dirname(installedProjection))));
  if (fs.lstatSync(installedPackageRoot).isSymbolicLink()) {
    fs.rmSync(installedPackageRoot);
    fs.cpSync(root, installedPackageRoot, { recursive: true });
  }
  fs.appendFileSync(installedProjection, "\n// stale same-version candidate\n");
  const staleRuntime = run(["agent", "status", ...common]);
  assert.equal(staleRuntime.status, "DRIFTED");
  assert.equal(staleRuntime.verification.runtimeVersionMatch, true);
  assert.equal(staleRuntime.verification.runtimeCoreDigestMatch, true);
  assert.equal(staleRuntime.verification.runtimeIntegrityDigestMatch, false);
  const sameVersionUpgrade = run(["agent", "upgrade", ...common], 2);
  const refreshed = run(["agent", "upgrade", ...common, "--confirm", sameVersionUpgrade.planDigest]);
  assert.equal(refreshed.status, "INSTALLED");
  assert.equal(refreshed.verification.runtimeIntegrityDigestMatch, true);
  assert.doesNotMatch(fs.readFileSync(installedProjection, "utf8"), /stale same-version candidate/);
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

test("default WorkBuddy runtime synchronization installs the exact current package without a registry dependency", { skip: !fs.existsSync(manager) }, () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "evopilot-host-current-package-"));
  const hostHome = path.join(temp, "workbuddy");
  const runtimeRoot = path.join(hostHome, "binaries", "node", "workspace");
  fs.mkdirSync(runtimeRoot, { recursive: true });
  fs.writeFileSync(path.join(runtimeRoot, "package.json"), JSON.stringify({ private: true }));
  const common = ["--host", "workbuddy", "--host-home", hostHome, "--workspace", path.join(temp, "workspace"), "--manager-root", manager, "--runtime-root", runtimeRoot];
  const preview = run(["agent", "install", ...common], 2);
  const runtimeChange = preview.changes.find((change) => change.action === "synchronize-isolated-npm-runtime");
  assert.equal(runtimeChange.source, "current-installed-package");
  assert.match(runtimeChange.integrityDigest, /^sha256:/);
  assert.equal(preview.packageIntegrityDigest, runtimeChange.integrityDigest);
  const installed = run(["agent", "install", ...common, "--confirm", preview.planDigest]);
  assert.equal(installed.status, "INSTALLED");
  const installedRoot = path.join(runtimeRoot, "node_modules", "@evopilot", "harness");
  assert.equal(fs.lstatSync(installedRoot).isSymbolicLink(), false);
  assert.equal(JSON.parse(fs.readFileSync(path.join(installedRoot, "package.json"), "utf8")).version, manifest.version);
  assert.equal(run(["agent", "status", ...common]).verification.runtimeIntegrityDigestMatch, true);
});

test("WorkBuddy installer uses the declarative marketplace when the legacy expert manager is absent", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "evopilot-host-declarative-"));
  const hostHome = path.join(temp, "workbuddy");
  const workspace = path.join(temp, "workspace");
  const runtimeRoot = path.join(hostHome, "binaries", "node", "workspace");
  const marketplace = path.join(hostHome, "plugins", "marketplaces", "my-experts");
  const catalogPath = path.join(marketplace, ".codebuddy-plugin", "marketplace.json");
  fs.mkdirSync(path.dirname(catalogPath), { recursive: true });
  fs.mkdirSync(runtimeRoot, { recursive: true });
  fs.writeFileSync(path.join(runtimeRoot, "package.json"), JSON.stringify({ private: true }));
  fs.writeFileSync(catalogPath, JSON.stringify({
    name: "my-experts",
    description: "preserved marketplace",
    plugins: [{ name: "unrelated-expert", source: "./plugins/unrelated-expert", description: "preserved" }]
  }));
  const missingManager = path.join(temp, "missing-expert-manager");
  const common = [
    "--host", "workbuddy",
    "--host-home", hostHome,
    "--workspace", workspace,
    "--manager-root", missingManager,
    "--host-version", "5.2.6",
    "--runtime-root", runtimeRoot,
    "--runtime-package-spec", root
  ];
  const preview = run(["agent", "install", ...common], 2);
  assert.ok(preview.changes.some((change) => change.action === "register-through-workbuddy-declarative-marketplace"));
  const installed = run(["agent", "install", ...common, "--confirm", preview.planDigest]);
  assert.equal(installed.status, "INSTALLED");
  assert.equal(installed.verification.registrationMode, "declarative-marketplace");
  assert.equal(installed.verification.expertManagerAvailable, false);
  const catalog = JSON.parse(fs.readFileSync(catalogPath, "utf8"));
  assert.deepEqual(catalog.plugins.map((item) => item.name), ["unrelated-expert", "evopilot-harness-digital-expert"]);
  assert.equal(run(["agent", "status", ...common]).status, "INSTALLED");
});

test("WorkBuddy installer migrates only owned root MCP entries and rejects unowned conflicts", { skip: !fs.existsSync(manager) }, () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "evopilot-host-mcp-migration-"));
  const hostHome = path.join(temp, "workbuddy");
  const runtimeRoot = path.join(hostHome, "binaries", "node", "workspace");
  fs.mkdirSync(runtimeRoot, { recursive: true });
  fs.writeFileSync(path.join(runtimeRoot, "package.json"), JSON.stringify({ private: true }));
  fs.writeFileSync(path.join(hostHome, "mcp.json"), JSON.stringify({ mcpServers: { unrelated: { command: "true" }, "evopilot-harness": { command: "legacy", managedBy: "@evopilot/harness" } } }));
  const common = ["--host", "workbuddy", "--host-home", hostHome, "--workspace", path.join(temp, "workspace"), "--manager-root", manager, "--runtime-root", runtimeRoot, "--runtime-package-spec", root];
  const preview = run(["agent", "install", ...common], 2);
  assert.equal(run(["agent", "install", ...common, "--confirm", preview.planDigest]).status, "INSTALLED");
  let config = JSON.parse(fs.readFileSync(path.join(hostHome, "mcp.json"), "utf8"));
  assert.ok(config.mcpServers.unrelated);
  assert.equal(config.mcpServers["evopilot-harness"], undefined);
  config.mcpServers["evopilot-harness"] = {
    type: "stdio",
    command: path.join(runtimeRoot, "node_modules", ".bin", "evopilot-harness"),
    args: ["mcp", "serve", "--transport", "stdio", "--workspace", path.join(temp, "workspace")],
    disabled: false
  };
  fs.writeFileSync(path.join(hostHome, "mcp.json"), JSON.stringify(config));
  const materializedStatus = run(["agent", "status", ...common]);
  assert.equal(materializedStatus.status, "INSTALLED");
  assert.equal(materializedStatus.verification.hostMaterializedPluginMcp, true);
  assert.equal(materializedStatus.verification.rootMcpBindingAcceptable, true);
  const derivedRepair = run(["agent", "repair", ...common], 2);
  assert.equal(run(["agent", "repair", ...common, "--confirm", derivedRepair.planDigest]).status, "INSTALLED");
  config = JSON.parse(fs.readFileSync(path.join(hostHome, "mcp.json"), "utf8"));
  assert.equal(config.mcpServers["evopilot-harness"], undefined);
  config.mcpServers["evopilot-harness"] = { type: "stdio", command: "user-owned-command" };
  fs.writeFileSync(path.join(hostHome, "mcp.json"), JSON.stringify(config));
  const conflictingStatus = run(["agent", "status", ...common]);
  assert.equal(conflictingStatus.status, "DRIFTED");
  assert.equal(conflictingStatus.verification.hostMaterializedPluginMcp, false);
  assert.equal(conflictingStatus.verification.rootMcpBindingAcceptable, false);
  const repair = run(["agent", "repair", ...common], 2);
  const failed = run(["agent", "repair", ...common, "--confirm", repair.planDigest], 1);
  assert.equal(failed.error.code, "UNOWNED_MCP_CONFLICT");
});
