#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const e2eRoot = path.join(root, "tests", "e2e");
const expectedCaseOrder = ["RC01", "RC02", "RC03", "RC04", "RC05"];
const forbiddenAuthorityKeys = new Set([
  "acceptanceStatus",
  "approval",
  "approvals",
  "criterion",
  "decision",
  "evidenceRefs",
  "release",
  "releaseAuthorization",
  "status"
]);

try {
  const options = parseOptions(process.argv.slice(2));
  const indexFile = options.index ? resolveInput(options.index) : path.join(e2eRoot, "index.json");
  const indexBytes = fs.readFileSync(indexFile);
  const index = JSON.parse(indexBytes);
  const indexedVersions = validateIndex(index, indexFile);
  const schemaFile = path.join(e2eRoot, "schema", "manifest.schema.json");
  const schemaBytes = fs.readFileSync(schemaFile);
  const schema = JSON.parse(schemaBytes);
  assert(schema.$id === "https://evopilot.dev/schemas/harness-e2e-manifest-v1.json", "MANIFEST_SCHEMA_INVALID", "The repository E2E manifest schema identity is invalid.");

  const manifestFiles = options.manifest
    ? [resolveInput(options.manifest)]
    : [...indexedVersions.values()].map((entry) => entry.manifestFile);
  const manifests = manifestFiles.map((manifestFile) => validateManifest({ manifestFile, indexedVersions }));
  const report = {
    schema: "evopilot-harness-e2e-validation/v1",
    status: "PASSED",
    indexDigest: sha256(indexBytes),
    schemaDigest: sha256(schemaBytes),
    versions: manifests,
    authority: {
      source: "governance/targets",
      projectionReadOnly: true,
      productAuthority: false,
      acceptanceAuthority: false,
      releaseAuthority: false
    }
  };
  report.validationDigest = sha256(Buffer.from(JSON.stringify(report)));
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} catch (error) {
  const report = {
    schema: "evopilot-harness-e2e-validation/v1",
    status: "BLOCKED",
    blocker: {
      code: error.code ?? "REPOSITORY_E2E_VALIDATION_FAILED",
      message: redactPath(error.message)
    },
    authority: {
      projectionReadOnly: true,
      productAuthority: false,
      acceptanceAuthority: false,
      releaseAuthority: false
    }
  };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.exitCode = 2;
}

function validateIndex(index, indexFile) {
  assert(indexFile === path.join(e2eRoot, "index.json"), "INDEX_PATH_UNSAFE", "The E2E index must be the checked-in tests/e2e/index.json file.");
  exactKeys(index, ["schema", "versions"], "INDEX_SHAPE_INVALID");
  assert(index.schema === "evopilot-harness-e2e-index/v1", "INDEX_SCHEMA_INVALID", "The E2E index schema is invalid.");
  assert(Array.isArray(index.versions) && index.versions.length > 0, "INDEX_VERSIONS_INVALID", "The E2E index must list at least one version.");
  const versions = new Map();
  for (const entry of index.versions) {
    exactKeys(entry, ["manifest", "version"], "INDEX_ENTRY_SHAPE_INVALID");
    assert(/^\d+\.\d+\.\d+$/.test(entry.version), "INDEX_VERSION_INVALID", `Invalid indexed version: ${entry.version}.`);
    assert(!versions.has(entry.version), "INDEX_VERSION_DUPLICATE", `Duplicate indexed version: ${entry.version}.`);
    assert(entry.manifest === `versions/${entry.version}/manifest.json`, "INDEX_MANIFEST_PATH_INVALID", `Version ${entry.version} must use its canonical manifest path.`);
    const manifestFile = resolveInside(e2eRoot, entry.manifest, "INDEX_MANIFEST_PATH_UNSAFE");
    assert(fs.statSync(manifestFile).isFile(), "INDEX_MANIFEST_MISSING", `Manifest for ${entry.version} is missing.`);
    versions.set(entry.version, { ...entry, manifestFile });
  }
  return versions;
}

