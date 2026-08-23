import fs from "node:fs";
import path from "node:path";
import { PACKAGE_ROOT } from "../v3/constants.mjs";

export const AGENT_PROTOCOL_VERSION = "evopilot-harness-agent-operations/v2";
export const LEGACY_AGENT_PROTOCOL_VERSION = "evopilot-harness-agent-operations/v1";
export const AGENT_SESSION_SCHEMA = "evopilot-harness-agent-operation-session/v2";
export const LEGACY_AGENT_SESSION_SCHEMA = "evopilot-harness-agent-operation-session/v1";
export const INTERACTION_FRAME_SCHEMA = "evopilot-harness-interaction-frame/v1";
export const INTERACTION_PRESENTATION_RECEIPT_SCHEMA = "evopilot-harness-interaction-presentation-receipt/v1";
export const OPERATION_PLAN_SCHEMA = "evopilot-harness-operation-plan/v1";
export const DIGITAL_EXPERT_SCHEMA = "evopilot-harness-digital-expert/v1";
export const MCP_PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];
export const DEFAULT_MCP_PROTOCOL_VERSION = MCP_PROTOCOL_VERSIONS[0];
export const ENGINE_PROTOCOL_RANGE = { min: "harness.evopilot.io/v3", max: "harness.evopilot.io/v3" };
export const RELEASE_ROOT = PACKAGE_ROOT;

export function operationCompatibility() {
  const packageJson = JSON.parse(fs.readFileSync(path.join(PACKAGE_ROOT, "package.json"), "utf8"));
  const expertLock = JSON.parse(fs.readFileSync(path.join(PACKAGE_ROOT, "digital-expert/manifest.lock.json"), "utf8"));
  return {
    productVersion: packageJson.version,
    expertVersion: expertLock.expertVersion,
    coreDigest: expertLock.coreDigest,
    agentProtocolVersion: AGENT_PROTOCOL_VERSION,
    engineApiVersion: ENGINE_PROTOCOL_RANGE.min
  };
}

export function assertOperationCompatibility(value) {
  const expected = operationCompatibility();
  const actual = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const mismatches = Object.entries(expected)
    .filter(([key, expectedValue]) => actual[key] !== expectedValue)
    .map(([key, expectedValue]) => ({ field: key, expected: expectedValue, actual: actual[key] ?? null }));
  if (mismatches.length) {
    const error = new Error(`Agent compatibility is missing or incompatible: ${mismatches.map((item) => item.field).join(", ")}.`);
    error.name = "AgentCompatibilityError";
    error.code = "AGENT_COMPATIBILITY_MISMATCH";
    error.nextAction = "reload-current-digital-expert-adapter-and-reinitialize";
    error.mismatches = mismatches;
    throw error;
  }
  return expected;
}

export function assertExternalWorkspace(home) {
  const resolved = path.resolve(home);
  const release = path.resolve(RELEASE_ROOT);
  const canonical = canonicalTarget(resolved);
  const canonicalRelease = fs.realpathSync(release);
  if (inside(release, resolved) || inside(canonicalRelease, canonical)) {
    throw new Error(`Agent Workspace must be outside the evopilot-harness Release: ${canonical}`);
  }
  return canonical;
}

export function resolveWorkspacePath(home, ...segments) {
  const workspace = assertExternalWorkspace(home);
  const target = path.resolve(workspace, ...segments.map(String));
  if (!inside(workspace, target)) throw workspaceBoundaryError(target);
  const canonical = canonicalTarget(target);
  if (!inside(workspace, canonical)) throw workspaceBoundaryError(canonical);
  return canonical;
}

export function assertWorkspaceTreeConfined(home) {
  const workspace = assertExternalWorkspace(home);
  if (!fs.existsSync(workspace)) return workspace;
  scanWorkspaceLinks(workspace, workspace);
  return workspace;
}

function canonicalTarget(target) {
  let existing = target;
  const suffix = [];
  while (!fs.existsSync(existing)) {
    const parent = path.dirname(existing);
    if (parent === existing) throw new Error(`Agent Workspace has no existing ancestor: ${target}`);
    suffix.unshift(path.basename(existing));
    existing = parent;
  }
  return path.resolve(fs.realpathSync(existing), ...suffix);
}

function inside(root, target) {
  return target === root || target.startsWith(`${root}${path.sep}`);
}

function scanWorkspaceLinks(workspace, directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) {
      let canonical;
      try {
        canonical = fs.realpathSync(target);
      } catch {
        throw workspaceBoundaryError(target);
      }
      if (!inside(workspace, canonical)) throw workspaceBoundaryError(canonical);
    } else if (entry.isDirectory()) {
      scanWorkspaceLinks(workspace, target);
    }
  }
}

function workspaceBoundaryError(target) {
  const error = new Error(`Agent Workspace path must remain inside the external Workspace: ${target}`);
  error.name = "AgentWorkspaceBoundaryError";
  error.code = "WORKSPACE_WRITE_BOUNDARY_VIOLATION";
  error.nextAction = "remove-or-replace-workspace-symlink";
  return error;
}
