import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PACKAGE_ROOT } from "../v3/constants.mjs";
import { agentBootstrap } from "./bootstrap.mjs";
import { resolveWorkspaceModelsFile } from "../v3/workspace.mjs";
import { inspectModelReadiness } from "../v3/model-readiness.mjs";

export const HOST_INSTALLER_SCHEMA = "evopilot-harness-agent-host-installer/v1";
export const AGENT_HOST_INSTALLER_OPERATIONS = Object.freeze(["discover", "preview", "install", "status", "upgrade", "repair", "uninstall"]);
const EXPERT_ID = "evopilot-harness-digital-expert";
const MCP_ID = "evopilot-harness";
const MANAGED_SCHEMA = "evopilot-harness-agent-host-ownership/v1";
const OPERATIONS = new Set(["install", "status", "upgrade", "repair", "uninstall"]);
const RUNTIME_INTEGRITY_FILES = Object.freeze([
  "package.json",
  "digital-expert/manifest.lock.json",
  "src/v4/interaction/business-projection.mjs",
  "src/v4/interaction/controller.mjs",
  "src/v4/interaction/lifecycle-replay.mjs",
  "src/v4/interaction/professional-reasoning.mjs",
  "src/v4/operation-job/store.mjs",
  "src/v4/operation-job/worker.mjs",
  "src/v4/agent-host-installer.mjs",
  "src/v4/operation-server/server.mjs",
  "src/v4/protocol/tools.mjs",
  "src/v4/session/store.mjs"
]);

export function runAgentHostCommand(operation, argv) {
  if (!OPERATIONS.has(operation)) throw hostError("UNSUPPORTED_OPERATION", `Unsupported Agent host operation: ${operation}.`);
  const options = parseOptions(argv);
  const host = String(options.host ?? "").trim().toLowerCase();
  if (!host) throw hostError("MISSING_HOST", `${operation} requires --host <id>.`);
  if (host !== "workbuddy") throw hostError("UNSUPPORTED_HOST_INSTALLER", `No lifecycle installer exists for ${host}.`);
  const context = workbuddyContext(options);
  if (operation === "status") return inspectStatus(context);
  const plan = buildPlan(operation, context);
  if (!options.confirm) return { ...plan, status: "CONFIRMATION_REQUIRED", confirmation: plan.planDigest, nextAction: `repeat-with---confirm-${plan.planDigest}` };
  if (String(options.confirm) !== plan.planDigest) throw hostError("CONFIRMATION_MISMATCH", "--confirm must exactly match the current preview planDigest.");
  return applyPlan(operation, context, plan);
}

export function renderAgentHostResult(result, json) {
  if (json) return `${JSON.stringify(result, null, 2)}\n`;
  const lines = [`${result.operation ?? "status"} ${result.host.id}: ${result.status}`];
  if (result.planDigest) lines.push(`Plan digest: ${result.planDigest}`);
  if (result.confirmation) lines.push(`Confirm with: --confirm ${result.confirmation}`);
  for (const change of result.changes ?? []) lines.push(`- ${change.action}: ${change.path}`);
  if (result.nextAction) lines.push(`Next action: ${result.nextAction}`);
  return `${lines.join("\n")}\n`;
}

export function renderAgentHostError(error, json) {
  const result = { schema: HOST_INSTALLER_SCHEMA, status: "FAILED", error: { code: String(error?.code ?? "AGENT_HOST_INSTALLER_FAILED"), message: String(error?.message ?? error), nextAction: String(error?.nextAction ?? "inspect-agent-host") } };
  return json ? `${JSON.stringify(result, null, 2)}\n` : `${result.error.code}: ${result.error.message}\nNext action: ${result.error.nextAction}\n`;
}

