import { createHash } from "node:crypto";

const CURRENT_PATHS = Object.freeze({
  classificationBranch: ["status", "currentResult.aggregate"],
  sourceSnapshotDigest: ["source.snapshotDigest", "currentResult.sourceSnapshotDigest"],
  networkAcquisition: ["source.resolution.networkAcquisition"]
});

export function preflightClassificationEvidence(value) {
  const engineResult = unwrapEngineResult(value);
  const classificationBranch = consistentRequired(engineResult, CURRENT_PATHS.classificationBranch, "classificationBranch");
  const sourceSnapshotDigest = consistentRequired(engineResult, CURRENT_PATHS.sourceSnapshotDigest, "sourceSnapshotDigest");
  const networkAcquisition = consistentRequired(engineResult, CURRENT_PATHS.networkAcquisition, "networkAcquisition");
  requiredString(engineResult.sessionId, "sessionId");
  requiredString(engineResult.sessionDigest, "sessionDigest");
  requiredString(engineResult.currentResult?.analysisResultDigest, "currentResult.analysisResultDigest");

  const projection = {
    schema: "evopilot-independent-host-classification-evidence-projection/v1",
    algorithm: "current-classification-result-paths/v1",
    classificationBranch,
    sourceSnapshotDigest,
    networkAcquisition,
    sessionId: engineResult.sessionId,
    sessionDigest: engineResult.sessionDigest,
    analysisResultDigest: engineResult.currentResult.analysisResultDigest,
    advisorInvocationCount: engineResult.currentResult.advisor?.invocationCount ?? null,
    fieldPaths: CURRENT_PATHS,
    authority: {
      engineResultChanged: false,
      acceptanceSemanticsChanged: false,
      sourceSelectionChanged: false
    }
  };
  return { status: "PASS", projection: { ...projection, projectionDigest: digest(projection) } };
}

export function createProjectionCorrectionRecord({ previousRecordDigest, caseId, attempt, finding, projection, createdAt }) {
  requiredString(previousRecordDigest, "previousRecordDigest");
  requiredString(caseId, "caseId");
  requiredString(finding, "finding");
  requiredString(createdAt, "createdAt");
  if (!Number.isInteger(attempt) || attempt < 1) throw projectionError("INVALID_CORRECTION_ATTEMPT", "attempt must be a positive integer");
  if (projection?.schema !== "evopilot-independent-host-classification-evidence-projection/v1") throw projectionError("INVALID_CORRECTION_PROJECTION", "projection must be a preflighted current-path projection");
  const record = {
    schema: "evopilot-independent-host-runner-projection-correction/v1",
    createdAt,
    caseId,
    attempt,
    finding,
    previousRecordDigest,
    projection,
    disposition: "APPEND_ONLY_RUNNER_PROJECTION_CORRECTION",
    authority: {
      overwritesPreviousEvidence: false,
      changesEngineResult: false,
      changesFrozenStandard: false,
      changesSourceSelection: false,
      changesAcceptanceSemantics: false
    }
  };
  return { ...record, recordDigest: digest(record) };
}

function unwrapEngineResult(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw projectionError("CLASSIFICATION_RESULT_REQUIRED", "classification result must be an object");
  if (value.engineResult !== undefined) return objectRequired(value.engineResult, "engineResult");
  if (value.structuredContent !== undefined) return objectRequired(value.structuredContent, "structuredContent");
  return value;
}

function consistentRequired(value, paths, fieldName) {
  const observed = paths.map((path) => ({ path, value: atPath(value, path) })).filter((item) => item.value !== undefined && item.value !== null);
  if (!observed.length) throw projectionError("CLASSIFICATION_PROJECTION_FIELD_MISSING", `required current field ${fieldName} is missing`, { fieldName, paths });
  for (const item of observed) requiredString(item.value, item.path);
  if (new Set(observed.map((item) => item.value)).size !== 1) throw projectionError("CLASSIFICATION_PROJECTION_FIELD_CONFLICT", `current fields for ${fieldName} conflict`, { fieldName, observed });
  return observed[0].value;
}

function atPath(value, fieldPath) {
  return fieldPath.split(".").reduce((current, segment) => current?.[segment], value);
}

function objectRequired(value, fieldName) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw projectionError("CLASSIFICATION_RESULT_REQUIRED", `${fieldName} must be an object`);
  return value;
}

function requiredString(value, fieldName) {
  if (typeof value !== "string" || value.length === 0) throw projectionError("CLASSIFICATION_PROJECTION_FIELD_INVALID", `${fieldName} must be a non-empty string`);
}

function projectionError(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  return error;
}

function digest(value) {
  return `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}
