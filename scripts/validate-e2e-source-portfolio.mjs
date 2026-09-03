#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { buildSourceConceptHypothesis } from "../src/v4/classification/source-concept.mjs";
import { normalizeSourceDescriptor, resolveSourceDescriptor } from "../src/v4/classification/source-descriptor.mjs";
import { parseCli, option, writeJson } from "../src/v3/utils.mjs";

const root = path.resolve(import.meta.dirname, "..");
const args = parseCli(process.argv.slice(2));
const manifestFile = requiredPath("manifest");
const expectedDigest = option(args, "expected-digest");
const caseId = option(args, "case");
const workspace = option(args, "workspace") ? path.resolve(option(args, "workspace")) : null;
const out = option(args, "out") ? path.resolve(option(args, "out")) : null;

const bytes = fs.readFileSync(manifestFile);
const manifestDigest = `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
if (expectedDigest && manifestDigest !== expectedDigest) fail("SOURCE_PORTFOLIO_DIGEST_MISMATCH", `Expected ${expectedDigest}, received ${manifestDigest}.`);
const manifest = JSON.parse(bytes);
if (manifest.schema !== "evopilot-harness-e2e-source-portfolio/v1" || manifest.sourceMutation !== false || manifest.projectMutation !== false) fail("SOURCE_PORTFOLIO_CONTRACT_INVALID", "Source Portfolio schema or read-only authority is invalid.");
if (!Array.isArray(manifest.sources) || !Array.isArray(manifest.caseBindings)) fail("SOURCE_PORTFOLIO_SHAPE_INVALID", "Source Portfolio requires sources and caseBindings.");

const sourceById = new Map();
for (const source of manifest.sources) {
  if (!source?.id || sourceById.has(source.id)) fail("SOURCE_PORTFOLIO_SOURCE_ID_INVALID", `Missing or duplicate Source id: ${source?.id ?? "[missing]"}.`);
  if (source.readOnly !== true) fail("SOURCE_PORTFOLIO_SOURCE_NOT_READ_ONLY", `Source ${source.id} is not declared read-only.`);
  sourceById.set(source.id, source);
}
const bindingByCase = new Map();
for (const binding of manifest.caseBindings) {
  if (!/^RC(?:0[1-9]|1[0-5])$/.test(binding?.caseId) || bindingByCase.has(binding.caseId)) fail("SOURCE_PORTFOLIO_CASE_BINDING_INVALID", `Invalid or duplicate case binding: ${binding?.caseId ?? "[missing]"}.`);
  if (!Array.isArray(binding.sourceIds) || !binding.sourceIds.length || binding.sourceIds.some((id) => !sourceById.has(id))) fail("SOURCE_PORTFOLIO_CASE_SOURCE_UNRESOLVED", `Case ${binding.caseId} has unresolved Source ids.`);
  bindingByCase.set(binding.caseId, binding);
}
for (let index = 1; index <= 15; index += 1) {
  const required = `RC${String(index).padStart(2, "0")}`;
  if (!bindingByCase.has(required)) fail("SOURCE_PORTFOLIO_CASE_MISSING", `Source Portfolio does not bind ${required}.`);
}
if (caseId && !bindingByCase.has(caseId)) fail("SOURCE_PORTFOLIO_CASE_NOT_FOUND", `Source Portfolio does not bind ${caseId}.`);

const selectedIds = caseId ? bindingByCase.get(caseId).sourceIds : [...sourceById.keys()];
const results = [];
for (const sourceId of selectedIds) results.push(validateSource(sourceById.get(sourceId)));
const report = {
  schema: "evopilot-harness-e2e-source-portfolio-validation/v1",
  status: results.some((item) => item.status === "BLOCKED") ? "BLOCKED" : "PASSED",
  manifestDigest,
  targetVersion: manifest.targetVersion,
  caseId: caseId ?? "ALL",
  sourceCount: results.length,
  sources: results,
  authority: { acceptanceEvidenceOnly: true, sourceMutation: false, productAuthority: false, releaseAuthority: false }
};
report.validationDigest = sha256Json(report);
if (out) {
  assertOutputOutsideSources(out);
  writeJson(out, report);
}
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (report.status !== "PASSED") process.exitCode = 2;

function validateSource(source) {
  if (["CONTROLLED_FIXTURE_SET", "VIRTUAL_ACCEPTANCE_SET"].includes(source.type)) return { sourceId: source.id, type: source.type, safeLabel: source.id.toLowerCase(), status: "DEFERRED_TARGET_FIXTURE", readOnly: true };
  try {
    const descriptor = portfolioDescriptor(source);
    if (descriptor.type === "GITHUB_REPOSITORY" && !workspace) {
      return {
        sourceId: source.id,
        type: source.type,
        safeLabel: descriptor.locator.repository,
        descriptorDigest: sha256Json(descriptor),
        status: "BLOCKED",
        blocker: {
          code: "WORKSPACE_REQUIRED_FOR_GITHUB_SNAPSHOT",
          message: "A dedicated external Workspace is required to acquire and pin a GitHub Source snapshot.",
          nextAction: "provide-workspace"
        },
        readOnly: true
      };
    }
    const resolution = resolveSourceDescriptor({ descriptor, workspace: workspace ?? root });
    const hypothesis = buildSourceConceptHypothesis(resolution);
    if (source.expectedResolvedCommit && resolution.resolvedCommit !== source.expectedResolvedCommit) fail("SOURCE_PORTFOLIO_GITHUB_COMMIT_MISMATCH", `Source ${source.id} resolved an unexpected commit.`);
    return {
      sourceId: source.id,
      type: source.type,
      safeLabel: descriptor.type === "ORDERED_ATTACHMENT_SET" ? descriptor.safeLabel ?? source.id.toLowerCase() : descriptor.type === "GITHUB_REPOSITORY" ? descriptor.locator.repository : path.basename(descriptor.locator.path),
      descriptorDigest: resolution.sourceDescriptorDigest,
      sourceResolutionDigest: resolution.sourceResolutionDigest,
      sourceSnapshotDigest: hypothesis.sourceSnapshotDigest,
      resolvedCommit: resolution.resolvedCommit,
      memberSourceIds: descriptor.members?.map((member) => member.sourceId) ?? null,
      status: "PASSED",
      readOnly: true,
      sourceExecution: false
    };
  } catch (error) {
    return { sourceId: source.id, type: source.type, safeLabel: source.id.toLowerCase(), status: "BLOCKED", blocker: { code: error.code ?? "SOURCE_PORTFOLIO_VALIDATION_FAILED", message: redactPath(error.message), nextAction: error.nextAction ?? "inspect-source-portfolio" }, readOnly: true };
  }
}

function portfolioDescriptor(source) {
  if (source.type === "ORDERED_ATTACHMENT_SET") return normalizeSourceDescriptor({ sourceId: source.id.toLowerCase(), safeLabel: source.id, type: source.type, members: source.members.map((member, index) => ({ sourceId: `${source.id.toLowerCase()}-${String(index + 1).padStart(2, "0")}`, safeLabel: path.basename(member), path: resolveLocator(member) })) });
  if (source.type === "GITHUB_REPOSITORY") return normalizeSourceDescriptor({ sourceId: source.id.toLowerCase(), safeLabel: source.repository, type: source.type, repository: source.repositoryUrl ?? source.repository, requestedRef: source.requestedRef });
  return normalizeSourceDescriptor({ sourceId: source.id.toLowerCase(), safeLabel: source.id, type: source.type, path: resolveLocator(source.locator) });
}

function resolveLocator(value) { return path.isAbsolute(String(value)) ? path.resolve(String(value)) : path.resolve(root, String(value)); }
function requiredPath(name) { const value = option(args, name); if (!value) fail("SOURCE_PORTFOLIO_ARGUMENT_REQUIRED", `--${name} is required.`); return path.resolve(value); }
function sha256Json(value) { return `sha256:${crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex")}`; }
function redactPath(message) { return String(message).replace(/\/Users\/[^/\s]+/g, "/Users/[REDACTED]"); }
function assertOutputOutsideSources(target) {
  for (const source of manifest.sources) {
    const locators = source.members ?? (source.locator && path.isAbsolute(String(source.locator)) ? [source.locator] : []);
    for (const locator of locators) {
      const sourcePath = path.resolve(locator);
      if (target === sourcePath || target.startsWith(`${sourcePath}${path.sep}`)) fail("SOURCE_PORTFOLIO_OUTPUT_INSIDE_SOURCE", "Acceptance evidence output must remain outside every Source.");
    }
  }
}
function fail(code, message) { const error = new Error(message); error.code = code; throw error; }