function workbuddyContext(options) {
  const configRoot = path.resolve(String(options["host-home"] ?? process.env.WORKBUDDY_CONFIG_DIR ?? path.join(os.homedir(), ".workbuddy")));
  const packageJson = readJson(path.join(PACKAGE_ROOT, "package.json"));
  const source = path.join(PACKAGE_ROOT, "digital-expert", "installers", "workbuddy", "expert");
  const marketplace = path.join(configRoot, "plugins", "marketplaces", "my-experts");
  const expert = path.join(marketplace, "plugins", EXPERT_ID);
  const mcpPath = path.resolve(String(options["mcp-config"] ?? path.join(configRoot, "mcp.json")));
  const workspace = path.resolve(String(options.workspace ?? path.join(os.homedir(), ".evopilot-harness")));
  const manager = resolveManager(options["manager-root"]);
  const hostVersion = String(options["host-version"] ?? detectWorkbuddyVersion() ?? "unknown");
  const cliEntry = path.resolve(process.argv[1]);
  const runtimeRoot = path.resolve(String(options["runtime-root"] ?? path.join(configRoot, "binaries", "node", "workspace")));
  const runtimePackageSpec = options["runtime-package-spec"] ? String(options["runtime-package-spec"]) : null;
  const runtimePackageSource = runtimePackageSpec ? "explicit-package-spec" : "current-installed-package";
  const registrationMode = manager ? "expert-manager" : "declarative-marketplace";
  return { host: "workbuddy", hostVersion, configRoot, packageJson, source, marketplace, expert, mcpPath, workspace, manager, registrationMode, cliEntry, runtimeRoot, runtimePackageSpec, runtimePackageSource };
}

function detectWorkbuddyVersion() {
  try {
    return execFileSync("plutil", ["-extract", "CFBundleShortVersionString", "raw", "/Applications/WorkBuddy.app/Contents/Info.plist"], { encoding: "utf8" }).trim();
  } catch { return null; }
}

function resolveManager(explicit) {
  const isManager = (item) => fs.existsSync(path.join(item, "scripts", "validate_expert.py")) && fs.existsSync(path.join(item, "scripts", "register_expert.py"));
  if (explicit) {
    const requested = path.resolve(String(explicit));
    return isManager(requested) ? requested : null;
  }
  const candidates = [
    "/Applications/WorkBuddy.app/Contents/Resources/app.asar.unpacked/resources/plugins/workbuddy-builtin/skills/expert-manager",
    "/Applications/WorkBuddy.app/Contents/Resources/app.asar.unpacked/resources/builtin-skills/expert-manager"
  ]
    .map((item) => path.resolve(String(item)));
  return candidates.find(isManager) ?? null;
}

function buildPlan(operation, context) {
  const bootstrap = agentBootstrap(["--host", "workbuddy", "--workspace", context.workspace]);
  const changes = [];
  if (operation === "uninstall") {
    changes.push({ action: "remove-owned-expert", path: context.expert }, { action: "remove-owned-mcp-entry", path: context.mcpPath });
  } else {
    changes.push({ action: fs.existsSync(context.expert) ? "replace-owned-expert" : "create-owned-expert", path: context.expert });
    changes.push({ action: "migrate-owned-root-mcp-to-expert-plugin", path: context.mcpPath });
    changes.push({
      action: context.registrationMode === "expert-manager"
        ? "register-through-workbuddy-expert-manager"
        : "register-through-workbuddy-declarative-marketplace",
      path: context.marketplace
    });
    if (fs.existsSync(path.join(context.runtimeRoot, "package.json"))) changes.push({
      action: "synchronize-isolated-npm-runtime",
      path: context.runtimeRoot,
      package: context.runtimePackageSpec ?? `${context.packageJson.name}@${context.packageJson.version}`,
      source: context.runtimePackageSource,
      integrityDigest: packagedRuntimeIntegrityDigest(PACKAGE_ROOT)
    });
  }
  const stable = { schema: HOST_INSTALLER_SCHEMA, operation, host: context.host, package: `${context.packageJson.name}@${context.packageJson.version}`, packageIntegrityDigest: packagedRuntimeIntegrityDigest(PACKAGE_ROOT), workspace: context.workspace, changes };
  return { ...stable, host: { id: context.host, configRoot: context.configRoot }, planDigest: digest(stable), safety: { bootstrapReadOnly: true, previewBoundConfirmation: true, preservesUnrelatedConfiguration: true, workspaceRemovedOnUninstall: false }, bootstrap };
}