function validateManifest({ manifestFile, indexedVersions }) {
  const bytes = fs.readFileSync(manifestFile);
  const manifest = JSON.parse(bytes);
  rejectAuthorityCopies(manifest);
  exactKeys(manifest, ["authority", "cases", "evidencePolicy", "projectionMode", "requiredCaseOrder", "scenarioProfile", "schema", "target", "version"], "MANIFEST_SHAPE_INVALID");
  assert(manifest.schema === "evopilot-harness-e2e-manifest/v1", "MANIFEST_SCHEMA_INVALID", "Manifest schema is invalid.");
  assert(manifest.projectionMode === "HISTORICAL_ACCEPTANCE_PROJECTION", "PROJECTION_MODE_INVALID", "Manifest projectionMode must be historical and read-only.");
  assert(/^\d+\.\d+\.\d+$/.test(manifest.version), "MANIFEST_VERSION_INVALID", "Manifest version must be an exact SemVer.");
  const indexed = indexedVersions.get(manifest.version);
  assert(indexed, "VERSION_NOT_INDEXED", `Version ${manifest.version} is not declared by tests/e2e/index.json.`);

  exactKeys(manifest.authority, ["grantsAcceptance", "grantsRelease", "readOnly", "source"], "MANIFEST_AUTHORITY_INVALID");
  assert(manifest.authority.source === "governance/targets" && manifest.authority.readOnly === true && manifest.authority.grantsAcceptance === false && manifest.authority.grantsRelease === false, "MANIFEST_AUTHORITY_INVALID", "Manifest authority must be a read-only governance/targets projection with no acceptance or release authority.");
  exactKeys(manifest.target, ["id", "path", "revision", "sha256"], "TARGET_BINDING_SHAPE_INVALID");
  assert(/^sha256:[0-9a-f]{64}$/.test(manifest.target.sha256), "TARGET_DIGEST_INVALID", "Target binding requires an exact SHA-256 digest.");
  assert(Number.isInteger(manifest.target.revision) && manifest.target.revision > 0, "TARGET_REVISION_INVALID", "Target revision must be a positive integer.");
  assert(/^governance\/targets\/[^/]+\.json$/.test(manifest.target.path), "TARGET_PATH_UNSAFE", "Target path must be one repository-relative governance/targets JSON file.");
  const targetFile = resolveInside(root, manifest.target.path, "TARGET_PATH_UNSAFE");
  const targetBytes = fs.readFileSync(targetFile);
  const targetDigest = sha256(targetBytes);
  assert(targetDigest === manifest.target.sha256, "TARGET_DIGEST_MISMATCH", `Target digest drift for ${manifest.version}: expected ${manifest.target.sha256}, received ${targetDigest}.`);
  const target = JSON.parse(targetBytes);
  assert(target.id === manifest.target.id, "TARGET_ID_MISMATCH", `Target id mismatch for ${manifest.version}.`);
  assert(target.revision === manifest.target.revision, "TARGET_REVISION_MISMATCH", `Target revision mismatch for ${manifest.version}.`);
  assert(target.roadmapBindings?.some((binding) => binding.project === "evopilot-harness" && binding.targetVersion === manifest.version), "TARGET_VERSION_MISMATCH", `Target ${manifest.target.id} is not bound to ${manifest.version}.`);

  assert(deepEqual(manifest.requiredCaseOrder, expectedCaseOrder), "REQUIRED_CASE_ORDER_MISMATCH", "Manifest requiredCaseOrder must be exactly RC01-RC05.");
  assert(Array.isArray(manifest.cases) && manifest.cases.length === expectedCaseOrder.length, "CASE_COUNT_MISMATCH", "Manifest must project exactly five cases.");
  const caseIds = manifest.cases.map((item) => item?.id);
  assert(deepEqual(caseIds, expectedCaseOrder), "CASE_ORDER_MISMATCH", "Manifest cases must be exactly RC01-RC05 in order.");
  const targetCases = target.realCaseCoverage;
  assert(Array.isArray(targetCases) && deepEqual(targetCases.map((item) => item.id), expectedCaseOrder), "TARGET_CASE_PORTFOLIO_INVALID", `Authoritative Target ${manifest.target.id} does not contain exactly RC01-RC05 in order.`);

  for (const [index, projection] of manifest.cases.entries()) {
    exactKeys(projection, ["acceptanceIds", "evidencePointer", "id", "targetPointer"], "CASE_PROJECTION_SHAPE_INVALID");
    const authoritative = targetCases[index];
    assert(projection.targetPointer === `/realCaseCoverage/${index}`, "TARGET_POINTER_MISMATCH", `Case ${projection.id} has an invalid Target pointer.`);
    assert(projection.evidencePointer === `/realCaseCoverage/${index}/evidenceRefs`, "EVIDENCE_POINTER_MISMATCH", `Case ${projection.id} has an invalid evidence pointer.`);
    assert(Array.isArray(projection.acceptanceIds) && projection.acceptanceIds.length > 0 && new Set(projection.acceptanceIds).size === projection.acceptanceIds.length, "CASE_ACCEPTANCE_IDS_INVALID", `Case ${projection.id} acceptanceIds must be unique and non-empty.`);
    assert(deepEqual(projection.acceptanceIds, authoritative.coversAcceptanceIds), "CASE_ACCEPTANCE_COVERAGE_MISMATCH", `Case ${projection.id} does not exactly project authoritative acceptance coverage.`);
    assert(Array.isArray(authoritative.evidenceRefs) && authoritative.evidenceRefs.length > 0 && authoritative.evidenceRefs.every((item) => typeof item === "string" && item.length > 0), "TARGET_EVIDENCE_REFS_INVALID", `Case ${projection.id} has no authoritative evidence references.`);
  }

  const projectedAcceptance = new Set(manifest.cases.flatMap((item) => item.acceptanceIds));
  const targetAcceptance = new Set(target.acceptance.map((item) => item.id));
  assert(setEqual(projectedAcceptance, targetAcceptance), "TARGET_ACCEPTANCE_COVERAGE_INCOMPLETE", `Version ${manifest.version} cases do not collectively cover every current Target acceptance id.`);

  assert(manifest.scenarioProfile === "../../scenarios/target-case-projection.json", "SCENARIO_PROFILE_INVALID", "Manifest must use the shared target-case-projection profile.");
  const scenarioFile = path.resolve(path.dirname(indexed.manifestFile), manifest.scenarioProfile);
  assert(isInside(path.join(e2eRoot, "scenarios"), scenarioFile), "SCENARIO_PROFILE_PATH_UNSAFE", "Scenario profile must stay under tests/e2e/scenarios.");
  const scenario = JSON.parse(fs.readFileSync(scenarioFile));
  assert(scenario.schema === "evopilot-harness-e2e-scenario-profile/v1" && scenario.id === "target-case-projection", "SCENARIO_PROFILE_INVALID", "Shared scenario profile identity is invalid.");

  exactKeys(manifest.evidencePolicy, ["embeddedEvidence", "immutableBinding", "mode"], "EVIDENCE_POLICY_INVALID");
  assert(manifest.evidencePolicy.mode === "TARGET_POINTERS_ONLY" && manifest.evidencePolicy.immutableBinding === "TARGET_FILE_SHA256" && manifest.evidencePolicy.embeddedEvidence === false, "EVIDENCE_POLICY_INVALID", "Evidence must remain pointer-only and bound by the exact Target file digest.");

  return {
    version: manifest.version,
    manifest: path.relative(root, indexed.manifestFile).split(path.sep).join("/"),
    manifestDigest: sha256(bytes),
    target: manifest.target.path,
    targetId: target.id,
    targetRevision: target.revision,
    targetDigest,
    caseIds,
    acceptanceIdCount: projectedAcceptance.size,
    evidenceReferenceCount: targetCases.reduce((sum, item) => sum + item.evidenceRefs.length, 0),
    terminalState: scenario.terminalState
  };
}

