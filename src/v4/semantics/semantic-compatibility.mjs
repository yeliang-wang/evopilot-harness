import { digest, persistedJson } from "../../v3/utils.mjs";
import { GROUNDING_OUTCOMES, ONTOLOGY_GROUNDING_RESULT_SCHEMA, SEMANTIC_META_TYPES, SEMANTIC_RELATION_TYPES } from "./ontology-grounding.mjs";

export const HARNESS_SEMANTIC_REQUIREMENTS_SCHEMA = "evopilot-harness-semantic-requirements/v1";
export const SEMANTIC_COMPATIBILITY_REPORT_SCHEMA = "evopilot-harness-semantic-compatibility-report/v1";

export function createHarnessSemanticRequirements(input = {}) {
  const requiredConcepts = normalizeRequirements(input.requiredConcepts);
  const prohibitedConcepts = normalizeRequirements(input.prohibitedConcepts);
  const overlap = requiredConcepts.filter((required) => prohibitedConcepts.some((prohibited) => prohibited.conceptId === required.conceptId));
  if (overlap.length) throw semanticRequirementsError("SEMANTIC_REQUIREMENT_CONFLICT", `Concepts cannot be both required and prohibited: ${overlap.map((item) => item.conceptId).join(", ")}`);
  const core = {
    schema: HARNESS_SEMANTIC_REQUIREMENTS_SCHEMA,
    foundationDigest: requiredDigest(input.foundationDigest, "foundationDigest"),
    requiredConcepts,
    prohibitedConcepts,
    relationRequirements: normalizeRelations(input.relationRequirements),
    evidenceRequirements: unique(input.evidenceRequirements),
    authority: { descriptiveConstraintOnly: true, executable: false, provesEligibility: false, mayApprove: false, mayPublish: false }
  };
  core.requirementsDigest = digest(core);
  return core;
}

export function evaluateSemanticCompatibility({ requirements, groundingResult, eligibility = null }) {
  const canonicalRequirements = createHarnessSemanticRequirements(requirements);
  validateGroundingResult(groundingResult);
  if (canonicalRequirements.foundationDigest !== groundingResult.foundationDigest) throw semanticRequirementsError("SEMANTIC_FOUNDATION_BINDING_MISMATCH", "Harness semantic requirements and grounding result use different Foundation digests.");
  const resolved = new Set(groundingResult.results.filter((item) => item.outcome === "RESOLVED").map((item) => item.resolvedConceptId));
  const missingRequired = canonicalRequirements.requiredConcepts.filter((item) => !resolved.has(item.conceptId));
  const presentProhibited = canonicalRequirements.prohibitedConcepts.filter((item) => resolved.has(item.conceptId));
  const unresolved = groundingResult.results.filter((item) => item.outcome !== "RESOLVED");
  const status = presentProhibited.length || missingRequired.length ? "INCOMPATIBLE" : unresolved.length ? "INDETERMINATE" : "COMPATIBLE";
  const core = {
    schema: SEMANTIC_COMPATIBILITY_REPORT_SCHEMA,
    status,
    requirementsDigest: canonicalRequirements.requirementsDigest,
    groundingResultDigest: groundingResult.groundingResultDigest,
    matchedRequiredConceptIds: canonicalRequirements.requiredConcepts.filter((item) => resolved.has(item.conceptId)).map((item) => item.conceptId),
    missingRequiredConceptIds: missingRequired.map((item) => item.conceptId),
    presentProhibitedConceptIds: presentProhibited.map((item) => item.conceptId),
    unresolvedCandidateIds: unresolved.map((item) => item.candidateId),
    eligibilityObservation: eligibility == null ? null : persistedJson(eligibility),
    authority: { semanticCompatibilityOnly: true, harnessEligibilityIndependent: true, mayOverrideEligibility: false, mayCreateProposal: false, mayApprove: false, mayPublish: false }
  };
  core.compatibilityReportDigest = digest(core);
  return core;
}

function normalizeRequirements(values = []) {
  if (!Array.isArray(values)) throw semanticRequirementsError("SEMANTIC_REQUIREMENTS_INVALID", "Semantic concept requirements must be arrays.");
  const result = values.map((item) => {
    const conceptId = String(item?.conceptId ?? "").trim();
    const metaType = String(item?.metaType ?? "").toUpperCase();
    if (!conceptId || !SEMANTIC_META_TYPES.includes(metaType)) throw semanticRequirementsError("SEMANTIC_REQUIREMENT_INVALID", "Each concept requirement needs conceptId and a valid Foundation metaType.");
    return { conceptId, metaType, rationale: String(item.rationale ?? "").trim(), evidenceRefs: unique(item.evidenceRefs) };
  });
  return [...new Map(result.map((item) => [item.conceptId, item])).values()].sort((left, right) => left.conceptId < right.conceptId ? -1 : left.conceptId > right.conceptId ? 1 : 0);
}

function normalizeRelations(values = []) {
  if (!Array.isArray(values)) throw semanticRequirementsError("SEMANTIC_RELATIONS_INVALID", "Semantic relation requirements must be arrays.");
  return values.map((item) => {
    const value = { subjectConceptId: String(item.subjectConceptId ?? "").trim(), relationType: String(item.relationType ?? "").trim(), objectConceptId: String(item.objectConceptId ?? "").trim() };
    if (!value.subjectConceptId || !value.objectConceptId || !SEMANTIC_RELATION_TYPES.includes(value.relationType)) throw semanticRequirementsError("SEMANTIC_RELATION_INVALID", "Each relation requirement needs two concept identifiers and one Foundation relation type.");
    return value;
  }).sort((left, right) => JSON.stringify(left) < JSON.stringify(right) ? -1 : JSON.stringify(left) > JSON.stringify(right) ? 1 : 0);
}

function validateGroundingResult(value) {
  const copy = persistedJson(value ?? {}); delete copy.groundingResultDigest;
  if (value?.schema !== ONTOLOGY_GROUNDING_RESULT_SCHEMA || value.groundingResultDigest !== digest(copy) || !value.results?.every((item) => GROUNDING_OUTCOMES.includes(item.outcome))) throw semanticRequirementsError("GROUNDING_RESULT_INVALID", "Semantic compatibility requires an immutable valid Ontology Grounding Result.");
}

function requiredDigest(value, field) { if (!/^sha256:[a-f0-9]{64}$/.test(String(value ?? ""))) throw semanticRequirementsError("SEMANTIC_DIGEST_REQUIRED", `${field} must be a sha256 digest.`); return String(value); }
function unique(values = []) { return [...new Set(values.map((item) => String(item).trim()).filter(Boolean))].sort(); }
function semanticRequirementsError(code, message) { const error = new Error(message); error.name = "SemanticCompatibilityError"; error.code = code; error.nextAction = "repair-semantic-requirements-or-grounding-binding"; return error; }