function applyPlan(operation, context, plan) {
  if (operation === "uninstall") return uninstall(context, plan);
  if (!fs.existsSync(context.source)) throw hostError("EXPERT_NOT_PACKAGED", `Packaged WorkBuddy expert is missing: ${context.source}.`, "repair-package-content");
  if (context.hostVersion !== "unknown" && Number(context.hostVersion.split(".")[0]) !== 5) throw hostError("UNSUPPORTED_WORKBUDDY_VERSION", `WorkBuddy ${context.hostVersion} is outside the validated 5.x range.`, `manual-import-from-${context.source}`);
  if (fs.existsSync(context.expert) && !owned(context.expert)) throw hostError("UNOWNED_EXPERT_CONFLICT", `Refusing to replace an expert not owned by @evopilot/harness: ${context.expert}.`, "rename-or-remove-conflicting-expert-after-review");
  let replaceHostMirror = false;
  if (fs.existsSync(context.mcpPath)) {
    const existingMcp = readJson(context.mcpPath).mcpServers?.[MCP_ID];
    replaceHostMirror = isInstalledPluginMcpMirror(context, existingMcp);
    if (existingMcp && !isHarnessManagedRootMcp(context, existingMcp) && !isInstalledPluginMcpMirror(context, existingMcp)) throw hostError("UNOWNED_MCP_CONFLICT", `Refusing to remove an MCP server not owned by @evopilot/harness: ${MCP_ID}.`, "rename-or-remove-conflicting-mcp-after-review");
  }
  fs.mkdirSync(path.dirname(context.expert), { recursive: true });
  const backupRoot = backupManaged(context);
  try {
    fs.rmSync(context.expert, { recursive: true, force: true });
    fs.cpSync(context.source, context.expert, { recursive: true });
    const ownership = { schema: MANAGED_SCHEMA, owner: "@evopilot/harness", version: context.packageJson.version, expertId: EXPERT_ID, workspace: context.workspace, installedAt: new Date().toISOString() };
    fs.writeFileSync(path.join(context.expert, ".evopilot-harness-owner.json"), `${JSON.stringify(ownership, null, 2)}\n`);
    const pluginPath = path.join(context.expert, ".codebuddy-plugin", "plugin.json");
    const plugin = readJson(pluginPath);
    plugin.version = context.packageJson.version;
    plugin.mcpServers = { [MCP_ID]: mcpDefinition(context) };
    fs.writeFileSync(pluginPath, `${JSON.stringify(plugin, null, 2)}\n`);
    ownership.managedFiles = managedFileDigests(context.expert);
    fs.writeFileSync(path.join(context.expert, ".evopilot-harness-owner.json"), `${JSON.stringify(ownership, null, 2)}\n`);
    synchronizeRuntime(context);
    if (fs.existsSync(context.mcpPath)) {
      const config = readJson(context.mcpPath);
      const rootMcp = config.mcpServers?.[MCP_ID];
      if (replaceHostMirror || isHarnessManagedRootMcp(context, rootMcp) || isInstalledPluginMcpMirror(context, rootMcp)) {
        delete config.mcpServers[MCP_ID];
        fs.writeFileSync(context.mcpPath, `${JSON.stringify(config, null, 2)}\n`);
      }
    }
    if (context.manager) {
      const managerEnv = { ...process.env, WORKBUDDY_CONFIG_DIR: context.configRoot };
      execFileSync("python3", [path.join(context.manager, "scripts", "validate_expert.py"), context.expert], { stdio: "pipe", env: managerEnv });
      execFileSync("python3", [path.join(context.manager, "scripts", "register_expert.py"), context.expert, "--marketplace-dir", context.marketplace, "--session-id", `evopilot-harness-${context.packageJson.version}`], { stdio: "pipe", env: managerEnv });
    } else {
      validateDeclarativeExpert(context);
      registerDeclarativeExpert(context);
    }
  } catch (error) {
    restoreBackup(context, backupRoot);
    throw hostError("WORKBUDDY_REGISTRATION_FAILED", `WorkBuddy registration failed and managed state was rolled back: ${error.message}`, `manual-import-from-${context.source}`);
  }
  const status = inspectStatus(context);
  if (status.status !== "INSTALLED") throw hostError("POST_INSTALL_VERIFICATION_FAILED", "WorkBuddy expert registration did not pass post-install verification.", "run-agent-repair");
  return { ...plan, status: "INSTALLED", initializationStatus: status.initializationStatus, llmInitialization: status.llmInitialization, backupRoot, verification: status.verification, nextAction: status.initializationStatus === "LIVE_VERIFICATION_REQUIRED" ? "restart-workbuddy-open-a-fresh-expert-session-and-call-inspect-capabilities" : "restart-or-refresh-workbuddy-open-expert-and-complete-llm-initialization" };
}