function parseOptions(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    assert(token === "--index" || token === "--manifest", "ARGUMENT_UNSUPPORTED", `Unsupported argument: ${token}.`);
    const value = argv[index + 1];
    assert(value && !value.startsWith("--"), "ARGUMENT_VALUE_REQUIRED", `${token} requires a path.`);
    options[token.slice(2)] = value;
    index += 1;
  }
  return options;
}

function resolveInput(value) {
  return path.isAbsolute(value) ? path.resolve(value) : path.resolve(root, value);
}

function resolveInside(base, relative, code) {
  assert(typeof relative === "string" && relative.length > 0 && !path.isAbsolute(relative), code, "Path must be non-empty and repository-relative.");
  const resolved = path.resolve(base, relative);
  assert(isInside(base, resolved), code, `Path escapes its allowed root: ${relative}.`);
  return resolved;
}

function isInside(base, candidate) {
  const relative = path.relative(path.resolve(base), path.resolve(candidate));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function rejectAuthorityCopies(value, pointer = "$") {
  if (Array.isArray(value)) {
    value.forEach((item, index) => rejectAuthorityCopies(item, `${pointer}[${index}]`));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, item] of Object.entries(value)) {
    assert(!forbiddenAuthorityKeys.has(key), "MANIFEST_AUTHORITY_FIELD_FORBIDDEN", `Manifest must not embed authoritative field ${pointer}.${key}.`);
    rejectAuthorityCopies(item, `${pointer}.${key}`);
  }
}

function exactKeys(value, expected, code) {
  assert(value && typeof value === "object" && !Array.isArray(value), code, "Expected an object.");
  const actual = Object.keys(value).sort();
  assert(deepEqual(actual, [...expected].sort()), code, `Unexpected object fields: ${actual.join(", ")}.`);
}

function setEqual(left, right) {
  return left.size === right.size && [...left].every((item) => right.has(item));
}

function deepEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function sha256(value) {
  return `sha256:${crypto.createHash("sha256").update(value).digest("hex")}`;
}

function redactPath(message) {
  return String(message).replace(/\/Users\/[^/\s]+/g, "/Users/[REDACTED]");
}

function assert(condition, code, message) {
  if (condition) return;
  const error = new Error(message);
  error.code = code;
  throw error;
}
