import path from "node:path";

export const PACKAGE_ROOT = path.resolve(import.meta.dirname, "../..");
export const API_VERSION = "harness.evopilot.io/v3";
export const CATALOG_SCHEMA = "evopilot-harness-catalog/v3";
export const CATALOG_BLOCK = "evopilot-harness-catalog-v3";
export const REGISTRY_SCHEMA = "evopilot-harness-registry/v2";
export const EVIDENCE_GRAPH_SCHEMA = "evopilot-harness-evidence-graph/v1";
export const REASONING_SCHEMA = "evopilot-harness-reasoning-result/v3";
export const WORKSPACE_SCHEMA = "evopilot-harness-workspace/v1";
export const FEEDBACK_API_VERSION = "feedback.evopilot.io/v1";
export const EFFECTIVENESS_API_VERSION = "feedback.evopilot.io/v1";
export const DECISIONS = [
  "EVOLVE_EXISTING",
  "COMPOSE_NEW_BUNDLE",
  "PROPOSE_NEW_PROFILE",
  "INSUFFICIENT_EVIDENCE",
  "NOT_HARNESS_ELIGIBLE",
  "REVIEW_REQUIRED"
];

export function defaultHarnessHome(env = process.env) {
  return path.resolve(env.EVOPILOT_HARNESS_HOME || path.join(env.HOME || process.cwd(), ".evopilot-harness"));
}