function uninstall(context, plan) {
  const backupRoot = backupManaged(context);
  if (owned(context.expert)) fs.rmSync(context.expert, { recursive: true, force: true });
  if (fs.existsSync(context.mcpPath)) {
    const config = readJson(context.mcpPath);
    if (config.mcpServers?.[MCP_ID]?.managedBy === "@evopilot/harness") delete config.mcpServers[MCP_ID];
    fs.writeFileSync(context.mcpPath, `${JSON.stringify(config, null, 2)}\n`);
  }
  if (fs.existsSync(path.join(context.marketplace, ".codebuddy-plugin", "marketplace.json"))) {
    const catalogPath = path.join(context.marketplace, ".codebuddy-plugin", "marketplace.json");
    const catalog = readJson(catalogPath);
    catalog.plugins = (catalog.plugins ?? []).filter((item) => item.name !== EXPERT_ID);
    fs.writeFileSync(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`);
  }
  return { ...plan, status: "UNINSTALLED", backupRoot, workspacePreserved: context.workspace, nextAction: "restart-or-refresh-workbuddy" };
}

function removeOwnedRootMcp(context) {
  if (!fs.existsSync(context.mcpPath)) return;
  const config = readJson(context.mcpPath);
  if (!isHarnessManagedRootMcp(context, config.mcpServers?.[MCP_ID])) return;
  delete config.mcpServers[MCP_ID];
  fs.writeFileSync(context.mcpPath, `${JSON.stringify(config, null, 2)}\n`);
}

function isHarnessManagedRootMcp(context, value) {
  if (!value || typeof value !== "object") return false;
  if (value.managedBy === "@evopilot/harness") return true;
  const expected = mcpDefinition(context);
  return value.type === expected.type
    && value.command === expected.command
    && JSON.stringify(value.args) === JSON.stringify(expected.args)
    && (value.disabled === undefined || value.disabled === false);
}

function isInstalledPluginMcpMirror(context, value) {
  if (!value || typeof value !== "object") return false;
  const pluginPath = path.join(context.expert, ".codebuddy-plugin", "plugin.json");
  if (!fs.existsSync(pluginPath)) return false;
  const installed = readJson(pluginPath).mcpServers?.[MCP_ID];
  if (!installed || typeof installed !== "object") return false;
  return value.type === installed.type
    && value.command === installed.command
    && JSON.stringify(value.args) === JSON.stringify(installed.args)
    && (value.disabled === undefined || value.disabled === false);
}

function inspectStatus(context) {
  const expertExists = fs.existsSync(context.expert);
  const isOwned = owned(context.expert);
  const ownedFilesMatch = isOwned && managedFilesMatch(context.expert, context.packageJson.version);
  const catalogPath = path.join(context.marketplace, ".codebuddy-plugin", "marketplace.json");
  const registered = fs.existsSync(catalogPath) && (readJson(catalogPath).plugins ?? []).some((item) => item.name === EXPERT_ID);
  const config = fs.existsSync(context.mcpPath) ? readJson(context.mcpPath) : {};
  const mcp = config.mcpServers?.[MCP_ID];
  const legacyRootMcpPresent = Boolean(mcp);
  const legacyRootMcpOwned = mcp?.managedBy === "@evopilot/harness";
  // WorkBuddy 5.x materializes a connected expert-plugin MCP declaration into
  // its root runtime configuration. The host does not retain our ownership
  // marker, so equality with the installed plugin binding is the only stable,
  // deterministic provenance signal available. Treat that exact mirror as a
  // host runtime cache, never as a second Harness-owned configuration surface.
  const hostMaterializedPluginMcp = legacyRootMcpPresent
    && !legacyRootMcpOwned
    && (isHarnessManagedRootMcp(context, mcp) || isInstalledPluginMcpMirror(context, mcp));
  const expectedRuntimeCli = path.join(context.runtimeRoot, "node_modules", ".bin", "evopilot-harness");
  const pluginPath = path.join(context.expert, ".codebuddy-plugin", "plugin.json");
  const pluginMcp = fs.existsSync(pluginPath) ? readJson(pluginPath).mcpServers?.[MCP_ID] : null;
  const pluginMcpDeclared = Boolean(pluginMcp);
  const pluginMcpRuntimeBindingMatch = pluginMcp?.command === expectedRuntimeCli
    && Array.isArray(pluginMcp?.args)
    && pluginMcp.args.includes(context.workspace)
    && fs.existsSync(expectedRuntimeCli);
  const runtimeDetected = fs.existsSync(path.join(context.runtimeRoot, "package.json"));
  const runtimePackage = path.join(context.runtimeRoot, "node_modules", "@evopilot", "harness", "package.json");
  const runtimeVersion = fs.existsSync(runtimePackage) ? readJson(runtimePackage).version : null;
  const runtimeVersionMatch = !runtimeDetected || runtimeVersion === context.packageJson.version;
  const runtimeCoreDigest = installedCoreDigest(context.runtimeRoot);
  const expectedCoreDigest = packagedCoreDigest(PACKAGE_ROOT);
  const runtimeCoreDigestMatch = !runtimeDetected || runtimeCoreDigest === expectedCoreDigest;
  const runtimeIntegrityDigest = installedRuntimeIntegrityDigest(context.runtimeRoot);
  const expectedRuntimeIntegrityDigest = packagedRuntimeIntegrityDigest(PACKAGE_ROOT);
  const runtimeIntegrityDigestMatch = !runtimeDetected || runtimeIntegrityDigest === expectedRuntimeIntegrityDigest;
  const rootMcpBindingAcceptable = !legacyRootMcpPresent || legacyRootMcpOwned || hostMaterializedPluginMcp;
  const healthy = expertExists && isOwned && ownedFilesMatch && registered && rootMcpBindingAcceptable && pluginMcpDeclared && pluginMcpRuntimeBindingMatch && runtimeVersionMatch && runtimeCoreDigestMatch && runtimeIntegrityDigestMatch;
  const llmInitialization = inspectModelReadiness(context.workspace, resolveWorkspaceModelsFile(context.workspace));
  const initializationStatus = !healthy || llmInitialization.status !== "CONFIGURED_AND_VERIFIED" ? "ACTION_REQUIRED" : "LIVE_VERIFICATION_REQUIRED";
  return { schema: HOST_INSTALLER_SCHEMA, operation: "status", status: healthy ? "INSTALLED" : expertExists || registered || mcp ? "DRIFTED" : "NOT_INSTALLED", initializationStatus, host: { id: context.host, version: context.hostVersion, configRoot: context.configRoot }, verification: { expertExists, owned: isOwned, ownedFilesMatch, registered, registrationMode: context.registrationMode, legacyRootMcpPresent, legacyRootMcpOwned, hostMaterializedPluginMcp, rootMcpBindingAcceptable, pluginMcpDeclared, pluginMcpRuntimeBindingMatch, liveSessionVerified: false, workspaceExists: fs.existsSync(context.workspace), runtimeDetected, runtimeRoot: context.runtimeRoot, runtimeVersion, runtimeVersionMatch, runtimeCoreDigest, expectedCoreDigest, runtimeCoreDigestMatch, runtimeIntegrityDigest, expectedRuntimeIntegrityDigest, runtimeIntegrityDigestMatch, expertManagerAvailable: Boolean(context.manager) }, llmInitialization, nextAction: healthy ? initializationStatus === "LIVE_VERIFICATION_REQUIRED" ? "restart-workbuddy-open-a-fresh-expert-session-and-call-inspect-capabilities" : "complete-harness-llm-initialization" : expertExists || registered || mcp ? "run-agent-repair" : "run-agent-install" };
}

function validateDeclarativeExpert(context) {
  const pluginPath = path.join(context.expert, ".codebuddy-plugin", "plugin.json");
  const plugin = readJson(pluginPath);
  if (plugin.name !== EXPERT_ID || plugin.expertType !== "agent") {
    throw new Error("declarative WorkBuddy expert identity is invalid");
  }
  for (const relative of [...(plugin.agents ?? []), ...(plugin.skills ?? [])]) {
    if (!String(relative).startsWith("./") || !fs.existsSync(path.resolve(context.expert, relative))) {
      throw new Error(`declarative WorkBuddy expert entry is missing: ${relative}`);
    }
  }
  if (!plugin.mcpServers?.[MCP_ID]) throw new Error("declarative WorkBuddy expert MCP binding is missing");
}

function registerDeclarativeExpert(context) {
  const catalogPath = path.join(context.marketplace, ".codebuddy-plugin", "marketplace.json");
  fs.mkdirSync(path.dirname(catalogPath), { recursive: true });
  const catalog = fs.existsSync(catalogPath)
    ? readJson(catalogPath)
    : { name: path.basename(context.marketplace), description: `${path.basename(context.marketplace)} marketplace`, plugins: [] };
  if (!Array.isArray(catalog.plugins)) throw new Error("WorkBuddy declarative marketplace plugins must be an array");
  const plugin = readJson(path.join(context.expert, ".codebuddy-plugin", "plugin.json"));
  const entry = {
    name: EXPERT_ID,
    source: `./plugins/${EXPERT_ID}`,
    description: plugin.description
  };
  catalog.plugins = [...catalog.plugins.filter((item) => item?.name !== EXPERT_ID), entry];
  fs.writeFileSync(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`);
}

function mcpDefinition(context) {
  return {
    type: "stdio",
    command: path.join(context.runtimeRoot, "node_modules", ".bin", "evopilot-harness"),
    args: ["mcp", "serve", "--transport", "stdio", "--workspace", context.workspace],
    timeout: 300000
  };
}

function synchronizeRuntime(context) {
  const manifest = path.join(context.runtimeRoot, "package.json");
  if (!fs.existsSync(manifest)) return;
  const installed = path.join(context.runtimeRoot, "node_modules", "@evopilot", "harness", "package.json");
  const versionMatches = fs.existsSync(installed) && readJson(installed).version === context.packageJson.version;
  const coreMatches = installedCoreDigest(context.runtimeRoot) === packagedCoreDigest(PACKAGE_ROOT);
  const integrityMatches = installedRuntimeIntegrityDigest(context.runtimeRoot) === packagedRuntimeIntegrityDigest(PACKAGE_ROOT);
  if (versionMatches && coreMatches && integrityMatches) return;
  const installedRoot = path.dirname(installed);
  const backupRoot = `${installedRoot}.evopilot-runtime-backup-${process.pid}`;
  if (fs.existsSync(backupRoot)) fs.rmSync(backupRoot, { recursive: true, force: true });
  if (fs.existsSync(installedRoot)) fs.renameSync(installedRoot, backupRoot);
  let materializedPackage = null;
  try {
    materializedPackage = context.runtimePackageSpec ? null : materializeCurrentPackage();
    const packageSpec = context.runtimePackageSpec ?? materializedPackage.tarball;
    execFileSync("npm", ["install", "--prefix", context.runtimeRoot, "--save-exact", "--ignore-scripts", packageSpec], { stdio: "pipe", env: process.env });
    if (installedRuntimeIntegrityDigest(context.runtimeRoot) !== packagedRuntimeIntegrityDigest(PACKAGE_ROOT)) {
      throw new Error("isolated runtime content does not match the requested package");
    }
    fs.rmSync(backupRoot, { recursive: true, force: true });
  } catch (error) {
    fs.rmSync(installedRoot, { recursive: true, force: true });
    if (fs.existsSync(backupRoot)) fs.renameSync(backupRoot, installedRoot);
    throw error;
  } finally {
    if (materializedPackage) fs.rmSync(materializedPackage.root, { recursive: true, force: true });
  }
}

function materializeCurrentPackage() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "evopilot-harness-runtime-package-"));
  try {
    const output = execFileSync("npm", ["pack", PACKAGE_ROOT, "--pack-destination", root, "--json", "--ignore-scripts"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env: process.env });
    const packed = JSON.parse(output);
    const filename = packed?.[0]?.filename;
    if (!filename) throw new Error("npm pack did not return a candidate package filename");
    return { root, tarball: path.join(root, filename) };
  } catch (error) {
    fs.rmSync(root, { recursive: true, force: true });
    throw error;
  }
}

function packagedCoreDigest(packageRoot) {
  const lock = path.join(packageRoot, "digital-expert", "manifest.lock.json");
  return fs.existsSync(lock) ? readJson(lock).coreDigest ?? null : null;
}

function installedCoreDigest(runtimeRoot) {
  return packagedCoreDigest(path.join(runtimeRoot, "node_modules", "@evopilot", "harness"));
}

function packagedRuntimeIntegrityDigest(packageRoot) {
  try {
    const entries = RUNTIME_INTEGRITY_FILES.map((relative) => [relative, digestBytes(fs.readFileSync(path.join(packageRoot, relative)))]);
    return digest(entries);
  } catch { return null; }
}

function installedRuntimeIntegrityDigest(runtimeRoot) {
  return packagedRuntimeIntegrityDigest(path.join(runtimeRoot, "node_modules", "@evopilot", "harness"));
}

function backupManaged(context) {
  const targets = [context.expert, context.mcpPath, path.join(context.marketplace, ".codebuddy-plugin", "marketplace.json")].filter((item) => fs.existsSync(item));
  if (!targets.length) return null;
  const root = path.join(context.configRoot, "backups", "evopilot-harness", new Date().toISOString().replaceAll(":", "-"));
  fs.mkdirSync(root, { recursive: true });
  for (const target of targets) fs.cpSync(target, path.join(root, path.basename(target)), { recursive: true });
  fs.writeFileSync(path.join(root, "backup-manifest.json"), `${JSON.stringify({ targets }, null, 2)}\n`);
  return root;
}

function restoreBackup(context, root) {
  fs.rmSync(context.expert, { recursive: true, force: true });
  if (!root) { if (fs.existsSync(context.mcpPath)) fs.rmSync(context.mcpPath); return; }
  const targets = new Set(readJson(path.join(root, "backup-manifest.json")).targets);
  const expertBackup = path.join(root, EXPERT_ID);
  if (targets.has(context.expert) && fs.existsSync(expertBackup)) fs.cpSync(expertBackup, context.expert, { recursive: true });
  for (const target of [context.mcpPath, path.join(context.marketplace, ".codebuddy-plugin", "marketplace.json")]) {
    const saved = path.join(root, path.basename(target));
    if (targets.has(target) && fs.existsSync(saved)) fs.copyFileSync(saved, target);
    else fs.rmSync(target, { force: true });
  }
}

function owned(expert) {
  const marker = path.join(expert, ".evopilot-harness-owner.json");
  return fs.existsSync(marker) && readJson(marker).owner === "@evopilot/harness";
}

function managedFileDigests(expert) {
  const relativeFiles = [".codebuddy-plugin/plugin.json", "agents/evopilot-harness-digital-expert.md", "skills/evopilot-harness-digital-expert/SKILL.md", "README.md"];
  return Object.fromEntries(relativeFiles.map((relative) => [relative, digestBytes(fs.readFileSync(path.join(expert, relative)))]));
}

function managedFilesMatch(expert, version) {
  try {
    const ownership = readJson(path.join(expert, ".evopilot-harness-owner.json"));
    if (ownership.version !== version || !ownership.managedFiles) return false;
    return Object.entries(ownership.managedFiles).every(([relative, expected]) => {
      const file = path.join(expert, relative);
      return fs.existsSync(file) && digestBytes(fs.readFileSync(file)) === expected;
    });
  } catch { return false; }
}

function parseOptions(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (!value.startsWith("--")) continue;
    const [name, inline] = value.slice(2).split("=", 2);
    if (inline !== undefined) result[name] = inline;
    else if (argv[index + 1] && !argv[index + 1].startsWith("--")) result[name] = argv[++index];
    else result[name] = true;
  }
  return result;
}

function readJson(file) { return JSON.parse(fs.readFileSync(file, "utf8")); }
function digest(value) { return `sha256:${crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex")}`; }
function digestBytes(value) { return `sha256:${crypto.createHash("sha256").update(value).digest("hex")}`; }
function hostError(code, message, nextAction = "inspect-agent-host") { const error = new Error(message); error.code = code; error.nextAction = nextAction; return error; }
